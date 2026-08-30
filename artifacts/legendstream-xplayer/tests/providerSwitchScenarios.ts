import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildM3UStreamUrl,
  parseM3UProviderSource,
  parseM3UStreamRef,
} from "../lib/m3uCatalogRefs";
import { buildM3UDirectHydration } from "../lib/m3uCatalogHydration";
import { buildM3UCacheWriteProjection } from "../lib/m3uCacheWriteProjection";
import {
  emptyM3URefRejectionCounts,
  formatM3UCacheWriteMeasurement,
} from "../lib/m3uCacheWriteMeasurement";
import {
  formatM3USwitchMeasurement,
  resolveM3UNetworkFallback,
} from "../lib/m3uSwitchMeasurement";
import {
  CATALOG_SYNC_METRICS_KEY,
  readCatalogSyncMetricsPayload,
  writeCatalogSyncMetricsPayload,
} from "../lib/catalogSyncMetricsPersistence";
import { dispatchCatalogTabNavigation } from "../lib/catalogTabNavigation";
import {
  chooseProviderSwitchPath,
  clearProviderSwitchSnapshot,
  peekProviderSwitchSnapshot,
  primeProviderSwitchSnapshot,
  safeProviderSwitchError,
  shouldPreserveProviderSwitchSnapshot,
  tryBeginProviderSwitch,
} from "../lib/providerSwitchUx";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playerSource = readFileSync(resolve(ROOT, "context/PlayerContext.tsx"), "utf8");
const catalogSource = readFileSync(resolve(ROOT, "context/CatalogSyncContext.tsx"), "utf8");
const screenSource = readFileSync(resolve(ROOT, "components/OptimizedHomeScreenV6.tsx"), "utf8");
const cacheSource = readFileSync(resolve(ROOT, "lib/providerSwitchCache.ts"), "utf8");
const m3uCacheSource = readFileSync(resolve(ROOT, "lib/m3uCatalogCache.ts"), "utf8");
const hydrationSource = readFileSync(resolve(ROOT, "lib/m3uCatalogHydration.ts"), "utf8");
const m3uSwitchMetricsSource = readFileSync(resolve(ROOT, "lib/m3uSwitchMetrics.ts"), "utf8");
const catalogMetricsSource = readFileSync(resolve(ROOT, "lib/catalogSyncMetrics.ts"), "utf8");
const writeRunnerSource = readFileSync(resolve(ROOT, "lib/m3uCacheWriteRunner.ts"), "utf8");
const writeProjectionSource = readFileSync(resolve(ROOT, "lib/m3uCacheWriteProjection.ts"), "utf8");

let passed = 0;
const scenario = async (name: string, run: () => void | Promise<void>) => {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
};

const zeroRejects = () => emptyM3URefRejectionCounts();

async function main() {
  await scenario("usable target cache selects cache path before blocking provider refetch", () => {
    assert.equal(
      chooseProviderSwitchPath({ hasInMemoryChannels: false, hasUsableCatalogCache: true }),
      "cache",
    );
    assert.match(cacheSource, /if \(!hasUsableCatalogCache\(counts\)\) return null;/);
    const cacheBranch = playerSource.indexOf('switchPath === "memory" || switchPath === "cache"');
    const refetch = playerSource.indexOf("loadProviderSmart(fromProvider(existing))", cacheBranch);
    assert.ok(cacheBranch >= 0 && refetch > cacheBranch, "cache branch must precede blocking refetch");
  });

  await scenario("empty target cache preserves existing network switch path", () => {
    assert.equal(
      chooseProviderSwitchPath({ hasInMemoryChannels: false, hasUsableCatalogCache: false }),
      "network",
    );
    assert.match(playerSource, /const smart = await loadProviderSmart\(fromProvider\(existing\)\);/);
    assert.match(catalogSource, /if \(!usable && state\?\.phase !== "ready"\) \{\s*await runSync\("initial"\);/s);
  });

  await scenario("a second provider tap cannot start another switch", () => {
    const first = tryBeginProviderSwitch(null, "provider-b");
    assert.equal(first.started, true);
    const second = tryBeginProviderSwitch(first.providerId, "provider-c");
    assert.equal(second.started, false);
    assert.equal(second.providerId, "provider-b");
    assert.match(screenSource, /tryBeginProviderSwitch\(switchingProviderRef\.current, id\)/);
    assert.match(screenSource, /switchingProviderRef\.current = id;/);
  });

  await scenario("provider switch failure is visible but credential-safe", () => {
    const safe = safeProviderSwitchError(
      new Error("GET https://secret.example/get.php?username=alice&password=swordfish failed"),
    );
    assert.doesNotMatch(safe, /alice|swordfish|secret\.example|get\.php|username=|password=/i);
    assert.match(playerSource, /setError\(safeProviderSwitchError\(caught\)\);/);
    assert.match(screenSource, /visibleErrorText\(error \|\| catalogError\)/);
  });

  await scenario("active account marker follows the committed provider id", () => {
    assert.match(screenSource, /const active = item\.id === provider\.id;/);
    assert.match(screenSource, /const switching = switchingProviderId === item\.id;/);
    assert.match(screenSource, /active \? <Feather name="check-circle"/);
    assert.match(screenSource, /switching \? <ActivityIndicator/);
  });

  await scenario("cached provider handoff never publishes an empty snapshot first", () => {
    const snapshot = {
      providerId: "provider-b",
      ready: true,
      counts: { live: 3, vod: 2, series: 1 },
      live: [{ id: "live-1" }],
      movies: [{ stream_id: 1 }],
      series: [{ series_id: 1 }],
    };
    primeProviderSwitchSnapshot("provider-b", snapshot);
    assert.deepEqual(peekProviderSwitchSnapshot("provider-b"), snapshot);
    assert.equal(
      shouldPreserveProviderSwitchSnapshot({
        snapshotProviderId: "provider-b",
        targetProviderId: "provider-b",
        hasUsableCache: true,
      }),
      true,
    );
    clearProviderSwitchSnapshot("provider-b");
    assert.equal(peekProviderSwitchSnapshot("provider-b"), null);
    assert.match(catalogSource, /if \(primedSnapshot\) \{\s*setSnapshot\(primedSnapshot\);\s*setHasUsableCache\(true\);\s*\} else \{\s*setSnapshot\(EMPTY_SNAPSHOT\);/s);
    assert.match(screenSource, /if \(prepared\) \{\s*setVod\(prepared\.snapshot\.movies\);/s);
  });

  await scenario("M3U cache with safe get.php paths uses credential-free cache handoff", () => {
    const providerUrl = "https://iptv.example:8080/get.php?username=alice&password=swordfish&type=m3u_plus&output=ts";
    const provider = parseM3UProviderSource(providerUrl);
    assert.ok(provider);
    const ref = parseM3UStreamRef(
      providerUrl,
      "https://iptv.example:8080/live/alice/swordfish/991.ts",
      "live",
    );
    assert.deepEqual(ref, {
      type: "m3u-path",
      kind: "live",
      streamId: "991",
      containerExtension: "ts",
    });
    assert.doesNotMatch(JSON.stringify(ref), /alice|swordfish|username|password/i);
    assert.equal(
      buildM3UStreamUrl(providerUrl, ref!),
      "https://iptv.example:8080/live/alice/swordfish/991.ts",
    );
    assert.equal(
      chooseProviderSwitchPath({ hasInMemoryChannels: false, hasUsableCatalogCache: true }),
      "cache",
    );
    const m3uBranch = cacheSource.indexOf('if (provider.type === "m3u")');
    const xtreamGuard = cacheSource.indexOf('if (provider.type !== "xtream") return null;', m3uBranch);
    assert.ok(m3uBranch >= 0 && xtreamGuard > m3uBranch, "M3U cache branch must run before the Xtream-only fallback guard");
    assert.match(cacheSource, /hydrateM3UProviderCache\(provider as any\)/);
    assert.match(playerSource, /peekProviderSwitchSnapshot<\{ live\?: Channel\[\] \}>\(providerId\)/);
  });

  await scenario("M3U without usable cache keeps network fallback and catalog skeleton", () => {
    assert.equal(
      chooseProviderSwitchPath({ hasInMemoryChannels: false, hasUsableCatalogCache: false }),
      "network",
    );
    assert.match(cacheSource, /if \(!cached\) return null;/);
    assert.match(m3uCacheSource, /return null;/);
    assert.match(playerSource, /const smart = await loadProviderSmart\(fromProvider\(existing\)\);/);
    const skeletons = screenSource.match(/if \(!loaded\) return <CatalogLoadingSkeleton/g) ?? [];
    assert.ok(skeletons.length >= 2, "Movies and Series must keep skeleton placeholders while M3U has no cache");
  });

  await scenario("M3U tabs use the ready in-memory catalog instead of the Xtream category loader", () => {
    const calls: string[] = [];
    const loaders = {
      loadLocalMovies: () => { calls.push("local-movies"); },
      loadLocalSeries: () => { calls.push("local-series"); },
      loadXtreamMovies: () => { calls.push("xtream-movies"); },
      loadXtreamSeries: () => { calls.push("xtream-series"); },
    };
    dispatchCatalogTabNavigation({
      providerType: "m3u",
      target: "movies",
      m3uCatalogCounts: { movies: 24_457, series: 1_237 },
      ...loaders,
    });
    dispatchCatalogTabNavigation({
      providerType: "m3u",
      target: "series",
      m3uCatalogCounts: { movies: 24_457, series: 1_237 },
      ...loaders,
    });
    assert.deepEqual(calls, ["local-movies", "local-series"]);
    assert.match(screenSource, /dispatchCatalogTabNavigation\(\{/);
    assert.match(screenSource, /loadLocalMovies: applyLocalVod/);
    assert.match(screenSource, /loadLocalSeries: applyLocalSeries/);
  });

  await scenario("M3U tabs with no in-memory catalog preserve the existing skeleton state", () => {
    const calls: string[] = [];
    const loaders = {
      loadLocalMovies: () => { calls.push("local-movies"); },
      loadLocalSeries: () => { calls.push("local-series"); },
      loadXtreamMovies: () => { calls.push("xtream-movies"); },
      loadXtreamSeries: () => { calls.push("xtream-series"); },
    };
    dispatchCatalogTabNavigation({
      providerType: "m3u",
      target: "movies",
      m3uCatalogCounts: { movies: 0, series: 0 },
      ...loaders,
    });
    dispatchCatalogTabNavigation({
      providerType: "m3u",
      target: "series",
      m3uCatalogCounts: { movies: 0, series: 0 },
      ...loaders,
    });
    assert.deepEqual(calls, []);
    const skeletons = screenSource.match(/if \(!loaded\) return <CatalogLoadingSkeleton/g) ?? [];
    assert.ok(skeletons.length >= 2);
  });

  await scenario("Xtream tab navigation keeps the existing category loader path", () => {
    const calls: string[] = [];
    const loaders = {
      loadLocalMovies: () => { calls.push("local-movies"); },
      loadLocalSeries: () => { calls.push("local-series"); },
      loadXtreamMovies: () => { calls.push("xtream-movies"); },
      loadXtreamSeries: () => { calls.push("xtream-series"); },
    };
    dispatchCatalogTabNavigation({
      providerType: "xtream",
      target: "movies",
      m3uCatalogCounts: { movies: 0, series: 0 },
      ...loaders,
    });
    dispatchCatalogTabNavigation({
      providerType: "xtream",
      target: "series",
      m3uCatalogCounts: { movies: 0, series: 0 },
      ...loaders,
    });
    assert.deepEqual(calls, ["xtream-movies", "xtream-series"]);
    assert.match(screenSource, /loadXtreamMovies: \(\) => loadVodCategory\("__all__"\)/);
    assert.match(screenSource, /loadXtreamSeries: \(\) => loadSeriesCategory\("__all__"\)/);
  });

  await scenario("cold-start active M3U hydrates cached counts before the player leaves hydration", () => {
    const hydrateCall = playerSource.indexOf("const cached = await hydrateM3UProviderCache(provider);");
    const installLive = playerSource.indexOf("next.channels = cached.live;", hydrateCall);
    const finishHydration = playerSource.indexOf("setIsHydrating(false);", installLive);
    assert.ok(hydrateCall >= 0 && installLive > hydrateCall && finishHydration > installLive);
    assert.match(playerSource, /markM3UCacheActivation\(provider\.id\);/);
    assert.match(m3uCacheSource, /installM3UCatalog\(provider\.id, direct\.catalog\);/);
    assert.match(screenSource, /const local = getM3UCatalog\(effectiveProvider\.id\);\s*setHomeVodCount\(local\.movieItems\.length\);\s*setHomeSeriesCount\(local\.seriesGroups\.length\);/s);
  });

  await scenario("Xtream cache-first behavior remains unchanged", () => {
    assert.match(cacheSource, /if \(provider\.type !== "xtream"\) return null;/);
    assert.match(cacheSource, /getCatalogCounts\(provider\.id\)/);
    assert.match(cacheSource, /getCachedVodItems\(provider, undefined, HOME_SAMPLE_LIMIT\)/);
    assert.match(cacheSource, /getCachedSeriesItems\(provider, undefined, HOME_SAMPLE_LIMIT\)/);
    assert.match(catalogSource, /if \(!provider \|\| provider\.type !== "xtream"\) return;/);
    assert.equal(
      chooseProviderSwitchPath({ hasInMemoryChannels: false, hasUsableCatalogCache: true }),
      "cache",
    );
  });

  await scenario("M3U cache hydration does not call parseM3U or rebuild synthetic playlist text", () => {
    assert.doesNotMatch(m3uCacheSource, /\bparseM3U\s*\(/);
    assert.doesNotMatch(m3uCacheSource, /syntheticCatalog|#EXTM3U|#EXTINF/);
    assert.match(m3uCacheSource, /buildM3UDirectHydration\(provider, liveRows, vodRows, seriesRows\)/);
    assert.match(m3uCacheSource, /installM3UCatalog\(provider\.id, direct\.catalog\)/);
    assert.doesNotMatch(hydrationSource, /\bparseM3U\s*\(/);
  });

  await scenario("SQLite DTOs build live, movie and grouped series runtime objects directly", () => {
    const provider = {
      id: "m3u-provider",
      url: "https://iptv.example:8080/get.php?username=alice&password=swordfish&type=m3u_plus&output=ts",
    };
    const direct = buildM3UDirectHydration(
      provider,
      [{
        schemaVersion: 1,
        catalogKind: "live",
        providerId: provider.id,
        id: "live-1",
        name: "News",
        category: "Live",
        contentType: "live",
        playbackRef: { type: "m3u-path", kind: "live", streamId: "101", containerExtension: "ts" },
      }],
      [{
        schemaVersion: 1,
        catalogKind: "vod",
        providerId: provider.id,
        stream_id: "202",
        name: "Movie",
        category_id: "Movies",
        playbackRef: { type: "m3u-path", kind: "movie", streamId: "202", containerExtension: "mp4" },
      }],
      [{
        schemaVersion: 1,
        catalogKind: "series",
        providerId: provider.id,
        series_id: "series-303",
        name: "Series",
        category_id: "Drama",
        m3uEpisodes: [{
          id: "episode-1",
          title: "Series S01E01",
          category: "Drama",
          season: 1,
          episode: 1,
          playbackRef: { type: "m3u-path", kind: "series", streamId: "303", containerExtension: "mkv" },
        }],
      }],
    );
    assert.deepEqual(direct.counts, { live: 1, vod: 1, series: 1 });
    assert.equal(direct.live[0].streamUrl, "https://iptv.example:8080/live/alice/swordfish/101.ts");
    assert.equal(direct.catalog.movieItems[0].streamUrl, "https://iptv.example:8080/movie/alice/swordfish/202.mp4");
    assert.equal(
      direct.catalog.seriesGroups[0].seasons["1"][0].streamUrl,
      "https://iptv.example:8080/series/alice/swordfish/303.mkv",
    );
    assert.equal(direct.series[0].category_id, "Drama");
  });

  await scenario("M3U hydration null and error outcomes map to explicit network fallback reasons", () => {
    assert.deepEqual(
      resolveM3UNetworkFallback("network", "null", "empty-cache"),
      { used: true, reason: "cache-empty" },
    );
    assert.deepEqual(
      resolveM3UNetworkFallback("network", "error", "sqlite-read-error"),
      { used: true, reason: "cache-sqlite-error" },
    );
    assert.deepEqual(
      resolveM3UNetworkFallback("network", "error", "runtime-hydrate-error"),
      { used: true, reason: "cache-runtime-error" },
    );
    assert.match(m3uCacheSource, /outcome: "null"[\s\S]*reason: "empty-cache"/);
    assert.match(m3uCacheSource, /outcome: "error"[\s\S]*"sqlite-read-error"[\s\S]*"runtime-hydrate-error"/);
    assert.match(m3uSwitchMetricsSource, /noteM3UProviderSwitchPath/);
  });

  await scenario("catalog measurement payload survives a fresh storage adapter after process memory is gone", async () => {
    const backing = new Map<string, string>();
    const firstProcessStorage = {
      getItem: async (key: string) => backing.get(key) ?? null,
      setItem: async (key: string, value: string) => { backing.set(key, value); },
    };
    const payload = JSON.stringify({ kind: "m3u-switch", m3u: { totalSwitchMs: 1234 } });
    await writeCatalogSyncMetricsPayload(firstProcessStorage, payload);
    assert.equal(backing.has(CATALOG_SYNC_METRICS_KEY), true);

    const restartedProcessStorage = {
      getItem: async (key: string) => backing.get(key) ?? null,
      setItem: async (key: string, value: string) => { backing.set(key, value); },
    };
    assert.equal(await readCatalogSyncMetricsPayload(restartedProcessStorage), payload);
    assert.match(catalogMetricsSource, /readPersistedCatalogSyncMeasurement/);
  });

  await scenario("M3U measurement output contains timings/counts but no credential or URL fields", () => {
    const output = formatM3USwitchMeasurement({
      kind: "m3u-switch",
      startedAt: 1,
      m3u: {
        sqliteReadMs: 12,
        runtimeHydrateMs: 34,
        cacheHydrationOutcome: "hit",
        networkFallback: false,
        networkFallbackReason: "none",
        totalSwitchMs: 56,
        itemCounts: { live: 100, vod: 20, series: 10 },
        cacheRawCounts: { live: 100, vod: 20, series: 10 },
        cacheSyncPhase: "ready",
      },
    });
    assert.match(output, /m3u\.sqliteReadMs=12/);
    assert.match(output, /m3u\.runtimeHydrateMs=34/);
    assert.match(output, /m3u\.networkFallback=false/);
    assert.match(output, /m3u\.totalSwitchMs=56/);
    assert.match(output, /m3u\.itemCounts\.live=100/);
    assert.match(output, /m3u\.cacheRawCounts\.live=100/);
    assert.match(output, /m3u\.cacheSyncPhase=ready/);
    assert.match(output, /m3u\.writeAttempted=false/);
    assert.doesNotMatch(output, /https?:\/\/|get\.php|username[=:]|password[=:]|token[=:]|provider(name|id)?[=:]/i);
  });

  await scenario("M3U write failure is observed and the background caller reads false", () => {
    const output = formatM3UCacheWriteMeasurement({
      kind: "m3u-cache-write",
      startedAt: 1,
      m3u: {
        cacheRawCounts: { live: 0, vod: 0, series: 0 },
        cacheSyncPhase: "error",
        write: {
          writeAttempted: true,
          writeOutcome: "sqlite-error",
          writeMs: 88,
          writeInputCounts: { live: 3, vod: 2, series: 1 },
          writeSafeCounts: { live: 3, vod: 2, series: 1 },
          writeWrittenCounts: { live: 3, vod: 0, series: 0 },
          writeRejectCounts: zeroRejects(),
        },
      },
    });
    assert.match(output, /m3u\.writeOutcome=sqlite-error/);
    assert.match(output, /m3u\.cacheSyncPhase=error/);
    assert.match(writeRunnerSource, /const persisted = await persistM3UProviderCache\(provider, loaded\);/);
    assert.match(writeRunnerSource, /if \(!persisted\)/);
    assert.doesNotMatch(writeRunnerSource, /\.catch\(\(\) => undefined\)/);
    assert.match(m3uCacheSource, /noteM3UCacheWriteResult/);
  });

  await scenario("successful M3U write projection reports exact safe and written counters", () => {
    const provider = {
      id: "m3u-provider",
      type: "m3u" as const,
      url: "https://iptv.example:8080/get.php?username=alice&password=swordfish&type=m3u_plus&output=ts",
      createdAt: 1,
    };
    const live = {
      id: "live-1",
      providerId: provider.id,
      name: "News",
      streamUrl: "https://iptv.example:8080/live/alice/swordfish/101.ts",
      category: "Live",
      contentType: "live" as const,
    };
    const projection = buildM3UCacheWriteProjection(provider, {
      channels: [live],
      liveChannels: [live],
      movieItems: [{
        id: "movie-1",
        providerId: provider.id,
        name: "Movie",
        streamUrl: "https://iptv.example:8080/movie/alice/swordfish/202.mp4",
        category: "Movies",
        contentType: "movie",
      }],
      seriesGroups: [{
        id: "series-1",
        providerId: provider.id,
        name: "Series",
        category: "Drama",
        contentType: "series",
        seasons: {
          "1": [{
            id: "episode-1",
            providerId: provider.id,
            title: "Series S01E01",
            streamUrl: "https://iptv.example:8080/series/alice/swordfish/303.mkv",
            category: "Drama",
            season: 1,
            episode: 1,
          }],
        },
      }],
    });
    assert.ok(projection);
    assert.deepEqual(projection.inputCounts, { live: 1, vod: 1, series: 1 });
    assert.deepEqual(projection.safeCounts, { live: 1, vod: 1, series: 1 });
    assert.equal(projection.unsafeOutcome, null);
    assert.deepEqual(projection.rejectionCounts, zeroRejects());
    assert.match(m3uCacheSource, /writtenCounts\.live = await upsertCatalogItems/);
    assert.match(m3uCacheSource, /outcome: "success"/);
  });

  await scenario("unsafe M3U refs produce the correct fail-closed outcome and rejection reason counters", () => {
    const provider = {
      id: "m3u-provider",
      type: "m3u" as const,
      url: "https://iptv.example:8080/get.php?username=alice&password=swordfish&type=m3u_plus&output=ts",
      createdAt: 1,
    };
    const urls = [
      "https://cdn.example:8080/live/alice/swordfish/1.ts",
      "https://iptv.example:8080/live/alice/swordfish/extra/2.ts",
      "https://iptv.example:8080/live/alice/swordfish/3.ts?token=secret",
      "https://iptv.example:8080/movie/alice/swordfish/4.mp4",
      "https://iptv.example:8080/live/alice/swordfish/5",
      "https://iptv.example:8080/live/bob/wrong/6.ts",
    ];
    const channels = urls.map((streamUrl, index) => ({
      id: `live-${index}`,
      providerId: provider.id,
      name: `Live ${index}`,
      streamUrl,
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
    assert.deepEqual(projection.safeCounts, { live: 0, vod: 0, series: 0 });
    assert.deepEqual(projection.rejectionCounts, {
      "origin-mismatch": 1,
      "path-shape": 1,
      "query-present": 1,
      "kind-mismatch": 1,
      "missing-extension": 1,
      "credential-path-mismatch": 1,
    });
    assert.match(writeProjectionSource, /rejectionCounts\[inspection\.reason\] \+= 1/);
  });

  await scenario("M3U write telemetry is counter-only and contains no URL or credential values", () => {
    const output = formatM3UCacheWriteMeasurement({
      kind: "m3u-cache-write",
      startedAt: 1,
      m3u: {
        cacheRawCounts: { live: 9, vod: 8, series: 7 },
        cacheSyncPhase: "error",
        write: {
          writeAttempted: true,
          writeOutcome: "unsafe-live-ref",
          writeMs: 42,
          writeInputCounts: { live: 10, vod: 8, series: 7 },
          writeSafeCounts: { live: 9, vod: 8, series: 7 },
          writeWrittenCounts: { live: 0, vod: 0, series: 0 },
          writeRejectCounts: {
            ...zeroRejects(),
            "credential-path-mismatch": 1,
          },
        },
      },
    });
    assert.match(output, /m3u\.writeRejectCounts\.credential-path-mismatch=1/);
    assert.doesNotMatch(
      output,
      /https?:\/\/|get\.php|alice|swordfish|secret\.example|username\s*[=:]|password\s*[=:]|token\s*[=:]|host\s*[=:]/i,
    );
  });

  await scenario("unsafe or projection-dropped M3U cache writes remain all-or-nothing fail-closed", () => {
    const rejectBranch = m3uCacheSource.indexOf("if (projection.unsafeOutcome)");
    const failClosed = m3uCacheSource.indexOf("async function failClosedWrite");
    const deleteCatalog = m3uCacheSource.indexOf("await deleteProviderCatalog(options.providerId)", failClosed);
    const falseReturn = m3uCacheSource.indexOf("return false;", deleteCatalog);
    assert.ok(rejectBranch >= 0 && failClosed >= 0 && deleteCatalog > failClosed && falseReturn > deleteCatalog);
    assert.match(m3uCacheSource, /outcome: "projection-drop"/);
    assert.match(m3uCacheSource, /return failClosedWrite\(/);
    assert.doesNotMatch(m3uCacheSource, /writeSafeCounts[\s\S]*upsertCatalogItems\([^)]*projection\./);
  });

  await scenario("Xtream branch stays outside M3U measurement and direct hydration changes", () => {
    const m3uBranch = cacheSource.indexOf('if (provider.type === "m3u")');
    const xtreamGuard = cacheSource.indexOf('if (provider.type !== "xtream") return null;');
    assert.ok(m3uBranch >= 0 && xtreamGuard > m3uBranch);
    assert.match(cacheSource.slice(m3uBranch, xtreamGuard), /beginM3UProviderSwitchMeasurement\(provider\.id\)/);
    assert.doesNotMatch(cacheSource.slice(xtreamGuard), /beginM3UProviderSwitchMeasurement/);
    assert.match(cacheSource.slice(xtreamGuard), /getCatalogCounts\(provider\.id\)/);
    assert.match(cacheSource.slice(xtreamGuard), /getCachedVodItems\(provider, undefined, HOME_SAMPLE_LIMIT\)/);
    assert.match(cacheSource.slice(xtreamGuard), /getCachedSeriesItems\(provider, undefined, HOME_SAMPLE_LIMIT\)/);
  });

  assert.equal(passed, 24);
  console.log("provider switch UX scenarios: 24/24 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
