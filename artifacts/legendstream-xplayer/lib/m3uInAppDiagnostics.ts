export type M3UDiagnosticView = "home" | "live" | "movies" | "series" | "history" | "downloads" | "settings" | "player";

export type M3USourceShape = {
  liveItems: number;
  vodItems: number;
  seriesItems: number;
  liveCategories: number;
  vodCategories: number;
  seriesCategories: number;
  maxCategoryItems: number;
  duplicateIds: number;
  emptyCategories: number;
  avgPayloadLen: number;
  maxPayloadLen: number;
  avgNameLen: number;
  maxNameLen: number;
};

export type M3UDiagnosticState = {
  providerType: "m3u" | null;
  providerHash: string | null;
  currentView: M3UDiagnosticView;
  lastNavPress: string | null;
  lastNavigate: string | null;
  lastViewCommit: string | null;
  touchSentinelCount: number;
  navPressCount: number;
  heartbeatDriftMs: number;
  heartbeatDriftMaxMs: number;
  lastHeartbeatTimestamp: number | null;
  isLoading: boolean;
  isSyncing: boolean;
  isRefreshing: boolean;
  isHydrating: boolean;
  catalogDrawerOpen: boolean;
  switchingProviderPresent: boolean;
  pageDbOpenMs: number | null;
  indexMs: Record<string, number>;
  countQueryMs: number | null;
  pageQueryMs: number | null;
  categoryQueryMs: number | null;
  sourceShape: M3USourceShape | null;
  currentCacheBatchKind: "live" | "vod" | "series" | null;
  currentCacheBatchNumber: number | null;
  cacheWriterActive: boolean;
};

const initialState = (): M3UDiagnosticState => ({
  providerType: null,
  providerHash: null,
  currentView: "home",
  lastNavPress: null,
  lastNavigate: null,
  lastViewCommit: null,
  touchSentinelCount: 0,
  navPressCount: 0,
  heartbeatDriftMs: 0,
  heartbeatDriftMaxMs: 0,
  lastHeartbeatTimestamp: null,
  isLoading: false,
  isSyncing: false,
  isRefreshing: false,
  isHydrating: false,
  catalogDrawerOpen: false,
  switchingProviderPresent: false,
  pageDbOpenMs: null,
  indexMs: {},
  countQueryMs: null,
  pageQueryMs: null,
  categoryQueryMs: null,
  sourceShape: null,
  currentCacheBatchKind: null,
  currentCacheBatchNumber: null,
  cacheWriterActive: false,
});

let state = initialState();
const listeners = new Set<() => void>();

function publish(next: M3UDiagnosticState) {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeM3UDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getM3UDiagnosticSnapshot() {
  return state;
}

export function redactProviderId(providerId: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < providerId.length; index += 1) {
    hash ^= providerId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `p-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function setM3UDiagnosticSession(providerId: string, view: M3UDiagnosticView) {
  const providerHash = redactProviderId(providerId);
  if (state.providerHash !== providerHash) {
    state = { ...initialState(), providerType: "m3u", providerHash, currentView: view };
    publish(state);
    return;
  }
  publish({ ...state, providerType: "m3u", currentView: view });
}

export function recordM3UTouchSentinel() {
  publish({ ...state, touchSentinelCount: state.touchSentinelCount + 1 });
}

export function recordM3UNavPress(target: string, currentView: M3UDiagnosticView) {
  publish({
    ...state,
    currentView,
    lastNavPress: target,
    navPressCount: state.navPressCount + 1,
  });
}

export function recordM3UNavigate(target: string) {
  publish({ ...state, lastNavigate: target });
}

export function recordM3UViewCommit(view: M3UDiagnosticView) {
  publish({ ...state, currentView: view, lastViewCommit: view });
}

export function recordM3UHeartbeat(driftMs: number, timestamp: number) {
  publish({
    ...state,
    heartbeatDriftMs: Math.max(0, Math.trunc(driftMs)),
    heartbeatDriftMaxMs: Math.max(state.heartbeatDriftMaxMs, Math.max(0, Math.trunc(driftMs))),
    lastHeartbeatTimestamp: timestamp,
  });
}

export function recordM3UBusyState(input: {
  isLoading: boolean;
  isSyncing: boolean;
  isRefreshing: boolean;
  isHydrating: boolean;
  catalogDrawerOpen: boolean;
  switchingProviderPresent: boolean;
}) {
  publish({ ...state, ...input });
}

export function recordM3UPageDbOpen(elapsedMs: number) {
  publish({ ...state, pageDbOpenMs: Math.max(0, Math.trunc(elapsedMs)) });
}

export function recordM3UIndexTiming(name: string, elapsedMs: number) {
  publish({
    ...state,
    indexMs: { ...state.indexMs, [name]: Math.max(0, Math.trunc(elapsedMs)) },
  });
}

export function recordM3UFirstQueryTiming(
  key: "countQueryMs" | "pageQueryMs" | "categoryQueryMs",
  elapsedMs: number,
) {
  if (state[key] !== null) return;
  publish({ ...state, [key]: Math.max(0, Math.trunc(elapsedMs)) });
}

export function recordM3USourceShape(sourceShape: M3USourceShape) {
  publish({ ...state, sourceShape });
}

export function recordM3UCacheBatch(
  phase: "begin" | "end",
  kind: "live" | "vod" | "series",
  batch: number,
) {
  publish({
    ...state,
    currentCacheBatchKind: kind,
    currentCacheBatchNumber: batch,
    cacheWriterActive: phase === "begin",
  });
}

export function resetM3UDiagnosticCounters() {
  publish({
    ...state,
    lastNavPress: null,
    lastNavigate: null,
    lastViewCommit: state.currentView,
    touchSentinelCount: 0,
    navPressCount: 0,
    heartbeatDriftMs: 0,
    heartbeatDriftMaxMs: 0,
    lastHeartbeatTimestamp: null,
    pageDbOpenMs: null,
    indexMs: {},
    countQueryMs: null,
    pageQueryMs: null,
    categoryQueryMs: null,
    currentCacheBatchKind: null,
    currentCacheBatchNumber: null,
    cacheWriterActive: false,
  });
}

const value = (input: string | number | boolean | null | undefined) =>
  input === null || input === undefined ? "—" : String(input);

export function buildM3UDiagnosticReport(snapshot: M3UDiagnosticState) {
  const shape = snapshot.sourceShape;
  const indexValues = Object.entries(snapshot.indexMs).sort(([left], [right]) => left.localeCompare(right));
  return [
    "M3U_DIAGNOSTIC_REPORT",
    `providerType=${value(snapshot.providerType)}`,
    `providerHash=${value(snapshot.providerHash)}`,
    `view=${value(snapshot.currentView)}`,
    `lastNavPress=${value(snapshot.lastNavPress)}`,
    `lastNavigate=${value(snapshot.lastNavigate)}`,
    `lastViewCommit=${value(snapshot.lastViewCommit)}`,
    `touchSentinelCount=${snapshot.touchSentinelCount}`,
    `navPressCount=${snapshot.navPressCount}`,
    `heartbeatDriftMs=${snapshot.heartbeatDriftMs}`,
    `heartbeatDriftMaxMs=${snapshot.heartbeatDriftMaxMs}`,
    `lastHeartbeatTimestamp=${value(snapshot.lastHeartbeatTimestamp)}`,
    `isLoading=${snapshot.isLoading}`,
    `isSyncing=${snapshot.isSyncing}`,
    `isRefreshing=${snapshot.isRefreshing}`,
    `isHydrating=${snapshot.isHydrating}`,
    `catalogDrawerOpen=${snapshot.catalogDrawerOpen}`,
    `switchingProviderPresent=${snapshot.switchingProviderPresent}`,
    `pageDbOpenMs=${value(snapshot.pageDbOpenMs)}`,
    ...indexValues.map(([name, ms], index) => `index${index + 1}Ms=${ms} (${name})`),
    `countQueryMs=${value(snapshot.countQueryMs)}`,
    `pageQueryMs=${value(snapshot.pageQueryMs)}`,
    `categoryQueryMs=${value(snapshot.categoryQueryMs)}`,
    `liveItems=${value(shape?.liveItems)}`,
    `vodItems=${value(shape?.vodItems)}`,
    `seriesItems=${value(shape?.seriesItems)}`,
    `liveCategories=${value(shape?.liveCategories)}`,
    `vodCategories=${value(shape?.vodCategories)}`,
    `seriesCategories=${value(shape?.seriesCategories)}`,
    `maxCategoryItems=${value(shape?.maxCategoryItems)}`,
    `duplicateIds=${value(shape?.duplicateIds)}`,
    `emptyCategories=${value(shape?.emptyCategories)}`,
    `avgPayloadLen=${value(shape?.avgPayloadLen)}`,
    `maxPayloadLen=${value(shape?.maxPayloadLen)}`,
    `avgNameLen=${value(shape?.avgNameLen)}`,
    `maxNameLen=${value(shape?.maxNameLen)}`,
    `cacheWriterActive=${snapshot.cacheWriterActive}`,
    `currentBatchKind=${value(snapshot.currentCacheBatchKind)}`,
    `currentBatch=${value(snapshot.currentCacheBatchNumber)}`,
  ].join("\n");
}
