import type { StalkerTraceEntry } from "./stalkerPlaybackTrace";

export type C3HTracePath = "EXACT_PAGE" | "CATEGORY" | "FULL_DISCOVERY" | "PENDING" | "UNKNOWN";
export type C3HCmdStage = "ALREADY_RESOLVED" | "CREATE_LINK_REQUIRED" | "INVALID_RESOLVED" | "UNKNOWN";
export type C3HVlcState = "IDLE" | "OPENING" | "BUFFERING" | "PLAYING" | "ERROR";

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

  return {
    traceId,
    path,
    rows: detailNumber(last("PLAYBACK_REACQUIRE_ROWS"), "rowCount"),
    lookups,
    getAll: sawGetAll ? true : reacquireDone ? false : null,
    reacquireMs: elapsed(reacquireStart, reacquireDone),
    c3fMs: elapsed(reacquireDone, runtimeSuccess),
    vlcStartMs: elapsed(vlcSourceSet, vlcPlaying),
    totalMs: elapsed(tap, vlcPlaying),
    cmdStage,
    createLink,
    vlc,
  };
}
