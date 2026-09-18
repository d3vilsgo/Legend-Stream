import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const screenSource = source("components/OptimizedHomeScreenPaged.tsx");
const hookSource = source("hooks/useCatalogPage.ts");
const repositorySource = source("lib/catalogPageRepository.ts");
const iptvSource = source("lib/iptv.ts");
const m3uCacheSource = source("lib/m3uCatalogCache.ts");
const projectionSource = source("lib/m3uCacheWriteProjection.ts");
const persistenceSource = source("lib/catalogPersistence.ts");

let passed = 0;
let failed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    passed += 1;
    console.log(`ok ${passed + failed} - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok ${passed + failed} - ${name}`);
    console.error(error);
  }
}

async function main() {
  const hydration = await import("../lib/m3uCatalogHydration") as any;
  assert.equal(typeof hydration.buildM3UDirectHydrationCooperatively, "function");
  const provider = {
    id: "provider-large",
    url: "https://panel.example/get.php?username=alice&password=swordfish&type=m3u_plus&output=ts",
  };

  await scenario("8,001 live rows yield exactly between 200-row hydration batches", async () => {
    const liveRows = Array.from({ length: 8_001 }, (_, index) => ({
      schemaVersion: 1,
      catalogKind: "live",
      id: `live-${index}`,
      providerId: provider.id,
      name: `Live ${index}`,
      category: "Live",
      playbackRef: {
        type: "m3u-path",
        kind: "live",
        streamId: String(index + 1),
        containerExtension: "ts",
      },
    }));
    let yieldCount = 0;
    const result = await hydration.buildM3UDirectHydrationCooperatively(
      provider,
      liveRows,
      [],
      [],
      { batchSize: 200, yieldFn: async () => { yieldCount += 1; } },
    );
    assert.equal(result.counts.live, 8_001);
    assert.equal(yieldCount, 40);
  });

  await scenario("15,994 VOD rows retain the two-pass cooperative yield contract", async () => {
    const vodRows = Array.from({ length: 15_994 }, (_, index) => ({
      schemaVersion: 1,
      catalogKind: "vod",
      id: `vod-${index}`,
      providerId: provider.id,
      stream_id: String(index + 1),
      name: `Movie ${index}`,
      category_id: "Movies",
      container_extension: "mp4",
      playbackRef: {
        type: "m3u-path",
        kind: "movie",
        streamId: String(index + 1),
        containerExtension: "mp4",
      },
    }));
    let yieldCount = 0;
    const result = await hydration.buildM3UDirectHydrationCooperatively(
      provider,
      [],
      vodRows,
      [],
      { batchSize: 200, yieldFn: async () => { yieldCount += 1; } },
    );
    assert.equal(result.counts.vod, 15_994);
    assert.equal(result.movies.length, 15_994);
    assert.equal(yieldCount, 158);
  });

  await scenario("post-first-paint M3U ingest and every cache projection pass remain cooperative", () => {
    assert.match(iptvSource, /async function buildM3UCatalogCooperatively\(/);
    assert.match(iptvSource, /await buildM3UCatalogCooperatively\(entries, providerId,[\s\S]*batchSize:\s*200[\s\S]*yieldFn:\s*yieldToUi/);
    assert.match(projectionSource, /export async function buildM3UCacheWriteProjectionCooperatively\(/);
    assert.match(m3uCacheSource, /await buildM3UCacheWriteProjectionCooperatively\(provider, loaded,[\s\S]*batchSize:\s*200[\s\S]*yieldFn:\s*yieldToUi/);
    assert.match(persistenceSource, /export async function projectCatalogItemsCooperatively\(/);
    assert.equal((m3uCacheSource.match(/projectCatalogItemsCooperatively\(stagingProviderId,/g) ?? []).length, 3);
    assert.doesNotMatch(m3uCacheSource, /\bprojectCatalogItems\(provider\.id/);
    assert.doesNotMatch(m3uCacheSource, /const staged(?:Live|Vod|Series) = persisted(?:Live|Vod|Series)\.map/);
  });

  await scenario("catalog first-open pages persisted rows instead of hydrating a full M3U kind", () => {
    assert.match(screenSource, /PagedLiveCatalog/);
    assert.match(screenSource, /PagedMoviesCatalog/);
    assert.match(screenSource, /PagedSeriesCatalog/);
    assert.match(hookSource, /limit:\s*100/);
    assert.match(hookSource, /getCachedCatalogPage\(provider, request\)/);
    assert.match(repositorySource, /plan\.pageSql/);
    assert.doesNotMatch(screenSource, /hydrateM3UProviderKindCache|applyLocalVod|applyLocalSeries|applyLocalLive/);
  });

  await scenario("M3U Home navigation stays provider-independent while background persistence is running", () => {
    const navigateStart = screenSource.indexOf("const navigate = (target: ContentView) => {");
    const navigateEnd = screenSource.indexOf("\n  };", navigateStart);
    assert.ok(navigateStart >= 0 && navigateEnd > navigateStart);
    const navigateBlock = screenSource.slice(navigateStart, navigateEnd);
    assert.match(navigateBlock, /setView\(target\)/);
    assert.doesNotMatch(navigateBlock, /provider\.type|isLoading|isSyncing|isRefreshing|busy|disabled/);
    assert.match(screenSource, /nav\.map\(\(item\) => <FocusButton[\s\S]*onPress=\{\(\) => navigate\(item\.key\)\}/);
    assert.doesNotMatch(screenSource, /nav\.map\(\(item\) => <FocusButton[^>]*disabled=/);
    for (const target of ["live", "movies", "series", "history", "downloads", "settings"]) {
      assert.match(screenSource, new RegExp(`key: "${target}" as const`));
    }
    assert.match(screenSource, /view === "live" && \(provider\.type === "m3u" \|\| provider\.type === "xtream"\)/);
    assert.match(screenSource, /view === "movies" && \(provider\.type === "m3u" \|\| provider\.type === "xtream"\)/);
    assert.match(screenSource, /view === "series" && \(provider\.type === "m3u" \|\| provider\.type === "xtream"\)/);
    assert.match(screenSource, /view === "history" \? <HistoryView/);
    assert.match(screenSource, /view === "downloads" \? <DownloadsView/);
    assert.match(screenSource, /view === "settings" \? <Settings/);
  });

  if (failed > 0) throw new Error("m3u hydration yield scenarios failed");
  assert.equal(passed, 5);
  console.log("m3u hydration yield scenarios: 5/5 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
