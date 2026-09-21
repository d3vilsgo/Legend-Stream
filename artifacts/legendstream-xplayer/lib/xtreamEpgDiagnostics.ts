import { safeLog } from "./safeLog";

export type XtreamEpgDiagnosticMode =
  | "FETCH_ONLY"
  | "FETCH_BODY_ONLY"
  | "PARSE_NO_PUBLICATION"
  | "FULL_PIPELINE";
export type XtreamEpgSourceKind = "short_epg" | "xmltv" | "other_bounded" | "unknown";
export type XtreamEpgPhase =
  | "TRIGGER" | "FETCH" | "BODY" | "DECODE" | "PARSE" | "NORMALIZE" | "PUBLICATION" | "UI_COMMIT";

type PhaseMetric = { startedAt: number | null; elapsedMs: number | null; heartbeatDriftMaxMs: number };
export type XtreamEpgDiagnosticSnapshot = {
  mode: XtreamEpgDiagnosticMode;
  sourceKind: XtreamEpgSourceKind;
  maxObservedHeartbeatDriftMs: number;
  bodyBytes: number | null;
  bodyChars: number | null;
  channelCount: number | null;
  programmeCount: number | null;
  publishedItemCount: number | null;
  phases: Record<XtreamEpgPhase, PhaseMetric>;
};

const phases: XtreamEpgPhase[] = ["TRIGGER","FETCH","BODY","DECODE","PARSE","NORMALIZE","PUBLICATION","UI_COMMIT"];
const now = () => globalThis.performance?.now?.() ?? Date.now();
const freshPhases = () => Object.fromEntries(phases.map((phase) => [phase, {
  startedAt: null, elapsedMs: null, heartbeatDriftMaxMs: 0,
}])) as Record<XtreamEpgPhase, PhaseMetric>;
let snapshot: XtreamEpgDiagnosticSnapshot = {
  mode: "FULL_PIPELINE", sourceKind: "unknown", maxObservedHeartbeatDriftMs: 0,
  bodyBytes: null, bodyChars: null, channelCount: null, programmeCount: null,
  publishedItemCount: null, phases: freshPhases(),
};
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
export function subscribeXtreamEpgDiagnostics(listener: () => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function getXtreamEpgDiagnosticSnapshot() { return snapshot; }
export function setXtreamEpgDiagnosticMode(mode: XtreamEpgDiagnosticMode) {
  snapshot = { ...snapshot, mode }; notify();
}
export function resetXtreamEpgDiagnosticRun(channelCount: number) {
  snapshot = { ...snapshot, sourceKind: "unknown", maxObservedHeartbeatDriftMs: 0,
    bodyBytes: null, bodyChars: null, channelCount, programmeCount: null,
    publishedItemCount: null, phases: freshPhases() };
  notify();
}
export function setXtreamEpgSourceKind(sourceKind: XtreamEpgSourceKind) {
  snapshot = { ...snapshot, sourceKind }; notify();
}
export function beginXtreamEpgPhase(phase: XtreamEpgPhase) {
  snapshot = { ...snapshot, phases: { ...snapshot.phases,
    [phase]: { ...snapshot.phases[phase], startedAt: now(), elapsedMs: null } } };
  safeLog.info(`XTREAM_EPG_${phase}_BEGIN`, {});
  notify();
}
export function endXtreamEpgPhase(phase: XtreamEpgPhase, metrics: {
  bodyBytes?: number; bodyChars?: number; programmeCount?: number; publishedItemCount?: number;
} = {}) {
  const metric = snapshot.phases[phase];
  const elapsedMs = metric.startedAt === null ? null : Math.max(0, Math.round(now() - metric.startedAt));
  snapshot = { ...snapshot,
    bodyBytes: metrics.bodyBytes ?? snapshot.bodyBytes,
    bodyChars: metrics.bodyChars ?? snapshot.bodyChars,
    programmeCount: metrics.programmeCount ?? snapshot.programmeCount,
    publishedItemCount: metrics.publishedItemCount ?? snapshot.publishedItemCount,
    phases: { ...snapshot.phases, [phase]: { ...metric, elapsedMs } } };
  safeLog.info(`XTREAM_EPG_${phase}_END`, { elapsedMs,
    bodyBytes: metrics.bodyBytes, bodyChars: metrics.bodyChars,
    programmeCount: metrics.programmeCount, publishedItemCount: metrics.publishedItemCount });
  notify();
}
export function recordXtreamEpgHeadersReceived() {
  safeLog.info("XTREAM_EPG_HEADERS_RECEIVED", {});
}
export function recordXtreamEpgHeartbeat(driftMs: number) {
  if (!Number.isFinite(driftMs)) return;
  const drift = Math.max(0, Math.round(driftMs));
  let active: XtreamEpgPhase | null = null;
  for (const phase of phases) if (snapshot.phases[phase].startedAt !== null && snapshot.phases[phase].elapsedMs === null) active = phase;
  if (drift <= snapshot.maxObservedHeartbeatDriftMs && (!active || drift <= snapshot.phases[active].heartbeatDriftMaxMs)) return;
  snapshot = { ...snapshot, maxObservedHeartbeatDriftMs: Math.max(snapshot.maxObservedHeartbeatDriftMs, drift),
    phases: active ? { ...snapshot.phases, [active]: { ...snapshot.phases[active],
      heartbeatDriftMaxMs: Math.max(snapshot.phases[active].heartbeatDriftMaxMs, drift) } } : snapshot.phases };
  notify();
}
export function xtreamEpgDiagnosticLines(value = snapshot) {
  return [
    `XTREAM_EPG_DIAGNOSTIC_MODE=${value.mode}`,
    `XTREAM_EPG_SOURCE_KIND=${value.sourceKind}`,
    `XTREAM_EPG_MAX_OBSERVED_HEARTBEAT_DRIFT_MS=${value.maxObservedHeartbeatDriftMs}`,
    `XTREAM_EPG_BODY_BYTES=${value.bodyBytes ?? "—"}`,
    `XTREAM_EPG_BODY_CHARS=${value.bodyChars ?? "—"}`,
    `XTREAM_EPG_CHANNEL_COUNT=${value.channelCount ?? "—"}`,
    `XTREAM_EPG_PROGRAMME_COUNT=${value.programmeCount ?? "—"}`,
    `XTREAM_EPG_PUBLISHED_ITEM_COUNT=${value.publishedItemCount ?? "—"}`,
    ...phases.flatMap((phase) => [
      `XTREAM_EPG_${phase}_ELAPSED_MS=${value.phases[phase].elapsedMs ?? "—"}`,
      `XTREAM_EPG_${phase}_HEARTBEAT_DRIFT_MAX_MS=${value.phases[phase].heartbeatDriftMaxMs}`,
    ]),
  ];
}
