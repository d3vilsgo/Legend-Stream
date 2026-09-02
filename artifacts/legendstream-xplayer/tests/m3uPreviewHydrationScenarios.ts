import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const cacheSource = source("lib/m3uCatalogCache.ts");
const switchSource = source("lib/providerSwitchCache.ts");
const screenSource = source("components/OptimizedHomeScreenPaged.tsx");
const viewsSource = source("components/catalog/PagedCatalogViews.tsx");
const hookSource = source("hooks/useCatalogPage.ts");
const repositorySource = source("lib/catalogPageRepository.ts");
const pagingSource = source("lib/catalogPaging.ts");
const playerSource = source("context/PlayerContext.tsx");
const iptvSource = source("lib/iptv.ts");
const projectionSource = source("lib/m3uCacheWriteProjection.ts");

let passed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function main() {
  await scenario("M3U provider switch reads at most the 48-row Home preview for every kind", () => {
    assert.match(cacheSource, /export const M3U_HOME_PREVIEW_LIMIT = 48/);
    for (const kind of ["live", "vod", "series"] as const) {
      assert.match(
        cacheSource,
        new RegExp(`getCachedPersistedItems\\(provider\\.id,\\s*"${kind}",\\s*undefined,\\s*M3U_HOME_PREVIEW_LIMIT\\)`),
      );
    }
    assert.match(switchSource, /const HOME_SAMPLE_LIMIT = 48/);
    assert.match(switchSource, /hydrateM3UProviderCache\(provider\)/);
    assert.match(switchSource, /cached\.movies\.slice\(0, HOME_SAMPLE_LIMIT\)/);
    assert.match(switchSource, /cached\.series\.slice\(0, HOME_SAMPLE_LIMIT\)/);
  });

  await scenario("persisted full counts stay separate from preview row counts", () => {
    assert.match(cacheSource, /getCatalogCounts\(provider\.id\)/);
    assert.match(cacheSource, /counts:\s*cacheRawCounts/);
    assert.match(cacheSource, /hydratedCounts:\s*direct\.counts/);
    assert.match(switchSource, /counts:\s*cached\.counts/);
  });

  await scenario("M3U preview never installs or exposes a partial global full catalog", () => {
    assert.doesNotMatch(cacheSource, /installM3UCatalog|getM3UCatalog|installFullCatalog/);
    assert.match(cacheSource, /scope:\s*"preview"/);
    assert.match(switchSource, /scope:\s*cached\.scope/);
  });

  await scenario("Movies Series and Live first-open never run full-kind hydration", () => {
    for (const activeSource of [screenSource, viewsSource]) {
      assert.doesNotMatch(
        activeSource,
        /hydrateM3UProviderKindCache|getM3UCatalog|applyLocalVod|applyLocalSeries|applyLocalLive|preparedSwitchRef/,
      );
    }
    assert.match(viewsSource, /useCatalogPage\(/);
    assert.match(hookSource, /getCachedCatalogPage\(provider, request\)/);
  });

  await scenario("first-open uses persisted paging with a 100-row page and 200-row hard max", () => {
    assert.match(hookSource, /limit:\s*100/);
    assert.match(pagingSource, /DEFAULT_CATALOG_PAGE_SIZE = 100/);
    assert.match(pagingSource, /MAX_CATALOG_PAGE_SIZE = 200/);
    assert.match(repositorySource, /plan\.pageSql/);
    assert.doesNotMatch(repositorySource, /getCachedPersistedItems\(provider\.id,\s*request\.kind\)/);
  });

  await scenario("catalog navigation is independent of any full catalog count", () => {
    const navigateStart = screenSource.indexOf("const navigate = (target: ContentView) => {");
    const navigateEnd = screenSource.indexOf("\n  };", navigateStart);
    assert.ok(navigateStart >= 0 && navigateEnd > navigateStart);
    const navigateBlock = screenSource.slice(navigateStart, navigateEnd);
    assert.match(navigateBlock, /setView\(target\)/);
    assert.doesNotMatch(navigateBlock, /count|catalog|hydrate|load/);
    assert.match(viewsSource, /enabled:\s*providerType !== null/);
  });

  await scenario("active M3U cold start hydrates only the bounded preview", () => {
    assert.match(playerSource, /const cached = await hydrateM3UProviderCache\(provider\);/);
    assert.match(cacheSource, /M3U_HOME_PREVIEW_LIMIT/);
    assert.doesNotMatch(playerSource, /hydrateM3UProviderKindCache|installFullCatalog/);
  });

  await scenario("cooperative M3U ingest and hydration coverage remains wired", () => {
    assert.match(cacheSource, /buildM3UDirectHydrationCooperatively/);
    assert.match(cacheSource, /yieldFn:\s*yieldToUi/);
    assert.match(iptvSource, /async function buildM3UCatalogCooperatively\(/);
    assert.match(projectionSource, /buildM3UCacheWriteProjectionCooperatively/);
    assert.match(projectionSource, /options\.batchSize \?\? 200/);
  });

  assert.equal(passed, 8);
  console.log("m3u preview hydration scenarios: 8/8 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
