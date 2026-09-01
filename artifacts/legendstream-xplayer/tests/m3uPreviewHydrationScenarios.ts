import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheSource = readFileSync(resolve(ROOT, "lib/m3uCatalogCache.ts"), "utf8");
const switchSource = readFileSync(resolve(ROOT, "lib/providerSwitchCache.ts"), "utf8");
const screenSource = readFileSync(resolve(ROOT, "components/OptimizedHomeScreenV6.tsx"), "utf8");
const navigationSource = readFileSync(resolve(ROOT, "lib/catalogTabNavigation.ts"), "utf8");

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

function block(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `start marker missing: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `end marker missing after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

async function main() {
  await scenario("M3U provider switch requests only a 48-row preview for every catalog kind", () => {
    assert.match(
      switchSource,
      /hydrateM3UProviderCache\(provider as any,\s*\{\s*initialLimit:\s*HOME_SAMPLE_LIMIT\s*\}\)/,
    );
    const hydrationBlock = block(
      cacheSource,
      "export async function hydrateM3UProviderCache(",
      "async function readWriteCacheState(",
    );
    assert.match(hydrationBlock, /options:\s*\{\s*initialLimit\?:\s*number\s*\}\s*=\s*\{\}/);
    for (const kind of ["live", "vod", "series"] as const) {
      assert.match(
        hydrationBlock,
        new RegExp(`getCachedPersistedItems\\(provider\\.id,\\s*"${kind}",\\s*undefined,\\s*options\\.initialLimit\\)`),
      );
    }
  });

  await scenario("preview hydration preserves full SQLite counts separately from hydrated row counts", () => {
    const hydrationBlock = block(
      cacheSource,
      "export async function hydrateM3UProviderCache(",
      "async function readWriteCacheState(",
    );
    assert.match(hydrationBlock, /counts:\s*cacheRawCounts/);
    assert.match(hydrationBlock, /hydratedCounts:\s*direct\.counts/);
    assert.match(switchSource, /counts:\s*cached\.counts/);
  });

  await scenario("preview hydration is explicit and never overwrites the global full M3U catalog", () => {
    const hydrationBlock = block(
      cacheSource,
      "export async function hydrateM3UProviderCache(",
      "async function readWriteCacheState(",
    );
    assert.match(hydrationBlock, /scope:\s*options\.initialLimit === undefined \? "full" : "preview"/);
    assert.match(
      hydrationBlock,
      /if \(options\.initialLimit === undefined\)\s*\{\s*installM3UCatalog\(provider\.id, direct\.catalog\);\s*\}/s,
    );
    assert.match(switchSource, /scope:\s*cached\.scope/);
  });

  await scenario("M3U Movies Series and Live first-open loaders hydrate only the requested full kind", () => {
    assert.match(cacheSource, /export async function hydrateM3UProviderKindCache\(/);
    const kindBlock = block(
      cacheSource,
      "export async function hydrateM3UProviderKindCache(",
      "async function readWriteCacheState(",
    );
    assert.match(kindBlock, /getCachedPersistedItems\(provider\.id, kind\)/);
    assert.match(kindBlock, /buildM3UDirectHydrationCooperatively\(/);
    assert.match(kindBlock, /yieldFn:\s*yieldToUi/);

    const vodBlock = block(screenSource, "const applyLocalVod = async () =>", "const applyLocalSeries = async () =>");
    const seriesBlock = block(screenSource, "const applyLocalSeries = async () =>", "const applyLocalLive = async () =>");
    const liveBlock = block(screenSource, "const applyLocalLive = async () =>", "const tryCatalogFallbackToM3U");
    assert.match(vodBlock, /hydrateM3UProviderKindCache\(provider as any,\s*"vod"\)/);
    assert.match(seriesBlock, /hydrateM3UProviderKindCache\(provider as any,\s*"series"\)/);
    assert.match(liveBlock, /hydrateM3UProviderKindCache\(provider as any,\s*"live"\)/);
    assert.doesNotMatch(vodBlock, /getM3UCatalog\(/);
    assert.doesNotMatch(seriesBlock, /getM3UCatalog\(/);
  });

  await scenario("preview state does not make Movies or Series look fully loaded and navigation is not count-gated", () => {
    const effectBlock = block(
      screenSource,
      "const prepared = provider && preparedSwitchRef.current?.snapshot.providerId === provider.id",
      "}, [provider?.id]);",
    );
    assert.match(effectBlock, /const previewOnly = preparedSnapshot\?\.scope === "preview"/);
    assert.match(effectBlock, /setVodLoaded\(Boolean\(preparedSnapshot && !previewOnly/);
    assert.match(effectBlock, /setSeriesLoaded\(Boolean\(preparedSnapshot && !previewOnly/);

    const localBranch = block(
      navigationSource,
      'if (options.providerType === "m3u") {',
      'if (options.providerType !== "xtream") return;',
    );
    assert.match(localBranch, /options\.target === "movies"[\s\S]*options\.loadLocalMovies\(\)/);
    assert.match(localBranch, /options\.target === "series"[\s\S]*options\.loadLocalSeries\(\)/);
    assert.match(localBranch, /options\.target === "live"[\s\S]*options\.loadLocalLive\(\)/);
    assert.doesNotMatch(localBranch, /m3uCatalogCounts/);
  });

  await scenario("15,994 VOD full hydration remains cooperative in 200-row batches", async () => {
    const hydration = await import("../lib/m3uCatalogHydration") as any;
    const provider = {
      id: "provider-large-vod",
      url: "https://panel.example/get.php?username=alice&password=swordfish&type=m3u_plus&output=ts",
    };
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
      {
        batchSize: 200,
        yieldFn: async () => { yieldCount += 1; },
      },
    );
    assert.equal(result.movies.length, 15_994);
    assert.equal(yieldCount, 158);
  });

  if (failed > 0) {
    throw new Error(`m3u preview hydration scenarios: ${passed}/6 passed, ${failed} failed`);
  }
  assert.equal(passed, 6);
  console.log("m3u preview hydration scenarios: 6/6 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
