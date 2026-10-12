import AsyncStorage from "@react-native-async-storage/async-storage";

export type ProviderKind = "m3u" | "xtream" | "stalker" | "unknown";
export type StartupKind = "cold" | "warm";
export type StartupEventName =
  | "ROOT_MOUNT"
  | "PLAYER_HYDRATION_BEGIN" | "PLAYER_HYDRATION_END" | "PROVIDER_READY"
  | "CATALOG_DB_OPEN_BEGIN" | "CATALOG_DB_OPEN_END"
  | "STAGING_CLEANUP_BEGIN" | "STAGING_CLEANUP_END"
  | "COUNTS_BEGIN" | "COUNTS_END" | "SYNC_STATE_BEGIN" | "SYNC_STATE_END"
  | "HOME_LIVE_QUERY_BEGIN" | "HOME_LIVE_QUERY_END"
  | "HOME_VOD_QUERY_BEGIN" | "HOME_VOD_QUERY_END"
  | "HOME_SERIES_QUERY_BEGIN" | "HOME_SERIES_QUERY_END"
  | "HOME_NEW_CONTENT_QUERY_BEGIN" | "HOME_NEW_CONTENT_QUERY_END"
  | "SNAPSHOT_PUBLISH" | "HOME_FIRST_USABLE_RENDER";
export type PlaybackEventName =
  | "TAP" | "RESOLVE_BEGIN" | "RESOLVE_END" | "SOURCE_SET"
  | "VLC_OPENING" | "VLC_BUFFERING" | "VLC_PLAYING" | "VLC_ERROR" | "PLAYER_EXIT";

type TimedEvent<Name extends string> = { name: Name; atMs: number };
export type StartupSession = {
  id: string;
  kind: StartupKind;
  providerGeneration: number | null;
  providerKind: ProviderKind;
  events: Array<TimedEvent<StartupEventName>>;
};
export type PlaybackAttempt = {
  id: string;
  providerKind: ProviderKind;
  events: Array<TimedEvent<PlaybackEventName>>;
};
export type PerformanceDiagnosticsSnapshot = {
  enabled: boolean;
  preferenceLoaded: boolean;
  startup: StartupSession | null;
  playback: PlaybackAttempt[];
};

type ControllerOptions = {
  now?: () => number;
  randomId?: () => string;
  initialEnabled?: boolean;
  preferenceLoaded?: boolean;
};

const MAX_PLAYBACK_ATTEMPTS = 8;
const monotonicNow = () => globalThis.performance.now();
const randomId = () => {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? uuid.slice(0, 12) : `${Math.floor(monotonicNow())}-${Math.random().toString(36).slice(2, 8)}`;
};

export function createPerformanceDiagnostics(options: ControllerOptions = {}) {
  const now = options.now ?? monotonicNow;
  const makeId = options.randomId ?? randomId;
  let enabled = options.initialEnabled ?? false;
  let preferenceLoaded = options.preferenceLoaded ?? true;
  let startup: StartupSession | null = null;
  let playback: PlaybackAttempt[] = [];
  let activePlaybackId: string | null = null;
  let cachedSnapshot: PerformanceDiagnosticsSnapshot | null = null;
  const listeners = new Set<() => void>();
  const canCapture = () => enabled || !preferenceLoaded;
  const emit = () => { cachedSnapshot = null; for (const listener of listeners) listener(); };
  const safeId = () => makeId().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "session";
  const safeProviderKind = (value: ProviderKind): ProviderKind =>
    value === "m3u" || value === "xtream" || value === "stalker" ? value : "unknown";

  const setPreference = (next: boolean, loaded = true) => {
    enabled = next;
    preferenceLoaded = loaded;
    if (!next && loaded) {
      startup = null;
      playback = [];
      activePlaybackId = null;
    }
    emit();
  };
  const beginStartup = (kind: StartupKind, providerGeneration: number | null = null, providerKind: ProviderKind = "unknown") => {
    if (!canCapture()) return null;
    if (kind === "cold" && startup?.kind === "cold") return startup.id;
    if (kind === "warm" && startup?.kind === "warm" && startup.providerGeneration === providerGeneration && startup.providerKind === providerKind) return startup.id;
    startup = { id: `startup-${safeId()}`, kind, providerGeneration, providerKind: safeProviderKind(providerKind), events: [] };
    emit();
    return startup.id;
  };
  const bindStartupProvider = (providerGeneration: number, providerKind: ProviderKind) => {
    if (!canCapture()) return null;
    if (!startup) beginStartup("warm", providerGeneration, providerKind);
    else if (startup.providerGeneration === null) {
      startup = { ...startup, providerGeneration, providerKind: safeProviderKind(providerKind) };
      emit();
    } else if (startup.providerGeneration !== providerGeneration || startup.providerKind !== providerKind) {
      beginStartup("warm", providerGeneration, providerKind);
    }
    return startup?.id ?? null;
  };
  const markStartup = (name: StartupEventName) => {
    if (!canCapture()) return;
    if (!startup) beginStartup("cold");
    const repeatable = name.endsWith("_BEGIN") || name.endsWith("_END");
    if (!startup || (!repeatable && startup.events.some((event) => event.name === name))) return;
    startup = { ...startup, events: [...startup.events, { name, atMs: now() }] };
    emit();
  };
  const beginPlayback = (providerKind: ProviderKind) => {
    if (!canCapture()) return null;
    const attempt: PlaybackAttempt = { id: `playback-${safeId()}`, providerKind: safeProviderKind(providerKind), events: [{ name: "TAP", atMs: now() }] };
    playback = [...playback.slice(-(MAX_PLAYBACK_ATTEMPTS - 1)), attempt];
    activePlaybackId = attempt.id;
    emit();
    return attempt.id;
  };
  const markPlayback = (name: Exclude<PlaybackEventName, "TAP">) => {
    if (!canCapture() || !activePlaybackId) return;
    const index = playback.findIndex((attempt) => attempt.id === activePlaybackId);
    if (index < 0) return;
    const attempt = playback[index];
    if (name !== "VLC_BUFFERING" && attempt.events.some((event) => event.name === name)) return;
    const next = { ...attempt, events: [...attempt.events, { name, atMs: now() }] };
    playback = playback.map((item, itemIndex) => itemIndex === index ? next : item);
    emit();
  };
  const snapshot = (): PerformanceDiagnosticsSnapshot => {
    if (!cachedSnapshot) cachedSnapshot = {
      enabled,
      preferenceLoaded,
      startup: startup ? { ...startup, events: startup.events.slice() } : null,
      playback: playback.map((attempt) => ({ ...attempt, events: attempt.events.slice() })),
    };
    return cachedSnapshot;
  };
  return {
    setPreference,
    beginStartup,
    bindStartupProvider,
    markStartup,
    beginPlayback,
    markPlayback,
    snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

const PREFERENCE_KEY = "@legendstream/performance-diagnostics-enabled-v1";
const runtime = createPerformanceDiagnostics({ initialEnabled: false, preferenceLoaded: false });
void AsyncStorage.getItem(PREFERENCE_KEY)
  .then((value) => runtime.setPreference(value === "1", true))
  .catch(() => runtime.setPreference(false, true));

export const markRootMount = () => { runtime.beginStartup("cold"); runtime.markStartup("ROOT_MOUNT"); };
export const bindStartupProvider = (generation: number, providerKind: ProviderKind) => runtime.bindStartupProvider(generation, providerKind);
export const markStartupEvent = (name: StartupEventName) => runtime.markStartup(name);
export const observeStartupPromise = <T>(begin: StartupEventName, end: StartupEventName, promise: Promise<T>) => {
  runtime.markStartup(begin);
  return promise.then(
    (value) => { runtime.markStartup(end); return value; },
    (error) => { runtime.markStartup(end); throw error; },
  );
};
export const beginPlaybackAttempt = (providerKind: ProviderKind) => runtime.beginPlayback(providerKind);
export const markPlaybackEvent = (name: Exclude<PlaybackEventName, "TAP">) => runtime.markPlayback(name);
export const getPerformanceDiagnosticsSnapshot = () => runtime.snapshot();
export const subscribePerformanceDiagnostics = (listener: () => void) => runtime.subscribe(listener);
export async function setPerformanceDiagnosticsEnabled(enabled: boolean) {
  runtime.setPreference(enabled, true);
  await AsyncStorage.setItem(PREFERENCE_KEY, enabled ? "1" : "0");
}

const elapsed = (events: Array<TimedEvent<string>>, from: string, to: string) => {
  const durations: number[] = [];
  let pending: number | undefined;
  for (const event of events) {
    if (event.name === from) pending = event.atMs;
    if (event.name === to && pending !== undefined) {
      durations.push(Math.max(0, Math.round(event.atMs - pending)));
      pending = undefined;
    }
  }
  return durations.length ? durations.map((duration) => `${duration}ms`).join(",") : "NOT_OBSERVED";
};

export function formatPerformanceDiagnostics(snapshot = runtime.snapshot()) {
  const lines = ["LEGENDSTREAM_PERFORMANCE_DIAGNOSTICS_V1", `enabled=${snapshot.enabled}`];
  const startup = snapshot.startup;
  if (!startup) lines.push("startup=NOT_OBSERVED");
  else {
    lines.push(`startup.session=${startup.id}`, `startup.kind=${startup.kind}`, `startup.provider=${startup.providerKind}`, `startup.generation=${startup.providerGeneration ?? "NOT_OBSERVED"}`);
    const spans: Array<[string, StartupEventName, StartupEventName]> = [
      ["player_hydration", "PLAYER_HYDRATION_BEGIN", "PLAYER_HYDRATION_END"],
      ["catalog_db_open", "CATALOG_DB_OPEN_BEGIN", "CATALOG_DB_OPEN_END"],
      ["staging_cleanup", "STAGING_CLEANUP_BEGIN", "STAGING_CLEANUP_END"],
      ["counts", "COUNTS_BEGIN", "COUNTS_END"], ["sync_state", "SYNC_STATE_BEGIN", "SYNC_STATE_END"],
      ["home_live_query", "HOME_LIVE_QUERY_BEGIN", "HOME_LIVE_QUERY_END"],
      ["home_vod_query", "HOME_VOD_QUERY_BEGIN", "HOME_VOD_QUERY_END"],
      ["home_series_query", "HOME_SERIES_QUERY_BEGIN", "HOME_SERIES_QUERY_END"],
      ["home_new_content_query", "HOME_NEW_CONTENT_QUERY_BEGIN", "HOME_NEW_CONTENT_QUERY_END"],
      ["root_to_snapshot", "ROOT_MOUNT", "SNAPSHOT_PUBLISH"],
      ["root_to_first_usable", "ROOT_MOUNT", "HOME_FIRST_USABLE_RENDER"],
    ];
    for (const [label, from, to] of spans) lines.push(`startup.${label}=${elapsed(startup.events, from, to)}`);
  }
  if (!snapshot.playback.length) lines.push("playback=NOT_OBSERVED");
  for (const attempt of snapshot.playback) {
    lines.push(`playback.attempt=${attempt.id}`, `playback.provider=${attempt.providerKind}`);
    lines.push(`playback.resolve=${elapsed(attempt.events, "RESOLVE_BEGIN", "RESOLVE_END")}`);
    lines.push(`playback.source_set_to_opening=${elapsed(attempt.events, "SOURCE_SET", "VLC_OPENING")}`);
    lines.push(`playback.opening_to_playing=${elapsed(attempt.events, "VLC_OPENING", "VLC_PLAYING")}`);
    lines.push(`playback.tap_to_playing=${elapsed(attempt.events, "TAP", "VLC_PLAYING")}`);
    lines.push(`playback.buffering=${attempt.events.some((event) => event.name === "VLC_BUFFERING") ? "OBSERVED" : "NOT_OBSERVED"}`);
    lines.push(`playback.error=${attempt.events.some((event) => event.name === "VLC_ERROR") ? "OBSERVED" : "NOT_OBSERVED"}`);
  }
  return lines.join("\n");
}
