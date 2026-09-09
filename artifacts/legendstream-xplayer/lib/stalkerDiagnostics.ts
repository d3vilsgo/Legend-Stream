import { safeLog } from "./safeLog";

export type StalkerDiagnosticMarker =
  | "STALKER_FETCH_START"
  | "STALKER_FETCH_RESOLVED"
  | "STALKER_BODY_READ_START"
  | "STALKER_BODY_READ_END"
  | "STALKER_POST_BODY_YIELD_START"
  | "STALKER_POST_BODY_YIELD_END"
  | "STALKER_JSON_PARSE_START"
  | "STALKER_JSON_PARSE_END"
  | "STALKER_REQUEST_RETURN"
  | "STALKER_AGGREGATE_NORMALIZE_START"
  | "STALKER_FIRST_NORMALIZE_YIELD"
  | "STALKER_AGGREGATE_NORMALIZE_END"
  | "STALKER_STAGE_START"
  | "STALKER_FIRST_STAGE_WRITE_START"
  | "STALKER_FIRST_STAGE_WRITE_END"
  | "STALKER_FIRST_STAGE_YIELD"
  | "STALKER_STAGE_END"
  | "STALKER_COMMIT_START"
  | "STALKER_COMMIT_END"
  | "STALKER_SYNC_END";

export type StalkerDiagnosticAction =
  | "handshake"
  | "get_profile"
  | "get_genres"
  | "get_all_channels"
  | "get_ordered_list"
  | "other";

type MarkerDetails = {
  syncRunId?: string;
  providerId?: string;
  action?: StalkerDiagnosticAction;
  endpointKind?: string;
  elapsedMs?: number;
  durationMs?: number;
  timerLatenessMs?: number;
  status?: number;
  ok?: boolean;
  rowCount?: number;
  chunkSize?: number;
  chunkIndex?: number;
  chunkRows?: number;
  persisted?: number;
  expectedCount?: number;
  categoryCount?: number;
  pagesFetched?: number;
  discoverySource?: string;
  result?: "SUCCESS" | "CANCELLED" | "ERROR";
  errorCode?: string;
};

export const stalkerDiagnosticNowMs = () => {
  const performanceNow = globalThis.performance?.now;
  return typeof performanceNow === "function"
    ? performanceNow.call(globalThis.performance)
    : Date.now();
};

export function classifyStalkerDiagnosticAction(value: unknown): StalkerDiagnosticAction {
  switch (value) {
    case "handshake":
    case "get_profile":
    case "get_genres":
    case "get_all_channels":
    case "get_ordered_list":
      return value;
    default:
      return "other";
  }
}

export function beginStalkerDiagnosticTimer(nowFn: () => number = stalkerDiagnosticNowMs) {
  const startedAt = nowFn();
  let firedAt: number | null = null;
  const setTimer = globalThis.setTimeout;
  const timer = typeof setTimer === "function"
    ? setTimer(() => {
      firedAt = nowFn();
    }, 0)
    : null;
  return {
    elapsed() {
      return Math.max(0, nowFn() - startedAt);
    },
    lateness() {
      return firedAt === null ? Math.max(0, nowFn() - startedAt) : Math.max(0, firedAt - startedAt);
    },
    cancel() {
      if (timer !== null && typeof globalThis.clearTimeout === "function") {
        globalThis.clearTimeout(timer);
      }
    },
  };
}

export function logStalkerDiagnosticMarker(marker: StalkerDiagnosticMarker, details: MarkerDetails) {
  safeLog.info(marker, details);
}
