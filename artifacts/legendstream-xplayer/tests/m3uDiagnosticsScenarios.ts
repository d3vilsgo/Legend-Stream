import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasUsableM3UCacheSnapshot } from "../lib/m3uCacheAvailability";
import {
  buildM3UDiagnosticReport,
  describeM3UPlaybackUri,
  getM3UDiagnosticSnapshot,
  recordM3UBackgroundRefreshBegin,
  recordM3UBackgroundRefreshEnd,
  recordM3UBackgroundRefreshLoadEnd,
  recordM3UCatalogBuildEnd,
  recordM3UEpgBegin,
  recordM3UFetchBegin,
  recordM3UFetchResponse,
  recordM3UEpgEnd,
  recordM3ULivePress,
  recordM3ULivePressIn,
  recordM3ULivePressOut,
  recordM3UPagedLiveState,
  recordM3UParseLinesEnd,
  recordM3UResponseTextEnd,
  recordM3USplitBegin,
  recordM3USplitEnd,
  recordM3UOpenLiveEnter,
  recordM3UOpenLiveSetPlayable,
  recordM3UOpenLiveSetPlayerView,
  recordM3UPlayerViewCommit,
  resetM3UDiagnosticCounters,
  setM3UDiagnosticSession,
} from "../lib/m3uInAppDiagnostics";
import { buildM3UCacheWriteProjection } from "../lib/m3uCacheWriteProjection";
import {
  classifyM3UContentTypeWithSource,
  createM3UShapeDiagnosticsObserver,
  formatM3UShapeDiagnosticsFields,
} from "../lib/m3uShapeDiagnostics";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iptvSource = readFileSync(resolve(ROOT, "lib/iptv.ts"), "utf8");
const cacheSource = readFileSync(resolve(ROOT, "lib/m3uCatalogCache.ts"), "utf8");
const homeSource = readFileSync(resolve(ROOT, "components/OptimizedHomeScreenPaged.tsx"), "utf8");
const pagedSource = readFileSync(resolve(ROOT, "components/catalog/PagedCatalogViews.tsx"), "utf8");
const compatSource = readFileSync(resolve(ROOT, "components/CompatibilityVideoPlayerV2.tsx"), "utf8");
const orientationSource = readFileSync(resolve(ROOT, "hooks/usePlayerOrientation.ts"), "utf8");
const vlcSource = readFileSync(resolve(ROOT, "components/player/VlcPlaybackSurface.tsx"), "utf8");
const panelSource = readFileSync(resolve(ROOT, "components/M3UDiagnosticPanel.tsx"), "utf8");
const pageRepoSource = readFileSync(resolve(ROOT, "lib/catalogPageRepository.ts"), "utf8");
const playerSource = readFileSync(resolve(ROOT, "context/PlayerContext.tsx"), "utf8");

let passed = 0;
const scenario = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
};

function main() {
  scenario("shape observer counts origin path extension duration and tvg-id in one observation pass", () => {
    const observer = createM3UShapeDiagnosticsObserver(
      "https://panel.example:8443/get.php?username=alice&password=secret&type=m3u_plus",
    );
    observer.observe({
      streamUrl: "https://panel.example:8443/live/alice/secret/101.ts",
      category: "Live TV",
      extinfDuration: "-1",
      tvgId: "news-101",
    });
    observer.observe({
      streamUrl: "https://cdn.example:9443/movie/alice/secret/202.mp4",
      category: "Movies",
      extinfDuration: "7200",
    });
    const value = observer.snapshot();
    assert.deepEqual(value.originCompare, {
      total: 2,
      protocolMatchCount: 2,
      hostnameMatchCount: 1,
      portMatchCount: 1,
      exactOriginMatchCount: 1,
    });
    assert.equal(value.streamOrigin.distinctOriginCount, 2);
    assert.equal(value.pathShape.hasLiveSegmentCount, 1);
    assert.equal(value.pathShape.hasMovieSegmentCount, 1);
    assert.equal(value.pathShape.hasSeriesSegmentCount, 0);
    assert.equal(value.pathShape.noneOfKnownSegmentsCount, 0);
    assert.deepEqual(value.pathShape.segmentCountHistogram, { "4": 2 });
    assert.equal(value.extension.presentCount, 2);
    assert.equal(value.extension.distinctCount, 2);
    assert.equal(value.extension.liveLikeCount, 1);
    assert.equal(value.extension.vodLikeCount, 1);
    assert.equal(value.extinfDuration.negativeOneCount, 1);
    assert.equal(value.extinfDuration.positiveCount, 1);
    assert.deepEqual(value.tvgId, { presentCount: 1, absentCount: 1 });
  });

  scenario("classification decision source preserves the existing hard priority order", () => {
    assert.deepEqual(
      classifyM3UContentTypeWithSource("https://example.test/movie/u/p/1.ts", "Live"),
      { contentType: "movie", source: "path-movie" },
    );
    assert.deepEqual(
      classifyM3UContentTypeWithSource("https://example.test/series/u/p/2.mp4", "Movies"),
      { contentType: "series", source: "path-series" },
    );
    assert.deepEqual(
      classifyM3UContentTypeWithSource("https://example.test/live/u/p/3.mp4", "Cinema"),
      { contentType: "live", source: "path-live" },
    );
    assert.deepEqual(
      classifyM3UContentTypeWithSource("https://example.test/files/4.mp4", "Live"),
      { contentType: "movie", source: "extension-movie" },
    );
    assert.deepEqual(
      classifyM3UContentTypeWithSource("https://example.test/files/5.ts", "Cinema"),
      { contentType: "live", source: "extension-live" },
    );
    assert.deepEqual(
      classifyM3UContentTypeWithSource("https://example.test/files/6.bin", "TR: SINEMA"),
      { contentType: "movie", source: "group-movie" },
    );
    assert.deepEqual(
      classifyM3UContentTypeWithSource("https://example.test/files/7.bin", "DIZILER"),
      { contentType: "series", source: "group-series" },
    );
    assert.deepEqual(
      classifyM3UContentTypeWithSource("https://example.test/files/8.bin", "General"),
      { contentType: "live", source: "default-live" },
    );
  });

  scenario("classification and conflict counters identify cinema-labelled live ambiguity", () => {
    const observer = createM3UShapeDiagnosticsObserver("https://panel.example/get.php?username=a&password=b");
    observer.observe({
      streamUrl: "https://panel.example/live/a/b/1.ts",
      category: "TR: CINEMA",
      extinfDuration: "-1",
      tvgId: "cinema-one",
    });
    observer.observe({
      streamUrl: "https://panel.example/files/2.bin",
      category: "TR: SINEMA",
      extinfDuration: "-1",
      tvgId: "cinema-two",
    });
    observer.observe({
      streamUrl: "https://panel.example/series/a/b/3.mp4",
      category: "Drama",
      extinfDuration: "3600",
    });
    const value = observer.snapshot();
    assert.equal(value.classification.byPathLive, 1);
    assert.equal(value.classification.byGroupMovie, 1);
    assert.equal(value.classification.byPathSeries, 1);
    assert.equal(value.conflict.pathLive_groupMovie, 1);
    assert.equal(value.conflict.durationNegativeOne_groupMovie, 2);
    assert.equal(value.conflict.tvgIdPresent_groupMovie, 2);
    assert.equal(value.conflict.pathSeries_extensionMovie, 1);
  });

  scenario("origin mismatch never prevents independent path and metadata observation", () => {
    const observer = createM3UShapeDiagnosticsObserver("https://panel.example/get.php?username=a&password=b");
    observer.observe({
      streamUrl: "http://other.example:8080/live/a/b/1.ts",
      category: "Cinema",
      extinfDuration: "-1",
      tvgId: "channel-1",
    });
    const value = observer.snapshot();
    assert.equal(value.originCompare.exactOriginMatchCount, 0);
    assert.equal(value.originCompare.protocolMatchCount, 0);
    assert.equal(value.originCompare.hostnameMatchCount, 0);
    assert.equal(value.originCompare.portMatchCount, 0);
    assert.equal(value.pathShape.hasLiveSegmentCount, 1);
    assert.equal(value.extension.liveLikeCount, 1);
    assert.equal(value.extinfDuration.negativeOneCount, 1);
    assert.equal(value.tvgId.presentCount, 1);
    assert.equal(value.conflict.pathLive_groupMovie, 1);
  });

  scenario("cache validation fails fast and publishes truncation plus first reject codes", () => {
    const provider = {
      id: "provider",
      type: "m3u" as const,
      url: "https://panel.example/get.php?username=alice&password=secret&type=m3u_plus",
      createdAt: 1,
    };
    const channels = Array.from({ length: 5 }, (_, index) => ({
      id: `live-${index}`,
      providerId: provider.id,
      name: `Live ${index}`,
      streamUrl: index === 0
        ? "https://cdn.example/live/alice/secret/1.ts"
        : `https://panel.example/live/alice/secret/${index + 1}.ts`,
      category: "Live",
      contentType: "live" as const,
    }));
    const projection = buildM3UCacheWriteProjection(provider, {
      channels,
      liveChannels: channels,
      movieItems: [],
      seriesGroups: [],
    });
    assert.ok(projection);
    assert.equal(projection.unsafeOutcome, "unsafe-live-ref");
    assert.equal(projection.rejectionCounts["origin-mismatch"], 1);
    assert.deepEqual(projection.scan, {
      scanTotalCandidateCount: 5,
      scanInspectedCount: 1,
      scanTruncated: true,
      firstRejectKind: "live",
      firstRejectReason: "origin-mismatch",
    });
  });

  scenario("cleanup failure cannot replace the primary unsafe outcome", () => {
    const failClosedStart = cacheSource.indexOf("async function failClosedWrite");
    const persistStart = cacheSource.indexOf("export async function persistM3UProviderCache", failClosedStart);
    const body = cacheSource.slice(failClosedStart, persistStart);
    assert.match(body, /await publishWriteObservation\(\{\s*\.\.\.options,/s);
    assert.match(body, /cleanupOutcome/);
    assert.match(body, /cleanupStage/);
    assert.doesNotMatch(body, /outcome:\s*"sqlite-error"/);
    const actualWriteBlock = cacheSource.slice(persistStart);
    assert.match(actualWriteBlock, /catch \(caught\)[\s\S]*outcome: "sqlite-error"/);
  });

  scenario("errored M3U cache is never usable even when stale rows remain", () => {
    assert.equal(hasUsableM3UCacheSnapshot({ live: 100, vod: 20, series: 10 }, "error"), false);
    assert.equal(hasUsableM3UCacheSnapshot({ live: 100, vod: 20, series: 10 }, "ready"), true);
    assert.equal(hasUsableM3UCacheSnapshot({ live: 0, vod: 0, series: 0 }, "ready"), false);
    const errorGuard = cacheSource.indexOf('cacheSyncPhase === "error"');
    const hydration = cacheSource.indexOf("buildM3UDirectHydration", errorGuard);
    assert.ok(errorGuard >= 0 && hydration > errorGuard, "error-state guard must run before direct hydration");
  });

  scenario("EXTINF duration is diagnostic-only and output remains structural", () => {
    assert.match(iptvSource, /extinfDuration = line\.match/);
    assert.match(iptvSource, /extinfDuration: state\.pending\.extinfDuration/);
    assert.doesNotMatch(iptvSource, /contentType:\s*[^\n]*extinfDuration/);
    const observer = createM3UShapeDiagnosticsObserver("https://panel.example/get.php?username=a&password=b");
    observer.observe({
      streamUrl: "https://panel.example/files/1.bin",
      category: "Cinema",
      extinfDuration: "-1",
      tvgId: "x",
    });
    const output = formatM3UShapeDiagnosticsFields(observer.snapshot()).join("\n");
    assert.match(output, /m3u\.extinfDuration\.negativeOneCount=1/);
    assert.match(output, /m3u\.classification\.byGroupMovie=1/);
  });

  scenario("Z2M player handoff commit is observable and chronological", () => {
    setM3UDiagnosticSession("provider-z2m", "live");
    resetM3UDiagnosticCounters();
    recordM3ULivePress();
    recordM3UOpenLiveEnter();
    recordM3UOpenLiveSetPlayable();
    recordM3UOpenLiveSetPlayerView();
    recordM3UPlayerViewCommit();
    const snapshot = getM3UDiagnosticSnapshot();
    assert.equal(snapshot.lastChannelPressCount, 1);
    assert.ok(snapshot.lastLivePressAt);
    assert.ok(snapshot.openLiveEnterAt);
    assert.ok(snapshot.setPlayableAt);
    assert.ok(snapshot.setPlayerViewAt);
    assert.ok(snapshot.playerViewCommitAt);
    assert.deepEqual(
      snapshot.playbackSequence.map((entry) => entry.marker),
      [
        "M3U_LIVE_PRESS",
        "M3U_OPEN_LIVE_ENTER",
        "M3U_OPEN_LIVE_SET_PLAYABLE",
        "M3U_OPEN_LIVE_SET_PLAYER_VIEW",
        "M3U_PLAYER_VIEW_COMMIT",
      ],
    );
  });

  scenario("Z2M URI diagnostics report rewrite metadata without raw URL or credentials", () => {
    const raw = "https://panel.example/live/alice/secret/12345.m3u8?token=private";
    const effective = "https://panel.example/live/alice/secret/12345.ts?token=private";
    const metadata = describeM3UPlaybackUri(raw, effective);
    assert.deepEqual(metadata, {
      scheme: "https",
      inputExtension: "m3u8",
      effectiveExtension: "ts",
      rewriteApplied: true,
      hasLivePath: true,
      sourceLength: raw.length,
    });
    const report = buildM3UDiagnosticReport({
      ...getM3UDiagnosticSnapshot(),
      uriMetadata: metadata,
    });
    assert.match(report, /uriScheme=https/);
    assert.match(report, /inputExtension=m3u8/);
    assert.match(report, /effectiveExtension=ts/);
    assert.match(report, /rewriteApplied=true/);
    assert.doesNotMatch(report, /panel\.example|alice|secret|12345|private|token=/);
  });

  scenario("Z2M instrumentation preserves playback orientation queue and touch semantics", () => {
    assert.match(pagedSource, /provider\.type === "m3u"\) recordM3ULivePress\(\)/);
    assert.match(homeSource, /recordM3UOpenLiveEnter\(\)/);
    assert.match(homeSource, /setPlayable\(\{ title: channel\.name,[\s\S]*url: channel\.streamUrl,[\s\S]*kind: "live"/);
    assert.match(homeSource, /setView\("player"\);[\s\S]*recordM3UOpenLiveSetPlayerView\(\)/);
    assert.match(homeSource, /view === "player"[\s\S]*M3UDiagnosticPanel/);
    assert.doesNotMatch(homeSource, /m3uDiagnosticEnabled \|\| view === "player"/);
    assert.match(compatSource, /\/live\\\/\/i\.test\(runtimeSource\)[\s\S]*\.m3u8[\s\S]*replace\([\s\S]*"\.ts"\)/);
    assert.match(compatSource, /getCachedLivePlaybackWindow\(provider,/);
    assert.match(pageRepoSource, /const LIVE_PLAYBACK_WINDOW_MAX = 500/);
    assert.match(orientationSource, /await ScreenOrientation\.getOrientationAsync\(\)/);
    assert.match(orientationSource, /await ScreenOrientation\.unlockAsync\(\)/);
    assert.match(orientationSource, /recordM3UOrientationReady/);
    assert.match(vlcSource, /source=\{\{ uri, initType: 2, initOptions \}\}/);
    assert.match(vlcSource, /onPlaying=\{handlePlaying\}/);
    assert.match(panelSource, /pointerEvents="box-none"/);
    assert.doesNotMatch(panelSource, /streamUrl|playlistUrl|username|password|token|mac/i);
  });

  scenario("Z2O Paged Live report uses the mounted page state rather than inferred busy flags", () => {
    setM3UDiagnosticSession("provider-z2o", "live");
    resetM3UDiagnosticCounters();
    recordM3UPagedLiveState({
      pageLoadingInitial: true,
      pageLoadingMore: true,
      pageItemsCount: 641,
      parentRefreshing: false,
      isEpgLoading: true,
      categoriesReady: true,
      selectedCategory: "__all__",
    });
    const snapshot = getM3UDiagnosticSnapshot();
    assert.equal(snapshot.pageLoadingInitial, true);
    assert.equal(snapshot.pageLoadingMore, true);
    assert.equal(snapshot.pageItemsCount, 641);
    assert.equal(snapshot.parentRefreshing, false);
    assert.equal(snapshot.isEpgLoading, true);
    assert.equal(snapshot.categoriesReady, true);
    assert.equal(snapshot.selectedCategory, "__all__");
    assert.match(pagedSource, /recordM3UPagedLiveState\(\{[\s\S]*pageLoadingInitial: page\.loadingInitial,[\s\S]*pageLoadingMore: page\.loadingMore,[\s\S]*pageItemsCount: page\.items\.length,[\s\S]*parentRefreshing: refreshing,[\s\S]*isEpgLoading: epgLoading,[\s\S]*categoriesReady,[\s\S]*selectedCategory: category/);
  });

  scenario("Z2O responder counters are independent and onPress keeps its existing semantic order", () => {
    resetM3UDiagnosticCounters();
    recordM3ULivePressIn();
    recordM3ULivePressOut();
    let snapshot = getM3UDiagnosticSnapshot();
    assert.equal(snapshot.pressInCount, 1);
    assert.equal(snapshot.pressCount, 0);
    assert.equal(snapshot.pressOutCount, 1);
    recordM3ULivePress();
    snapshot = getM3UDiagnosticSnapshot();
    assert.equal(snapshot.pressInCount, 1);
    assert.equal(snapshot.pressCount, 1);
    assert.equal(snapshot.pressOutCount, 1);
    assert.match(pagedSource, /onPressIn=\{\(\) => \{[\s\S]*recordM3ULivePressIn\(\)[\s\S]*onPress=\{\(\) => \{\s*if \(provider\.type === "m3u"\) recordM3ULivePress\(\);\s*onOpen\(channel\);[\s\S]*onPressOut=\{\(\) => \{[\s\S]*recordM3ULivePressOut\(\)/);
  });

  scenario("Z2O background refresh and EPG markers preserve existing scheduling and dedupe semantics", () => {
    assert.match(playerSource, /const M3U_BACKGROUND_REFRESH_DELAY_MS = 1_250/);
    assert.match(playerSource, /setTimeout\(\(\) => \{\s*if \(!cancelled\) void refreshProviderInBackground\(providerId\);\s*\}, M3U_BACKGROUND_REFRESH_DELAY_MS\)/);
    assert.match(playerSource, /recordM3UBackgroundRefreshBegin\(\);[\s\S]*await loadProviderSmart\(fromProvider\(existing\), \{ persistM3U: false \}\);[\s\S]*recordM3UBackgroundRefreshLoadEnd/);
    assert.match(playerSource, /recordM3UBackgroundRefreshEnd\([\s\S]*if \(!persistenceOwnsRequest\) providerLoadGateRef\.current\.finish\(ownership\)/);
    assert.match(playerSource, /const EPG_START_DELAY_MS = 1_200/);
    assert.match(playerSource, /const existingPromise = bulkEpgPromiseRef\.current\.get\(resolvedProviderId\);[\s\S]*if \(existingPromise\) \{\s*await existingPromise/);
    assert.match(playerSource, /if \(m3uEpgStartedAt !== null\) recordM3UEpgBegin\(\);[\s\S]*await loadBulkProviderEpg\(provider, providerChannels\)/);
    assert.match(playerSource, /recordM3UEpgEnd\([\s\S]*bulkEpgPromiseRef\.current\.delete\(resolvedProviderId\);\s*setIsEpgLoading\(false\)/);
    assert.match(playerSource, /provider\.type !== "xtream"\) return;/);
  });

  scenario("Z2O correlation report is bounded privacy-safe and diagnostic-only", () => {
    resetM3UDiagnosticCounters();
    recordM3UBackgroundRefreshBegin();
    recordM3UBackgroundRefreshLoadEnd(25);
    recordM3UEpgBegin();
    recordM3ULivePressIn();
    recordM3ULivePressOut();
    recordM3UEpgEnd(50);
    recordM3UBackgroundRefreshEnd(75);
    const report = buildM3UDiagnosticReport(getM3UDiagnosticSnapshot());
    assert.match(report, /M3U_BG_REFRESH_BEGIN/);
    assert.match(report, /M3U_BG_REFRESH_LOAD_END/);
    assert.match(report, /M3U_EPG_BEGIN/);
    assert.match(report, /M3U_LIVE_PRESS_IN/);
    assert.match(report, /M3U_LIVE_PRESS_OUT/);
    assert.match(report, /m3uBgRefreshActive=false/);
    assert.match(report, /m3uEpgActive=false/);
    assert.doesNotMatch(report, /playlistUrl|streamUrl|epgUrl|username|password|token|mac=/i);
    assert.match(pagedSource, /if \(provider\.type === "m3u"\) recordM3ULivePressIn\(\)/);
    assert.match(pagedSource, /if \(provider\.type === "m3u"\) recordM3ULivePressOut\(\)/);
    assert.doesNotMatch(pagedSource, /disabled=\{provider\.type === "m3u"/);
    const backgroundDelay = playerSource.match(/const M3U_BACKGROUND_REFRESH_DELAY_MS = ([0-9_]+);/);
    assert.equal(backgroundDelay?.[1], "1_250");
  });

  scenario("Z2Q ingest markers are placed on the exact M3U full-load boundaries", () => {
    const fetchStart = iptvSource.indexOf("async function fetchProviderText");
    const loadM3UStart = iptvSource.indexOf("async function loadM3U", fetchStart);
    const fetchSource = iptvSource.slice(fetchStart, loadM3UStart);
    assert.ok(fetchStart >= 0 && loadM3UStart > fetchStart);
    const fetchBegin = fetchSource.indexOf("recordM3UFetchBegin();");
    const fetchCall = fetchSource.indexOf("response = await fetch(url");
    const fetchResponse = fetchSource.indexOf("recordM3UFetchResponse();");
    const responseText = fetchSource.indexOf("const text = await response.text();");
    const responseTextEnd = fetchSource.indexOf("recordM3UResponseTextEnd();");
    assert.ok(fetchBegin >= 0 && fetchBegin < fetchCall);
    assert.ok(fetchCall < fetchResponse && fetchResponse < responseText && responseText < responseTextEnd);

    const cooperativeStart = iptvSource.indexOf("async function parseM3UCooperatively");
    const errorClassStart = iptvSource.indexOf("export class ProviderLoadError", cooperativeStart);
    const cooperativeSource = iptvSource.slice(cooperativeStart, errorClassStart);
    const splitBegin = cooperativeSource.indexOf("recordM3USplitBegin();");
    const splitOperation = cooperativeSource.indexOf('content.replace(/^\\uFEFF/, "").split(/\\r?\\n/)');
    const splitEnd = cooperativeSource.indexOf("recordM3USplitEnd();");
    const parseLinesEnd = cooperativeSource.indexOf("recordM3UParseLinesEnd();");
    const catalogBuild = cooperativeSource.indexOf("await buildM3UCatalogCooperatively");
    const catalogBuildEnd = cooperativeSource.indexOf("recordM3UCatalogBuildEnd();");
    assert.ok(splitBegin >= 0 && splitBegin < splitOperation);
    assert.ok(splitOperation < splitEnd && splitEnd < parseLinesEnd);
    assert.ok(parseLinesEnd < catalogBuild && catalogBuild < catalogBuildEnd);

    const standaloneStart = iptvSource.indexOf("export function parseM3U(");
    const standaloneEnd = iptvSource.indexOf("async function parseM3UCooperatively", standaloneStart);
    const standaloneSource = iptvSource.slice(standaloneStart, standaloneEnd);
    assert.doesNotMatch(standaloneSource, /recordM3U(?:Split|ParseLines|CatalogBuild)/);
  });

  scenario("Z2Q phase durations and chronological ingest sequence use monotonic boundaries", () => {
    setM3UDiagnosticSession("provider-z2q", "live");
    resetM3UDiagnosticCounters();
    recordM3UFetchBegin(1000);
    recordM3UFetchResponse(1500);
    recordM3UResponseTextEnd(1600);
    recordM3USplitBegin(1600);
    recordM3USplitEnd(1750);
    recordM3UParseLinesEnd(2100);
    recordM3UCatalogBuildEnd(2500);
    const snapshot = getM3UDiagnosticSnapshot();
    assert.equal(snapshot.m3uFetchWaitMs, 500);
    assert.equal(snapshot.m3uResponseTextMs, 100);
    assert.equal(snapshot.m3uSplitMs, 150);
    assert.equal(snapshot.m3uParseLinesMs, 350);
    assert.equal(snapshot.m3uCatalogBuildMs, 400);
    assert.equal(snapshot.m3uTotalIngestMs, 1500);
    assert.deepEqual(
      snapshot.correlationSequence.map((entry) => entry.marker),
      [
        "M3U_FETCH_BEGIN",
        "M3U_FETCH_RESPONSE",
        "M3U_RESPONSE_TEXT_END",
        "M3U_SPLIT_BEGIN",
        "M3U_SPLIT_END",
        "M3U_PARSE_LINES_END",
        "M3U_CATALOG_BUILD_END",
      ],
    );
    assert.deepEqual(
      snapshot.correlationSequence.map((entry) => entry.elapsedMs),
      [0, 500, 600, 600, 750, 1100, 1500],
    );
  });

  scenario("Z2Q keeps heartbeat background refresh parser batching and provider isolation unchanged", () => {
    assert.match(homeSource, /const intervalMs = 250;[\s\S]*setInterval\(\(\) => \{[\s\S]*recordM3UHeartbeat\(driftMs, now\)/);
    assert.match(playerSource, /recordM3UBackgroundRefreshBegin\(\);[\s\S]*recordM3UBackgroundRefreshLoadEnd/);
    assert.match(playerSource, /recordM3UBackgroundRefreshEnd\(/);
    assert.match(iptvSource, /const batchSize = 500;/);
    assert.match(iptvSource, /buildM3UCatalogCooperatively\(entries, providerId, \{\s*batchSize: 200,/);
    assert.match(iptvSource, /const lines = content\.replace\(\/\^\\uFEFF\/, ""\)\.split\(\/\\r\?\\n\/\);/);
    const xtreamStart = iptvSource.indexOf("async function loadXtream");
    const stalkerStart = iptvSource.indexOf("async function loadStalker", xtreamStart);
    const providerStart = iptvSource.indexOf("export async function loadProvider", stalkerStart);
    assert.doesNotMatch(iptvSource.slice(xtreamStart, providerStart), /recordM3U(?:Fetch|Response|Split|ParseLines|CatalogBuild)/);
  });

  scenario("Z2Q report remains privacy-safe after reachability hardening", () => {
    const report = buildM3UDiagnosticReport(getM3UDiagnosticSnapshot());
    assert.match(report, /m3uFetchWaitMs=500/);
    assert.match(report, /m3uResponseTextMs=100/);
    assert.match(report, /m3uSplitMs=150/);
    assert.match(report, /m3uParseLinesMs=350/);
    assert.match(report, /m3uCatalogBuildMs=400/);
    assert.match(report, /m3uTotalIngestMs=1500/);
    assert.doesNotMatch(report, /playlistUrl|streamUrl|epgUrl|username|password|token|cookie|mac=/i);
  });

  scenario("Z2QA M3U DBG is the top shell sibling and Android-safe without consuming unrelated touches", () => {
    assert.match(homeSource, /const m3uDiagnosticEnabled = provider\?\.type === "m3u";/);
    assert.match(panelSource, /<View pointerEvents="box-none" style=\{styles\.overlay\}>/);
    assert.match(panelSource, /useSafeAreaInsets\(\)/);
    assert.match(panelSource, /top: Math\.max\(insets\.top \+ 8, 112\)/);
    assert.match(panelSource, /overlay:\s*\{[\s\S]*zIndex: 1000,[\s\S]*elevation: 40,/);
    assert.match(panelSource, /floatingButton:\s*\{[\s\S]*elevation: 41,/);
    assert.match(panelSource, /panel:\s*\{[\s\S]*elevation: 42,/);

    const liveSurface = homeSource.indexOf('{view === "live" && (provider.type === "m3u" || provider.type === "xtream")');
    const moviesSurface = homeSource.indexOf('{view === "movies" && (provider.type === "m3u" || provider.type === "xtream")');
    const seriesSurface = homeSource.indexOf('{view === "series" && (provider.type === "m3u" || provider.type === "xtream")');
    const homeSurface = homeSource.indexOf('{view === "home" ? <HomeDiscovery');
    const nonPlayerPanel = homeSource.lastIndexOf('{m3uDiagnosticEnabled ? <M3UDiagnosticPanel providerId={provider.id} /> : null}');
    assert.ok(liveSurface >= 0 && moviesSurface >= 0 && seriesSurface >= 0 && homeSurface >= 0);
    assert.ok(nonPlayerPanel > liveSurface, "M3U DBG must mount after Dedicated Live");
    assert.ok(nonPlayerPanel > moviesSurface, "M3U DBG must mount after Movies");
    assert.ok(nonPlayerPanel > seriesSurface, "M3U DBG must mount after Series");
    assert.ok(nonPlayerPanel > homeSurface, "M3U DBG must mount after Home");
    assert.match(homeSource, /m3uDiagnosticEnabled \? <M3UDiagnosticPanel/);
    assert.doesNotMatch(homeSource, /provider\.type !== "m3u"[\s\S]{0,120}<M3UDiagnosticPanel/);
  });

  assert.equal(passed, 20);
  console.log("m3u shape diagnostics scenarios: 8/8 passed");
  console.log("m3u Z2M handoff diagnostics scenarios: 3/3 passed");
  console.log("m3u Z2O targeted correlation diagnostics scenarios: 4/4 passed");
  console.log("m3u Z2Q ingest phase diagnostics scenarios: 4/4 passed");
  console.log("m3u Z2QA diagnostic reachability scenarios: 1/1 passed");
  console.log("m3u shape + Z2M + Z2O + Z2Q + Z2QA diagnostics scenarios: 20/20 passed");
}

main();
