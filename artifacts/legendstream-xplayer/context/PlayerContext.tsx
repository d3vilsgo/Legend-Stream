import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Channel,
  EpgProgram,
  loadEpg,
  loadProvider,
  normalizeXtreamBaseUrl,
  Provider,
  ProviderType,
} from "@/lib/iptv";
import { mapInBatches, yieldToUi } from "@/lib/cooperative";

export { ProviderType };
export type { Channel, EpgProgram };

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  playlistUrl: string;
  url: string;
  username?: string;
  password?: string;
  mac?: string;
  epgUrl?: string;
  connectedAt: string;
  createdAt: number;
  lastLoadedAt?: number;
  channelCount?: number;
  loadError?: string;
}

export type EpgSelection = { now?: EpgProgram; next?: EpgProgram };

const EPG_CACHE_TTL_MS = 15 * 60 * 1000;
const EPG_START_DELAY_MS = 1_200;
const STORAGE_KEY = "@legendstream/player-state-v3";
const LEGACY_STORAGE_KEY = "@legendstream/player-state-v2";
const LOGGED_OUT = "__logged_out__";

export function selectProgramsAt(
  programs: readonly EpgProgram[] | undefined,
  nowMs = Date.now(),
): EpgSelection {
  if (!programs?.length) return {};
  const currentIndex = programs.findIndex(
    (program) => program.start <= nowMs && nowMs < program.end,
  );
  if (currentIndex >= 0) {
    return { now: programs[currentIndex], next: programs[currentIndex + 1] };
  }
  return { next: programs.find((program) => program.start > nowMs) };
}

export function selectChannelEpg(
  epg: EpgProgram[],
  channel?: Channel,
  nowMs = Date.now(),
): EpgSelection {
  if (!channel) return {};
  return selectProgramsAt(
    epg
      .filter((program) => program.channelId === channel.id)
      .sort((a, b) => a.start - b.start),
    nowMs,
  );
}

interface PlayerState {
  providers: ProviderConfig[];
  provider: ProviderConfig | null;
  channels: Channel[];
  epg: EpgProgram[];
  favorites: string[];
  history: string[];
  activeProviderId?: string;
}

interface ProviderInput extends Omit<
  ProviderConfig,
  "id" | "connectedAt" | "createdAt" | "url" | "channelCount"
> {
  url?: string;
  epgUrl?: string;
  mac?: string;
}

interface PlayerContextValue extends PlayerState {
  epgByChannel: ReadonlyMap<string, readonly EpgProgram[]>;
  isHydrating: boolean;
  isSaving: boolean;
  isLoading: boolean;
  isEpgLoading: boolean;
  error: string | null;
  connectProvider: (config: ProviderInput) => Promise<boolean>;
  removeProvider: (providerId?: string) => Promise<void>;
  disconnectProvider: () => Promise<void>;
  refreshProvider: (providerId?: string) => Promise<void>;
  refreshEpg: (providerId?: string, channelId?: string) => Promise<void>;
  setActiveProvider: (providerId: string) => Promise<boolean>;
  toggleFavorite: (channelId: string) => Promise<void>;
  recordWatched: (channelId: string) => Promise<void>;
  clearError: () => void;
}

const emptyState: PlayerState = {
  providers: [],
  provider: null,
  channels: [],
  epg: [],
  favorites: [],
  history: [],
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

const toProvider = (provider: Provider): ProviderConfig => ({
  ...provider,
  playlistUrl: provider.url,
  connectedAt: new Date(provider.createdAt).toISOString(),
});

const fromProvider = (provider: ProviderConfig): Provider => ({
  id: provider.id,
  name: provider.name,
  type: provider.type,
  url: provider.url || provider.playlistUrl,
  username: provider.username,
  password: provider.password,
  mac: provider.mac,
  epgUrl: provider.epgUrl,
  createdAt: provider.createdAt,
  lastLoadedAt: provider.lastLoadedAt,
  channelCount: provider.channelCount,
  loadError: provider.loadError,
});

const normalizeUrl = (value: string) =>
  value.trim().replace(/\/+$/, "").toLowerCase();

function parseXtreamGetPhp(value: string) {
  try {
    const url = new URL(value.trim());
    if (!/\/get\.php$/i.test(url.pathname)) return null;
    const username = url.searchParams.get("username")?.trim();
    const password = url.searchParams.get("password") ?? "";
    const type = url.searchParams.get("type")?.toLowerCase();
    if (!username || !password || (type && type !== "m3u_plus")) return null;
    const path = url.pathname.replace(/\/get\.php$/i, "").replace(/\/+$/, "");
    return {
      baseUrl: `${url.origin}${path}`,
      username,
      password,
    };
  } catch {
    return null;
  }
}

function normalizeGetPhpIdentity(provider: Provider): Provider {
  const parsed = parseXtreamGetPhp(provider.url);
  return parsed
    ? {
        ...provider,
        type: "xtream",
        username: parsed.username,
        password: parsed.password,
      }
    : provider;
}

function toXtreamLoadProvider(provider: Provider): Provider {
  const parsed = parseXtreamGetPhp(provider.url);
  return parsed
    ? {
        ...provider,
        type: "xtream",
        url: parsed.baseUrl,
        username: parsed.username,
        password: parsed.password,
      }
    : provider;
}

async function loadProviderSmart(provider: Provider) {
  const parsed = parseXtreamGetPhp(provider.url);
  if (!parsed) {
    return { provider, loaded: await loadProvider(provider) };
  }

  const savedXtream: Provider = {
    ...provider,
    type: "xtream",
    username: parsed.username,
    password: parsed.password,
  };

  try {
    return {
      provider: savedXtream,
      loaded: await loadProvider(toXtreamLoadProvider(savedXtream)),
    };
  } catch {
    const fallback: Provider = {
      ...provider,
      type: "m3u",
      username: undefined,
      password: undefined,
    };
    return { provider: fallback, loaded: await loadProvider(fallback) };
  }
}

function xtreamBaseUrl(provider: Pick<ProviderConfig, "url" | "playlistUrl">) {
  const raw = provider.url || provider.playlistUrl;
  return parseXtreamGetPhp(raw)?.baseUrl ?? normalizeXtreamBaseUrl(raw);
}

const sameAccount = (a: ProviderConfig, b: Provider) =>
  normalizeUrl(a.url || a.playlistUrl) === normalizeUrl(b.url) &&
  (a.username || "") === (b.username || "") &&
  (a.mac || "").toLowerCase() === (b.mac || "").toLowerCase();

const readState = async (): Promise<PlayerState> => {
  let raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, raw);
      } catch {
        // best effort
      }
    }
  }
  if (!raw) return emptyState;
  try {
    const saved = JSON.parse(raw) as Partial<PlayerState>;
    const providers = (saved.providers ?? []).map((item) => ({
      ...item,
      url: item.url || item.playlistUrl,
      playlistUrl: item.playlistUrl || item.url,
    })) as ProviderConfig[];
    const activeProviderId = saved.activeProviderId;
    const provider =
      activeProviderId === LOGGED_OUT
        ? null
        : providers.find((item) => item.id === activeProviderId) ??
          (saved.provider
            ? providers.find((item) => item.id === saved.provider?.id) ?? null
            : providers[0] ?? null);
    return {
      providers,
      provider,
      channels: [],
      epg: [],
      favorites: Array.isArray(saved.favorites) ? saved.favorites.slice(0, 500) : [],
      history: Array.isArray(saved.history) ? saved.history.slice(0, 50) : [],
      activeProviderId: activeProviderId ?? provider?.id,
    };
  } catch {
    return emptyState;
  }
};

function decodeBase64Utf8(value: string) {
  try {
    if (typeof globalThis.atob !== "function") return value;
    const binary = globalThis.atob(value);
    const encoded = Array.from(binary, (char) =>
      `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
    ).join("");
    try {
      return decodeURIComponent(encoded);
    } catch {
      return binary;
    }
  } catch {
    return value;
  }
}

function decodeMaybeBase64(value: string) {
  const trimmed = value.trim();
  if (
    trimmed.length < 8 ||
    trimmed.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)
  ) {
    return value;
  }
  const decoded = decodeBase64Utf8(trimmed).trim();
  if (!decoded || decoded === trimmed) return value;
  const printable = Array.from(decoded).filter((char) => {
    const code = char.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || code >= 32;
  }).length;
  return printable / decoded.length >= 0.9 ? decoded : value;
}

async function normalizeProgramText(programs: EpgProgram[]) {
  return mapInBatches(
    programs,
    (program) => ({
      ...program,
      title: decodeMaybeBase64(program.title),
      description: program.description
        ? decodeMaybeBase64(program.description)
        : undefined,
    }),
    250,
  );
}

async function loadBulkProviderEpg(
  provider: ProviderConfig,
  channels: Channel[],
): Promise<EpgProgram[]> {
  let epgUrl = provider.epgUrl?.trim();
  if (
    !epgUrl &&
    provider.type === "xtream" &&
    provider.username &&
    provider.password
  ) {
    const baseUrl = xtreamBaseUrl(provider);
    epgUrl = `${baseUrl}/xmltv.php?username=${encodeURIComponent(
      provider.username,
    )}&password=${encodeURIComponent(provider.password)}`;
  }
  if (!epgUrl) return [];

  await yieldToUi();
  const programs = await loadEpg(
    {
      ...toXtreamLoadProvider(fromProvider(provider)),
      epgUrl,
    },
    channels,
  );
  return normalizeProgramText(programs);
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlayerState>(emptyState);
  const [isHydrating, setIsHydrating] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isEpgLoading, setIsEpgLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const epgCacheRef = useRef(
    new Map<string, { loadedAt: number; channelCount: number }>(),
  );
  const bulkEpgPromiseRef = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    readState()
      .then((saved) => {
        stateRef.current = saved;
        setState(saved);
        setIsHydrating(false);
      })
      .catch(() => setIsHydrating(false));
  }, []);

  const persist = async (next: PlayerState) => {
    stateRef.current = next;
    setState(next);
    try {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          providers: next.providers,
          provider: next.provider,
          activeProviderId: next.activeProviderId,
          favorites: next.favorites.slice(0, 500),
          history: next.history.slice(0, 50),
        }),
      );
    } catch {
      // keep in-memory session usable
    }
  };

  const connectProvider = async (config: ProviderInput) => {
    setIsLoading(true);
    setError(null);
    const candidate = normalizeGetPhpIdentity({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: config.name.trim() || "My provider",
      type: config.type,
      url: (config.url || config.playlistUrl).trim(),
      username: config.username?.trim() || undefined,
      password: config.password || undefined,
      mac: config.mac?.trim() || undefined,
      epgUrl: config.epgUrl?.trim() || undefined,
      createdAt: Date.now(),
    });

    try {
      const current = stateRef.current;
      const duplicate = current.providers.find((item) => sameAccount(item, candidate));
      const providerToLoad = duplicate
        ? { ...candidate, id: duplicate.id, createdAt: duplicate.createdAt }
        : candidate;
      const smart = await loadProviderSmart(providerToLoad);
      const savedProvider = toProvider({
        ...smart.provider,
        lastLoadedAt: Date.now(),
        channelCount: smart.loaded.channels.length,
        epgUrl: smart.provider.epgUrl || smart.loaded.epgUrl,
      });
      const providers = duplicate
        ? current.providers.map((item) =>
            item.id === duplicate.id ? savedProvider : item,
          )
        : [...current.providers, savedProvider];
      epgCacheRef.current.delete(savedProvider.id);
      await persist({
        ...current,
        providers,
        provider: savedProvider,
        activeProviderId: savedProvider.id,
        channels: [
          ...current.channels.filter(
            (channel) => channel.providerId !== savedProvider.id,
          ),
          ...smart.loaded.channels,
        ],
      });
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The provider could not be loaded.",
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const refreshProvider = async (providerId = stateRef.current.provider?.id) => {
    if (!providerId) return;
    const current = stateRef.current;
    const existing = current.providers.find((item) => item.id === providerId);
    if (!existing) return;
    setIsLoading(true);
    setError(null);
    try {
      const smart = await loadProviderSmart(fromProvider(existing));
      const updated = toProvider({
        ...smart.provider,
        lastLoadedAt: Date.now(),
        channelCount: smart.loaded.channels.length,
        epgUrl: smart.provider.epgUrl || smart.loaded.epgUrl,
        loadError: undefined,
      });
      epgCacheRef.current.delete(providerId);
      await persist({
        ...stateRef.current,
        provider:
          stateRef.current.provider?.id === providerId
            ? updated
            : stateRef.current.provider,
        providers: stateRef.current.providers.map((item) =>
          item.id === providerId ? updated : item,
        ),
        channels: [
          ...stateRef.current.channels.filter(
            (channel) => channel.providerId !== providerId,
          ),
          ...smart.loaded.channels,
        ],
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "The provider could not be refreshed.";
      setError(message);
      await persist({
        ...stateRef.current,
        providers: stateRef.current.providers.map((item) =>
          item.id === providerId ? { ...item, loadError: message } : item,
        ),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const setActiveProvider = async (providerId: string) => {
    const current = stateRef.current;
    const existing = current.providers.find((item) => item.id === providerId);
    if (!existing) return false;
    setIsLoading(true);
    setError(null);
    try {
      if (current.channels.some((channel) => channel.providerId === providerId)) {
        await persist({ ...current, provider: existing, activeProviderId: providerId });
        return true;
      }
      const smart = await loadProviderSmart(fromProvider(existing));
      const updated = toProvider({
        ...smart.provider,
        lastLoadedAt: Date.now(),
        channelCount: smart.loaded.channels.length,
        epgUrl: smart.provider.epgUrl || smart.loaded.epgUrl,
        loadError: undefined,
      });
      epgCacheRef.current.delete(providerId);
      await persist({
        ...stateRef.current,
        provider: updated,
        activeProviderId: providerId,
        providers: stateRef.current.providers.map((item) =>
          item.id === providerId ? updated : item,
        ),
        channels: [
          ...stateRef.current.channels.filter(
            (channel) => channel.providerId !== providerId,
          ),
          ...smart.loaded.channels,
        ],
      });
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The saved provider could not be opened.",
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectProvider = async () => {
    await persist({
      ...stateRef.current,
      provider: null,
      activeProviderId: LOGGED_OUT,
    });
  };

  const removeProvider = async (providerId = stateRef.current.provider?.id) => {
    if (!providerId) return;
    const current = stateRef.current;
    const providers = current.providers.filter((item) => item.id !== providerId);
    const channels = current.channels.filter(
      (channel) => channel.providerId !== providerId,
    );
    const channelIds = new Set(channels.map((channel) => channel.id));
    const nextProvider =
      current.provider?.id === providerId ? providers[0] ?? null : current.provider;
    epgCacheRef.current.delete(providerId);
    bulkEpgPromiseRef.current.delete(providerId);
    await persist({
      ...current,
      providers,
      provider: nextProvider,
      activeProviderId:
        nextProvider?.id ?? (providers.length ? providers[0].id : LOGGED_OUT),
      channels,
      favorites: current.favorites.filter((id) => channelIds.has(id)),
      history: current.history.filter((id) => channelIds.has(id)),
      epg: current.epg.filter((program) => channelIds.has(program.channelId)),
    });
  };

  const refreshEpg = useCallback(
    async (providerId?: string, channelId?: string) => {
      const snapshot = stateRef.current;
      const resolvedProviderId = providerId ?? snapshot.provider?.id;
      if (!resolvedProviderId) return;
      const provider = snapshot.providers.find(
        (item) => item.id === resolvedProviderId,
      );
      if (!provider) return;
      const providerChannels = snapshot.channels.filter(
        (channel) => channel.providerId === resolvedProviderId,
      );
      if (!providerChannels.length) return;

      if (!channelId) {
        const cached = epgCacheRef.current.get(resolvedProviderId);
        if (
          cached &&
          cached.channelCount === providerChannels.length &&
          Date.now() - cached.loadedAt < EPG_CACHE_TTL_MS
        ) {
          return;
        }
        const existingPromise = bulkEpgPromiseRef.current.get(resolvedProviderId);
        if (existingPromise) return existingPromise;

        setIsEpgLoading(true);
        const promise = (async () => {
          try {
            const programs = await loadBulkProviderEpg(provider, providerChannels);
            await yieldToUi();
            const ids = new Set(providerChannels.map((channel) => channel.id));
            setState((previous) => {
              const next = {
                ...previous,
                epg: [
                  ...previous.epg.filter((program) => !ids.has(program.channelId)),
                  ...programs,
                ],
              };
              stateRef.current = next;
              return next;
            });
          } catch {
            // EPG is optional; a timeout/parse problem must never block live TV.
          } finally {
            epgCacheRef.current.set(resolvedProviderId, {
              loadedAt: Date.now(),
              channelCount: providerChannels.length,
            });
            bulkEpgPromiseRef.current.delete(resolvedProviderId);
            setIsEpgLoading(false);
          }
        })();
        bulkEpgPromiseRef.current.set(resolvedProviderId, promise);
        await promise;
        return;
      }

      const inFlight = bulkEpgPromiseRef.current.get(resolvedProviderId);
      if (inFlight) await inFlight;
      const latest = stateRef.current;
      const targetChannel = latest.channels.find(
        (channel) =>
          channel.providerId === resolvedProviderId && channel.id === channelId,
      );
      if (!targetChannel) return;
      const now = Date.now();
      if (
        latest.epg.some(
          (program) => program.channelId === channelId && program.end > now,
        )
      ) {
        return;
      }
      if (provider.type !== "xtream") return;

      setIsEpgLoading(true);
      try {
        const programs = await normalizeProgramText(
          await loadEpg(
            {
              ...toXtreamLoadProvider(fromProvider(provider)),
              epgUrl: undefined,
            },
            [targetChannel],
          ),
        );
        setState((previous) => {
          const next = {
            ...previous,
            epg: [
              ...previous.epg.filter((program) => program.channelId !== channelId),
              ...programs,
            ],
          };
          stateRef.current = next;
          return next;
        });
      } catch {
        // active-channel fallback is optional
      } finally {
        setIsEpgLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (isHydrating || !state.provider) return;
    if (
      !state.channels.some((channel) => channel.providerId === state.provider?.id)
    ) {
      return;
    }

    // Live channels must become visible/respond to input before bulk XMLTV work
    // starts. This intentionally decouples "load live TV" from EPG refresh.
    let cancelled = false;
    const providerId = state.provider.id;
    const timer = setTimeout(() => {
      void (async () => {
        await yieldToUi();
        if (!cancelled) await refreshEpg(providerId);
      })();
    }, EPG_START_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    isHydrating,
    state.provider?.id,
    state.provider?.lastLoadedAt,
    state.channels,
    refreshEpg,
  ]);

  const toggleFavorite = async (channelId: string) => {
    const current = stateRef.current;
    const favorites = current.favorites.includes(channelId)
      ? current.favorites.filter((id) => id !== channelId)
      : [...current.favorites, channelId];
    await persist({ ...current, favorites });
  };

  const recordWatched = async (channelId: string) => {
    const current = stateRef.current;
    await persist({
      ...current,
      history: [
        channelId,
        ...current.history.filter((id) => id !== channelId),
      ].slice(0, 50),
    });
  };

  const epgByChannel = useMemo(() => {
    const map = new Map<string, EpgProgram[]>();
    for (const program of state.epg) {
      const programs = map.get(program.channelId);
      if (programs) programs.push(program);
      else map.set(program.channelId, [program]);
    }
    for (const programs of map.values()) programs.sort((a, b) => a.start - b.start);
    return map as ReadonlyMap<string, readonly EpgProgram[]>;
  }, [state.epg]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      ...state,
      epgByChannel,
      isHydrating,
      isSaving: isLoading,
      isLoading,
      isEpgLoading,
      error,
      connectProvider,
      removeProvider,
      disconnectProvider,
      refreshProvider,
      refreshEpg,
      setActiveProvider,
      toggleFavorite,
      recordWatched,
      clearError: () => setError(null),
    }),
    [
      state,
      epgByChannel,
      isHydrating,
      isLoading,
      isEpgLoading,
      error,
      refreshEpg,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used within PlayerProvider");
  return context;
}
