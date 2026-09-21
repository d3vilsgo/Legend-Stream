import { safeLog } from "./safeLog";

export type ManualEpgResult = "idle" | "success" | "empty" | "timeout" | "failure" | "stale";

export type ManualEpgSnapshot = {
  triggerMode: "manual";
  providerId: string | null;
  manualPressCount: number;
  lastManualPressAt: number | null;
  manualActive: boolean;
  manualElapsedMs: number | null;
  manualResult: ManualEpgResult;
  autoStartCount: number;
  heartbeatDriftMaxMs: number;
};

const empty = (providerId: string | null): ManualEpgSnapshot => ({
  triggerMode: "manual", providerId, manualPressCount: 0, lastManualPressAt: null,
  manualActive: false, manualElapsedMs: null, manualResult: "idle",
  autoStartCount: 0, heartbeatDriftMaxMs: 0,
});

let snapshot = empty(null);
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function subscribeManualEpg(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getManualEpgSnapshot() { return snapshot; }

export function selectManualEpgProvider(providerId: string | null) {
  if (snapshot.providerId === providerId) return;
  snapshot = empty(providerId);
  notify();
}

export function beginManualEpg(providerId: string) {
  if (snapshot.providerId !== providerId) selectManualEpgProvider(providerId);
  if (snapshot.manualActive) return false;
  const at = Date.now();
  snapshot = { ...snapshot, manualPressCount: snapshot.manualPressCount + 1,
    lastManualPressAt: at, manualActive: true, manualElapsedMs: null, manualResult: "idle" };
  safeLog.info("EPG_MANUAL_BEGIN", { pressCount: snapshot.manualPressCount, timestamp: at });
  notify();
  return true;
}

export function recordAutoEpgStart(providerId: string) {
  if (snapshot.providerId !== providerId) selectManualEpgProvider(providerId);
  snapshot = { ...snapshot, autoStartCount: snapshot.autoStartCount + 1 };
  safeLog.info("EPG_AUTO_START", { count: snapshot.autoStartCount });
  notify();
}

export function endManualEpg(providerId: string, result: ManualEpgResult) {
  if (snapshot.providerId !== providerId || !snapshot.manualActive) return;
  const elapsedMs = Math.max(0, Date.now() - (snapshot.lastManualPressAt ?? Date.now()));
  snapshot = { ...snapshot, manualActive: false, manualElapsedMs: elapsedMs, manualResult: result };
  safeLog.info("EPG_MANUAL_END", { result, elapsedMs });
  notify();
}

export function recordManualEpgHeartbeat(providerId: string, driftMs: number) {
  if (snapshot.providerId !== providerId || !Number.isFinite(driftMs)) return;
  const rounded = Math.max(0, Math.round(driftMs));
  if (rounded <= snapshot.heartbeatDriftMaxMs) return;
  snapshot = { ...snapshot, heartbeatDriftMaxMs: rounded };
  notify();
}

export function manualEpgDiagnosticLines(value = snapshot) {
  return [
    "EPG_TRIGGER_MODE=manual",
    `EPG_MANUAL_PRESS_COUNT=${value.manualPressCount}`,
    `LAST_EPG_MANUAL_PRESS_AT=${value.lastManualPressAt ?? "—"}`,
    `EPG_MANUAL_ACTIVE=${value.manualActive}`,
    `EPG_MANUAL_ELAPSED_MS=${value.manualElapsedMs ?? "—"}`,
    `EPG_MANUAL_RESULT=${value.manualResult}`,
    `EPG_AUTO_START_COUNT=${value.autoStartCount}`,
    `EPG_HEARTBEAT_DRIFT_MAX_MS=${value.heartbeatDriftMaxMs}`,
  ];
}
