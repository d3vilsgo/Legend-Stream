import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIVE_ID_LOOKUP_CHUNK_SIZE,
  chunkLiveIdentityIds,
  normalizeLiveIdentityIds,
} from "../lib/catalogLiveIdentity";
import {
  LegacyCatalogFallbackAttemptGuard,
  shouldFallbackLegacyXtreamCatalogToM3U,
} from "../lib/legacyCatalogFallback";
import {
  clearCatalogCategoryMemoryForProvider,
  readCatalogCategorySelection,
  rememberCatalogCategorySelection,
  validateCatalogCategorySelection,
} from "../lib/catalogCategoryMemory";
import { XtreamCatalogError } from "../lib/xtreamCatalogErrors";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const screenSource = source("components/OptimizedHomeScreenPaged.tsx");
const stalkerSource = source("components/catalog/StalkerLiveCatalog.tsx");
const identityRepositorySource = source("lib/catalogLiveIdentityRepository.ts");
const categoryViewsSource = source("components/catalog/PagedCatalogViews.tsx");
const catalogPagingSource = source("lib/catalogPaging.ts");
const m3uCacheSource = source("lib/m3uCatalogCache.ts");
const providerSwitchSource = source("lib/providerSwitchCache.ts");
const providerSwitchTests = source("tests/providerSwitchScenarios.ts");
const catalogPagingTests = source("tests/catalogPagingScenarios.ts");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const legacyXtream = {
  type: "xtream" as const,
  url: "https://iptv.example/get.php?username=alice&password=swordfish&type=m3u_plus&output=ts",
  playlistUrl: "https://iptv.example/get.php?username=alice&password=swordfish&type=m3u_plus&output=ts",
};

async function main() {
  await scenario("Stalker Live delegates to the persisted PagedLive catalog path", () => {
    assert.match(screenSource, /provider\.type === "stalker"[\s\S]*StalkerLiveCatalog/s);
    assert.match(stalkerSource, /PagedLiveCatalog/);
    assert.match(stalkerSource, /refreshCatalog/);
    assert.doesNotMatch(stalkerSource, /channels\.filter|visible = useMemo|FlatList/);
    assert.match(categoryViewsSource, /type === "stalker"/);
    assert.match(catalogPagingSource, /"m3u" \| "xtream" \| "stalker"/);
  });

  await scenario("M3U and Xtream Live remain on the persisted paged path", () => {
    assert.match(screenSource, /provider\.type === "m3u" \|\| provider\.type === "xtream"/);
    assert.match(screenSource, /PagedLiveCatalog/);
    assert.match(catalogPagingSource, /DEFAULT_CATALOG_PAGE_SIZE = 100/);
    assert.match(catalogPagingSource, /MAX_CATALOG_PAGE_SIZE = 200/);
  });

  await scenario("live identity normalization deduplicates without truncating valid requested ids", () => {
    const expected = Array.from({ length: 650 }, (_, index) => `live-${index}`);
    const ids = ["  ", ` ${expected[0]} `, ...expected.slice(1), "live-1", ""];
    const normalized = normalizeLiveIdentityIds(ids);
    assert.equal(normalized.length, 650);
    assert.deepEqual(normalized, expected);
    assert.equal(normalized[0], "live-0");
    assert.equal(normalized[1], "live-1");
    assert.equal(normalized.at(-1), "live-649");
    assert.equal(new Set(normalized).size, normalized.length);
  });

  await scenario("live identity lookup chunks stay below SQLite bind limits", () => {
    const ids = Array.from({ length: 450 }, (_, index) => `live-${index}`);
    const chunks = chunkLiveIdentityIds(ids);
    assert.equal(LIVE_ID_LOOKUP_CHUNK_SIZE, 200);
    assert.deepEqual(chunks.map((chunk) => chunk.length), [200, 200, 50]);
    assert.ok(chunks.every((chunk) => chunk.length <= LIVE_ID_LOOKUP_CHUNK_SIZE));
  });

  await scenario("history and favorites resolve ids outside the 48-row Home preview without full Live hydration", () => {
    const requested = normalizeLiveIdentityIds(["live-6400", "live-9000"]);
    assert.deepEqual(requested, ["live-6400", "live-9000"]);
    assert.match(identityRepositorySource, /provider_id = \?/);
    assert.match(identityRepositorySource, /kind = 'live'/);
    assert.match(identityRepositorySource, /item_id IN/);
    assert.match(identityRepositorySource, /normalizeLiveIdentityIds/);
    assert.doesNotMatch(identityRepositorySource, /getCachedLiveItems\(|SELECT[\s\S]*FROM catalog_items[\s\S]*kind = 'live'[\s\S]*ORDER BY/s);
    assert.match(
      screenSource,
      /const fullHistoryIdentityIds[\s\S]*view === "history" \? \[\.\.\.history, \.\.\.favorites\] : \[\][\s\S]*const resolvedFullHistoryIdentityChannels = useResolvedLiveIdentityChannels/s,
    );
  });

  await scenario("persisted live identity lookup remains provider-isolated and input-order preserving", () => {
    assert.match(identityRepositorySource, /provider\.id/);
    assert.match(identityRepositorySource, /new Map/);
    assert.match(identityRepositorySource, /requestedIds\.map/);
    assert.match(identityRepositorySource, /provider\.type !== "stalker"/);
  });

  await scenario("recognized legacy Xtream catalog-format failure allows exactly-once M3U migration", () => {
    const error = new XtreamCatalogError("UNSUPPORTED_RESPONSE", "unsupported catalog");
    assert.equal(shouldFallbackLegacyXtreamCatalogToM3U(legacyXtream, error), true);
    const guard = new LegacyCatalogFallbackAttemptGuard();
    assert.equal(guard.tryStart("provider-a"), true);
    assert.equal(guard.tryStart("provider-a"), false);
  });

  await scenario("auth network and timeout Xtream failures never trigger M3U migration", () => {
    assert.equal(shouldFallbackLegacyXtreamCatalogToM3U(legacyXtream, new XtreamCatalogError("HTTP_ERROR", "401", 401)), false);
    assert.equal(shouldFallbackLegacyXtreamCatalogToM3U(legacyXtream, new XtreamCatalogError("TIMEOUT", "timeout")), false);
    assert.equal(shouldFallbackLegacyXtreamCatalogToM3U(legacyXtream, new XtreamCatalogError("UNREACHABLE", "offline")), false);
  });

  await scenario("normal Xtream and already-M3U providers never enter compatibility migration", () => {
    const formatError = new XtreamCatalogError("INVALID_RESPONSE", "invalid json");
    assert.equal(shouldFallbackLegacyXtreamCatalogToM3U({ type: "xtream", url: "https://iptv.example" }, formatError), false);
    assert.equal(shouldFallbackLegacyXtreamCatalogToM3U({ ...legacyXtream, type: "m3u" }, formatError), false);
  });

  await scenario("legacy fallback continuation remains persisted-page bounded", () => {
    assert.match(screenSource, /recoverLegacyCatalogFallback/);
    assert.match(screenSource, /PagedMoviesCatalog/);
    assert.match(screenSource, /PagedSeriesCatalog/);
    assert.doesNotMatch(screenSource, /getM3UCatalog|hydrateM3UProviderKindCache|applyLocalVod|applyLocalSeries/);
    assert.match(catalogPagingSource, /DEFAULT_CATALOG_PAGE_SIZE = 100/);
  });

  await scenario("category selection memory is isolated by provider and kind and validates removed categories", () => {
    clearCatalogCategoryMemoryForProvider("provider-a");
    clearCatalogCategoryMemoryForProvider("provider-b");
    rememberCatalogCategorySelection("provider-a", "vod", "42");
    rememberCatalogCategorySelection("provider-a", "series", "7");
    rememberCatalogCategorySelection("provider-b", "vod", "99");
    assert.equal(readCatalogCategorySelection("provider-a", "vod"), "42");
    assert.equal(readCatalogCategorySelection("provider-a", "series"), "7");
    assert.equal(readCatalogCategorySelection("provider-b", "vod"), "99");
    assert.equal(validateCatalogCategorySelection("provider-a", "vod", ["42", "43"]), "42");
    assert.equal(validateCatalogCategorySelection("provider-a", "vod", ["43"]), "__all__");
    assert.match(categoryViewsSource, /readCatalogCategorySelection/);
    assert.match(categoryViewsSource, /rememberCatalogCategorySelection/);
  });

  await scenario("existing fail-closed and bounded hydration gates remain exact", () => {
    assert.match(providerSwitchTests, /assert\.equal\(passed, 24\)/);
    assert.match(providerSwitchTests, /provider switch UX scenarios: 24\/24 passed/);
    assert.match(catalogPagingTests, /assert\.equal\(passed, 20\)/);
    assert.match(catalogPagingTests, /catalog paging scenarios: 20\/20 passed/);
    assert.match(providerSwitchSource, /HOME_SAMPLE_LIMIT = 48/);
    assert.match(m3uCacheSource, /M3U_HOME_PREVIEW_LIMIT = 48/);
  });

  assert.equal(passed, 12);
  console.log("catalog parity scenarios: 12/12 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
