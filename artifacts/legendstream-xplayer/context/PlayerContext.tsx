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
import { deleteCredentials, readCredentials, saveCredentials, type ProviderSecrets } from "@/lib/secureCredentials";
import { credentialFieldsEqual, hasRequiredCredentialFields, migratedLegacyStateAfterVerification, resolveCredentialState } from "@/lib/providerCredentialState";
import type { ProviderMetadataCommitMetrics } from "@/lib/providerBackupService";
import {
  consumeM3UCacheActivation,
  hydrateM3UProviderCache,
  markM3UCacheActivation,
} from "@/lib/m3uCatalogCache";
import { persistM3ULoadInBackground } from "@/lib/m3uCacheWriteRunner";
import {
  resolveM3UTransport,
  resolvedProviderTransport,
  type M3UTransportResolutionReason,
  type ProviderTransport,
} from "@/lib/m3uTransportRouting";
import { safeLog } from "@/lib/safeLog";
import {
  chooseProviderSwitchPath,
  hasPrimedProviderSwitchSnapshot,
  peekProviderSwitchSnapshot,
  safeProviderSwitchError,
} from "@/lib/providerSwitchUx";
import {
  clearLiveHistoryProvider,
  commitLiveHistoryV2,
  emptyLiveHistoryV2,
  historyForProvider,
  migrateLiveHistoryStorage,
  providerIdFromChannelId,
  recordLiveHistory,
  removeLiveHistory,
  type LiveHistoryV2,
} from "@/lib/liveHistory";
import {
  LegacyCatalogFallbackAttemptGuard,
  shouldFallbackLegacyXtreamCatalogToM3U,
} from "@/lib/legacyCatalogFallback";

export { ProviderType };
export type { Channel, EpgProgram };

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  declaredType?: ProviderType;
  transport?: ProviderTransport;
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
  needsCredentials: boolean;
}

export type EpgSelection = { now?: EpgProgram; next?: EpgProgram };

const EPG_CACHE_TTL_MS = 15 * 60 * 1000;
const EPG_START_DELAY_MS = 1_200;
const M3U_BACKGROUND_REFRESH_DELAY_MS = 1_250;
const LARGE_PROVIDER_CHANNEL_THRESHOLD = 1_000;
const LARGE_PROVIDER_INITIAL_EPG_CHANNELS = 48;
const XTREAM_PROBE_TIMEOUT_MS = 7_000;
const PROVIDER_CONNECT_TIMEOUT_MS = 30_000;
const STORAGE_KEY = "@legendstream/player-state-v3";
const LEGACY_STORAGE_KEY = "@legendstream/player-state-v2";
const SECURE_MIGRATION_KEY = "@legendstream/secure-credentials-v2";
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
  "id" | "connectedAt" | "createdAt" | "url" | "channelCount" | "needsCredentials"
> {
  providerId?: string;
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
  mergeImportedProviders: (providers: ProviderConfig[]) => Promise<ProviderMetadataCommitMetrics>;
  removeProvider: (providerId?: string) => Promise<void>;
  disconnectProvider: () => Promise<void>;
  refreshProvider: (providerId?: string) => Promise<void>;
  recoverLegacyCatalogFallback: (providerId: string, error: unknown) => Promise<boolean>;
  refreshEpg: (providerId?: string, channelId?: string) => Promise<void>;
  resolveProviderForSwitch: (providerId: string) => Promise<ProviderConfig | null>;
  setActiveProvider: (providerId: string) => Promise<boolean>;
  toggleFavorite: (channelId: string) => Promise<void>;
  recordWatched: (channelId: string) => Promise<void>;
  removeWatched: (channelId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
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

type RoutedProvider = Provider & {
  declaredType?: ProviderType;
  transport?: ProviderTransport;
  playlistUrl?: string;
};

const toProvider = (provider: RoutedProvider): ProviderConfig => ({
  ...provider,
  declaredType: provider.declaredType ?? provider.type,
  transport: provider.transport ?? (
    provider.type === "xtream" || provider.type === "m3u" ? provider.type : undefined
  ),
  playlistUrl: provider.playlistUrl || provider.url,
  connectedAt: new Date(provider.createdAt).toISOString(),
  needsCredentials: false,
});

const fromProvider = (provider: ProviderConfig): RoutedProvider => ({
  id: provider.id,
  name: provider.name,
  type: provider.type,
  declaredType: provider.declaredType ?? provider.type,
  transport: provider.transport ?? (
    provider.type === "xtream" || provider.type === "m3u" ? provider.type : undefined
  ),
  url: provider.url || provider.playlistUrl,
  playlistUrl: provider.playlistUrl || provider.url,
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

function logProviderTransport(
  providerType: ProviderType,
  resolvedTransport: string | undefined,
  resolutionReason: M3UTransportResolutionReason,
) {
  safeLog.info("LS_PROVIDER_TRANSPORT", {
    providerType,
    resolvedTransport: resolvedTransport ?? "unknown",
    resolutionReason,
  });
}

// Transport diagnostics above are deliberately identity-free and credential-free.
// Keep source locations, account fields, and endpoint details outside that event payload.

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

async function resolveProviderTransport(provider: RoutedProvider): Promise<RoutedProvider> {
  const declaredType = provider.declaredType ?? provider.type;
  if (declaredType === "m3u") {
    const source = provider.playlistUrl || provider.url;
    const resolution = await resolveM3UTransport(source);
    logProviderTransport(resolution.declaredType, resolution.transport, resolution.reason);
    if (resolution.transport === "xtream" && resolution.credentials) {
      return {
        ...provider,
        type: "xtream",
        declaredType: "m3u",
        transport: "xtream",
        url: resolution.credentials.baseUrl,
        playlistUrl: source,
        username: resolution.credentials.username,
        password: resolution.credentials.password,
      };
    }
    return {
      ...provider,
      type: "m3u",
      declaredType: "m3u",
      transport: "m3u",
      url: source,
      playlistUrl: source,
      username: undefined,
      password: undefined,
    };
  }

  if (declaredType !== "xtream") return { ...provider, declaredType };
  const parsed = parseXtreamGetPhp(provider.url);
  if (!parsed) {
    return { ...provider, type: "xtream", declaredType: "xtream", transport: "xtream" };
  }
  if (await probeXtreamApi(parsed)) {
    return {
      ...provider,
      type: "xtream",
      declaredType: "xtream",
      transport: "xtream",
      username: parsed.username,
      password: parsed.password,
    };
  }
  return {
    ...provider,
    type: "m3u",
    declaredType: "xtream",
    transport: "m3u",
    username: undefined,
    password: undefined,
  };
}

function toXtreamLoadProvider(provider: RoutedProvider): Provider {
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

async function loadProviderSmart(provider: RoutedProvider) {
  if (resolvedProviderTransport(provider) !== "xtream") {
    const loaded = await loadProvider(provider);
    persistM3ULoadInBackground(provider, loaded);
    return { provider, loaded };
  }
  const parsed = parseXtreamGetPhp(provider.url);
  if (!parsed) {
    return { provider, loaded: await loadProvider(provider) };
  }
  const savedXtream: RoutedProvider = {
    ...provider,
    type: "xtream",
    transport: "xtream",
    username: parsed.username,
    password: parsed.password,
  };
  try {
    return {
      provider: savedXtream,
      loaded: await loadProvider(toXtreamLoadProvider(savedXtream)),
    };
  } catch {
    const fallback: RoutedProvider = {
      ...provider,
      type: "m3u",
      transport: "m3u",
      url: provider.playlistUrl || provider.url,
      username: undefined,
      password: undefined,
    };
    const loaded = await loadProvider(fallback);
    persistM3ULoadInBackground(fallback, loaded);
    return { provider: fallback, loaded };
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
  });
}

function parseStoredPlayerState(raw: string | null, label: string): Partial<PlayerState> | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Stored player state is not an object.");
    }
    return parsed as Partial<PlayerState>;
  } catch {
    throw new Error(`${label} player state could not be read.`);
  }
}

function providersFromStoredState(saved: Partial<PlayerState> | null): ProviderConfig[] {
  if (!saved) return [];
  const providers = Array.isArray(saved.providers) ? [...saved.providers] : [];
  if (saved.provider?.id && !providers.some((item) => item.id === saved.provider?.id)) {
    providers.push(saved.provider);
  }
  return providers;
}

function withoutLegacyHistory(saved: Partial<PlayerState> | null): Partial<PlayerState> | null {
  if (!saved) return null;
  const { history: _history, ...rest } = saved;
  return rest as Partial<PlayerState>;
}

async function stripLegacyHistoryFields() {
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) continue;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !("history" in parsed)) continue;
    const { history: _history, ...rest } = parsed;
    await AsyncStorage.setItem(key, JSON.stringify(rest));
  }
}

const liveHistoryStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
};

async function hydrateStoredProvider(
  stored: ProviderConfig | StoredProviderConfig,
  v3Secrets: ProviderSecrets | undefined,
  v2Secrets: ProviderSecrets | undefined,
): Promise<{ provider: ProviderConfig; secureVerified: boolean }> {
  const secure = await readCredentials(stored.id);
  const resolution = resolveCredentialState(stored.type, v3Secrets, v2Secrets, secure);
  let needsCredentials = resolution.needsCredentials;
  let secureVerified =
    secure.status === "found" &&
    hasRequiredCredentialFields(stored.type, resolution.secrets) &&
    credentialFieldsEqual(secure.secrets, resolution.secrets);

  if (secure.status !== "error" && resolution.shouldWriteSecureStore) {
    try {
      await saveCredentials(stored.id, resolution.secrets);
      secureVerified = true;
    } catch {
      needsCredentials = true;
      secureVerified = false;
    }
  }

  const secrets = resolution.secrets;
  const url = secrets.url || secrets.playlistUrl || "";
  const provider = {
    ...stored,
    declaredType: stored.declaredType ?? stored.type,
    transport: stored.transport ?? (
      stored.type === "xtream" || stored.type === "m3u" ? stored.type : undefined
    ),
    url,
    playlistUrl: secrets.playlistUrl || secrets.url || "",
    epgUrl: secrets.epgUrl,
    username: secrets.username,
    password: secrets.password,
    mac: secrets.mac,
    needsCredentials,
  } as ProviderConfig;
  return { provider, secureVerified };
}

async function saveProviderSecrets(provider: ProviderConfig) {
  const secrets = providerSecretsFrom(provider);
  if (!hasRequiredCredentialFields(provider.type, secrets)) {
    throw new Error("Provider credentials are incomplete.");
  }
  await saveCredentials(provider.id, secrets);
}

type HydratedState = { state: PlayerState; liveHistory: LiveHistoryV2 };

const readState = async (): Promise<HydratedState> => {
  const [v3Raw, v2Raw] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEY),
    AsyncStorage.getItem(LEGACY_STORAGE_KEY),
  ]);
  if (v3Raw === null && v2Raw === null) {
    const liveHistory = await migrateLiveHistoryStorage(
      liveHistoryStorage,
      undefined,
      stripLegacyHistoryFields,
    );
    return { state: emptyState, liveHistory };
  }

  const v3Saved = parseStoredPlayerState(v3Raw, "Current");
  const v2Saved = parseStoredPlayerState(v2Raw, "Legacy");
  const v3Providers = providersFromStoredState(v3Saved);
  const v2Providers = providersFromStoredState(v2Saved);
  const v3ById = new Map(v3Providers.map((item) => [item.id, item]));
  const v2ById = new Map(v2Providers.map((item) => [item.id, item]));
  const providerIds = [
    ...v3Providers.map((item) => item.id),
    ...v2Providers.map((item) => item.id).filter((id) => !v3ById.has(id)),
  ];

  const legacyCredentialProviderIds = new Set(
    v2Providers
      .filter((item) => hasProviderSecrets(providerSecretsFrom(item)))
      .map((item) => item.id),
  );
  if (
    v2Saved?.provider?.id &&
    hasProviderSecrets(providerSecretsFrom(v2Saved.provider))
  ) {
    legacyCredentialProviderIds.add(v2Saved.provider.id);
  }
  const verifiedLegacyProviderIds = new Set<string>();
  const providers: ProviderConfig[] = [];
  for (const id of providerIds) {
    const v3 = v3ById.get(id);
    const v2 = v2ById.get(id);
    const stored = { ...(v2 ?? {}), ...(v3 ?? {}) } as ProviderConfig | StoredProviderConfig;
    const hydration = await hydrateStoredProvider(
      stored,
      v3 ? providerSecretsFrom(v3) : undefined,
      v2 ? providerSecretsFrom(v2) : undefined,
    );
    providers.push(hydration.provider);
    if (hydration.secureVerified) verifiedLegacyProviderIds.add(id);
  }

  const activeProviderId = v3Saved?.activeProviderId ?? v2Saved?.activeProviderId;
  const savedActive = v3Saved?.provider ?? v2Saved?.provider;
  const provider =
    activeProviderId === LOGGED_OUT
      ? null
      : providers.find((item) => item.id === activeProviderId) ??
        (savedActive
          ? providers.find((item) => item.id === savedActive.id) ?? null
          : providers[0] ?? null);
  const favoritesSource = Array.isArray(v3Saved?.favorites)
    ? v3Saved.favorites
    : Array.isArray(v2Saved?.favorites)
      ? v2Saved.favorites
      : [];
  const hasLegacyHistory = Array.isArray(v3Saved?.history) || Array.isArray(v2Saved?.history);
  const historySource = Array.isArray(v3Saved?.history)
    ? v3Saved.history
    : Array.isArray(v2Saved?.history)
      ? v2Saved.history
      : undefined;
  const liveHistory = await migrateLiveHistoryStorage(
    liveHistoryStorage,
    hasLegacyHistory ? historySource : undefined,
    stripLegacyHistoryFields,
  );
  const next: PlayerState = {
    providers,
    provider,
    channels: [],
    epg: [],
    favorites: favoritesSource.slice(0, 500),
    history: historyForProvider(liveHistory, provider?.id),
    activeProviderId: activeProviderId ?? provider?.id,
  };

  if (provider?.type === "m3u" && !provider.needsCredentials) {
    try {
      const cached = await hydrateM3UProviderCache(provider);
      if (cached) {
        next.channels = cached.live;
        markM3UCacheActivation(provider.id);
      }
    } catch {
      // A cache read failure must preserve the existing network fallback path.
    }
  }

  if (providers.every((item) => !item.needsCredentials)) {
    await AsyncStorage.setItem(STORAGE_KEY, serializedPlayerState(next));
    await AsyncStorage.setItem(SECURE_MIGRATION_KEY, "1");
  }

  const legacyCredentialsVerified = [...legacyCredentialProviderIds].every((id) =>
    verifiedLegacyProviderIds.has(id),
  );
  const migratedLegacy = migratedLegacyStateAfterVerification(
    withoutLegacyHistory(v2Saved),
    v2Saved !== null && legacyCredentialsVerified,
  );
  if (migratedLegacy) {
    await AsyncStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(migratedLegacy));
  }
  return { state: next, liveHistory };
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
  const liveHistoryRef = useRef<LiveHistoryV2>(emptyLiveHistoryV2());
  const epgCacheRef = useRef(
    new Map<string, { loadedAt: number; channelCount: number }>(),
  );
  const bulkEpgPromiseRef = useRef(new Map<string, Promise<void>>());
  const legacyCatalogFallbackGuardRef = useRef(new LegacyCatalogFallbackAttemptGuard());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    readState()
      .then(({ state: saved, liveHistory }) => {
        liveHistoryRef.current = liveHistory;
        stateRef.current = saved;
        setState(saved);
        setIsHydrating(false);
      })
      .catch(() => {
        setError("Credential storage could not be read.");
        setIsHydrating(false);
      });
  }, []);

  const persist = async (next: PlayerState) => {
    stateRef.current = next;
    setState(next);
    try {
      const providersToSecure = new Map<string, ProviderConfig>();
      for (const item of next.providers) providersToSecure.set(item.id, item);
      if (next.provider) providersToSecure.set(next.provider.id, next.provider);
      for (const item of providersToSecure.values()) {
        const secrets = providerSecretsFrom(item);
        if (!item.needsCredentials && hasRequiredCredentialFields(item.type, secrets)) {
          await saveProviderSecrets(item);
        }
      }

      await AsyncStorage.setItem(STORAGE_KEY, serializedPlayerState(next));
      await AsyncStorage.setItem(SECURE_MIGRATION_KEY, "1");
    } catch {
      // Keep the in-memory session usable and leave the previous on-disk state intact.
    }
  };

  const persistLiveHistory = async (next: LiveHistoryV2) => {
    try {
      const verified = await commitLiveHistoryV2(liveHistoryStorage, next);
      liveHistoryRef.current = verified;
      return verified;
    } catch {
      setError("Live TV history could not be saved.");
      return null;
    }
  };

  const mergeImportedProviders = async (incoming: ProviderConfig[]) => {
    if (!incoming.length) {
      return {
        prepareMs: 0,
        asyncStorageWriteMs: 0,
        stateApplyMs: 0,
        asyncStorageWriteCount: 0,
      };
    }
    const prepareStartedAt = Date.now();
    const current = stateRef.current;
    const importedById = new Map(incoming.map((item) => [item.id, item]));
    const importedIds = new Set(importedById.keys());
    const existingIds = new Set(current.providers.map((item) => item.id));
    const providers = current.providers.map((item) => importedById.get(item.id) ?? item);
    for (const item of incoming) {
      if (!existingIds.has(item.id)) providers.push(item);
    }

    const removedChannelIds = new Set(
      current.channels
        .filter((channel) => importedIds.has(channel.providerId))
        .map((channel) => channel.id),
    );
    const provider = current.provider?.id
      ? importedById.get(current.provider.id) ?? current.provider
      : current.provider;
    const next: PlayerState = {
      ...current,
      providers,
      provider,
      channels: current.channels.filter((channel) => !importedIds.has(channel.providerId)),
      epg: current.epg.filter((program) => !removedChannelIds.has(program.channelId)),
      favorites: current.favorites.filter((id) => !removedChannelIds.has(id)),
      history: historyForProvider(liveHistoryRef.current, provider?.id),
    };
    const serialized = serializedPlayerState(next);
    const prepareMs = Date.now() - prepareStartedAt;

    const writeStartedAt = Date.now();
    await AsyncStorage.setItem(STORAGE_KEY, serialized);
    const asyncStorageWriteMs = Date.now() - writeStartedAt;
    const stateApplyStartedAt = Date.now();
    stateRef.current = next;
    setState(next);
    return {
      prepareMs,
      asyncStorageWriteMs,
      stateApplyMs: Date.now() - stateApplyStartedAt,
      asyncStorageWriteCount: 1,
    };
  };

  const resolveProviderForSwitch = async (providerId: string): Promise<ProviderConfig | null> => {
    const current = stateRef.current;
    const existing = current.providers.find((item) => item.id === providerId);
    if (!existing || existing.needsCredentials) return null;

    const resolved = await resolveProviderTransport(fromProvider(existing));
    const updated = toProvider({
      ...resolved,
      id: existing.id,
      name: existing.name,
      createdAt: existing.createdAt,
      lastLoadedAt: existing.lastLoadedAt,
      channelCount: existing.channelCount,
      epgUrl: resolved.epgUrl || existing.epgUrl,
      loadError: existing.loadError,
    });
    await saveProviderSecrets(updated);

    const latest = stateRef.current;
    await persist({
      ...latest,
      providers: latest.providers.map((item) => item.id === providerId ? updated : item),
      provider: latest.provider?.id === providerId ? updated : latest.provider,
    });
    return updated;
  };

  const connectProvider = async (config: ProviderInput) => {
    setIsLoading(true);
    setError(null);

    try {
      const sourceUrl = (config.url || config.playlistUrl).trim();
      const rawCandidate: RoutedProvider = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: config.name.trim() || "My provider",
        type: config.type,
        declaredType: config.type,
        url: sourceUrl,
        playlistUrl: sourceUrl,
        username: config.username?.trim() || undefined,
        password: config.password || undefined,
        mac: config.mac?.trim() || undefined,
        epgUrl: config.epgUrl?.trim() || undefined,
        createdAt: Date.now(),
      };
      const candidate = await resolveProviderTransport(rawCandidate);
      const current = stateRef.current;
      const duplicate = config.providerId
        ? current.providers.find((item) => item.id === config.providerId)
        : current.providers.find((item) => sameAccount(item, candidate));
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
        history: historyForProvider(liveHistoryRef.current, savedProvider.id),
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

  const recoverLegacyCatalogFallback = async (providerId: string, caught: unknown) => {
    const current = stateRef.current;
    const existing = current.providers.find((item) => item.id === providerId);
    if (
      !existing ||
      !shouldFallbackLegacyXtreamCatalogToM3U(existing, caught) ||
      !legacyCatalogFallbackGuardRef.current.tryStart(providerId)
    ) {
      return false;
    }

    const source = existing.playlistUrl || existing.url;
    const fallback: RoutedProvider = {
      ...fromProvider(existing),
      type: "m3u",
      declaredType: existing.declaredType ?? "xtream",
      transport: "m3u",
      url: source,
      playlistUrl: source,
      username: undefined,
      password: undefined,
    };

    try {
      const loaded = await loadProvider(fallback);
      persistM3ULoadInBackground(fallback, loaded);
      const updated = toProvider({
        ...fallback,
        lastLoadedAt: Date.now(),
        channelCount: loaded.channels.length,
        epgUrl: fallback.epgUrl || loaded.epgUrl,
        loadError: undefined,
      });
      await saveProviderSecrets(updated);

      const latest = stateRef.current;
      if (!latest.providers.some((item) => item.id === providerId)) return false;
      epgCacheRef.current.delete(providerId);
      await persist({
        ...latest,
        provider: latest.provider?.id === providerId ? updated : latest.provider,
        providers: latest.providers.map((item) => item.id === providerId ? updated : item),
        channels: [
          ...latest.channels.filter((channel) => channel.providerId !== providerId),
          ...loaded.channels,
        ],
      });
      return true;
    } catch {
      return false;
    }
  };

  const refreshProviderInBackground = async (providerId: string) => {
    const current = stateRef.current;
    const existing = current.providers.find((item) => item.id === providerId);
    if (!existing || existing.type !== "m3u") return;
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
      const latest = stateRef.current;
      await persist({
        ...latest,
        provider: latest.provider?.id === providerId ? updated : latest.provider,
        providers: latest.providers.map((item) => item.id === providerId ? updated : item),
        channels: [
          ...latest.channels.filter((channel) => channel.providerId !== providerId),
          ...smart.loaded.channels,
        ],
      });
    } catch {
      // A background refresh failure must never hide or invalidate usable cached rows.
    }
  };

  useEffect(() => {
    const active = state.provider;
    if (isHydrating || !active || active.type !== "m3u") return;
    if (!consumeM3UCacheActivation(active.id)) return;
    let cancelled = false;
    const providerId = active.id;
    const timer = setTimeout(() => {
      if (!cancelled) void refreshProviderInBackground(providerId);
    }, M3U_BACKGROUND_REFRESH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isHydrating, state.provider?.id, state.provider?.type]);

  const setActiveProvider = async (providerId: string) => {
    const current = stateRef.current;
    const existing = current.providers.find((item) => item.id === providerId);
    if (!existing) return false;
    if (existing.needsCredentials) {
      setError(null);
      return false;
    }
    setIsLoading(true);
    setError(null);
    try {
      const switchPath = chooseProviderSwitchPath({
        hasInMemoryChannels: current.channels.some(
          (channel) => channel.providerId === providerId,
        ),
        hasUsableCatalogCache: hasPrimedProviderSwitchSnapshot(providerId),
      });
      if (switchPath === "memory" || switchPath === "cache") {
        const primed = existing.type === "m3u" && switchPath === "cache"
          ? peekProviderSwitchSnapshot<{ live?: Channel[] }>(providerId)
          : null;
        const cachedLive = primed?.live ?? [];
        await persist({
          ...current,
          provider: existing,
          activeProviderId: providerId,
          history: historyForProvider(liveHistoryRef.current, providerId),
          channels: cachedLive.length
            ? [
                ...current.channels.filter((channel) => channel.providerId !== providerId),
                ...cachedLive,
              ]
            : current.channels,
        });
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
        history: historyForProvider(liveHistoryRef.current, providerId),
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
      setError(safeProviderSwitchError(caught));
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
      history: [],
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
      history: historyForProvider(liveHistoryRef.current, nextProvider?.id),
      epg: current.epg.filter((program) => channelIds.has(program.channelId)),
    });
    try {
      await deleteCredentials(providerId);
    } catch {
      setError("Provider was removed, but secure credential cleanup failed.");
    }
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
    const providerId = providerIdFromChannelId(channelId) ?? current.provider?.id;
    if (!providerId) return;
    const verified = await persistLiveHistory(
      recordLiveHistory(liveHistoryRef.current, providerId, channelId),
    );
    if (!verified) return;
    const latest = stateRef.current;
    if (latest.provider?.id !== providerId) return;
    await persist({
      ...latest,
      history: historyForProvider(verified, providerId),
    });
  };

  const removeWatched = async (channelId: string) => {
    const current = stateRef.current;
    const providerId = providerIdFromChannelId(channelId) ?? current.provider?.id;
    if (!providerId) return;
    const verified = await persistLiveHistory(
      removeLiveHistory(liveHistoryRef.current, providerId, channelId),
    );
    if (!verified) return;
    const latest = stateRef.current;
    if (latest.provider?.id !== providerId) return;
    await persist({
      ...latest,
      history: historyForProvider(verified, providerId),
    });
  };

  const clearHistory = async () => {
    const current = stateRef.current;
    const providerId = current.provider?.id;
    if (!providerId) return;
    const verified = await persistLiveHistory(
      clearLiveHistoryProvider(liveHistoryRef.current, providerId),
    );
    if (!verified) return;
    const latest = stateRef.current;
    if (latest.provider?.id !== providerId) return;
    await persist({
      ...latest,
      history: historyForProvider(verified, providerId),
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
      mergeImportedProviders,
      removeProvider,
      disconnectProvider,
      refreshProvider,
      recoverLegacyCatalogFallback,
      refreshEpg,
      resolveProviderForSwitch,
      setActiveProvider,
      toggleFavorite,
      recordWatched,
      removeWatched,
      clearHistory,
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
