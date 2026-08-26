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
  ProviderLoadError,
  ProviderType,
} from "@/lib/iptv";
import { mapInBatches, yieldToUi } from "@/lib/cooperative";
import { deleteCredentials, getCredentials, saveCredentials, type ProviderSecrets } from "@/lib/secureCredentials";

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
const LARGE_PROVIDER_CHANNEL_THRESHOLD = 1_000;
const LARGE_PROVIDER_INITIAL_EPG_CHANNELS = 48;
const XTREAM_PROBE_TIMEOUT_MS = 7_000;
const PROVIDER_CONNECT_TIMEOUT_MS = 30_000;
const STORAGE_KEY = "@legendstream/player-state-v3";
const LEGACY_STORAGE_KEY = "@legendstream/player-state-v2";
const SECURE_MIGRATION_KEY = "@legendstream/secure-credentials-v3";
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
  removeWatched: (channelId: string) => Promise<void>;
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

type ParsedGetPhp = NonNullable<ReturnType<typeof parseXtreamGetPhp>>;

async function probeXtreamApi(parsed: ParsedGetPhp) {
  try {
    const apiUrl = new URL("player_api.php", `${parsed.baseUrl}/`);
    apiUrl.searchParams.set("username", parsed.username);
    apiUrl.searchParams.set("password", parsed.password);
    const response = await fetch(apiUrl.toString(), {
      headers: { Accept: "application/json,*/*" },
      signal: AbortSignal.timeout(XTREAM_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const text = await response.text();
    const payload = JSON.parse(text) as {
      user_info?: { auth?: number | string; status?: string };
    };
    const userInfo = payload?.user_info;
    if (!userInfo || typeof userInfo !== "object") return false;
    const auth = userInfo.auth;
    if (auth === 0 || auth === "0") return false;
    const status = String(userInfo.status ?? "").toLowerCase();
    if (["disabled", "banned", "expired"].includes(status)) return false;
    return auth === 1 || auth === "1" || status === "active";
  } catch {
    return false;
  }
}

async function resolveProviderOnConnect(provider: Provider): Promise<Provider> {
  // An explicitly selected M3U source is authoritative. Never silently turn it
  // into Xtream merely because its URL happens to be a get.php/m3u_plus link.
  if (provider.type !== "xtream") return provider;

  const parsed = parseXtreamGetPhp(provider.url);
  if (!parsed) return provider;

  // get.php can be exposed by both full Xtream servers and playlist-only
  // gateways. Promote only after a cheap, bounded player_api.php auth probe.
  if (await probeXtreamApi(parsed)) {
    return {
      ...provider,
      type: "xtream",
      username: parsed.username,
      password: parsed.password,
    };
  }

  return {
    ...provider,
    type: "m3u",
    username: undefined,
    password: undefined,
  };
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
  // The saved type is authoritative for explicit M3U/Stalker accounts. This
  // also prevents Home/VOD from ever entering player_api.php for M3U sources.
  if (provider.type !== "xtream") {
    return { provider, loaded: await loadProvider(provider) };
  }

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
    // Migration path for accounts that older APKs blindly persisted as Xtream.
    // A failed player_api.php load silently falls back to the original get.php
    // playlist and callers persist this resolved M3U type after the load.
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

type StoredProviderConfig = Omit<
  ProviderConfig,
  "url" | "playlistUrl" | "epgUrl" | "username" | "password" | "mac"
>;

function providerSecretsFrom(provider: Partial<ProviderConfig>): ProviderSecrets {
  return {
    url: typeof provider.url === "string" ? provider.url : undefined,
    playlistUrl: typeof provider.playlistUrl === "string" ? provider.playlistUrl : undefined,
    epgUrl: typeof provider.epgUrl === "string" ? provider.epgUrl : undefined,
    username: typeof provider.username === "string" ? provider.username : undefined,
    password: typeof provider.password === "string" ? provider.password : undefined,
    mac: typeof provider.mac === "string" ? provider.mac : undefined,
  };
}

function hasProviderSecrets(secrets: ProviderSecrets) {
  return Object.values(secrets).some((value) => typeof value === "string" && value.length > 0);
}

function mergeProviderSecrets(...sources: Array<ProviderSecrets | null | undefined>): ProviderSecrets {
  const merged: ProviderSecrets = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source) as Array<[
      keyof ProviderSecrets,
      string | undefined,
    ]>) {
      if (typeof value === "string" && value.length > 0) merged[key] = value;
    }
  }
  return merged;
}

function hasRequiredProviderSecrets(type: ProviderType, secrets: ProviderSecrets) {
  const url = secrets.url || secrets.playlistUrl || "";
  if (!url) return false;
  if (type === "xtream") {
    const parsed = parseXtreamGetPhp(url);
    return Boolean((secrets.username && secrets.password) || (parsed?.username && parsed.password));
  }
  if (type === "stalker") return Boolean(secrets.mac);
  return true;
}

function storedProviderFrom(provider: ProviderConfig): StoredProviderConfig {
  const {
    url: _url,
    playlistUrl: _playlistUrl,
    epgUrl: _epgUrl,
    username: _username,
    password: _password,
    mac: _mac,
    ...metadata
  } = provider;
  return metadata;
}

function serializedPlayerState(next: PlayerState) {
  return JSON.stringify({
    providers: next.providers.map(storedProviderFrom),
    provider: next.provider ? storedProviderFrom(next.provider) : null,
    activeProviderId: next.activeProviderId,
    favorites: next.favorites.slice(0, 500),
    history: next.history.slice(0, 50),
  });
}

async function hydrateStoredProvider(
  stored: ProviderConfig | StoredProviderConfig,
  legacySecrets?: ProviderSecrets,
): Promise<ProviderConfig> {
  const secure = await getCredentials(stored.id).catch(() => null);
  const secrets = mergeProviderSecrets(
    legacySecrets,
    providerSecretsFrom(stored as ProviderConfig),
    secure,
  );
  const url = secrets.url || secrets.playlistUrl || "";
  return {
    ...stored,
    url,
    playlistUrl: secrets.playlistUrl || secrets.url || "",
    epgUrl: secrets.epgUrl,
    username: secrets.username,
    password: secrets.password,
    mac: secrets.mac,
  } as ProviderConfig;
}

async function saveProviderSecrets(provider: ProviderConfig) {
  await saveCredentials(provider.id, providerSecretsFrom(provider));
}

const readState = async (): Promise<PlayerState> => {
  const primaryRaw = await AsyncStorage.getItem(STORAGE_KEY);
  const legacyRaw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
  const raw = primaryRaw ?? legacyRaw;
  if (!raw) return emptyState;

  try {
    const saved = JSON.parse(raw) as Partial<PlayerState>;
    const legacySaved = legacyRaw ? (JSON.parse(legacyRaw) as Partial<PlayerState>) : undefined;
    const storedProviders = (saved.providers ?? []) as ProviderConfig[];
    const recoveryById = new Map<string, ProviderSecrets>();

    const collectRecovery = (candidate?: Partial<PlayerState>) => {
      for (const item of (candidate?.providers ?? []) as ProviderConfig[]) {
        recoveryById.set(
          item.id,
          mergeProviderSecrets(recoveryById.get(item.id), providerSecretsFrom(item)),
        );
      }
      if (candidate?.provider?.id) {
        recoveryById.set(
          candidate.provider.id,
          mergeProviderSecrets(
            recoveryById.get(candidate.provider.id),
            providerSecretsFrom(candidate.provider),
          ),
        );
      }
    };

    // v2 may still contain the plaintext credentials that an earlier broken
    // v3 migration failed to secure. Read both stores, not only v2-as-fallback.
    collectRecovery(legacySaved);
    collectRecovery(saved);

    let migrationSucceeded = true;
    const providers = await Promise.all(
      storedProviders.map(async (item) => {
        const recovered = recoveryById.get(item.id);
        const hydrated = await hydrateStoredProvider(item, recovered);
        const secrets = providerSecretsFrom(hydrated);
        if (!hasRequiredProviderSecrets(hydrated.type, secrets)) {
          migrationSucceeded = false;
          return hydrated;
        }
        try {
          await saveCredentials(item.id, secrets);
        } catch {
          migrationSucceeded = false;
        }
        return hydrated;
      }),
    );

    const activeProviderId = saved.activeProviderId;
    const provider =
      activeProviderId === LOGGED_OUT
        ? null
        : providers.find((item) => item.id === activeProviderId) ??
          (saved.provider
            ? providers.find((item) => item.id === saved.provider?.id) ?? null
            : providers[0] ?? null);
    const next: PlayerState = {
      providers,
      provider,
      channels: [],
      epg: [],
      favorites: Array.isArray(saved.favorites) ? saved.favorites.slice(0, 500) : [],
      history: Array.isArray(saved.history) ? saved.history.slice(0, 50) : [],
      activeProviderId: activeProviderId ?? provider?.id,
    };

    if (migrationSucceeded) {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, serializedPlayerState(next));
        await AsyncStorage.setItem(SECURE_MIGRATION_KEY, "1");
        await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // SecureStore already owns the secrets. A later persist will retry metadata cleanup.
      }
    }
    return next;
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

function compactEpgPrograms(programs: EpgProgram[], nowMs = Date.now()) {
  const byChannel = new Map<string, EpgProgram[]>();
  for (const program of programs) {
    if (!Number.isFinite(program.start) || !Number.isFinite(program.end)) continue;
    const list = byChannel.get(program.channelId);
    if (list) list.push(program);
    else byChannel.set(program.channelId, [program]);
  }

  const compact: EpgProgram[] = [];
  for (const list of byChannel.values()) {
    list.sort((a, b) => a.start - b.start);
    const currentIndex = list.findIndex(
      (program) => program.start <= nowMs && nowMs < program.end,
    );
    if (currentIndex >= 0) {
      compact.push(list[currentIndex]);
      if (list[currentIndex + 1]) compact.push(list[currentIndex + 1]);
      continue;
    }
    const nextIndex = list.findIndex((program) => program.start > nowMs);
    if (nextIndex >= 0) {
      compact.push(list[nextIndex]);
      if (list[nextIndex + 1]) compact.push(list[nextIndex + 1]);
    }
  }
  return compact;
}

async function normalizeProgramText(programs: EpgProgram[]) {
  const normalized = await mapInBatches(
    programs,
    (program) => ({
      ...program,
      title: decodeMaybeBase64(program.title),
      description: undefined,
    }),
    250,
  );
  return compactEpgPrograms(normalized);
}

async function loadBulkProviderEpg(
  provider: ProviderConfig,
  channels: Channel[],
): Promise<EpgProgram[]> {
  const xtreamProvider = toXtreamLoadProvider(fromProvider(provider));

  if (
    provider.type === "xtream" &&
    channels.length >= LARGE_PROVIDER_CHANNEL_THRESHOLD
  ) {
    await yieldToUi();
    const seedChannels = channels.slice(0, LARGE_PROVIDER_INITIAL_EPG_CHANNELS);
    const programs = await loadEpg(
      {
        ...xtreamProvider,
        epgUrl: undefined,
      },
      seedChannels,
    );
    return normalizeProgramText(programs);
  }

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
      ...xtreamProvider,
      epgUrl,
    },
    channels,
  );
  return normalizeProgramText(programs);
}

function withProviderConnectDeadline<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new ProviderLoadError(
          "The provider connection timed out. Check the URL, server response time, and try again.",
          "PROVIDER_TIMEOUT",
        ),
      );
    }, PROVIDER_CONNECT_TIMEOUT_MS);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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
      // Do not sanitize metadata or delete the legacy recovery store unless
      // every remaining provider has a complete credential set secured first.
      const providersToSecure = new Map<string, ProviderConfig>();
      for (const item of next.providers) providersToSecure.set(item.id, item);
      if (next.provider) providersToSecure.set(next.provider.id, next.provider);
      for (const item of providersToSecure.values()) {
        const secrets = providerSecretsFrom(item);
        if (!hasRequiredProviderSecrets(item.type, secrets)) {
          throw new Error("Provider credentials are incomplete; preserving recovery storage.");
        }
        await saveProviderSecrets(item);
      }

      await AsyncStorage.setItem(STORAGE_KEY, serializedPlayerState(next));
      await AsyncStorage.setItem(SECURE_MIGRATION_KEY, "1");
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Keep the in-memory session usable and preserve previous on-disk state.
    }
  };

  const connectProvider = async (config: ProviderInput) => {
    setIsLoading(true);
    setError(null);

    try {
      const rawCandidate: Provider = {
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
      const candidate = await resolveProviderOnConnect(rawCandidate);
      const current = stateRef.current;
      const duplicate = current.providers.find((item) => sameAccount(item, candidate));
      const providerToLoad = duplicate
        ? { ...candidate, id: duplicate.id, createdAt: duplicate.createdAt }
        : candidate;
      const smart = await withProviderConnectDeadline(loadProviderSmart(providerToLoad));
      const savedProvider = toProvider({
        ...smart.provider,
        lastLoadedAt: Date.now(),
        channelCount: smart.loaded.channels.length,
        epgUrl: smart.provider.epgUrl || smart.loaded.epgUrl,
      });
      await saveProviderSecrets(savedProvider);
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
      await saveProviderSecrets(updated);
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
      await saveProviderSecrets(updated);
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
    await deleteCredentials(providerId).catch(() => undefined);
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

  const removeWatched = async (channelId: string) => {
    const current = stateRef.current;
    await persist({
      ...current,
      history: current.history.filter((id) => id !== channelId),
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
      removeWatched,
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
