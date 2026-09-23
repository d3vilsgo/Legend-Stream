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
  ProviderLoadResult,
  ProviderType,
  EpgPhaseFailure,
} from "@/lib/iptv";
import { mapInBatches, yieldToUi } from "@/lib/cooperative";
import { OwnedEpgAttempts, type OwnedEpgAttempt } from "@/lib/ownedEpgAttempt";
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
  ProviderLoadRequestGate,
  publishSuccessfulCatalogCommitIfCurrent,
  type CatalogSyncOwnership,
  type ProviderLoadRequestOwnership,
} from "@/lib/catalogAvailability";
import {
  resolveM3UTransport,
  resolvedProviderTransport,
  type M3UTransportResolutionReason,
  type ProviderTransport,
} from "@/lib/m3uTransportRouting";
import { safeLog } from "@/lib/safeLog";
import {
  beginManualEpg,
  endManualEpg,
  recordAutoEpgStart,
  selectManualEpgProvider,
  type ManualEpgResult,
} from "@/lib/manualEpgMode";
import {
  beginXtreamEpgPhase,
  endXtreamEpgPhase,
  getXtreamEpgDiagnosticSnapshot,
  recordXtreamEpgCpuStage,
  isXtreamEpgDiagnosticAttemptCurrent,
  invalidateXtreamEpgDiagnosticAttempt,
  recordXtreamEpgFailure,
  resetXtreamEpgDiagnosticRun,
} from "@/lib/xtreamEpgDiagnostics";
import {
  recordM3UBackgroundRefreshBegin,
  recordM3UBackgroundRefreshEnd,
  recordM3UBackgroundRefreshLoadEnd,
  recordM3UEpgBegin,
  recordM3UEpgEnd,
  recordM3UEpgGenerationCurrent,
  recordM3UEpgNormalizeBegin,
  recordM3UEpgNormalizeEnd,
  recordM3UEpgPublicationBegin,
  recordM3UEpgPublicationEnd,
  recordM3UEpgRetryGate,
  recordM3UEpgWorkBegin,
  recordM3UEpgWorkEnd,
  redactProviderId,
} from "@/lib/m3uInAppDiagnostics";
import {
  ProviderConnectAttemptGate,
  withProviderConnectDeadline,
  type ProviderConnectAttempt,
  type ProviderConnectCancelReason,
} from "@/lib/providerConnectAttempt";
import {
  chooseProviderSwitchPath,
  hasPrimedProviderSwitchSnapshot,
  peekProviderSwitchSnapshot,
  safeProviderSwitchError,
} from "@/lib/providerSwitchUx";
import {
  LiveHistoryMutationQueue,
  clearLiveHistoryProvider,
  emptyLiveHistoryV2,
  historyForProvider,
  migrateLiveHistoryStorage,
  providerIdFromChannelId,
  recordLiveHistory,
  removeLiveHistory,
  type LiveHistoryMutation,
  type LiveHistoryV2,
} from "@/lib/liveHistory";
import {
  LegacyCatalogFallbackAttemptGuard,
  shouldFallbackLegacyXtreamCatalogToM3U,
} from "@/lib/legacyCatalogFallback";
import {
  EPG_PAGED_SEED_LIMIT,
  EPG_RETRY_BACKOFF_MS,
  EpgAttemptGeneration,
  EpgSingleFlight,
  clearRegisteredEpgChannels,
  getRegisteredEpgChannels,
  hasUsableChannelEpg,
  mergeEpgPrograms,
} from "@/lib/epgRuntime";
import {
  removeLegacyStalkerCatalogChannels,
  syncStalkerCatalogForLifecycle,
} from "@/lib/stalkerLiveCatalogRouting";
import type { StalkerLiveSyncOwner } from "@/lib/stalkerLiveSync";

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

export type PlayerScopedError = {
  domain: "live-history";
  providerId: string;
  messageKey: "historySaveFailed";
};

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
  scopedError: PlayerScopedError | null;
  m3uCatalogCommit: CatalogSyncOwnership & { sequence: number } | null;
  connectProvider: (config: ProviderInput) => Promise<boolean>;
  cancelProviderConnect: () => void;
  mergeImportedProviders: (providers: ProviderConfig[]) => Promise<ProviderMetadataCommitMetrics>;
  removeProvider: (providerId?: string) => Promise<void>;
  disconnectProvider: () => Promise<void>;
  refreshProvider: (providerId?: string) => Promise<void>;
  recoverLegacyCatalogFallback: (providerId: string, error: unknown) => Promise<boolean>;
  refreshEpg: (providerId?: string, channelId?: string) => Promise<void>;
  loadEpgManually: (providerId: string) => Promise<void>;
  resolveProviderForSwitch: (providerId: string) => Promise<ProviderConfig | null>;
  setActiveProvider: (providerId: string) => Promise<boolean>;
  toggleFavorite: (channelId: string) => Promise<void>;
  recordWatched: (channelId: string) => Promise<void>;
  removeWatched: (channelId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  clearError: () => void;
  clearScopedError: (domain?: PlayerScopedError["domain"]) => void;
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

async function loadProviderSmart(
  provider: RoutedProvider,
  options: {
    persistM3U?: boolean;
    signal?: AbortSignal;
    isCurrent?: () => boolean;
    stalkerSyncOwner?: StalkerLiveSyncOwner;
  } = {},
) {
  if (provider.type === "stalker") {
    const result = await syncStalkerCatalogForLifecycle(provider, {
      signal: options.signal,
      isCurrent: options.isCurrent,
      owner: options.stalkerSyncOwner,
    });
    if (!result) throw new Error("Stalker catalog routing could not start canonical sync.");
    return {
      provider,
      loaded: { channels: [], liveChannels: [], epgUrl: provider.epgUrl } as ProviderLoadResult,
      cacheWriteTask: null,
      catalogCount: result.persisted,
    };
  }

  if (resolvedProviderTransport(provider) !== "xtream") {
    const loaded = await loadProvider(provider);
    const cacheWriteTask = options.persistM3U === false
      ? null
      : persistM3ULoadInBackground(provider, loaded);
    return { provider, loaded, cacheWriteTask, catalogCount: loaded.channels.length };
  }
  const parsed = parseXtreamGetPhp(provider.url);
  if (!parsed) {
    const loaded = await loadProvider(provider);
    return { provider, loaded, cacheWriteTask: null, catalogCount: loaded.channels.length };
  }
  const savedXtream: RoutedProvider = {
    ...provider,
    type: "xtream",
    transport: "xtream",
    username: parsed.username,
    password: parsed.password,
  };
  try {
    const loaded = await loadProvider(toXtreamLoadProvider(savedXtream));
    return {
      provider: savedXtream,
      loaded,
      cacheWriteTask: null,
      catalogCount: loaded.channels.length,
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
    const cacheWriteTask = options.persistM3U === false
      ? null
      : persistM3ULoadInBackground(fallback, loaded);
    return { provider: fallback, loaded, cacheWriteTask, catalogCount: loaded.channels.length };
  }
}

function xtreamBaseUrl(provider: Pick<ProviderConfig, "url" | "playlistUrl">) {
  const raw = provider.url || provider.playlistUrl;
  return parseXtreamGetPhp(raw)?.baseUrl ?? normalizeXtreamBaseUrl(raw);
}

function stableEpgIdentityHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function effectiveEpgSourceIdentity(provider: ProviderConfig) {
  const explicit = provider.epgUrl?.trim();
  if (explicit) return `epg-${stableEpgIdentityHash(explicit)}`;
  if (provider.type === "xtream" && provider.username && provider.password) {
    return `xtream-${stableEpgIdentityHash(
      [xtreamBaseUrl(provider), provider.username, provider.password].join("\u0000"),
    )}`;
  }
  return "none";
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

async function normalizeProgramText(programs: EpgProgram[], diagnosticM3U = false, diagnosticXtream = false, diagnosticAttemptId?: number, signal?: AbortSignal, isCurrentEpg?: () => boolean) {
  const reportM3U = () => diagnosticM3U && (isCurrentEpg?.() ?? true);
  if (reportM3U()) recordM3UEpgNormalizeBegin();
  if (diagnosticXtream) beginXtreamEpgPhase("NORMALIZE", diagnosticAttemptId);
  try {
    const normalizeOne = (program: EpgProgram) => ({
        ...program,
        title: decodeMaybeBase64(program.title),
        description: undefined,
    });
    let normalized: EpgProgram[];
    if (diagnosticXtream) {
      normalized = new Array<EpgProgram>(programs.length);
      for (let start = 0; start < programs.length; start += 250) {
        const end = Math.min(start + 250, programs.length);
        const began = globalThis.performance?.now?.() ?? Date.now();
        for (let index = start; index < end; index += 1) normalized[index] = normalizeOne(programs[index]);
        const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - began;
        recordXtreamEpgCpuStage("NORMALIZE_MAP", elapsed, elapsed, end - start, diagnosticAttemptId);
        if (end < programs.length) await yieldToUi();
        if (signal?.aborted) throw new EpgPhaseFailure("abort", "abort");
      }
    } else {
      normalized = await mapInBatches(programs, normalizeOne, 250);
    }
    await yieldToUi();
    if (signal?.aborted) throw new EpgPhaseFailure("abort", "abort");
    const compactBegan = diagnosticXtream ? (globalThis.performance?.now?.() ?? Date.now()) : 0;
    const compact = compactEpgPrograms(normalized);
    if (diagnosticXtream) {
      const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - compactBegan;
      recordXtreamEpgCpuStage("SORT_OR_GROUP", elapsed, elapsed, normalized.length, diagnosticAttemptId);
    }
    return compact;
  } finally {
    if (reportM3U()) recordM3UEpgNormalizeEnd();
    if (diagnosticXtream) endXtreamEpgPhase("NORMALIZE", {}, diagnosticAttemptId);
  }
}

async function loadBulkProviderEpg(
  provider: ProviderConfig,
  channels: Channel[],
  signal?: AbortSignal,
  diagnosticAttemptId?: number,
  isCurrentEpg?: () => boolean,
): Promise<EpgProgram[]> {
  const xtreamProvider = toXtreamLoadProvider(fromProvider(provider));
  const diagnosticMode = provider.type === "xtream"
    ? getXtreamEpgDiagnosticSnapshot().mode : "FULL_PIPELINE";
  const stopBeforeNormalization = diagnosticMode === "FETCH_ONLY" || diagnosticMode === "FETCH_BODY_ONLY";

  if (
    provider.type === "xtream" &&
    Math.max(channels.length, provider.channelCount ?? 0) >= LARGE_PROVIDER_CHANNEL_THRESHOLD
  ) {
    await yieldToUi();
    const seedChannels = channels.slice(0, LARGE_PROVIDER_INITIAL_EPG_CHANNELS);
    const programs = await loadEpg(
      {
        ...xtreamProvider,
        epgUrl: undefined,
      },
      seedChannels,
      { signal, diagnosticAttemptId, isCurrentEpg },
    );
    return stopBeforeNormalization ? programs :
      normalizeProgramText(programs, false, true, diagnosticAttemptId, signal);
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
    { signal, diagnosticAttemptId, isCurrentEpg },
  );
  return stopBeforeNormalization ? programs :
    normalizeProgramText(programs, provider.type === "m3u", provider.type === "xtream", diagnosticAttemptId, signal, isCurrentEpg);
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlayerState>(emptyState);
  const [isHydrating, setIsHydrating] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isEpgLoading, setIsEpgLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopedError, setScopedError] = useState<PlayerScopedError | null>(null);
  const [m3uCatalogCommit, setM3UCatalogCommit] = useState<
    (CatalogSyncOwnership & { sequence: number }) | null
  >(null);
  const stateRef = useRef(state);
  const activeProviderGenerationRef = useRef(0);
  const providerLoadGateRef = useRef(new ProviderLoadRequestGate());
  const playerBusySequenceRef = useRef(0);
  const playerBusyOwnerRef = useRef<number | null>(null);
  const connectAttemptGateRef = useRef(new ProviderConnectAttemptGate());
  const connectBusyOwnerRef = useRef<{ attemptId: number; busyId: number } | null>(null);
  const connectPersistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const liveHistoryRef = useRef<LiveHistoryV2>(emptyLiveHistoryV2());
  const liveHistoryMutationQueueRef = useRef(new LiveHistoryMutationQueue());
  const epgCacheRef = useRef(
    new Map<string, { loadedAt: number; channelCount: number; inputKey?: string; sourceKey?: string }>(),
  );
  const bulkEpgPromiseRef = useRef(new Map<string, Promise<void>>());
  const manualEpgResultRef = useRef(new Map<string, ManualEpgResult>());
  const activeEpgSingleFlightRef = useRef(new EpgSingleFlight());
  const epgAttemptGenerationRef = useRef(new EpgAttemptGeneration());
  const ownedEpgAttemptsRef = useRef(new OwnedEpgAttempts());
  const previousEpgProviderRef = useRef<string | null>(null);
  const epgRetryNotBeforeRef = useRef(new Map<string, number>());
  const legacyCatalogFallbackGuardRef = useRef(new LegacyCatalogFallbackAttemptGuard());

  const cancelOwnedEpg = (providerId: string) => {
    const active = ownedEpgAttemptsRef.current.active(providerId);
    ownedEpgAttemptsRef.current.cancel(providerId);
    if (active) bulkEpgPromiseRef.current.delete(providerId);
    invalidateXtreamEpgDiagnosticAttempt(active?.diagnosticAttemptId);
  };

  const clearEpgProviderCache = (providerId: string) => {
    cancelOwnedEpg(providerId);
    epgAttemptGenerationRef.current.invalidate(providerId);
    epgCacheRef.current.delete(providerId);
    clearRegisteredEpgChannels(providerId);
  };

  const invalidateEpgFreshness = (providerId: string) => {
    cancelOwnedEpg(providerId);
    epgAttemptGenerationRef.current.invalidate(providerId);
    epgCacheRef.current.delete(providerId);
  };

  const isCurrentProviderLoad = (ownership: ProviderLoadRequestOwnership) =>
    stateRef.current.provider?.id === ownership.providerId &&
    providerLoadGateRef.current.isCurrent(ownership);

  const beginPlayerBusy = () => {
    const busyId = ++playerBusySequenceRef.current;
    playerBusyOwnerRef.current = busyId;
    setIsLoading(true);
    return busyId;
  };

  const finishPlayerBusy = (busyId: number) => {
    if (playerBusyOwnerRef.current !== busyId) return;
    playerBusyOwnerRef.current = null;
    setIsLoading(false);
  };

  const finishConnectBusy = (attemptId: number) => {
    const owner = connectBusyOwnerRef.current;
    if (!owner || owner.attemptId !== attemptId) return;
    connectBusyOwnerRef.current = null;
    finishPlayerBusy(owner.busyId);
  };

  const isCurrentConnectAttempt = (attempt: ProviderConnectAttempt) =>
    connectAttemptGateRef.current.isCurrent(attempt);

  const cancelConnectAttempt = (
    attempt: ProviderConnectAttempt,
    reason: ProviderConnectCancelReason,
  ) => {
    if (!connectAttemptGateRef.current.cancel(attempt, reason)) return false;
    safeLog.info("LS_PROVIDER_CONNECT_CANCEL", { attemptId: attempt.id, reason });
    finishConnectBusy(attempt.id);
    return true;
  };

  const cancelProviderConnect = () => {
    const attempt = connectAttemptGateRef.current.current();
    if (attempt) cancelConnectAttempt(attempt, "USER");
  };

  const beginForegroundProviderLoad = (providerId: string) => {
    const ownership = providerLoadGateRef.current.beginForeground(providerId);
    return { ownership, busyId: beginPlayerBusy() };
  };

  const finishProviderLoad = (
    ownership: ProviderLoadRequestOwnership,
    persistenceOwnsRequest: boolean,
    busyId: number,
  ) => {
    if (!persistenceOwnsRequest) providerLoadGateRef.current.finish(ownership);
    finishPlayerBusy(busyId);
  };

  const applyPlayerState = (next: PlayerState) => {
    const previousProviderId = stateRef.current.provider?.id ?? null;
    const nextProviderId = next.provider?.id ?? null;
    if (previousProviderId !== nextProviderId) {
      activeProviderGenerationRef.current += 1;
      providerLoadGateRef.current.invalidateAll();
      setM3UCatalogCommit(null);
    }
    stateRef.current = next;
    setState(next);
    return activeProviderGenerationRef.current;
  };

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    readState()
      .then(({ state: saved, liveHistory }) => {
        liveHistoryRef.current = liveHistory;
        applyPlayerState(saved);
        setIsHydrating(false);
      })
      .catch(() => {
        setError("Credential storage could not be read.");
        setIsHydrating(false);
      });
  }, []);

  const persist = async (next: PlayerState) => {
    const generation = applyPlayerState(next);
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
    return generation;
  };

  const persistConnectedProviderAttempt = async (
    attempt: ProviderConnectAttempt,
    next: PlayerState,
  ) => {
    const run = async (): Promise<number | null> => {
      if (!isCurrentConnectAttempt(attempt)) return null;
      const restoreCurrentState = async () => {
        try {
          await AsyncStorage.setItem(STORAGE_KEY, serializedPlayerState(stateRef.current));
        } catch {
          // Best-effort rollback only; stale connect state is never applied in memory.
        }
      };
      try {
        await AsyncStorage.setItem(STORAGE_KEY, serializedPlayerState(next));
        if (!isCurrentConnectAttempt(attempt)) {
          await restoreCurrentState();
          return null;
        }
        await AsyncStorage.setItem(SECURE_MIGRATION_KEY, "1");
        if (!isCurrentConnectAttempt(attempt)) {
          await restoreCurrentState();
          return null;
        }
        return applyPlayerState(next);
      } catch {
        await restoreCurrentState();
        return null;
      }
    };
    const queued = connectPersistenceQueueRef.current.then(run, run);
    connectPersistenceQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  };

  const observeM3UCacheWrite = (
    providerId: string,
    generation: number,
    completion: Promise<boolean> | null,
    requestOwnership?: ProviderLoadRequestOwnership,
  ) => {
    const publication = publishSuccessfulCatalogCommitIfCurrent(
      completion,
      { providerId, generation },
      () => ({
        providerId: stateRef.current.provider?.id ?? null,
        generation: activeProviderGenerationRef.current,
      }),
      () => {
        if (requestOwnership && !isCurrentProviderLoad(requestOwnership)) return;
        setM3UCatalogCommit((current) => ({
          providerId,
          generation,
          sequence: (current?.sequence ?? 0) + 1,
        }));
      },
    );
    void publication.finally(() => {
      if (requestOwnership) providerLoadGateRef.current.finish(requestOwnership);
    });
  };

  const persistLiveHistory = async (providerId: string, mutate: LiveHistoryMutation) => {
    try {
      const committed = await liveHistoryMutationQueueRef.current.run({
        storage: liveHistoryStorage,
        current: () => liveHistoryRef.current,
        mutate,
        publish: async (verified) => {
          liveHistoryRef.current = verified;
          const latest = stateRef.current;
          if (latest.provider?.id !== providerId) return;
          await persist({
            ...latest,
            history: historyForProvider(verified, providerId),
          });
        },
      });
      setScopedError((current) => current?.domain === "live-history" && current.providerId === providerId ? null : current);
      return committed;
    } catch (caught) {
      const diagnostic = caught instanceof Error && "cause" in caught
        ? (caught as Error & { cause?: unknown }).cause ?? caught
        : caught;
      safeLog.error("LS_LIVE_HISTORY_PERSIST_FAILED", diagnostic);
      setScopedError({ domain: "live-history", providerId, messageKey: "historySaveFailed" });
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
    applyPlayerState(next);
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
    providerLoadGateRef.current.invalidateAll();
    const { attempt, superseded } = connectAttemptGateRef.current.begin();
    if (superseded) {
      safeLog.info("LS_PROVIDER_CONNECT_CANCEL", { attemptId: superseded.id, reason: "SUPERSEDED" });
      finishConnectBusy(superseded.id);
    }
    const busyId = beginPlayerBusy();
    connectBusyOwnerRef.current = { attemptId: attempt.id, busyId };
    safeLog.info("LS_PROVIDER_CONNECT_START", { attemptId: attempt.id, providerType: config.type });
    setError(null);
    let loadStartedAt: number | null = null;
    let loadEndLogged = false;

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
      if (!isCurrentConnectAttempt(attempt)) return false;
      safeLog.info("LS_PROVIDER_CONNECT_TRANSPORT_RESOLVED", { attemptId: attempt.id, resolvedType: candidate.type });
      const current = stateRef.current;
      const duplicate = config.providerId
        ? current.providers.find((item) => item.id === config.providerId)
        : current.providers.find((item) => sameAccount(item, candidate));
      const providerToLoad = duplicate
        ? { ...candidate, id: duplicate.id, createdAt: duplicate.createdAt }
        : candidate;
      loadStartedAt = Date.now();
      safeLog.info("LS_PROVIDER_CONNECT_LOAD_START", { attemptId: attempt.id });
      let smart;
      try {
        smart = await withProviderConnectDeadline(loadProviderSmart(providerToLoad, {
          signal: attempt.signal,
          isCurrent: () => isCurrentConnectAttempt(attempt),
          stalkerSyncOwner: providerToLoad.type === "stalker" ? "CONNECT_PROVIDER" : undefined,
        }), {
          timeoutMs: PROVIDER_CONNECT_TIMEOUT_MS,
          onTimeout: () => {
            const timeoutError = new ProviderLoadError(
              "The provider connection timed out. Check the URL, server response time, and try again.",
              "PROVIDER_TIMEOUT",
            );
            if (isCurrentConnectAttempt(attempt)) {
              safeLog.info("LS_PROVIDER_CONNECT_TIMEOUT", { attemptId: attempt.id });
              cancelConnectAttempt(attempt, "TIMEOUT");
              setError(timeoutError.message);
            }
            return timeoutError;
          },
        });
        safeLog.info("LS_PROVIDER_CONNECT_LOAD_END", {
          attemptId: attempt.id,
          result: isCurrentConnectAttempt(attempt) ? "SUCCESS" : "CANCELLED",
          elapsedMs: Date.now() - loadStartedAt,
        });
        loadEndLogged = true;
      } catch (caught) {
        safeLog.info("LS_PROVIDER_CONNECT_LOAD_END", {
          attemptId: attempt.id,
          result: attempt.cancelReason ? "CANCELLED" : "ERROR",
          elapsedMs: Date.now() - loadStartedAt,
        });
        loadEndLogged = true;
        throw caught;
      }
      if (!isCurrentConnectAttempt(attempt)) return false;
      const savedProvider = toProvider({
        ...smart.provider,
        lastLoadedAt: Date.now(),
        channelCount: smart.catalogCount,
        epgUrl: smart.provider.epgUrl || smart.loaded.epgUrl,
      });
      if (!isCurrentConnectAttempt(attempt)) return false;
      await saveProviderSecrets(savedProvider);
      if (!isCurrentConnectAttempt(attempt)) return false;
      const latest = stateRef.current;
      const providers = duplicate
        ? latest.providers.map((item) =>
            item.id === duplicate.id ? savedProvider : item,
          )
        : [...latest.providers, savedProvider];
      if (!isCurrentConnectAttempt(attempt)) return false;
      clearEpgProviderCache(savedProvider.id);
      if (latest.provider?.id && latest.provider.id !== savedProvider.id) {
        cancelOwnedEpg(latest.provider.id);
        epgAttemptGenerationRef.current.invalidate(latest.provider.id);
      }
      const generation = await persistConnectedProviderAttempt(attempt, {
        ...latest,
        providers,
        provider: savedProvider,
        activeProviderId: savedProvider.id,
        history: historyForProvider(liveHistoryRef.current, savedProvider.id),
        channels: [
          ...latest.channels.filter(
            (channel) => channel.providerId !== savedProvider.id,
          ),
          ...smart.loaded.channels,
        ],
      });
      if (generation === null || !isCurrentConnectAttempt(attempt)) return false;
      safeLog.info("LS_PROVIDER_CONNECT_PUBLISH", { attemptId: attempt.id });
      observeM3UCacheWrite(savedProvider.id, generation, smart.cacheWriteTask);
      return true;
    } catch (caught) {
      if (!loadEndLogged && loadStartedAt !== null) {
        safeLog.info("LS_PROVIDER_CONNECT_LOAD_END", {
          attemptId: attempt.id,
          result: attempt.cancelReason ? "CANCELLED" : "ERROR",
          elapsedMs: Date.now() - loadStartedAt,
        });
      }
      if (!isCurrentConnectAttempt(attempt)) return false;
      setError(
        caught instanceof Error ? caught.message : "The provider could not be loaded.",
      );
      return false;
    } finally {
      if (connectAttemptGateRef.current.isCurrent(attempt)) {
        connectAttemptGateRef.current.finish(attempt);
      }
      finishConnectBusy(attempt.id);
    }
  };

  const refreshProvider = async (providerId = stateRef.current.provider?.id) => {
    if (!providerId) return;
    const current = stateRef.current;
    const existing = current.providers.find((item) => item.id === providerId);
    if (!existing) return;
    const { ownership, busyId } = beginForegroundProviderLoad(providerId);
    let persistenceOwnsRequest = false;
    setError(null);
    try {
      const smart = await loadProviderSmart(fromProvider(existing), {
        persistM3U: false,
        isCurrent: existing.type === "stalker"
          ? () => isCurrentProviderLoad(ownership)
          : undefined,
        stalkerSyncOwner: existing.type === "stalker" ? "REFRESH_PROVIDER" : undefined,
      });
      if (!isCurrentProviderLoad(ownership)) return;
      const updated = toProvider({
        ...smart.provider,
        lastLoadedAt: Date.now(),
        channelCount: smart.catalogCount,
        epgUrl: smart.provider.epgUrl || smart.loaded.epgUrl,
        loadError: undefined,
      });
      if (!isCurrentProviderLoad(ownership)) return;
      await saveProviderSecrets(updated);
      if (!isCurrentProviderLoad(ownership)) return;
      clearEpgProviderCache(providerId);
      const generation = await persist({
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
      if (!isCurrentProviderLoad(ownership)) return;
      const cacheWriteTask = persistM3ULoadInBackground(smart.provider, smart.loaded);
      if (cacheWriteTask) {
        persistenceOwnsRequest = true;
        observeM3UCacheWrite(providerId, generation, cacheWriteTask, ownership);
      }
    } catch (caught) {
      if (!isCurrentProviderLoad(ownership)) return;
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
      finishProviderLoad(ownership, persistenceOwnsRequest, busyId);
    }
  };

  const recoverLegacyCatalogFallback = async (providerId: string, caught: unknown) => {
    const current = stateRef.current;
    const existing = current.providers.find((item) => item.id === providerId);
    if (
      !existing ||
      !shouldFallbackLegacyXtreamCatalogToM3U(existing, caught)
    ) {
      return false;
    }
    const ownership = providerLoadGateRef.current.beginBackground(providerId);
    if (!ownership) return false;
    if (!legacyCatalogFallbackGuardRef.current.tryStart(providerId)) {
      providerLoadGateRef.current.finish(ownership);
      return false;
    }
    let persistenceOwnsRequest = false;

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
      if (!isCurrentProviderLoad(ownership)) return false;
      const updated = toProvider({
        ...fallback,
        lastLoadedAt: Date.now(),
        channelCount: loaded.channels.length,
        epgUrl: fallback.epgUrl || loaded.epgUrl,
        loadError: undefined,
      });
      if (!isCurrentProviderLoad(ownership)) return false;
      await saveProviderSecrets(updated);
      if (!isCurrentProviderLoad(ownership)) return false;

      const latest = stateRef.current;
      if (!latest.providers.some((item) => item.id === providerId)) return false;
      clearEpgProviderCache(providerId);
      const generation = await persist({
        ...latest,
        provider: latest.provider?.id === providerId ? updated : latest.provider,
        providers: latest.providers.map((item) => item.id === providerId ? updated : item),
        channels: [
          ...latest.channels.filter((channel) => channel.providerId !== providerId),
          ...loaded.channels,
        ],
      });
      if (!isCurrentProviderLoad(ownership)) return false;
      const cacheWriteTask = persistM3ULoadInBackground(fallback, loaded);
      if (cacheWriteTask) {
        persistenceOwnsRequest = true;
        observeM3UCacheWrite(providerId, generation, cacheWriteTask, ownership);
      }
      return true;
    } catch {
      return false;
    } finally {
      if (!persistenceOwnsRequest) providerLoadGateRef.current.finish(ownership);
    }
  };

  const refreshProviderInBackground = async (providerId: string) => {
    const current = stateRef.current;
    const existing = current.providers.find((item) => item.id === providerId);
    if (!existing || existing.type !== "m3u") return;
    if (playerBusyOwnerRef.current !== null) return;
    const ownership = providerLoadGateRef.current.beginBackground(providerId);
    if (!ownership) return;
    let persistenceOwnsRequest = false;
    const diagnosticStartedAt = globalThis.performance?.now?.() ?? Date.now();
    recordM3UBackgroundRefreshBegin();
    try {
      const smart = await loadProviderSmart(fromProvider(existing), { persistM3U: false });
      const diagnosticLoadEndedAt = globalThis.performance?.now?.() ?? Date.now();
      recordM3UBackgroundRefreshLoadEnd(diagnosticLoadEndedAt - diagnosticStartedAt);
      if (!isCurrentProviderLoad(ownership)) return;
      const updated = toProvider({
        ...smart.provider,
        lastLoadedAt: Date.now(),
        channelCount: smart.catalogCount,
        epgUrl: smart.provider.epgUrl || smart.loaded.epgUrl,
        loadError: undefined,
      });
      if (!isCurrentProviderLoad(ownership)) return;
      await saveProviderSecrets(updated);
      if (!isCurrentProviderLoad(ownership)) return;
      if ((existing.epgUrl?.trim() || "") !== (updated.epgUrl?.trim() || "")) {
        invalidateEpgFreshness(providerId);
      }
      const latest = stateRef.current;
      const generation = await persist({
        ...latest,
        provider: latest.provider?.id === providerId ? updated : latest.provider,
        providers: latest.providers.map((item) => item.id === providerId ? updated : item),
        channels: [
          ...latest.channels.filter(
            (channel) => channel.providerId !== providerId,
          ),
          ...smart.loaded.channels,
        ],
      });
      if (!isCurrentProviderLoad(ownership)) return;
      const cacheWriteTask = persistM3ULoadInBackground(smart.provider, smart.loaded);
      if (cacheWriteTask) {
        persistenceOwnsRequest = true;
        observeM3UCacheWrite(providerId, generation, cacheWriteTask, ownership);
      }
    } catch {
      // A background refresh failure must never hide or invalidate usable cached rows.
    } finally {
      const diagnosticEndedAt = globalThis.performance?.now?.() ?? Date.now();
      recordM3UBackgroundRefreshEnd(diagnosticEndedAt - diagnosticStartedAt);
      if (!persistenceOwnsRequest) providerLoadGateRef.current.finish(ownership);
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
    if (current.provider?.id && current.provider.id !== providerId) {
      cancelOwnedEpg(current.provider.id);
      epgAttemptGenerationRef.current.invalidate(current.provider.id);
    }
    providerLoadGateRef.current.invalidateAll();
    const busyId = beginPlayerBusy();
    setError(null);
    try {
      if (existing.type === "stalker") {
        clearEpgProviderCache(providerId);
        await persist({
          ...current,
          provider: existing,
          activeProviderId: providerId,
          history: historyForProvider(liveHistoryRef.current, providerId),
          channels: removeLegacyStalkerCatalogChannels(current.channels, providerId),
        });
        return true;
      }

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
        channelCount: smart.catalogCount,
        epgUrl: smart.provider.epgUrl || smart.loaded.epgUrl,
        loadError: undefined,
      });
      await saveProviderSecrets(updated);
      clearEpgProviderCache(providerId);
      const generation = await persist({
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
      observeM3UCacheWrite(providerId, generation, smart.cacheWriteTask);
      return true;
    } catch (caught) {
      setError(safeProviderSwitchError(caught));
      return false;
    } finally {
      finishPlayerBusy(busyId);
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
    providerLoadGateRef.current.invalidateProvider(providerId);
    const current = stateRef.current;
    const providers = current.providers.filter((item) => item.id !== providerId);
    const channels = current.channels.filter(
      (channel) => channel.providerId !== providerId,
    );
    const channelIds = new Set(channels.map((channel) => channel.id));
    const nextProvider =
      current.provider?.id === providerId ? providers[0] ?? null : current.provider;
    clearEpgProviderCache(providerId);
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
    async (providerId?: string, channelId?: string, force = false) => {
      const snapshot = stateRef.current;
      const resolvedProviderId = providerId ?? snapshot.provider?.id;
      if (!resolvedProviderId) return;
      const provider = snapshot.providers.find(
        (item) => item.id === resolvedProviderId,
      );
      if (!provider) return;
      const registeredChannels = getRegisteredEpgChannels<Channel>(resolvedProviderId);
      const boundedProvider = provider.type === "m3u" || provider.type === "xtream";
      const fallbackChannels = snapshot.channels.filter(
        (channel) => channel.providerId === resolvedProviderId,
      );
      const providerChannels = registeredChannels.length
        ? registeredChannels
        : boundedProvider
          ? fallbackChannels.slice(0, EPG_PAGED_SEED_LIMIT)
          : fallbackChannels;
      if (!providerChannels.length) {
        if (force) manualEpgResultRef.current.set(resolvedProviderId, "empty");
        return;
      }

      if (!channelId) {
        const externalInput = registeredChannels.length > 0;
        const inputKey = boundedProvider
          ? `${externalInput ? "paged" : "state"}:${providerChannels.map((channel) => channel.id).join("|")}`
          : externalInput
            ? `paged:${providerChannels.map((channel) => channel.id).join("|")}`
            : `state:${providerChannels.length}`;
        const sourceKey = boundedProvider ? effectiveEpgSourceIdentity(provider) : undefined;
        const now = Date.now();
        const cached = epgCacheRef.current.get(resolvedProviderId);
        if (
          !force && cached &&
          now - cached.loadedAt < EPG_CACHE_TTL_MS &&
          (
            boundedProvider
              ? cached.inputKey === inputKey && cached.sourceKey === sourceKey
              : externalInput
                ? cached.inputKey === inputKey
                : cached.channelCount === providerChannels.length
          )
        ) {
          return;
        }
        const existingWork = bulkEpgPromiseRef.current.get(resolvedProviderId);
        if (existingWork) {
          if (boundedProvider && !force) return;
          if (boundedProvider) {
            cancelOwnedEpg(resolvedProviderId);
          } else {
            await existingWork;
            return;
          }
        }
        const retryNotBefore = epgRetryNotBeforeRef.current.get(resolvedProviderId) ?? 0;
        if (boundedProvider && !force && Date.now() < retryNotBefore) {
          if (provider.type === "m3u") recordM3UEpgRetryGate(true);
          return;
        }
        if (provider.type === "m3u") recordM3UEpgRetryGate(false);

        if (boundedProvider && !force) recordAutoEpgStart(resolvedProviderId);
        setIsEpgLoading(true);
        const generation = boundedProvider
          ? epgAttemptGenerationRef.current.begin(resolvedProviderId)
          : null;
        const ownedAttempt: OwnedEpgAttempt | null = boundedProvider && generation !== null
          ? ownedEpgAttemptsRef.current.begin(resolvedProviderId, generation) : null;
        const isOwned = () => !boundedProvider || (
          ownedAttempt !== null && ownedEpgAttemptsRef.current.isCurrent(ownedAttempt) &&
          epgAttemptGenerationRef.current.isCurrent(resolvedProviderId, ownedAttempt.generation) &&
          stateRef.current.provider?.id === resolvedProviderId
        );
        if (provider.type === "m3u") recordM3UEpgGenerationCurrent(true);
        const m3uEpgStartedAt = provider.type === "m3u"
          ? (globalThis.performance?.now?.() ?? Date.now())
          : null;
        if (m3uEpgStartedAt !== null) {
          recordM3UEpgBegin();
          recordM3UEpgWorkBegin(m3uEpgStartedAt);
        }
        const providerHash = redactProviderId(resolvedProviderId);
        const diagnosticAttemptId = provider.type === "xtream"
          ? resetXtreamEpgDiagnosticRun(providerChannels.length) : undefined;
        if (ownedAttempt) ownedAttempt.diagnosticAttemptId = diagnosticAttemptId;
        if (provider.type === "xtream" && force) beginXtreamEpgPhase("TRIGGER", diagnosticAttemptId);
        if (boundedProvider) {
          safeLog.info("EPG_ATTEMPT_BEGIN", {
            providerType: provider.type,
            providerHash,
            channelCount: providerChannels.length,
          });
        }

        const startedAt = globalThis.performance?.now?.() ?? Date.now();
        const workResultPromise = Promise.resolve()
          .then(() => loadBulkProviderEpg(provider, providerChannels,
            ownedAttempt?.controller.signal, diagnosticAttemptId, isOwned))
          .then((value) => ({
            classification: "success" as const,
            value,
            elapsedMs: Math.max(0, Math.round((globalThis.performance?.now?.() ?? Date.now()) - startedAt)),
          }))
          .catch((error: unknown) => {
            if (provider.type === "xtream" && isOwned()) {
              const failure = error instanceof EpgPhaseFailure ? error :
                new EpgPhaseFailure("request", "network");
              recordXtreamEpgFailure(failure.stage, failure.failureClass, failure.httpStatusClass,
                failure.failureClass === "timeout" ? failure.stage : "none",
                failure.failureClass === "timeout" || failure.failureClass === "abort", diagnosticAttemptId);
            }
            return {
              classification: error instanceof EpgPhaseFailure && error.failureClass === "timeout"
                ? "timeout" as const : "failure" as const,
              elapsedMs: Math.max(0, Math.round((globalThis.performance?.now?.() ?? Date.now()) - startedAt)),
            };
          });
        const attemptPromise = workResultPromise;
        void workResultPromise.then((result) => safeLog.info("EPG_UNDERLYING_SETTLED", {
          providerType: provider.type, providerHash,
          result: result.classification, elapsedMs: result.elapsedMs,
        }));
        let workOwner!: Promise<void>;
        workOwner = workResultPromise
          .then(() => undefined)
          .finally(() => {
            if (bulkEpgPromiseRef.current.get(resolvedProviderId) === workOwner) {
              bulkEpgPromiseRef.current.delete(resolvedProviderId);
            }
            if (isOwned()) setIsEpgLoading(false);
            if (m3uEpgStartedAt !== null && isOwned()) {
              const endedAt = globalThis.performance?.now?.() ?? Date.now();
              recordM3UEpgWorkEnd(endedAt - m3uEpgStartedAt, endedAt);
            }
          });
        bulkEpgPromiseRef.current.set(resolvedProviderId, workOwner);

        const attempt = await attemptPromise;
        try {
          if (!isOwned()) {
            safeLog.info("EPG_RESULT_IGNORED_STALE", {
              providerType: provider.type, providerHash,
              elapsedMs: attempt.elapsedMs, channelCount: providerChannels.length,
              result: "stale",
            });
            return;
          }
          if (attempt.classification !== "success") {
            if (force) manualEpgResultRef.current.set(resolvedProviderId, attempt.classification);
            if (boundedProvider) {
              epgRetryNotBeforeRef.current.set(
                resolvedProviderId,
                Date.now() + EPG_RETRY_BACKOFF_MS,
              );
              if (provider.type === "m3u") recordM3UEpgRetryGate(true);
              safeLog.info(
                attempt.classification === "timeout"
                  ? "EPG_ATTEMPT_TIMEOUT"
                  : "EPG_ATTEMPT_FAILURE",
                {
                  providerType: provider.type,
                  providerHash,
                  elapsedMs: attempt.elapsedMs,
                  channelCount: providerChannels.length,
                  result: attempt.classification,
                },
              );
            }
            return;
          }

          const generationCurrent = isOwned();
          if (provider.type === "m3u") recordM3UEpgGenerationCurrent(generationCurrent);
          if (!generationCurrent) {
            if (force) manualEpgResultRef.current.set(resolvedProviderId, "stale");
            safeLog.info("EPG_RESULT_IGNORED_STALE", {
              providerType: provider.type,
              providerHash,
              elapsedMs: attempt.elapsedMs,
              channelCount: providerChannels.length,
              result: "stale",
            });
            return;
          }

          await yieldToUi();
          if (!isOwned()) return;
          const ids = new Set(providerChannels.map((channel) => channel.id));
          const programs = attempt.value ?? [];
          const xtreamMode = provider.type === "xtream" ? getXtreamEpgDiagnosticSnapshot().mode : "FULL_PIPELINE";
          const suppressPublication = provider.type === "xtream" && xtreamMode !== "FULL_PIPELINE";
          if (programs.length && !suppressPublication) {
            if (provider.type === "xtream") beginXtreamEpgPhase("PUBLICATION", diagnosticAttemptId);
            if (provider.type === "m3u") recordM3UEpgPublicationBegin();
            setState((previous) => {
              if (
                boundedProvider &&
                (
                  ownedAttempt?.controller.signal.aborted ||
                  generation === null ||
                  !epgAttemptGenerationRef.current.isCurrent(resolvedProviderId, generation) ||
                  previous.provider?.id !== resolvedProviderId
                )
              ) {
                return previous;
              }
              const next = {
                ...previous,
                epg: mergeEpgPrograms(previous.epg, ids, programs),
              };
              stateRef.current = next;
              return next;
            });
            if (provider.type === "m3u") recordM3UEpgPublicationEnd();
            if (provider.type === "xtream") {
              endXtreamEpgPhase("PUBLICATION", { publishedItemCount: programs.length }, diagnosticAttemptId);
              beginXtreamEpgPhase("UI_COMMIT", diagnosticAttemptId);
              await yieldToUi();
              if (!isOwned()) return;
              endXtreamEpgPhase("UI_COMMIT", { publishedItemCount: programs.length }, diagnosticAttemptId);
            }
          }
          if (suppressPublication) {
            if (force) manualEpgResultRef.current.set(resolvedProviderId, "success");
            return;
          }
          if (!isOwned()) return;
          epgCacheRef.current.set(resolvedProviderId, {
            loadedAt: Date.now(),
            channelCount: providerChannels.length,
            inputKey,
            sourceKey,
          });
          if (boundedProvider) epgRetryNotBeforeRef.current.delete(resolvedProviderId);
          if (provider.type === "m3u") recordM3UEpgRetryGate(false);
          if (boundedProvider) safeLog.info("EPG_ATTEMPT_SUCCESS", {
            providerType: provider.type,
            providerHash,
            elapsedMs: attempt.elapsedMs,
            channelCount: providerChannels.length,
            result: programs.length ? "success" : "empty",
          });
          if (force) manualEpgResultRef.current.set(resolvedProviderId, programs.length ? "success" : "empty");
        } catch {
          if (force && isOwned()) manualEpgResultRef.current.set(resolvedProviderId, "failure");
          // EPG remains optional for Stalker and bounded providers alike.
        } finally {
          if (provider.type === "xtream" && force && isXtreamEpgDiagnosticAttemptCurrent(diagnosticAttemptId))
            endXtreamEpgPhase("TRIGGER", {}, diagnosticAttemptId);
          if (m3uEpgStartedAt !== null && isOwned()) {
            const m3uEpgAttemptEndedAt = globalThis.performance?.now?.() ?? Date.now();
            recordM3UEpgEnd(m3uEpgAttemptEndedAt - m3uEpgStartedAt);
          }
          if (ownedAttempt) ownedEpgAttemptsRef.current.complete(ownedAttempt);
        }
        return;
      }

      const inFlight = bulkEpgPromiseRef.current.get(resolvedProviderId);
      if (inFlight) return;
      const latest = stateRef.current;
      const latestRegistered = getRegisteredEpgChannels<Channel>(resolvedProviderId);
      const targetChannel = latest.channels.find(
        (channel) =>
          channel.providerId === resolvedProviderId && channel.id === channelId,
      ) ?? latestRegistered.find((channel) => channel.id === channelId);
      if (!targetChannel) return;
      if (hasUsableChannelEpg(latest.epg, channelId)) return;
      if (provider.type !== "xtream") return;

      const requestKey = `${resolvedProviderId}\u0000${channelId}`;
      await activeEpgSingleFlightRef.current.run(requestKey, async () => {
        const beforeRequest = stateRef.current;
        if (hasUsableChannelEpg(beforeRequest.epg, channelId)) return;
        recordAutoEpgStart(resolvedProviderId);
        setIsEpgLoading(true);
        let ownedAttempt: OwnedEpgAttempt | null = null;
        try {
          const generation = epgAttemptGenerationRef.current.begin(resolvedProviderId);
          ownedAttempt = ownedEpgAttemptsRef.current.begin(resolvedProviderId, generation);
          const diagnosticAttemptId = resetXtreamEpgDiagnosticRun(1);
          ownedAttempt.diagnosticAttemptId = diagnosticAttemptId;
          const programs = await normalizeProgramText(
              await loadEpg(
                {
                  ...toXtreamLoadProvider(fromProvider(provider)),
                  epgUrl: undefined,
                },
                [targetChannel],
                { signal: ownedAttempt.controller.signal, diagnosticAttemptId },
              ),
              false, true, diagnosticAttemptId, ownedAttempt.controller.signal,
          );
          if (
            !ownedEpgAttemptsRef.current.isCurrent(ownedAttempt) ||
            !epgAttemptGenerationRef.current.isCurrent(resolvedProviderId, generation) ||
            stateRef.current.provider?.id !== resolvedProviderId
          ) return;
          setState((previous) => {
            if (ownedAttempt!.controller.signal.aborted ||
                !epgAttemptGenerationRef.current.isCurrent(resolvedProviderId, generation) ||
                previous.provider?.id !== resolvedProviderId) return previous;
            const next = {
              ...previous,
              epg: mergeEpgPrograms(previous.epg, new Set([channelId]), programs),
            };
            stateRef.current = next;
            return next;
          });
        } catch {
          // Active-channel EPG recovery is best effort and must never affect playback.
        } finally {
          if (ownedAttempt && ownedEpgAttemptsRef.current.isCurrent(ownedAttempt)) {
            setIsEpgLoading(false);
            ownedEpgAttemptsRef.current.complete(ownedAttempt);
          }
        }
      });
    },
    [],
  );

  const loadEpgManually = useCallback(async (providerId: string) => {
    const provider = stateRef.current.provider;
    if (provider?.id !== providerId || (provider.type !== "m3u" && provider.type !== "xtream")) return;
    if (!beginManualEpg(providerId)) return;
    manualEpgResultRef.current.delete(providerId);
    try {
      await refreshEpg(providerId, undefined, true);
      endManualEpg(providerId, manualEpgResultRef.current.get(providerId) ?? "failure");
    } catch {
      endManualEpg(providerId, "failure");
    } finally {
      manualEpgResultRef.current.delete(providerId);
    }
  }, [refreshEpg]);

  useEffect(() => {
    selectManualEpgProvider(state.provider?.id ?? null);
    const previousId = previousEpgProviderRef.current;
    const nextId = state.provider?.id ?? null;
    if (previousId && previousId !== nextId) {
      cancelOwnedEpg(previousId);
      epgAttemptGenerationRef.current.invalidate(previousId);
      setIsEpgLoading(false);
    }
    previousEpgProviderRef.current = nextId;
  }, [state.provider?.id]);

  useEffect(() => () => ownedEpgAttemptsRef.current.cancelAll(), []);

  useEffect(() => {
    if (isHydrating || !state.provider || state.provider.type !== "stalker") return;
    if (!state.channels.some((channel) => channel.providerId === state.provider?.id)) return;

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
    await persistLiveHistory(
      providerId,
      (history) => recordLiveHistory(history, providerId, channelId),
    );
  };

  const removeWatched = async (channelId: string) => {
    const current = stateRef.current;
    const providerId = providerIdFromChannelId(channelId) ?? current.provider?.id;
    if (!providerId) return;
    await persistLiveHistory(
      providerId,
      (history) => removeLiveHistory(history, providerId, channelId),
    );
  };

  const clearHistory = async () => {
    const current = stateRef.current;
    const providerId = current.provider?.id;
    if (!providerId) return;
    await persistLiveHistory(
      providerId,
      (history) => clearLiveHistoryProvider(history, providerId),
    );
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
      scopedError,
      m3uCatalogCommit,
      connectProvider,
      cancelProviderConnect,
      mergeImportedProviders,
      removeProvider,
      disconnectProvider,
      refreshProvider,
      recoverLegacyCatalogFallback,
      refreshEpg,
      loadEpgManually,
      resolveProviderForSwitch,
      setActiveProvider,
      toggleFavorite,
      recordWatched,
      removeWatched,
      clearHistory,
      clearError: () => setError(null),
      clearScopedError: (domain) => setScopedError((current) => !domain || current?.domain === domain ? null : current),
    }),
    [
      state,
      epgByChannel,
      isHydrating,
      isLoading,
      isEpgLoading,
      error,
      scopedError,
      m3uCatalogCommit,
      refreshEpg,
      loadEpgManually,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used within PlayerProvider");
  return context;
}
