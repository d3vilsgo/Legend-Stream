import type { StalkerTraceEntry } from "./stalkerPlaybackTrace";

export type C3HTracePath = "EXACT_PAGE" | "CATEGORY" | "FULL_DISCOVERY" | "PENDING" | "UNKNOWN";
export type C3HCmdStage = "ALREADY_RESOLVED" | "CREATE_LINK_REQUIRED" | "INVALID_RESOLVED" | "UNKNOWN";
export type C3HVlcState = "IDLE" | "OPENING" | "BUFFERING" | "PLAYING" | "ERROR";
export type C3JLookupKind = "EXACT" | "CATEGORY" | "FULL";
export type C3JLookupResult = "FOUND" | "MISS" | "OK" | "UNSUPPORTED" | "TIMEOUT" | "ABORTED" | "ERROR" | "PENDING";
export type C3KAttemptKind = "GENRE_ID" | "GENRE" | "DUAL" | "NONE" | "UNKNOWN";
export type C3KAttemptResult = "FOUND" | "MISS" | "OK" | "COMPAT_REJECT" | "UNSUPPORTED" | "TIMEOUT" | "AUTH_FAILED" | "ABORTED" | "ERROR" | "PENDING" | "UNKNOWN";
export type C3KAttemptRow = {
  sequence: number;
  kind: C3KAttemptKind;
  result: C3KAttemptResult;
  durationMs: number | null;
  networkMs: number | null;
  yieldMs: number | null;
  parseMs: number | null;
  requestCount: number | null;
};

export type C3JLookupRow = {
  sequence: number;
  kind: C3JLookupKind;
  result: C3JLookupResult;
  durationMs: number | null;
  networkMs: number | null;
  yieldMs: number | null;
  parseMs: number | null;
};

export type C3HPhysicalTraceState = {
  traceId: string | null;
  path: C3HTracePath;
  rows: number | null;
  lookups: number;
  getAll: boolean | null;
  reacquireMs: number | null;
  c3fMs: number | null;
  vlcStartMs: number | null;
  totalMs: number | null;
  cmdStage: C3HCmdStage;
  createLink: boolean | null;
  vlc: C3HVlcState;
  c3jLookups: C3JLookupRow[];
  c3kAttempts: C3KAttemptRow[];
  accountedMs: number | null;
  unaccountedMs: number | null;
  authRecoveries: number;
  authMs: number;
};

const SAFE_PATHS = new Set(["EXACT_PAGE", "CATEGORY", "FULL_DISCOVERY"]);
const SAFE_CMD_STAGES = new Set(["ALREADY_RESOLVED", "CREATE_LINK_REQUIRED", "INVALID_RESOLVED"]);

export const EMPTY_C3H_PHYSICAL_TRACE_STATE: C3HPhysicalTraceState = {
  traceId: null,
  path: "UNKNOWN",
  rows: null,
  lookups: 0,
  getAll: null,
  reacquireMs: null,
  c3fMs: null,
  vlcStartMs: null,
  totalMs: null,
  cmdStage: "UNKNOWN",
  createLink: null,
  vlc: "IDLE",
  c3jLookups: [],
  c3kAttempts: [],
  accountedMs: null,
  unaccountedMs: null,
  authRecoveries: 0,
  authMs: 0,
};

const detailString = (entry: StalkerTraceEntry | undefined, key: string) => {
  const value = entry?.details?.[key];
  return typeof value === "string" ? value : null;
};
const detailNumber = (entry: StalkerTraceEntry | undefined, key: string) => {
  const value = entry?.details?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};
const elapsed = (start?: StalkerTraceEntry, end?: StalkerTraceEntry) =>
  start && end && end.at >= start.at ? Math.max(0, end.at - start.at) : null;

export function projectC3HPhysicalTrace(entries: readonly StalkerTraceEntry[]): C3HPhysicalTraceState {
  const tap = [...entries].reverse().find((entry) =>
    entry.event === "STALKER_LIVE_TAP" && typeof entry.details.traceId === "string"
  );
  const traceId = detailString(tap, "traceId");
  if (!tap || !traceId) return { ...EMPTY_C3H_PHYSICAL_TRACE_STATE };

  const current = entries.filter((entry) => entry.details.traceId === traceId);
  const first = (event: string) => current.find((entry) => entry.event === event);
  const last = (event: string) => [...current].reverse().find((entry) => entry.event === event);

  const reacquireStart = first("PLAYBACK_REACQUIRE_START");
  const reacquireSource = last("PLAYBACK_REACQUIRE_SOURCE");
  const reacquireDone = last("PLAYBACK_REACQUIRE_DONE");
  const runtimeSuccess = last("CATALOG_RUNTIME_RESOLVE_SUCCESS");
  const vlcSourceSet = last("VLC_SOURCE_SET");
  const vlcPlaying = last("VLC_PLAYING");
  const sourceValue = detailString(reacquireSource, "source");
  const stageValue = detailString(last("STALKER_CMD_STAGE"), "stage");
  const lookups = current.filter((entry) => entry.event === "PLAYBACK_REACQUIRE_LOOKUP").length;
  const sawGetAll = current.some((entry) => entry.event === "PLAYBACK_REACQUIRE_GET_ALL");
  const lookupRows = new Map<number, C3JLookupRow>();
  for (const entry of current) {
    const sequence = detailNumber(entry, "lookupSeq");
    if (sequence === null) continue;
    const existing = lookupRows.get(sequence);
    if (entry.event === "C3J_LOOKUP_START") {
      const kind = detailString(entry, "lookupKind");
      if (kind === "EXACT" || kind === "CATEGORY" || kind === "FULL") {
        lookupRows.set(sequence, {
          sequence,
          kind,
          result: "PENDING",
          durationMs: null,
          networkMs: null,
          yieldMs: null,
          parseMs: null,
        });
      }
      continue;
    }
    if (!existing) continue;
    if (entry.event === "C3J_LOOKUP_DONE") {
      const result = detailString(entry, "lookupResult");
      if (result === "OK" || result === "UNSUPPORTED" || result === "TIMEOUT" || result === "ABORTED" || result === "ERROR") {
        existing.result = result;
      }
      existing.durationMs = detailNumber(entry, "durationMs");
      existing.networkMs = detailNumber(entry, "networkMs");
      existing.yieldMs = detailNumber(entry, "yieldMs");
      existing.parseMs = detailNumber(entry, "parseMs");
    } else if (entry.event === "C3J_LOOKUP_MATCH") {
      const result = detailString(entry, "lookupResult");
      if (result === "FOUND" || result === "MISS") existing.result = result;
    }
  }
  const attemptRows = new Map<number, C3KAttemptRow>();
  for (const entry of current) {
    const sequence = detailNumber(entry, "attemptSeq");
    if (sequence === null) continue;
    const existing = attemptRows.get(sequence);
    if (entry.event === "C3K_ATTEMPT_START") {
      const kind = detailString(entry, "attemptKind");
      if (kind === "GENRE_ID" || kind === "GENRE" || kind === "DUAL" || kind === "NONE" || kind === "UNKNOWN") {
        attemptRows.set(sequence, { sequence, kind, result: "PENDING", durationMs: null, networkMs: null, yieldMs: null, parseMs: null, requestCount: null });
      }
      continue;
    }
    if (!existing || entry.event !== "C3K_ATTEMPT_DONE") continue;
    const result = detailString(entry, "attemptResult");
    if (result === "FOUND" || result === "MISS" || result === "OK" || result === "COMPAT_REJECT" || result === "UNSUPPORTED" || result === "TIMEOUT" || result === "AUTH_FAILED" || result === "ABORTED" || result === "ERROR" || result === "UNKNOWN") existing.result = result;
    existing.durationMs = detailNumber(entry, "durationMs");
    existing.networkMs = detailNumber(entry, "networkMs");
    existing.yieldMs = detailNumber(entry, "yieldMs");
    existing.parseMs = detailNumber(entry, "parseMs");
    existing.requestCount = detailNumber(entry, "requestCount");
  }
  const c3kAttempts = [...attemptRows.values()].sort((a, b) => a.sequence - b.sequence);
  const authDone = current.filter((entry) => entry.event === "PLAYBACK_REACQUIRE_AUTH_DONE");
  const authMs = authDone.reduce((sum, entry) => sum + (detailNumber(entry, "authMs") ?? 0), 0);

  let path: C3HTracePath = "UNKNOWN";
  if (sourceValue && SAFE_PATHS.has(sourceValue)) path = sourceValue as C3HTracePath;
  else if (reacquireStart && !reacquireDone) path = "PENDING";

  let cmdStage: C3HCmdStage = "UNKNOWN";
  if (stageValue && SAFE_CMD_STAGES.has(stageValue)) cmdStage = stageValue as C3HCmdStage;

  const createLinkStarted = Boolean(first("STALKER_CREATE_LINK_START"));
  let createLink: boolean | null = null;
  if (createLinkStarted) createLink = true;
  else if (cmdStage === "ALREADY_RESOLVED" || cmdStage === "INVALID_RESOLVED") createLink = false;
  else if (cmdStage === "CREATE_LINK_REQUIRED" && runtimeSuccess) createLink = false;

  const vlcEvents = current.filter((entry) =>
    entry.event === "VLC_OPENING" ||
    entry.event === "VLC_BUFFERING" ||
    entry.event === "VLC_PLAYING" ||
    entry.event === "VLC_ERROR"
  );
  const lastVlc = vlcEvents[vlcEvents.length - 1]?.event;
  const vlc: C3HVlcState =
    lastVlc === "VLC_OPENING" ? "OPENING" :
    lastVlc === "VLC_BUFFERING" ? "BUFFERING" :
    lastVlc === "VLC_PLAYING" ? "PLAYING" :
    lastVlc === "VLC_ERROR" ? "ERROR" :
    "IDLE";

  const reacquireMs = elapsed(reacquireStart, reacquireDone);
  const completedAttemptDurations = c3kAttempts.map((row) => row.durationMs);
  const allAttemptsComplete = c3kAttempts.length > 0 && completedAttemptDurations.every((value) => value !== null);
  const accountedMs = allAttemptsComplete
    ? completedAttemptDurations.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const unaccountedMs = reacquireMs !== null && accountedMs !== null
    ? Math.max(0, reacquireMs - accountedMs)
    : null;

  return {
    traceId,
    path,
    rows: detailNumber(last("PLAYBACK_REACQUIRE_ROWS"), "rowCount"),
    lookups,
    getAll: sawGetAll ? true : reacquireDone ? false : null,
    reacquireMs,
    c3fMs: elapsed(reacquireDone, runtimeSuccess),
    vlcStartMs: elapsed(vlcSourceSet, vlcPlaying),
    totalMs: elapsed(tap, vlcPlaying),
    cmdStage,
    createLink,
    vlc,
    c3jLookups: [...lookupRows.values()].sort((a, b) => a.sequence - b.sequence),
    c3kAttempts,
    accountedMs,
    unaccountedMs,
    authRecoveries: authDone.length,
    authMs,
  };
}
