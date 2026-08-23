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
  parseXmltv,
  Provider,
  ProviderType,
} from "@/lib/iptv";

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

export type EpgSelection = {
  now?: EpgProgram;
  next?: EpgProgram;
};

const EPG_CACHE_TTL_MS = 15 * 60 * 1000;

export function selectProgramsAt(
  programs: readonly EpgProgram[] | undefined,
  nowMs = Date.now(),
): EpgSelection {
  if (!programs?.length) return {};
  const currentIndex = programs.findIndex(
    (program) => program.start <= nowMs && nowMs < program.end,
  );
  if (currentIndex >= 0) {
    return {
      now: programs[currentIndex],
      next: programs[currentIndex + 1],
    };
  }
  return {
    next: programs.find((program) => program.start > nowMs),
  };
}

/**
 * EPG programs are normalized to the app's internal channel id by loadEpg()/parseXmltv().
 * XMLTV uses tvg-id/name -> channel.id mapping; Xtream short EPG is attached directly
 * to the active Xtream channel id.
 */
export function selectChannelEpg(
  epg: EpgProgram[],
  channel?: Channel,
  nowMs = Date.now(),
): EpgSelection {
  if (!channel) return {};
  const programs = epg
    .filter((program) => program.channelId === channel.id)
    .sort((a, b) => a.start - b.start);
  return selectProgramsAt(programs, nowMs);
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

const STORAGE_KEY = "@legendstream/player-state-v3";
const LEGACY_STORAGE_KEY = "@legendstream/player-state-v2";
const LOGGED_OUT = "__logged_out__";
const PlayerContext = createContext<PlayerContextValue | null>(null);

const emptyState: PlayerState = {
  providers: [],
  provider: null,
  channels: [],
  epg: [],
  favorites: [],
  history: [],
};

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

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();

const sameAccount = (a: ProviderConfig, b: Provider) =>
  a.type === b.type &&
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
        // best-effort migration
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

function normalizeProgramText(programs: EpgProgram[]) {
  return programs.map((program) => ({
    ...program,
    title: decodeMaybeBase64(program.title),
    description: program.description
      ? decodeMaybeBase64(program.description)
      : undefined,
  }));
}

async function loadBulkProviderEpg(
  provider: ProviderConfig,
  channels: Channel[],
): Promise<EpgProgram[]> {
  let epgUrl = provider.epgUrl?.trim();
  if (!epgUrl && provider.type === "xtream" && provider.username && provider.password) {
    const baseUrl = normalizeXtreamBaseUrl(provider.url || provider.playlistUrl);
    epgUrl = `${baseUrl}/xmltv.php?username=${encodeURIComponent(provider.username)}&password=${encodeURIComponent(provider.password)}`;
  }
  if (!epgUrl) return [];

  const response = await fetch(epgUrl, {
    headers: { Accept: "application/xml,text/xml,*/*" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`EPG request failed with ${response.status}.`);
  }
  const xml = await response.text();
  // Let channel names render first; parse the potentially large XMLTV on the next turn.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return normalizeProgramText(parseXmltv(xml, channels));
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlayerState>(emptyState);
  const [isHydrating, setIsHydrating] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isEpgLoading, setIsEpgLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const epgCacheRef = useRef(new Map<string, { loadedAt: number; channelCount: number }>());
  const bulkEpgPromiseRef = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    readState()
      .then((saved) => {
        setState(saved);
        setIsHydrating(false);
      })
      .catch(() => setIsHydrating(false));
  }, []);

  const persist = async (next: PlayerState) => {
    stateRef.current = next;
    setState(next);
    const persisted = {
      providers: next.providers,
      provider: next.provider,
      activeProviderId: next.activeProviderId,
      favorites: next.favorites.slice(0, 500),
      history: next.history.slice(0, 50),
    };
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // Storage is best-effort; keep the in-memory session usable.
    }
  };

  const connectProvider = async (config: ProviderInput) => {
    setIsLoading(true);
    setError(null);
    const candidate: Provider = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: config.name.trim() || "My provider",
      type: config.type,
      url: (config.url || config.playlistUrl).trim(),
      username: config.username?.trim() || undefined,
      password: config.password || undefined,
      mac: config.mac?.trim() || undefined,
      epgUrl: config.epgUrl?.trim() || undefined,
      createdAt: Date.now(),
    };

    try {
      const current = stateRef.current;
      const duplicate = current.providers.find((item) => sameAccount(item, candidate));
      const providerToLoad = duplicate
        ? { ...candidate, id: duplicate.id, createdAt: duplicate.createdAt }
        : candidate;
      const loaded = await loadProvider(providerToLoad);
      const savedProvider = toProvider({
        ...providerToLoad,
        lastLoadedAt: Date.now(),
        channelCount: loaded.channels.length,
        epgUrl: providerToLoad.epgUrl || loaded.epgUrl,
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
          ...current.channels.filter((channel) => channel.providerId !== savedProvider.id),
          ...loaded.channels,
        ],
      });
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The provider could not be loaded.");
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
      const loaded = await loadProvider(fromProvider(existing));
      const updated: ProviderConfig = {
        ...existing,
        lastLoadedAt: Date.now(),
        channelCount: loaded.channels.length,
        epgUrl: existing.epgUrl || loaded.epgUrl,
        loadError: undefined,
      };
      epgCacheRef.current.delete(providerId);
      await persist({
        ...stateRef.current,
        provider: stateRef.current.provider?.id === providerId ? updated : stateRef.current.provider,
        providers: stateRef.current.providers.map((item) =>
          item.id === providerId ? updated : item,
        ),
        channels: [
          ...stateRef.current.channels.filter((channel) => channel.providerId !== providerId),
          ...loaded.channels,
        ],
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The provider could not be refreshed.";
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
      const alreadyLoaded = current.channels.some(
        (channel) => channel.providerId === providerId,
      );
      if (alreadyLoaded) {
        await persist({ ...current, provider: existing, activeProviderId: providerId });
        return true;
      }
      const loaded = await loadProvider(fromProvider(existing));
      const updated: ProviderConfig = {
        ...existing,
        lastLoadedAt: Date.now(),
        channelCount: loaded.channels.length,
        epgUrl: existing.epgUrl || loaded.epgUrl,
        loadError: undefined,
      };
      epgCacheRef.current.delete(providerId);
      await persist({
        ...stateRef.current,
        provider: updated,
        activeProviderId: providerId,
        providers: stateRef.current.providers.map((item) =>
          item.id === providerId ? updated : item,
        ),
        channels: [
          ...stateRef.current.channels.filter((channel) => channel.providerId !== providerId),
          ...loaded.channels,
        ],
      });
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The saved provider could not be opened.");
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectProvider = async () => {
    await persist({ ...stateRef.current, provider: null, activeProviderId: LOGGED_OUT });
  };

  const removeProvider = async (providerId = stateRef.current.provider?.id) => {
    if (!providerId) return;
    const current = stateRef.current;
    const providers = current.providers.filter((item) => item.id !== providerId);
    const channels = current.channels.filter((channel) => channel.providerId !== providerId);
    const favorites = current.favorites.filter((id) =>
      channels.some((channel) => channel.id === id),
    );
    const history = current.history.filter((id) =>
      channels.some((channel) => channel.id === id),
    );
    const nextProvider = current.provider?.id === providerId ? providers[0] ?? null : current.provider;
    epgCacheRef.current.delete(providerId);
    bulkEpgPromiseRef.current.delete(providerId);
    await persist({
      ...current,
      providers,
      provider: nextProvider,
      activeProviderId: nextProvider?.id ?? (providers.length ? providers[0].id : LOGGED_OUT),
      channels,
      favorites,
      history,
      epg: current.epg.filter((program) =>
        channels.some((channel) => channel.id === program.channelId),
      ),
    });
  };

  const refreshEpg = useCallback(async (providerId?: string, channelId?: string) => {
    const snapshot = stateRef.current;
    const resolvedProviderId = providerId ?? snapshot.provider?.id;
    if (!resolvedProviderId) return;
    const provider = snapshot.providers.find((item) => item.id === resolvedProviderId);
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
      if (existingPromise) {
        await existingPromise;
        return;
      }

      setIsEpgLoading(true);
      const promise = (async () => {
        try {
          const programs = await loadBulkProviderEpg(provider, providerChannels);
          const channelIds = new Set(providerChannels.map((channel) => channel.id));
          setState((previous) => {
            const next = {
              ...previous,
              epg: [
                ...previous.epg.filter((program) => !channelIds.has(program.channelId)),
                ...programs,
              ],
            };
            stateRef.current = next;
            return next;
          });
        } catch {
          // Bulk EPG is optional. Keep any previous cache and do not break channels/playback.
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

    const inFlightBulk = bulkEpgPromiseRef.current.get(resolvedProviderId);
    if (inFlightBulk) await inFlightBulk;

    const latest = stateRef.current;
    const targetChannel = latest.channels.find(
      (channel) => channel.providerId === resolvedProviderId && channel.id === channelId,
    );
    if (!targetChannel) return;
    const cachedPrograms = latest.epg.filter((program) => program.channelId === channelId);
    const now = Date.now();
    if (cachedPrograms.some((program) => program.end > now)) return;

    // Only Xtream gets a per-channel network fallback. The live list never calls this path.
    if (provider.type !== "xtream") return;
    setIsEpgLoading(true);
    try {
      const programs = normalizeProgramText(
        await loadEpg({ ...fromProvider(provider), epgUrl: undefined }, [targetChannel]),
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
      // Active-channel fallback is optional; leave playback running.
    } finally {
      setIsEpgLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isHydrating || !state.provider) return;
    const count = state.channels.filter(
      (channel) => channel.providerId === state.provider?.id,
    ).length;
    if (!count) return;
    void refreshEpg(state.provider.id);
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
      history: [channelId, ...current.history.filter((id) => id !== channelId)].slice(0, 50),
    });
  };

  const epgByChannel = useMemo(() => {
    const map = new Map<string, EpgProgram[]>();
    for (const program of state.epg) {
      const existing = map.get(program.channelId);
      if (existing) existing.push(program);
      else map.set(program.channelId, [program]);
    }
    for (const programs of map.values()) {
      programs.sort((a, b) => a.start - b.start);
    }
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
    [state, epgByChannel, isHydrating, isLoading, isEpgLoading, error, refreshEpg],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used within PlayerProvider");
  return context;
}
