import { safeLog, sanitizeErrorForLog } from "./safeLog";

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


export type M3UPlaybackUriMetadata = {
  scheme: "http" | "https" | "other";
  inputExtension: "ts" | "m3u8" | "other";
  effectiveExtension: "ts" | "m3u8" | "other";
  rewriteApplied: boolean;
  hasLivePath: boolean;
  sourceLength: number;
};

type M3UPlaybackSequenceEntry = {
  marker: string;
  at: number;
  elapsedMs: number | null;
};

type M3UCorrelationEvent = {
  marker: string;
  at: number;
  elapsedMs: number | null;
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
  sourceInputCounts: { live: number; vod: number; series: number } | null;
  sourceDuplicateIds: number | null;
  currentCacheBatchKind: "live" | "vod" | "series" | null;
  currentCacheBatchNumber: number | null;
  cacheWriterActive: boolean;
  lastLivePressAt: number | null;
  lastChannelPressCount: number;
  openLiveEnterAt: number | null;
  setPlayableAt: number | null;
  setPlayerViewAt: number | null;
  playerViewCommitAt: number | null;
  compatPlayerMountedAt: number | null;
  orientationBeginAt: number | null;
  orientationGetCompletedAt: number | null;
  orientationUnlockBeginAt: number | null;
  orientationUnlockEndAt: number | null;
  orientationReadyAt: number | null;
  orientationElapsedMs: number | null;
  orientationError: string | null;
  vlcSurfaceMountedAt: number | null;
  uriMetadata: M3UPlaybackUriMetadata | null;
  vlcPlayingAt: number | null;
  vlcPlayingElapsedMs: number | null;
  liveQueueBeginAt: number | null;
  liveQueueEndAt: number | null;
  liveQueueElapsedMs: number | null;
  liveQueueRowCount: number | null;
  playbackSequence: M3UPlaybackSequenceEntry[];
  pageLoadingInitial: boolean;
  pageLoadingMore: boolean;
  pageItemsCount: number;
  parentRefreshing: boolean;
  isEpgLoading: boolean;
  categoriesReady: boolean;
  selectedCategory: string | null;
  pressInCount: number;
  pressCount: number;
  pressOutCount: number;
  lastLivePressInAt: number | null;
  lastLivePressOutAt: number | null;
  m3uBgRefreshActive: boolean;
  lastM3uBgRefreshBegin: number | null;
  lastM3uBgRefreshLoadEnd: number | null;
  lastM3uBgRefreshEnd: number | null;
  lastM3uBgRefreshElapsedMs: number | null;
  m3uEpgActive: boolean;
  lastM3uEpgBegin: number | null;
  lastM3uEpgEnd: number | null;
  lastM3uEpgElapsedMs: number | null;
  m3uFetchWaitMs: number | null;
  m3uResponseTextMs: number | null;
  m3uSplitMs: number | null;
  m3uParseLinesMs: number | null;
  m3uCatalogBuildMs: number | null;
  m3uTotalIngestMs: number | null;
  m3uBgMaxJsSliceMs: number;
  epgAttemptActive: boolean;
  epgUnderlyingWorkActive: boolean;
  epgRetryGateActive: boolean;
  epgGenerationCurrent: boolean | null;
  epgFetchHeaderMs: number | null;
  epgBodyMaterializeMs: number | null;
  epgDecodeMs: number | null;
  epgStringAssemblyMs: number | null;
  epgParseMs: number | null;
  epgNormalizeMs: number | null;
  epgPublicationMs: number | null;
  epgTotalWorkMs: number | null;
  epgTimeoutTimerDriftMs: number | null;
  epgUnderlyingSettleAfterTimeoutMs: number | null;
  correlationSequence: M3UCorrelationEvent[];
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
  sourceInputCounts: null,
  sourceDuplicateIds: null,
  currentCacheBatchKind: null,
  currentCacheBatchNumber: null,
  cacheWriterActive: false,
  lastLivePressAt: null,
  lastChannelPressCount: 0,
  openLiveEnterAt: null,
  setPlayableAt: null,
  setPlayerViewAt: null,
  playerViewCommitAt: null,
  compatPlayerMountedAt: null,
  orientationBeginAt: null,
  orientationGetCompletedAt: null,
  orientationUnlockBeginAt: null,
  orientationUnlockEndAt: null,
  orientationReadyAt: null,
  orientationElapsedMs: null,
  orientationError: null,
  vlcSurfaceMountedAt: null,
  uriMetadata: null,
  vlcPlayingAt: null,
  vlcPlayingElapsedMs: null,
  liveQueueBeginAt: null,
  liveQueueEndAt: null,
  liveQueueElapsedMs: null,
  liveQueueRowCount: null,
  playbackSequence: [],
  pageLoadingInitial: false,
  pageLoadingMore: false,
  pageItemsCount: 0,
  parentRefreshing: false,
  isEpgLoading: false,
  categoriesReady: false,
  selectedCategory: null,
  pressInCount: 0,
  pressCount: 0,
  pressOutCount: 0,
  lastLivePressInAt: null,
  lastLivePressOutAt: null,
  m3uBgRefreshActive: false,
  lastM3uBgRefreshBegin: null,
  lastM3uBgRefreshLoadEnd: null,
  lastM3uBgRefreshEnd: null,
  lastM3uBgRefreshElapsedMs: null,
  m3uEpgActive: false,
  lastM3uEpgBegin: null,
  lastM3uEpgEnd: null,
  lastM3uEpgElapsedMs: null,
  m3uFetchWaitMs: null,
  m3uResponseTextMs: null,
  m3uSplitMs: null,
  m3uParseLinesMs: null,
  m3uCatalogBuildMs: null,
  m3uTotalIngestMs: null,
  m3uBgMaxJsSliceMs: 0,
  epgAttemptActive: false,
  epgUnderlyingWorkActive: false,
  epgRetryGateActive: false,
  epgGenerationCurrent: null,
  epgFetchHeaderMs: null,
  epgBodyMaterializeMs: null,
  epgDecodeMs: null,
  epgStringAssemblyMs: null,
  epgParseMs: null,
  epgNormalizeMs: null,
  epgPublicationMs: null,
  epgTotalWorkMs: null,
  epgTimeoutTimerDriftMs: null,
  epgUnderlyingSettleAfterTimeoutMs: null,
  correlationSequence: [],
});

let playbackPressStartedAt: number | null = null;
type M3UIngestClock = {
  fetchBegin: number | null;
  fetchResponse: number | null;
  responseTextEnd: number | null;
  splitBegin: number | null;
  splitEnd: number | null;
  parseLinesEnd: number | null;
};
const emptyIngestClock = (): M3UIngestClock => ({
  fetchBegin: null,
  fetchResponse: null,
  responseTextEnd: null,
  splitBegin: null,
  splitEnd: null,
  parseLinesEnd: null,
});
let ingestClock = emptyIngestClock();
type EpgPhaseClock = {
  workBegin: number | null;
  fetchBegin: number | null;
  bodyBegin: number | null;
  decodeBegin: number | null;
  stringAssemblyBegin: number | null;
  parseBegin: number | null;
  normalizeBegin: number | null;
  publicationBegin: number | null;
};
const emptyEpgPhaseClock = (): EpgPhaseClock => ({
  workBegin: null,
  fetchBegin: null,
  bodyBegin: null,
  decodeBegin: null,
  stringAssemblyBegin: null,
  parseBegin: null,
  normalizeBegin: null,
  publicationBegin: null,
});
let epgPhaseClock = emptyEpgPhaseClock();
const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now();
const wallNow = () => Date.now();
const elapsedFromPress = () => playbackPressStartedAt === null
  ? null
  : Math.max(0, Math.round(monotonicNow() - playbackPressStartedAt));
const sequenceEntry = (marker: string): M3UPlaybackSequenceEntry => ({
  marker,
  at: wallNow(),
  elapsedMs: elapsedFromPress(),
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

export function recordM3UPagedLiveState(input: {
  pageLoadingInitial: boolean;
  pageLoadingMore: boolean;
  pageItemsCount: number;
  parentRefreshing: boolean;
  isEpgLoading: boolean;
  categoriesReady: boolean;
  selectedCategory: string | null;
}) {
  if (state.providerType !== "m3u") return;
  publish({
    ...state,
    ...input,
    pageItemsCount: Math.max(0, Math.trunc(input.pageItemsCount)),
  });
}

export function recordM3ULivePressIn() {
  if (state.providerType !== "m3u") return;
  const at = wallNow();
  publish({
    ...state,
    pressInCount: state.pressInCount + 1,
    lastLivePressInAt: at,
    correlationSequence: [...state.correlationSequence.slice(-31), { marker: "M3U_LIVE_PRESS_IN", at, elapsedMs: null }],
  });
  safeLog.info("M3U_LIVE_PRESS_IN", { timestamp: at });
}

export function recordM3ULivePressOut() {
  if (state.providerType !== "m3u") return;
  const at = wallNow();
  publish({
    ...state,
    pressOutCount: state.pressOutCount + 1,
    lastLivePressOutAt: at,
    correlationSequence: [...state.correlationSequence.slice(-31), { marker: "M3U_LIVE_PRESS_OUT", at, elapsedMs: null }],
  });
  safeLog.info("M3U_LIVE_PRESS_OUT", { timestamp: at });
}

export function recordM3UBackgroundRefreshBegin() {
  if (state.providerType !== "m3u") return;
  const at = wallNow();
  publish({
    ...state,
    m3uBgRefreshActive: true,
    m3uBgMaxJsSliceMs: 0,
    lastM3uBgRefreshBegin: at,
    lastM3uBgRefreshLoadEnd: null,
    lastM3uBgRefreshEnd: null,
    lastM3uBgRefreshElapsedMs: null,
    correlationSequence: [...state.correlationSequence.slice(-31), { marker: "M3U_BG_REFRESH_BEGIN", at, elapsedMs: null }],
  });
  safeLog.info("M3U_BG_REFRESH_BEGIN", { timestamp: at });
}

export function recordM3UBackgroundRefreshLoadEnd(elapsedMs: number) {
  if (state.providerType !== "m3u") return;
  const safeElapsed = Math.max(0, Math.round(elapsedMs));
  const at = wallNow();
  publish({
    ...state,
    lastM3uBgRefreshLoadEnd: at,
    correlationSequence: [...state.correlationSequence.slice(-31), { marker: "M3U_BG_REFRESH_LOAD_END", at, elapsedMs: safeElapsed }],
  });
  safeLog.info("M3U_BG_REFRESH_LOAD_END", { timestamp: at, elapsedMs: safeElapsed });
}

export function recordM3UBackgroundRefreshEnd(elapsedMs: number) {
  if (state.providerType !== "m3u") return;
  const safeElapsed = Math.max(0, Math.round(elapsedMs));
  const at = wallNow();
  publish({
    ...state,
    m3uBgRefreshActive: false,
    lastM3uBgRefreshEnd: at,
    lastM3uBgRefreshElapsedMs: safeElapsed,
    correlationSequence: [...state.correlationSequence.slice(-31), { marker: "M3U_BG_REFRESH_END", at, elapsedMs: safeElapsed }],
  });
  safeLog.info("M3U_BG_REFRESH_END", { timestamp: at, elapsedMs: safeElapsed });
}

function safePhaseDuration(start: number | null, end: number) {
  return start === null ? null : Math.max(0, Math.round(end - start));
}

function publishM3UIngestMarker(
  marker: string,
  monotonicAt: number,
  patch: Partial<M3UDiagnosticState>,
) {
  if (state.providerType !== "m3u") return;
  const at = wallNow();
  const elapsedMs = safePhaseDuration(ingestClock.fetchBegin, monotonicAt);
  publish({
    ...state,
    ...patch,
    correlationSequence: [
      ...state.correlationSequence.slice(-31),
      { marker, at, elapsedMs },
    ],
  });
  safeLog.info(marker, { timestamp: at, elapsedMs });
}

export function recordM3UFetchBegin(monotonicAt = monotonicNow()) {
  if (state.providerType !== "m3u") return;
  ingestClock = {
    fetchBegin: monotonicAt,
    fetchResponse: null,
    responseTextEnd: null,
    splitBegin: null,
    splitEnd: null,
    parseLinesEnd: null,
  };
  publishM3UIngestMarker("M3U_FETCH_BEGIN", monotonicAt, {
    m3uFetchWaitMs: null,
    m3uResponseTextMs: null,
    m3uSplitMs: null,
    m3uParseLinesMs: null,
    m3uCatalogBuildMs: null,
    m3uTotalIngestMs: null,
  });
}

export function recordM3UFetchResponse(monotonicAt = monotonicNow()) {
  if (state.providerType !== "m3u") return;
  ingestClock.fetchResponse = monotonicAt;
  publishM3UIngestMarker("M3U_FETCH_RESPONSE", monotonicAt, {
    m3uFetchWaitMs: safePhaseDuration(ingestClock.fetchBegin, monotonicAt),
  });
}

export function recordM3UResponseTextEnd(monotonicAt = monotonicNow()) {
  if (state.providerType !== "m3u") return;
  ingestClock.responseTextEnd = monotonicAt;
  publishM3UIngestMarker("M3U_RESPONSE_TEXT_END", monotonicAt, {
    m3uResponseTextMs: safePhaseDuration(ingestClock.fetchResponse, monotonicAt),
  });
}

export function recordM3USplitBegin(monotonicAt = monotonicNow()) {
  if (state.providerType !== "m3u") return;
  ingestClock.splitBegin = monotonicAt;
  publishM3UIngestMarker("M3U_SPLIT_BEGIN", monotonicAt, {});
}

export function recordM3USplitEnd(monotonicAt = monotonicNow()) {
  if (state.providerType !== "m3u") return;
  ingestClock.splitEnd = monotonicAt;
  publishM3UIngestMarker("M3U_SPLIT_END", monotonicAt, {
    m3uSplitMs: safePhaseDuration(ingestClock.splitBegin, monotonicAt),
  });
}

export function recordM3UParseLinesEnd(monotonicAt = monotonicNow()) {
  if (state.providerType !== "m3u") return;
  ingestClock.parseLinesEnd = monotonicAt;
  publishM3UIngestMarker("M3U_PARSE_LINES_END", monotonicAt, {
    m3uParseLinesMs: safePhaseDuration(ingestClock.splitEnd, monotonicAt),
  });
}

export function recordM3UCatalogBuildEnd(monotonicAt = monotonicNow()) {
  if (state.providerType !== "m3u") return;
  publishM3UIngestMarker("M3U_CATALOG_BUILD_END", monotonicAt, {
    m3uCatalogBuildMs: safePhaseDuration(ingestClock.parseLinesEnd, monotonicAt),
    m3uTotalIngestMs: safePhaseDuration(ingestClock.fetchBegin, monotonicAt),
  });
}

function publishM3UEpgMarker(
  marker: string,
  monotonicAt: number,
  patch: Partial<M3UDiagnosticState>,
) {
  if (state.providerType !== "m3u") return;
  const at = wallNow();
  const elapsedMs = safePhaseDuration(epgPhaseClock.workBegin, monotonicAt);
  publish({
    ...state,
    ...patch,
    correlationSequence: [
      ...state.correlationSequence.slice(-31),
      { marker, at, elapsedMs },
    ],
  });
  safeLog.info(marker, { timestamp: at, elapsedMs });
}

export function recordM3UBackgroundJsSlice(elapsedMs: number) {
  if (state.providerType !== "m3u" || !state.m3uBgRefreshActive) return;
  publish({
    ...state,
    m3uBgMaxJsSliceMs: Math.max(
      state.m3uBgMaxJsSliceMs,
      Math.max(0, Math.round(elapsedMs)),
    ),
  });
}

export function recordM3UEpgWorkBegin(monotonicAt = monotonicNow()) {
  if (state.providerType !== "m3u") return;
  epgPhaseClock = { ...emptyEpgPhaseClock(), workBegin: monotonicAt };
  publishM3UEpgMarker("EPG_WORK_BEGIN", monotonicAt, {
    epgUnderlyingWorkActive: true,
    epgFetchHeaderMs: null,
    epgBodyMaterializeMs: null,
    epgDecodeMs: null,
    epgStringAssemblyMs: null,
    epgParseMs: null,
    epgNormalizeMs: null,
    epgPublicationMs: null,
    epgTotalWorkMs: null,
    epgTimeoutTimerDriftMs: null,
    epgUnderlyingSettleAfterTimeoutMs: null,
  });
}

export function recordM3UEpgWorkEnd(elapsedMs: number, monotonicAt = monotonicNow()) {
  publishM3UEpgMarker("EPG_UNDERLYING_SETTLED", monotonicAt, {
    epgUnderlyingWorkActive: false,
    epgTotalWorkMs: Math.max(0, Math.round(elapsedMs)),
  });
}

export function recordM3UEpgFetchBegin(monotonicAt = monotonicNow()) {
  epgPhaseClock.fetchBegin = monotonicAt;
  publishM3UEpgMarker("EPG_FETCH_BEGIN", monotonicAt, {});
}
export function recordM3UEpgFetchResponse(monotonicAt = monotonicNow()) {
  publishM3UEpgMarker("EPG_FETCH_RESPONSE", monotonicAt, {
    epgFetchHeaderMs: safePhaseDuration(epgPhaseClock.fetchBegin, monotonicAt),
  });
}
export function recordM3UEpgBodyBegin(monotonicAt = monotonicNow()) {
  epgPhaseClock.bodyBegin = monotonicAt;
  publishM3UEpgMarker("EPG_BODY_BEGIN", monotonicAt, {});
}
export function recordM3UEpgBodyEnd(monotonicAt = monotonicNow()) {
  publishM3UEpgMarker("EPG_BODY_END", monotonicAt, {
    epgBodyMaterializeMs: safePhaseDuration(epgPhaseClock.bodyBegin, monotonicAt),
  });
}
export function recordM3UEpgDecodeBegin(monotonicAt = monotonicNow()) {
  epgPhaseClock.decodeBegin = monotonicAt;
  publishM3UEpgMarker("EPG_DECODE_BEGIN", monotonicAt, {});
}
export function recordM3UEpgDecodeEnd(monotonicAt = monotonicNow()) {
  publishM3UEpgMarker("EPG_DECODE_END", monotonicAt, {
    epgDecodeMs: safePhaseDuration(epgPhaseClock.decodeBegin, monotonicAt),
  });
}
export function recordM3UEpgStringAssemblyBegin(monotonicAt = monotonicNow()) {
  epgPhaseClock.stringAssemblyBegin = monotonicAt;
  publishM3UEpgMarker("EPG_FULL_STRING_ASSEMBLY_BEGIN", monotonicAt, {});
}
export function recordM3UEpgStringAssemblyEnd(monotonicAt = monotonicNow()) {
  publishM3UEpgMarker("EPG_FULL_STRING_ASSEMBLY_END", monotonicAt, {
    epgStringAssemblyMs: safePhaseDuration(epgPhaseClock.stringAssemblyBegin, monotonicAt),
  });
}
export function recordM3UEpgParseBegin(monotonicAt = monotonicNow()) {
  epgPhaseClock.parseBegin = monotonicAt;
  publishM3UEpgMarker("EPG_PARSE_BEGIN", monotonicAt, {});
}
export function recordM3UEpgParseEnd(monotonicAt = monotonicNow()) {
  publishM3UEpgMarker("EPG_PARSE_END", monotonicAt, {
    epgParseMs: safePhaseDuration(epgPhaseClock.parseBegin, monotonicAt),
  });
}
export function recordM3UEpgNormalizeBegin(monotonicAt = monotonicNow()) {
  epgPhaseClock.normalizeBegin = monotonicAt;
  publishM3UEpgMarker("EPG_NORMALIZE_BEGIN", monotonicAt, {});
}
export function recordM3UEpgNormalizeEnd(monotonicAt = monotonicNow()) {
  publishM3UEpgMarker("EPG_NORMALIZE_END", monotonicAt, {
    epgNormalizeMs: safePhaseDuration(epgPhaseClock.normalizeBegin, monotonicAt),
  });
}
export function recordM3UEpgPublicationBegin(monotonicAt = monotonicNow()) {
  epgPhaseClock.publicationBegin = monotonicAt;
  publishM3UEpgMarker("EPG_PUBLICATION_BEGIN", monotonicAt, {});
}
export function recordM3UEpgPublicationEnd(monotonicAt = monotonicNow()) {
  publishM3UEpgMarker("EPG_PUBLICATION_END", monotonicAt, {
    epgPublicationMs: safePhaseDuration(epgPhaseClock.publicationBegin, monotonicAt),
  });
}
export function recordM3UEpgTimeoutTimerDrift(elapsedMs: number) {
  if (state.providerType !== "m3u") return;
  publish({ ...state, epgTimeoutTimerDriftMs: Math.max(0, Math.round(elapsedMs)) });
}
export function recordM3UEpgUnderlyingSettleAfterTimeout(elapsedMs: number) {
  if (state.providerType !== "m3u") return;
  publish({ ...state, epgUnderlyingSettleAfterTimeoutMs: Math.max(0, Math.round(elapsedMs)) });
}
export function recordM3UEpgRetryGate(active: boolean) {
  if (state.providerType !== "m3u") return;
  publish({ ...state, epgRetryGateActive: active });
}
export function recordM3UEpgGenerationCurrent(current: boolean | null) {
  if (state.providerType !== "m3u") return;
  publish({ ...state, epgGenerationCurrent: current });
}

export function recordM3UEpgBegin() {
  if (state.providerType !== "m3u") return;
  const at = wallNow();
  publish({
    ...state,
    m3uEpgActive: true,
    epgAttemptActive: true,
    lastM3uEpgBegin: at,
    lastM3uEpgEnd: null,
    lastM3uEpgElapsedMs: null,
    correlationSequence: [...state.correlationSequence.slice(-31), { marker: "M3U_EPG_BEGIN", at, elapsedMs: null }],
  });
  safeLog.info("M3U_EPG_BEGIN", { timestamp: at });
}

export function recordM3UEpgEnd(elapsedMs: number) {
  if (state.providerType !== "m3u") return;
  const safeElapsed = Math.max(0, Math.round(elapsedMs));
  const at = wallNow();
  publish({
    ...state,
    m3uEpgActive: false,
    epgAttemptActive: false,
    lastM3uEpgEnd: at,
    lastM3uEpgElapsedMs: safeElapsed,
    correlationSequence: [...state.correlationSequence.slice(-31), { marker: "M3U_EPG_END", at, elapsedMs: safeElapsed }],
  });
  safeLog.info("M3U_EPG_END", { timestamp: at, elapsedMs: safeElapsed });
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

export function recordM3USourceInputFacts(
  sourceInputCounts: { live: number; vod: number; series: number },
  sourceDuplicateIds: number,
) {
  publish({
    ...state,
    sourceInputCounts: {
      live: Math.max(0, Math.trunc(sourceInputCounts.live)),
      vod: Math.max(0, Math.trunc(sourceInputCounts.vod)),
      series: Math.max(0, Math.trunc(sourceInputCounts.series)),
    },
    sourceDuplicateIds: Math.max(0, Math.trunc(sourceDuplicateIds)),
  });
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

export function describeM3UPlaybackUri(
  inputUri: string,
  effectiveUri: string,
): M3UPlaybackUriMetadata {
  const schemeOf = (value: string): M3UPlaybackUriMetadata["scheme"] => {
    const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    return scheme === "http" || scheme === "https" ? scheme : "other";
  };
  const extensionOf = (value: string): M3UPlaybackUriMetadata["inputExtension"] => {
    const clean = value.split(/[?#]/, 1)[0] ?? "";
    const extension = clean.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
    return extension === "ts" || extension === "m3u8" ? extension : "other";
  };
  return {
    scheme: schemeOf(effectiveUri || inputUri),
    inputExtension: extensionOf(inputUri),
    effectiveExtension: extensionOf(effectiveUri),
    rewriteApplied: inputUri !== effectiveUri,
    hasLivePath: /\/live\//i.test(inputUri),
    sourceLength: inputUri.length,
  };
}

export function isM3ULivePlaybackDiagnosticActive() {
  return state.providerType === "m3u" && playbackPressStartedAt !== null;
}

function publishPlaybackMarker(
  marker: string,
  patch: Partial<M3UDiagnosticState>,
  details: Record<string, unknown> = {},
) {
  if (state.providerType !== "m3u") return;
  const entry = sequenceEntry(marker);
  publish({ ...state, ...patch, playbackSequence: [...state.playbackSequence.slice(-23), entry] });
  safeLog.info(marker, { ...details, timestamp: entry.at, elapsedMs: entry.elapsedMs });
}

export function recordM3ULivePress() {
  if (state.providerType !== "m3u") return;
  playbackPressStartedAt = monotonicNow();
  const at = wallNow();
  const next: M3UDiagnosticState = {
    ...state,
    lastLivePressAt: at,
    lastChannelPressCount: state.lastChannelPressCount + 1,
    pressCount: state.pressCount + 1,
    openLiveEnterAt: null,
    setPlayableAt: null,
    setPlayerViewAt: null,
    playerViewCommitAt: null,
    compatPlayerMountedAt: null,
    orientationBeginAt: null,
    orientationGetCompletedAt: null,
    orientationUnlockBeginAt: null,
    orientationUnlockEndAt: null,
    orientationReadyAt: null,
    orientationElapsedMs: null,
    orientationError: null,
    vlcSurfaceMountedAt: null,
    uriMetadata: null,
    vlcPlayingAt: null,
    vlcPlayingElapsedMs: null,
    liveQueueBeginAt: null,
    liveQueueEndAt: null,
    liveQueueElapsedMs: null,
    liveQueueRowCount: null,
    playbackSequence: [{ marker: "M3U_LIVE_PRESS", at, elapsedMs: 0 }],
    correlationSequence: [...state.correlationSequence.slice(-31), { marker: "M3U_LIVE_PRESS", at, elapsedMs: 0 }],
  };
  publish(next);
  safeLog.info("M3U_LIVE_PRESS", { timestamp: at, elapsedMs: 0 });
}

export function recordM3UOpenLiveEnter() {
  publishPlaybackMarker("M3U_OPEN_LIVE_ENTER", { openLiveEnterAt: wallNow() });
}
export function recordM3UOpenLiveSetPlayable() {
  publishPlaybackMarker("M3U_OPEN_LIVE_SET_PLAYABLE", { setPlayableAt: wallNow() });
}
export function recordM3UOpenLiveSetPlayerView() {
  publishPlaybackMarker("M3U_OPEN_LIVE_SET_PLAYER_VIEW", { setPlayerViewAt: wallNow() });
}
export function recordM3UPlayerViewCommit() {
  if (state.playerViewCommitAt !== null) return;
  publishPlaybackMarker("M3U_PLAYER_VIEW_COMMIT", { playerViewCommitAt: wallNow() });
}
export function recordM3UCompatPlayerMount() {
  if (state.compatPlayerMountedAt !== null) return;
  publishPlaybackMarker("M3U_COMPAT_PLAYER_MOUNT", { compatPlayerMountedAt: wallNow() });
}
export function recordM3UOrientationBegin() {
  publishPlaybackMarker("M3U_ORIENTATION_BEGIN", { orientationBeginAt: wallNow(), orientationError: null });
}
export function recordM3UOrientationGetCompleted() {
  publishPlaybackMarker("M3U_ORIENTATION_GET_COMPLETE", { orientationGetCompletedAt: wallNow() });
}
export function recordM3UOrientationUnlockBegin() {
  publishPlaybackMarker("M3U_ORIENTATION_UNLOCK_BEGIN", { orientationUnlockBeginAt: wallNow() });
}
export function recordM3UOrientationUnlockEnd() {
  publishPlaybackMarker("M3U_ORIENTATION_UNLOCK_END", { orientationUnlockEndAt: wallNow() });
}
export function recordM3UOrientationError(error: unknown) {
  const sanitized = sanitizeErrorForLog(error);
  publishPlaybackMarker("M3U_ORIENTATION_ERROR", {
    orientationError: `${sanitized.name}: ${sanitized.message}`,
  }, { error: sanitized });
}
export function recordM3UOrientationReady(elapsedMs: number) {
  const safeElapsed = Math.max(0, Math.round(elapsedMs));
  publishPlaybackMarker("M3U_ORIENTATION_READY", {
    orientationReadyAt: wallNow(),
    orientationElapsedMs: safeElapsed,
  }, { elapsedMs: safeElapsed });
}
export function recordM3UVlcSurfaceMount() {
  if (state.vlcSurfaceMountedAt !== null) return;
  publishPlaybackMarker("M3U_VLC_SURFACE_MOUNT", { vlcSurfaceMountedAt: wallNow() });
}
export function recordM3UVlcUriHandoff(metadata: M3UPlaybackUriMetadata) {
  publishPlaybackMarker("M3U_VLC_URI_HANDOFF", { uriMetadata: metadata }, metadata);
}
export function recordM3UVlcPlaying() {
  if (state.vlcPlayingAt !== null) return;
  const elapsedMs = elapsedFromPress();
  publishPlaybackMarker("M3U_VLC_PLAYING", {
    vlcPlayingAt: wallNow(),
    vlcPlayingElapsedMs: elapsedMs,
  }, { elapsedMs });
}
export function recordM3ULiveQueueBegin() {
  publishPlaybackMarker("M3U_LIVE_QUEUE_BEGIN", {
    liveQueueBeginAt: wallNow(),
    liveQueueEndAt: null,
    liveQueueElapsedMs: null,
    liveQueueRowCount: null,
  });
}
export function recordM3ULiveQueueEnd(elapsedMs: number, rowCount: number) {
  const safeElapsed = Math.max(0, Math.round(elapsedMs));
  const safeCount = Math.max(0, Math.min(500, Math.trunc(rowCount)));
  publishPlaybackMarker("M3U_LIVE_QUEUE_END", {
    liveQueueEndAt: wallNow(),
    liveQueueElapsedMs: safeElapsed,
    liveQueueRowCount: safeCount,
  }, { elapsedMs: safeElapsed, rowCount: safeCount });
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
    lastLivePressAt: null,
    lastChannelPressCount: 0,
    openLiveEnterAt: null,
    setPlayableAt: null,
    setPlayerViewAt: null,
    playerViewCommitAt: null,
    compatPlayerMountedAt: null,
    orientationBeginAt: null,
    orientationGetCompletedAt: null,
    orientationUnlockBeginAt: null,
    orientationUnlockEndAt: null,
    orientationReadyAt: null,
    orientationElapsedMs: null,
    orientationError: null,
    vlcSurfaceMountedAt: null,
    uriMetadata: null,
    vlcPlayingAt: null,
    vlcPlayingElapsedMs: null,
    liveQueueBeginAt: null,
    liveQueueEndAt: null,
    liveQueueElapsedMs: null,
    liveQueueRowCount: null,
    playbackSequence: [],
    pageLoadingInitial: false,
    pageLoadingMore: false,
    pageItemsCount: 0,
    parentRefreshing: false,
    isEpgLoading: false,
    categoriesReady: false,
    selectedCategory: null,
    pressInCount: 0,
    pressCount: 0,
    pressOutCount: 0,
    lastLivePressInAt: null,
    lastLivePressOutAt: null,
    m3uBgRefreshActive: false,
    lastM3uBgRefreshBegin: null,
    lastM3uBgRefreshLoadEnd: null,
    lastM3uBgRefreshEnd: null,
    lastM3uBgRefreshElapsedMs: null,
    m3uEpgActive: false,
    lastM3uEpgBegin: null,
    lastM3uEpgEnd: null,
    lastM3uEpgElapsedMs: null,
    m3uFetchWaitMs: null,
    m3uResponseTextMs: null,
    m3uSplitMs: null,
    m3uParseLinesMs: null,
    m3uCatalogBuildMs: null,
    m3uTotalIngestMs: null,
    m3uBgMaxJsSliceMs: 0,
    epgAttemptActive: false,
    epgUnderlyingWorkActive: false,
    epgRetryGateActive: false,
    epgGenerationCurrent: null,
    epgFetchHeaderMs: null,
    epgBodyMaterializeMs: null,
    epgDecodeMs: null,
    epgStringAssemblyMs: null,
    epgParseMs: null,
    epgNormalizeMs: null,
    epgPublicationMs: null,
    epgTotalWorkMs: null,
    epgTimeoutTimerDriftMs: null,
    epgUnderlyingSettleAfterTimeoutMs: null,
    correlationSequence: [],
  });
  playbackPressStartedAt = null;
  ingestClock = emptyIngestClock();
  epgPhaseClock = emptyEpgPhaseClock();
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
    "PAGED_LIVE_STATE",
    `pageLoadingInitial=${snapshot.pageLoadingInitial}`,
    `pageLoadingMore=${snapshot.pageLoadingMore}`,
    `pageItemsCount=${snapshot.pageItemsCount}`,
    `parentRefreshing=${snapshot.parentRefreshing}`,
    `isEpgLoading=${snapshot.isEpgLoading}`,
    `categoriesReady=${snapshot.categoriesReady}`,
    `selectedCategory=${value(snapshot.selectedCategory)}`,
    `pageDbOpenMs=${value(snapshot.pageDbOpenMs)}`,
    ...indexValues.map(([name, ms], index) => `index${index + 1}Ms=${ms} (${name})`),
    `countQueryMs=${value(snapshot.countQueryMs)}`,
    `pageQueryMs=${value(snapshot.pageQueryMs)}`,
    `categoryQueryMs=${value(snapshot.categoryQueryMs)}`,
    `liveItems=${value(snapshot.sourceInputCounts?.live ?? shape?.liveItems)}`,
    `vodItems=${value(snapshot.sourceInputCounts?.vod ?? shape?.vodItems)}`,
    `seriesItems=${value(snapshot.sourceInputCounts?.series ?? shape?.seriesItems)}`,
    `liveCategories=${value(shape?.liveCategories)}`,
    `vodCategories=${value(shape?.vodCategories)}`,
    `seriesCategories=${value(shape?.seriesCategories)}`,
    `maxCategoryItems=${value(shape?.maxCategoryItems)}`,
    `duplicateIds=${value(snapshot.sourceDuplicateIds ?? shape?.duplicateIds)}`,
    `emptyCategories=${value(shape?.emptyCategories)}`,
    `avgPayloadLen=${value(shape?.avgPayloadLen)}`,
    `maxPayloadLen=${value(shape?.maxPayloadLen)}`,
    `avgNameLen=${value(shape?.avgNameLen)}`,
    `maxNameLen=${value(shape?.maxNameLen)}`,
    `cacheWriterActive=${snapshot.cacheWriterActive}`,
    `currentBatchKind=${value(snapshot.currentCacheBatchKind)}`,
    `currentBatch=${value(snapshot.currentCacheBatchNumber)}`,
    "PLAYBACK_HANDOFF",
    `lastLivePressAt=${value(snapshot.lastLivePressAt)}`,
    `lastChannelPressCount=${snapshot.lastChannelPressCount}`,
    `pressInCount=${snapshot.pressInCount}`,
    `pressCount=${snapshot.pressCount}`,
    `pressOutCount=${snapshot.pressOutCount}`,
    `lastLivePressInAt=${value(snapshot.lastLivePressInAt)}`,
    `lastLivePressOutAt=${value(snapshot.lastLivePressOutAt)}`,
    `openLiveEnter=${value(snapshot.openLiveEnterAt)}`,
    `setPlayable=${value(snapshot.setPlayableAt)}`,
    `setPlayerView=${value(snapshot.setPlayerViewAt)}`,
    `playerViewCommit=${value(snapshot.playerViewCommitAt)}`,
    `compatPlayerMounted=${value(snapshot.compatPlayerMountedAt)}`,
    `orientationBegin=${value(snapshot.orientationBeginAt)}`,
    `orientationGetCompleted=${value(snapshot.orientationGetCompletedAt)}`,
    `orientationUnlockBegin=${value(snapshot.orientationUnlockBeginAt)}`,
    `orientationUnlockEnd=${value(snapshot.orientationUnlockEndAt)}`,
    `orientationReady=${value(snapshot.orientationReadyAt)}`,
    `orientationElapsedMs=${value(snapshot.orientationElapsedMs)}`,
    `orientationError=${value(snapshot.orientationError)}`,
    `vlcSurfaceMounted=${value(snapshot.vlcSurfaceMountedAt)}`,
    `uriScheme=${value(snapshot.uriMetadata?.scheme)}`,
    `inputExtension=${value(snapshot.uriMetadata?.inputExtension)}`,
    `effectiveExtension=${value(snapshot.uriMetadata?.effectiveExtension)}`,
    `rewriteApplied=${value(snapshot.uriMetadata?.rewriteApplied)}`,
    `hasLivePath=${value(snapshot.uriMetadata?.hasLivePath)}`,
    `sourceLength=${value(snapshot.uriMetadata?.sourceLength)}`,
    `vlcPlaying=${value(snapshot.vlcPlayingAt)}`,
    `vlcPlayingElapsedMs=${value(snapshot.vlcPlayingElapsedMs)}`,
    `liveQueueBegin=${value(snapshot.liveQueueBeginAt)}`,
    `liveQueueEnd=${value(snapshot.liveQueueEndAt)}`,
    `liveQueueElapsedMs=${value(snapshot.liveQueueElapsedMs)}`,
    `liveQueueRowCount=${value(snapshot.liveQueueRowCount)}`,
    "RUNTIME_CORRELATION",
    `m3uBgRefreshActive=${snapshot.m3uBgRefreshActive}`,
    `lastM3uBgRefreshBegin=${value(snapshot.lastM3uBgRefreshBegin)}`,
    `lastM3uBgRefreshLoadEnd=${value(snapshot.lastM3uBgRefreshLoadEnd)}`,
    `lastM3uBgRefreshEnd=${value(snapshot.lastM3uBgRefreshEnd)}`,
    `lastM3uBgRefreshElapsedMs=${value(snapshot.lastM3uBgRefreshElapsedMs)}`,
    `m3uEpgActive=${snapshot.m3uEpgActive}`,
    `lastM3uEpgBegin=${value(snapshot.lastM3uEpgBegin)}`,
    `lastM3uEpgEnd=${value(snapshot.lastM3uEpgEnd)}`,
    `lastM3uEpgElapsedMs=${value(snapshot.lastM3uEpgElapsedMs)}`,
    `m3uBgMaxJsSliceMs=${snapshot.m3uBgMaxJsSliceMs}`,
    "EPG_WORK_LIFETIME",
    `epgAttemptActive=${snapshot.epgAttemptActive}`,
    `epgUnderlyingWorkActive=${snapshot.epgUnderlyingWorkActive}`,
    `epgRetryGateActive=${snapshot.epgRetryGateActive}`,
    `epgGenerationCurrent=${value(snapshot.epgGenerationCurrent)}`,
    `EPG_FETCH_HEADER_MS=${value(snapshot.epgFetchHeaderMs)}`,
    `EPG_BODY_MATERIALIZE_MS=${value(snapshot.epgBodyMaterializeMs)}`,
    `EPG_DECODE_MS=${value(snapshot.epgDecodeMs)}`,
    `EPG_STRING_ASSEMBLY_MS=${value(snapshot.epgStringAssemblyMs)}`,
    `EPG_PARSE_MS=${value(snapshot.epgParseMs)}`,
    `EPG_NORMALIZE_MS=${value(snapshot.epgNormalizeMs)}`,
    `EPG_PUBLICATION_MS=${value(snapshot.epgPublicationMs)}`,
    `EPG_TOTAL_WORK_MS=${value(snapshot.epgTotalWorkMs)}`,
    `EPG_TIMEOUT_TIMER_DRIFT_MS=${value(snapshot.epgTimeoutTimerDriftMs)}`,
    `EPG_UNDERLYING_SETTLE_AFTER_TIMEOUT_MS=${value(snapshot.epgUnderlyingSettleAfterTimeoutMs)}`,
    "M3U_INGEST_PHASES",
    `m3uFetchWaitMs=${value(snapshot.m3uFetchWaitMs)}`,
    `m3uResponseTextMs=${value(snapshot.m3uResponseTextMs)}`,
    `m3uSplitMs=${value(snapshot.m3uSplitMs)}`,
    `m3uParseLinesMs=${value(snapshot.m3uParseLinesMs)}`,
    `m3uCatalogBuildMs=${value(snapshot.m3uCatalogBuildMs)}`,
    `m3uTotalIngestMs=${value(snapshot.m3uTotalIngestMs)}`,
    "correlationSequence:",
    ...snapshot.correlationSequence.map((entry, index) =>
      `${index + 1}. ${entry.marker} at=${entry.at} elapsedMs=${value(entry.elapsedMs)}`
    ),
    "playbackSequence:",
    ...snapshot.playbackSequence.map((entry, index) =>
      `${index + 1}. ${entry.marker} at=${entry.at} elapsedMs=${value(entry.elapsedMs)}`
    ),
  ].join("\n");
}
