import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  buildCatalogPageSql,
  catalogPageCursorFromRow,
  CatalogPageFlightGuard,
  DEFAULT_CATALOG_PAGE_SIZE,
  MAX_CATALOG_PAGE_SIZE,
  normalizeCatalogPageLimit,
  resolveCatalogTotalCount,
  resolveCatalogTotalCountUpdate,
  type CatalogPageRequest,
} from "../lib/catalogPaging";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const screenEntrySource = source("components/OptimizedHomeScreenV6.tsx");
const screenSource = source("components/OptimizedHomeScreenPaged.tsx");
const viewsSource = source("components/catalog/PagedCatalogViews.tsx");
const hookSource = source("hooks/useCatalogPage.ts");
const repositorySource = source("lib/catalogPageRepository.ts");
const providerSwitchSource = source("lib/providerSwitchCache.ts");
const m3uCacheSource = source("lib/m3uCatalogCache.ts");
const m3uHydrationSource = source("lib/m3uCatalogHydration.ts");
const xtreamSource = source("lib/xtreamCatalog.ts");
const videoPlayerSource = source("components/CompatibilityVideoPlayerV2.tsx");
const playerSource = source("context/PlayerContext.tsx");
const packageSource = source("package.json");

type SqlPlan = {
  countSql: string;
  countArgs: Array<string | number>;
  pageSql: string;
  pageArgs: Array<string | number>;
};
type PageRow = Record<string, string | number | null>;

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

let fixture: DatabaseSync | null = null;
function fixtureDb() {
  if (fixture) return fixture;
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE catalog_items (
      provider_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      item_id TEXT NOT NULL,
      category_id TEXT,
      name TEXT NOT NULL,
      image_url TEXT,
      payload TEXT NOT NULL,
      added_at INTEGER NOT NULL DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      is_new INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provider_id, kind, item_id)
    );
  `);
  const insert = db.prepare(`
    INSERT INTO catalog_items (
      provider_id, kind, item_id, category_id, name, image_url, payload,
      added_at, first_seen_at, last_seen_at, is_new
    ) VALUES (?, ?, ?, ?, ?, NULL, '{}', ?, ?, ?, 0)
  `);
  db.exec("BEGIN");
  const addRows = (
    providerId: string,
    kind: "live" | "vod" | "series",
    total: number,
    prefix: string,
  ) => {
    for (let index = 1; index <= total; index += 1) {
      const category = kind === "live"
        ? (index % 2 === 0 ? "News" : "Sports")
        : (index % 2 === 0 ? "cat-a" : "cat-b");
      insert.run(
        providerId,
        kind,
        String(index),
        category,
        `${prefix} ${String(index).padStart(5, "0")}`,
        kind === "live" ? 0 : index,
        1_700_000_000_000 + index,
        1_700_000_000_000 + index,
      );
    }
  };
  addRows("provider-a", "vod", 8_400, "Movie");
  addRows("provider-a", "series", 8_779, "Series");
  addRows("provider-a", "live", 12_116, "Live");
  addRows("provider-b", "vod", 3, "Other Movie");
  addRows("provider-b", "series", 2, "Other Series");
  addRows("provider-b", "live", 4, "Other Live");
  db.exec("COMMIT");
  fixture = db;
  return db;
}

function request(
  kind: "live" | "vod" | "series",
  overrides: Partial<CatalogPageRequest> = {},
): CatalogPageRequest {
  return {
    providerId: "provider-a",
    providerType: "m3u",
    kind,
    sort: "default",
    limit: 100,
    ...overrides,
  };
}

function runPlan(plan: SqlPlan) {
  const db = fixtureDb();
  const countRow = db.prepare(plan.countSql).get(...plan.countArgs) as { count: number } | undefined;
  const rows = db.prepare(plan.pageSql).all(...plan.pageArgs) as PageRow[];
  return { count: Number(countRow?.count ?? 0), rows };
}

function cursorAfter(req: CatalogPageRequest, rows: PageRow[], previousCursor?: string) {
  assert.ok(rows.length > 0);
  return catalogPageCursorFromRow(req, rows[rows.length - 1], previousCursor, rows.length);
}

async function main() {
  await scenario("total count is independent from loaded page length for VOD Series and Live", () => {
    assert.equal(resolveCatalogTotalCount({ persistedTotal: 8_400, persistedCountKnown: true, snapshotTotal: 100, snapshotCountKnown: true }), 8_400);
    assert.equal(resolveCatalogTotalCount({ persistedTotal: 8_779, persistedCountKnown: true, snapshotTotal: 48, snapshotCountKnown: true }), 8_779);
    assert.equal(resolveCatalogTotalCount({ persistedTotal: 12_116, persistedCountKnown: true, snapshotTotal: 100, snapshotCountKnown: true }), 12_116);
    assert.doesNotMatch(screenSource, /setHomeVodCount\(items\.length\)|setHomeSeriesCount\(items\.length\)/);
    assert.match(hookSource, /totalCount/);
    assert.match(hookSource, /countKnown/);
  });

  await scenario("unknown total stays nullable while verified empty catalog can be zero", () => {
    assert.equal(resolveCatalogTotalCount({ persistedTotal: 0, persistedCountKnown: false, snapshotTotal: 0, snapshotCountKnown: false }), null);
    assert.equal(resolveCatalogTotalCount({ persistedTotal: 0, persistedCountKnown: true, snapshotTotal: null, snapshotCountKnown: false }), 0);
    assert.match(viewsSource, /countKnown && totalCount !== null/);
  });

  await scenario("known total cannot be downgraded by a stale unknown page response", () => {
    assert.equal(resolveCatalogTotalCountUpdate({
      currentTotal: 8_400,
      currentCountKnown: true,
      persistedTotal: null,
      persistedCountKnown: false,
      snapshotTotal: null,
      snapshotCountKnown: false,
    }), 8_400);
    assert.equal(resolveCatalogTotalCountUpdate({
      currentTotal: 48,
      currentCountKnown: true,
      persistedTotal: 8_400,
      persistedCountKnown: true,
      snapshotTotal: 48,
      snapshotCountKnown: true,
    }), 8_400);
    assert.equal(resolveCatalogTotalCountUpdate({
      currentTotal: null,
      currentCountKnown: false,
      persistedTotal: null,
      persistedCountKnown: false,
      snapshotTotal: 8_400,
      snapshotCountKnown: true,
    }), 8_400);
    assert.match(hookSource, /resolveCatalogTotalCountUpdate/);
  });

  await scenario("M3U Series lazy detail drops stale provider or request generations", () => {
    assert.match(screenSource, /const activeProviderIdRef = useRef<string \| null>/);
    assert.match(screenSource, /const seriesRequestGenerationRef = useRef\(0\)/);
    assert.match(screenSource, /const requestProviderId = provider\.id;/);
    assert.match(screenSource, /const requestGeneration = \+\+seriesRequestGenerationRef\.current;/);
    const guards = screenSource.match(/if \(!isCurrentSeriesRequest\(requestProviderId, requestGeneration\)\) return;/g) ?? [];
    assert.ok(guards.length >= 3, "Series async success, queue publication, and error publication must all be stale-safe");
  });

  await scenario("M3U Movies first-open is count plus at most 100 rows", () => {
    const result = runPlan(buildCatalogPageSql(request("vod")));
    assert.equal(result.count, 8_400);
    assert.equal(result.rows.length, 100);
    assert.equal(DEFAULT_CATALOG_PAGE_SIZE, 100);
    assert.equal(MAX_CATALOG_PAGE_SIZE, 200);
    assert.equal(normalizeCatalogPageLimit(10_000), 200);
  });

  await scenario("M3U Series first-open is bounded and suppresses episode payloads", () => {
    const plan = buildCatalogPageSql(request("series"));
    const result = runPlan(plan);
    assert.equal(result.count, 8_779);
    assert.equal(result.rows.length, 100);
    assert.match(plan.pageSql, /NULL AS payload/i);
    assert.match(repositorySource, /persistedSeriesRow\(providerId: string, seriesId: string\)/);
  });

  await scenario("M3U Live first-open is count plus at most 100 rows", () => {
    const result = runPlan(buildCatalogPageSql(request("live")));
    assert.equal(result.count, 12_116);
    assert.equal(result.rows.length, 100);
  });

  await scenario("next page moves 100 to 200 without duplicate skip or OFFSET", () => {
    const firstRequest = request("vod");
    const first = runPlan(buildCatalogPageSql(firstRequest)).rows;
    const cursor = cursorAfter(firstRequest, first);
    const secondRequest = request("vod", { cursor });
    const secondPlan = buildCatalogPageSql(secondRequest);
    const second = runPlan(secondPlan).rows;
    assert.equal(first.length, 100);
    assert.equal(second.length, 100);
    const ids = [...first, ...second].map((row) => String(row.item_id));
    assert.equal(ids.length, 200);
    assert.equal(new Set(ids).size, 200);
    assert.doesNotMatch(secondPlan.pageSql, /\bOFFSET\b/i);
  });

  await scenario("repeated load-more is protected by single-flight", () => {
    const guard = new CatalogPageFlightGuard();
    assert.equal(guard.tryStart("same-page"), true);
    assert.equal(guard.tryStart("same-page"), false);
    guard.finish("same-page");
    assert.equal(guard.tryStart("same-page"), true);
    assert.match(hookSource, /CatalogPageFlightGuard/);
    assert.match(viewsSource, /onEndReached=\{page\.loadMore\}/);
  });

  await scenario("category count and pages keep the same category constraint", () => {
    const firstRequest = request("vod", { categoryId: "cat-a" });
    const first = runPlan(buildCatalogPageSql(firstRequest));
    assert.equal(first.count, 4_200);
    assert.equal(first.rows.length, 100);
    assert.ok(first.rows.every((row) => row.category_id === "cat-a"));
    const cursor = cursorAfter(firstRequest, first.rows);
    const second = runPlan(buildCatalogPageSql(request("vod", { categoryId: "cat-a", cursor })));
    assert.ok(second.rows.every((row) => row.category_id === "cat-a"));
    assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.item_id)).size, 200);
    assert.match(viewsSource, /getCachedCatalogCategories/);
  });

  await scenario("search is SQL-paged and stale pre-search cursor is rejected", () => {
    const initial = request("vod");
    const rows = runPlan(buildCatalogPageSql(initial)).rows;
    const staleCursor = cursorAfter(initial, rows);
    const searchedRequest = request("vod", { search: "Movie 00" });
    const searched = runPlan(buildCatalogPageSql(searchedRequest));
    assert.equal(searched.rows.length, 100);
    assert.ok(searched.count > 100 && searched.count < 8_400);
    assert.ok(searched.rows.every((row) => String(row.name).toLowerCase().includes("movie 00")));
    assert.throws(() => buildCatalogPageSql(request("vod", { search: "Movie 00", cursor: staleCursor })), /cursor/i);
    assert.doesNotMatch(viewsSource, /items\.filter\(/);
  });

  await scenario("sort is SQL-paged and stale pre-sort cursor is rejected", () => {
    const initial = request("vod");
    const rows = runPlan(buildCatalogPageSql(initial)).rows;
    const staleCursor = cursorAfter(initial, rows);
    const alpha = runPlan(buildCatalogPageSql(request("vod", { sort: "alphaAsc" })));
    const idDesc = runPlan(buildCatalogPageSql(request("vod", { sort: "idDesc" })));
    assert.equal(alpha.rows[0]?.name, "Movie 00001");
    assert.equal(String(idDesc.rows[0]?.item_id), "8400");
    assert.throws(() => buildCatalogPageSql(request("vod", { sort: "alphaAsc", cursor: staleCursor })), /cursor/i);
    assert.doesNotMatch(viewsSource, /sortCatalogRows/);
    assert.match(viewsSource, /supportsAdded=\{provider\.type === "xtream"\}/);
  });

  await scenario("provider identity is part of cursor and old provider cursor cannot leak", () => {
    const providerA = request("vod");
    const rowsA = runPlan(buildCatalogPageSql(providerA)).rows;
    const cursorA = cursorAfter(providerA, rowsA);
    assert.throws(() => buildCatalogPageSql(request("vod", { providerId: "provider-b", cursor: cursorA })), /cursor/i);
    const providerB = runPlan(buildCatalogPageSql(request("vod", { providerId: "provider-b" })));
    assert.equal(providerB.count, 3);
    assert.ok(providerB.rows.every((row) => row.provider_id === "provider-b"));
    assert.match(hookSource, /providerId/);
  });

  await scenario("M3U provider switch preview stays max 48 and cannot install partial global catalog", () => {
    assert.match(providerSwitchSource, /const HOME_SAMPLE_LIMIT = 48/);
    assert.match(providerSwitchSource, /hydrateM3UProviderCache\(provider\)/);
    assert.match(m3uCacheSource, /export const M3U_HOME_PREVIEW_LIMIT = 48/);
    assert.match(m3uCacheSource, /getCachedPersistedItems\(provider\.id, "vod", undefined, M3U_HOME_PREVIEW_LIMIT\)/);
    assert.doesNotMatch(m3uCacheSource, /installM3UCatalog|getM3UCatalog|installFullCatalog/);
  });

  await scenario("Xtream cached UI uses persisted page repository without server pagination assumptions", () => {
    assert.match(screenEntrySource, /OptimizedHomeScreenPaged/);
    assert.match(screenSource, /PagedMoviesCatalog/);
    assert.match(screenSource, /PagedSeriesCatalog/);
    assert.match(screenSource, /PagedLiveCatalog/);
    assert.match(hookSource, /getCachedCatalogPage/);
    assert.doesNotMatch(screenSource, /getCachedVodItems|getCachedSeriesItems|getCachedLiveItems/);
    assert.doesNotMatch(viewsSource, /getVodStreams|getSeries\(/);
  });

  await scenario("Xtream network API compatibility keeps category-only query semantics", () => {
    const vodStart = xtreamSource.indexOf("export async function getVodStreams(");
    const seriesStart = xtreamSource.indexOf("export async function getSeries(");
    const vodBlock = xtreamSource.slice(vodStart, seriesStart);
    const seriesEnd = xtreamSource.indexOf("function registerEpisodeQueue", seriesStart);
    const seriesBlock = xtreamSource.slice(seriesStart, seriesEnd);
    assert.ok(vodStart >= 0 && seriesStart > vodStart && seriesEnd > seriesStart);
    assert.match(vodBlock, /category_id:\s*categoryId/);
    assert.match(seriesBlock, /category_id:\s*categoryId/);
    assert.doesNotMatch(vodBlock, /\b(page|limit|offset)\s*:/i);
    assert.doesNotMatch(seriesBlock, /\b(page|limit|offset)\s*:/i);
  });

  await scenario("playback uses typed VOD identity lazy Series row and bounded Live VOD windows", () => {
    assert.match(screenSource, /vodIdentity:\s*\{ providerId: provider\.id, itemId: String\(item\.stream_id\) \}/);
    assert.match(screenSource, /vodIdentity=\{playable\.vodIdentity\}/);
    assert.match(screenSource, /loadM3USeriesInfoFromCache\(provider, item\.series_id\)/);
    assert.doesNotMatch(screenSource, /getM3UCatalog\(/);
    assert.match(videoPlayerSource, /getCachedLivePlaybackWindow/);
    assert.match(videoPlayerSource, /getCachedVodPlaybackWindow/);
    assert.doesNotMatch(videoPlayerSource, /getCachedLiveItems\(provider\)/);
  });

  await scenario("active catalog screen never invokes unbounded M3U full-kind hydration or global catalog", () => {
    assert.doesNotMatch(screenEntrySource, /hydrateM3UProviderKindCache|getM3UCatalog/);
    assert.doesNotMatch(screenSource, /hydrateM3UProviderKindCache|getM3UCatalog/);
    assert.doesNotMatch(viewsSource, /hydrateM3UProviderKindCache|getM3UCatalog/);
    assert.match(hookSource, /limit:\s*100/);
  });

  await scenario("existing cooperative M3U ingest and hydration invariants stay intact", () => {
    assert.match(m3uHydrationSource, /buildM3UDirectHydrationCooperatively/);
    assert.match(m3uHydrationSource, /M3U_HYDRATION_BATCH_SIZE = 200/);
    assert.match(m3uCacheSource, /buildM3UCacheWriteProjectionCooperatively\(provider, loaded, \{\s*batchSize: 200,\s*yieldFn: yieldToUi/s);
    assert.match(packageSource, /m3uHydrationYieldScenarios\.ts/);
  });

  await scenario("source guards prove count page search sort category and infinite scroll are page-owned", () => {
    const endReachedMatches = viewsSource.match(/onEndReached=\{page\.loadMore\}/g) ?? [];
    assert.equal(endReachedMatches.length, 3);
    assert.match(viewsSource, /categoryId:\s*category/);
    assert.match(hookSource, /queryKey/);
    assert.match(hookSource, /nextCursor/);
    assert.match(hookSource, /loadingInitial/);
    assert.match(hookSource, /loadingMore/);
    assert.match(hookSource, /hasMore/);
    assert.doesNotMatch(screenSource, /setHomeVodCount|setHomeSeriesCount/);
  });

  assert.equal(passed, 20);
  console.log("catalog paging scenarios: 20/20 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
