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
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const playerSource = source("context/PlayerContext.tsx");
const catalogSource = source("context/CatalogSyncContext.tsx");
const entrySource = source("components/OptimizedHomeScreenV6.tsx");
const screenSource = source("components/OptimizedHomeScreenPaged.tsx");
const viewsSource = source("components/catalog/PagedCatalogViews.tsx");
const hookSource = source("hooks/useCatalogPage.ts");
const cacheSource = source("lib/providerSwitchCache.ts");
const m3uCacheSource = source("lib/m3uCatalogCache.ts");
const hydrationSource = source("lib/m3uCatalogHydration.ts");
const m3uSwitchMetricsSource = source("lib/m3uSwitchMetrics.ts");
const catalogMetricsSource = source("lib/catalogSyncMetrics.ts");
const writeRunnerSource = source("lib/m3uCacheWriteRunner.ts");
const writeProjectionSource = source("lib/m3uCacheWriteProjection.ts");

let passed = 0;
const scenario = async (name: string, run: () => void | Promise<void>) => {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
};

const zeroRejects = () => emptyM3URefRejectionCounts();
const completeScan = (total: number) => ({
  scanTotalCandidateCount: total,
  scanInspectedCount: total,
  scanTruncated: false,
  firstRejectKind: "none" as const,
  firstRejectReason: "none" as const,
});

async function main() {
  await scenario("usable target cache selects cache path before blocking provider refetch", () => {
    assert.equal(chooseProviderSwitchPath({ hasInMemoryChannels: false, hasUsableCatalogCache: true }), "cache");
    assert.match(cacheSource, /if \(!hasUsableCatalogCache\(counts\)\) return null;/);
    const cacheBranch = playerSource.indexOf('switchPath === "memory" || switchPath === "cache"');
    const refetch = playerSource.indexOf("loadProviderSmart(fromProvider(existing))", cacheBranch);
    assert.ok(cacheBranch >= 0 && refetch > cacheBranch);
  });

  await scenario("empty target cache preserves the existing network switch fallback", () => {
    assert.equal(chooseProviderSwitchPath({ hasInMemoryChannels: false, hasUsableCatalogCache: false }), "network");
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
  });

  await scenario("provider switch failure remains visible and credential-safe", () => {
    const safe = safeProviderSwitchError(new Error("GET https://secret.example/get.php?username=alice&password=swordfish failed"));
    assert.doesNotMatch(safe, /alice|swordfish|secret\.example|get\.php|username=|password=/i);
    assert.match(screenSource, /setCatalogError\(safeProviderSwitchError\(caught\)\)/);
    assert.match(screenSource, /visibleErrorText\(error \|\| catalogError\)/);
  });

  await scenario("active account marker follows the committed provider id", () => {
    assert.match(screenSource, /const active = item\.id === provider\.id;/);
    assert.match(screenSource, /const switching = switchingProviderId === item\.id;/);
    assert.match(screenSource, /active \? <Feather name="check-circle"/);
  });

  await scenario("primed provider snapshot is preserved instead of publishing empty handoff", () => {
    const snapshot = {
      providerId: "provider-b",
      scope: "preview" as const,
      ready: true,
      counts: { live: 3, vod: 2, series: 1 },
      live: [{ id: "live-1" }],
      movies: [{ stream_id: 1 }],
      series: [{ series_id: 1 }],
    };
    primeProviderSwitchSnapshot("provider-b", snapshot);
    assert.deepEqual(peekProviderSwitchSnapshot("provider-b"), snapshot);
    assert.equal(shouldPreserveProviderSwitchSnapshot({ snapshotProviderId: "provider-b", targetProviderId: "provider-b", hasUsableCache: true }), true);
    clearProviderSwitchSnapshot("provider-b");
    assert.equal(peekProviderSwitchSnapshot("provider-b"), null);
    assert.match(catalogSource, /if \(primedSnapshot\) \{\s*setSnapshot\(primedSnapshot\);\s*setHasUsableCache\(true\);/s);
  });

  await scenario("M3U get.php paths use credential-free refs and a max-48 switch preview", () => {
    const providerUrl = "https://iptv.example:8080/get.php?username=alice&password=swordfish&type=m3u_plus&output=ts";
    const provider = parseM3UProviderSource(providerUrl);
    assert.ok(provider);
    const ref = parseM3UStreamRef(providerUrl, "https://iptv.example:8080/live/alice/swordfish/991.ts", "live");
    assert.deepEqual(ref, { type: "m3u-path", kind: "live", streamId: "991", containerExtension: "ts" });
    assert.doesNotMatch(JSON.stringify(ref), /alice|swordfish|username|password/i);
    assert.equal(buildM3UStreamUrl(providerUrl, ref!), "https://iptv.example:8080/live/alice/swordfish/991.ts");
    assert.match(cacheSource, /const HOME_SAMPLE_LIMIT = 48/);
    assert.match(cacheSource, /hydrateM3UProviderCache\(provider\)/);
    assert.match(m3uCacheSource, /export const M3U_HOME_PREVIEW_LIMIT = 48/);
    assert.doesNotMatch(cacheSource, /initialLimit|installFullCatalog/);
  });

  await scenario("M3U without usable cache keeps network fallback and paged initial skeleton", () => {
    assert.equal(chooseProviderSwitchPath({ hasInMemoryChannels: false, hasUsableCatalogCache: false }), "network");
    assert.match(cacheSource, /if \(!cached\) return null;/);
    assert.match(playerSource, /const smart = await loadProviderSmart\(fromProvider\(existing\)\);/);
    assert.match(viewsSource, /page\.loadingInitial && page\.items\.length === 0/);
  });

  await scenario("M3U catalog tabs use persisted pages and never invoke full-kind runtime loaders", () => {
    assert.match(entrySource, /OptimizedHomeScreenPaged/);
    assert.match(screenSource, /PagedLiveCatalog/);
    assert.match(screenSource, /PagedMoviesCatalog/);
    assert.match(screenSource, /PagedSeriesCatalog/);
    assert.match(hookSource, /getCachedCatalogPage/);
    assert.doesNotMatch(screenSource, /applyLocalVod|applyLocalSeries|applyLocalLive/);
    assert.doesNotMatch(screenSource, /hydrateM3UProviderKindCache|getM3UCatalog/);
  });

  await scenario("Xtream catalog tabs use persisted pages without restoring category-wide runtime loaders", () => {
    assert.match(screenSource, /PagedMoviesCatalog/);
    assert.match(screenSource, /PagedSeriesCatalog/);
    assert.match(screenSource, /PagedLiveCatalog/);
    assert.match(hookSource, /getCachedCatalogPage/);
    assert.doesNotMatch(screenSource, /loadVodCategory|loadSeriesCategory/);
    assert.doesNotMatch(viewsSource, /getVodStreams|getSeries\(/);
  });

  await scenario("active M3U cold start is bounded by default and cannot implicitly install full catalog", () => {
    const hydrateCall = playerSource.indexOf("const cached = await hydrateM3UProviderCache(provider);");
    const installLive = playerSource.indexOf("next.channels = cached.live;", hydrateCall);
    assert.ok(hydrateCall >= 0 && installLive > hydrateCall);
    assert.match(m3uCacheSource, /getCachedPersistedItems\(provider\.id, "live", undefined, M3U_HOME_PREVIEW_LIMIT\)/);
    assert.match(m3uCacheSource, /scope:\s*"preview"/);
    assert.doesNotMatch(m3uCacheSource, /installM3UCatalog|getM3UCatalog|installFullCatalog/);
  });

  await scenario("Xtream cache-first behavior remains bounded and API ingest semantics stay separate", () => {
    assert.match(cacheSource, /if \(provider\.type !== "xtream"\) return null;/);
    assert.match(cacheSource, /getCatalogCounts\(provider\.id\)/);
    assert.match(cacheSource, /getCachedLiveItems\(provider, undefined, HOME_SAMPLE_LIMIT\)/);
    assert.match(cacheSource, /getCachedVodItems\(provider, undefined, HOME_SAMPLE_LIMIT\)/);
    assert.match(cacheSource, /getCachedSeriesItems\(provider, undefined, HOME_SAMPLE_LIMIT\)/);
    assert.match(catalogSource, /resolvedProviderTransport\(provider\) !== "xtream"/);
  });

  await scenario("M3U cache hydration remains direct DTO mapping without reparsing synthetic playlist text", () => {
    assert.doesNotMatch(m3uCacheSource, /\bparseM3U\s*\(/);
    assert.doesNotMatch(m3uCacheSource, /syntheticCatalog|#EXTM3U|#EXTINF/);
    assert.match(m3uCacheSource, /buildM3UDirectHydrationCooperatively/);
    assert.doesNotMatch(hydrationSource, /\bparseM3U\s*\(/);
  });

  await scenario("SQLite DTOs still build live movie and grouped series runtime objects", () => {
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
    assert.equal(direct.catalog.seriesGroups[0].seasons["1"][0].streamUrl, "https://iptv.example:8080/series/alice/swordfish/303.mkv");
  });

  await scenario("M3U hydration null and error outcomes retain explicit network fallback reasons", () => {
    assert.deepEqual(resolveM3UNetworkFallback("network", "null", "empty-cache"), { used: true, reason: "cache-empty" });
    assert.deepEqual(resolveM3UNetworkFallback("network", "error", "sqlite-read-error"), { used: true, reason: "cache-sqlite-error" });
    assert.deepEqual(resolveM3UNetworkFallback("network", "error", "runtime-hydrate-error"), { used: true, reason: "cache-runtime-error" });
    assert.match(m3uCacheSource, /"sqlite-read-error"[\s\S]*"runtime-hydrate-error"/s);
    assert.match(m3uSwitchMetricsSource, /noteM3UProviderSwitchPath/);
  });

  await scenario("catalog measurement payload survives process-memory loss through storage", async () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => backing.get(key) ?? null,
      setItem: async (key: string, value: string) => { backing.set(key, value); },
    };
    const payload = JSON.stringify({ kind: "m3u-switch", m3u: { totalSwitchMs: 1234 } });
    await writeCatalogSyncMetricsPayload(storage, payload);
    assert.equal(backing.has(CATALOG_SYNC_METRICS_KEY), true);
    assert.equal(await readCatalogSyncMetricsPayload(storage), payload);
    assert.match(catalogMetricsSource, /readPersistedCatalogSyncMeasurement/);
  });

  await scenario("M3U measurement output remains credential-safe and separates before after state", () => {
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
        cacheBefore: { rawCounts: { live: 90, vod: 10, series: 5 }, syncPhase: "syncing" },
        cacheAfter: { rawCounts: { live: 100, vod: 20, series: 10 }, syncPhase: "ready" },
      },
    });
    assert.match(output, /m3u\.sqliteReadMs=12/);
    assert.match(output, /m3u\.cacheBefore\.rawCounts\.live=90/);
    assert.match(output, /m3u\.cacheAfter\.rawCounts\.live=100/);
    assert.doesNotMatch(output, /https?:\/\/|get\.php|username[=:]|password[=:]|token[=:]|provider(name|id)?[=:]/i);
  });

  await scenario("M3U write failure remains observed instead of being swallowed", () => {
    const output = formatM3UCacheWriteMeasurement({
      kind: "m3u-cache-write",
      startedAt: 1,
      m3u: {
        cacheAfter: { rawCounts: { live: 0, vod: 0, series: 0 }, syncPhase: "error" },
        write: {
          writeAttempted: true,
          writeOutcome: "sqlite-error",
          writeMs: 88,
          writeInputCounts: { live: 3, vod: 2, series: 1 },
          writeSafeCounts: { live: 3, vod: 2, series: 1 },
          writeWrittenCounts: { live: 3, vod: 0, series: 0 },
          writeRejectCounts: zeroRejects(),
          scan: completeScan(6),
          cleanupOutcome: "not-required",
          cleanupStage: "none",
        },
      },
    });
    assert.match(output, /m3u\.writeOutcome=sqlite-error/);
    assert.match(writeRunnerSource, /const persisted = await persistM3UProviderCache\(provider, loaded\);/);
    assert.match(writeRunnerSource, /if \(!persisted\)/);
    assert.doesNotMatch(writeRunnerSource, /\.catch\(\(\) => undefined\)/);
  });

  await scenario("successful M3U write projection reports exact safe and committed counters", () => {
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
    assert.deepEqual(projection.scan, completeScan(3));
    assert.match(m3uCacheSource, /const stagingProviderId = `__staging__\$\{provider\.id\}`;/);
    assert.match(m3uCacheSource, /const committedCounts = await swapStagingToProvider\(\{/);
    assert.doesNotMatch(m3uCacheSource, /upsertCatalogItems\(provider\.id/);
    assert.match(m3uCacheSource, /writtenCounts\.live = committedCounts\.live/);
    assert.match(m3uCacheSource, /writtenCounts\.vod = committedCounts\.vod/);
    assert.match(m3uCacheSource, /writtenCounts\.series = committedCounts\.series/);
    assert.match(m3uCacheSource, /outcome: "success"/);
  });

  await scenario("unsafe M3U refs fail fast on the first rejection", () => {
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
      "path-shape": 0,
      "query-present": 0,
      "kind-mismatch": 0,
      "missing-extension": 0,
      "credential-path-mismatch": 0,
    });
    assert.deepEqual(projection.scan, {
      scanTotalCandidateCount: 6,
      scanInspectedCount: 1,
      scanTruncated: true,
      firstRejectKind: "live",
      firstRejectReason: "origin-mismatch",
    });
    assert.match(writeProjectionSource, /if \(!inspection\.ref\) return reject\("live", inspection\.reason\)/);
  });

  await scenario("M3U write telemetry is counter-only and contains no URL or credential values", () => {
    const output = formatM3UCacheWriteMeasurement({
      kind: "m3u-cache-write",
      startedAt: 1,
      m3u: {
        cacheAfter: { rawCounts: { live: 9, vod: 8, series: 7 }, syncPhase: "error" },
        write: {
          writeAttempted: true,
          writeOutcome: "unsafe-live-ref",
          writeMs: 42,
          writeInputCounts: { live: 10, vod: 8, series: 7 },
          writeSafeCounts: { live: 9, vod: 0, series: 0 },
          writeWrittenCounts: { live: 0, vod: 0, series: 0 },
          writeRejectCounts: { ...zeroRejects(), "credential-path-mismatch": 1 },
          scan: {
            scanTotalCandidateCount: 25,
            scanInspectedCount: 10,
            scanTruncated: true,
            firstRejectKind: "live",
            firstRejectReason: "credential-path-mismatch",
          },
          cleanupOutcome: "error",
          cleanupStage: "delete-catalog",
        },
      },
    });
    assert.match(output, /m3u\.writeRejectCounts\.credential-path-mismatch=1/);
    assert.match(output, /m3u\.scanInspectedCount=10/);
    assert.match(output, /m3u\.scanTruncated=true/);
    assert.match(output, /m3u\.cleanupOutcome=error/);
    assert.match(output, /m3u\.cleanupStage=delete-catalog/);
    assert.doesNotMatch(output, /https?:\/\/|get\.php|alice|swordfish|secret\.example|username\s*[=:]|password\s*[=:]|token\s*[=:]|host\s*[=:]/i);
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

  await scenario("cooperative hydration and write projection remain mandatory", () => {
    assert.match(hydrationSource, /M3U_HYDRATION_BATCH_SIZE = 200/);
    assert.match(hydrationSource, /buildM3UDirectHydrationCooperatively/);
    assert.match(m3uCacheSource, /buildM3UCacheWriteProjectionCooperatively\(provider, loaded, \{\s*batchSize: 200,\s*yieldFn: yieldToUi/s);
    assert.match(writeProjectionSource, /yieldFn/);
  });

  assert.equal(passed, 24);
  console.log("provider switch UX scenarios: 24/24 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
