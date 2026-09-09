import { safeLog } from "./safeLog";

export type StalkerConnectCheckpoint =
  | "CONNECT_START"
  | "CONNECT_DEADLINE_ARMED"
  | "CONNECT_DEADLINE_FIRED"
  | "CONNECT_CHILD_RESOLVED"
  | "CONNECT_CHILD_REJECTED"
  | "STALKER_LOAD_START"
  | "BOOTSTRAP_START"
  | "HANDSHAKE_DONE"
  | "PROFILE_DONE"
  | "GET_GENRES_REQUEST_START"
  | "GET_GENRES_RESPONSE_HEADERS"
  | "GET_GENRES_BODY_DONE"
  | "GET_GENRES_AFTER_YIELD"
  | "GET_GENRES_PARSED"
  | "CATEGORIES_NORMALIZED"
  | "CATEGORIES_REMEMBERED"
  | "BOOTSTRAP_DONE"
  | "LOAD_PROVIDER_SMART_DONE"
  | "SAVE_PROVIDER_SECRETS_START"
  | "SAVE_PROVIDER_SECRETS_DONE"
  | "VERIFY_PROVIDER_SECRETS_START"
  | "VERIFY_PROVIDER_SECRETS_DONE"
  | "PERSIST_PROVIDER_START"
  | "PERSIST_PROVIDER_DONE"
  | "CONNECT_RETURN_TRUE"
  | "CONNECT_CATCH"
  | "CONNECT_FINALLY_ENTER"
  | "CONNECT_BUSY_CLEARED"
  | "CONNECT_FINALLY_EXIT";

export type StalkerConnectTraceSnapshot = {
  sequence: number;
  checkpoint: StalkerConnectCheckpoint;
  timestampMs: number;
  elapsedMs: number;
};

type Listener = (snapshot: StalkerConnectTraceSnapshot | null) => void;

let sequence = 0;
let connectStartedAt = 0;
let snapshot: StalkerConnectTraceSnapshot | null = null;
const listeners = new Set<Listener>();

export function traceStalkerConnectCheckpoint(
  checkpoint: StalkerConnectCheckpoint,
  details: Record<string, unknown> = {},
) {
  const timestampMs = Date.now();
  if (checkpoint === "CONNECT_START" || connectStartedAt === 0) {
    connectStartedAt = timestampMs;
    sequence = 0;
  }
  const next = {
    sequence: ++sequence,
    checkpoint,
    timestampMs,
    elapsedMs: Math.max(0, timestampMs - connectStartedAt),
  };
  snapshot = next;
  safeLog.info(`[STALKER_TRACE #${String(next.sequence).padStart(2, "0")} +${next.elapsedMs}ms]`, {
    checkpoint,
    timestampMs: next.timestampMs,
    elapsedMs: next.elapsedMs,
    ...details,
  });
  for (const listener of listeners) listener(snapshot);
}

export function getStalkerConnectTraceSnapshot() {
  return snapshot;
}

export function subscribeStalkerConnectTrace(listener: Listener) {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}
