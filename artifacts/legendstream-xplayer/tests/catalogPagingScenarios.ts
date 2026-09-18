import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  buildCatalogPageSql,
  catalogPageCursorFromRow,
  catalogPageQueryKey,
  CatalogPageFlightGuard,
  DEFAULT_CATALOG_PAGE_SIZE,
  LIVE_CATEGORIES_WITH_NAMES_SQL,
  LIVE_CATEGORY_FIRST_SEEN_SQL,
  MAX_CATALOG_PAGE_SIZE,
  normalizeCatalogPageLimit,
  normalizeCatalogSearchText,
  resolveLiveCategoryDisplayName,
  resolveCatalogTotalCount,
  resolveCatalogTotalCountUpdate,
  type CatalogPageRequest,
} from "../lib/catalogPaging";
import { shouldUseWholeCatalogLoadingSkeleton } from "../lib/catalogSearchPresentation";
import { searchStalkerVodCatalog } from "../lib/stalkerVod";
import { createStalkerSeriesProductController, searchStalkerSeriesCatalog } from "../lib/stalkerSeriesProduct";

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
const xtreamClientSource = source("lib/xtream/client.ts");
const videoPlayerSource = source("components/CompatibilityVideoPlayerV2.tsx");
const playerSource = source("context/PlayerContext.tsx");
const packageSource = source("package.json");
const moviesSearchSource = source("hooks/useStalkerMoviesCatalog.ts");
const goldenMoviesSource = source("components/stalker/StalkerGoldenMoviesCatalog.tsx");
const seriesSearchSource = source("components/stalker/StalkerSeriesProductSurface.tsx");

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
  ["Ulusal", "Haber", "Ulusal", "Spor", "DE", "USA", "__all__"].forEach((category, index) => {
    insert.run(
      "provider-order",
      "live",
      String(index + 1),
      category,
      `Ordered Live ${index + 1}`,
      0,
      1_700_000_100_000 + index,
      1_700_000_100_000 + index,
    );
  });
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

    const ordered = fixtureDb()
      .prepare(LIVE_CATEGORY_FIRST_SEEN_SQL)
      .all("provider-order") as Array<{ category_id: string }>;
    assert.deepEqual(ordered.map((row) => row.category_id), ["Ulusal", "Haber", "Spor", "DE", "USA"]);
    assert.equal(new Set(ordered.map((row) => row.category_id)).size, ordered.length);
    assert.ok(ordered.every((row) => row.category_id !== "__all__"));
    assert.match(LIVE_CATEGORY_FIRST_SEEN_SQL, /MIN\(rowid\)[\s\S]*GROUP BY category_id/i);
    assert.doesNotMatch(LIVE_CATEGORY_FIRST_SEEN_SQL, /COLLATE NOCASE/i);
    assert.match(repositorySource, /LIVE_CATEGORY_FIRST_SEEN_SQL/);
    assert.match(viewsSource, /providerGlobal \? String\(providerGlobal\.category_id\) : "__all__"/);
    assert.match(viewsSource, /return options\.filter\(\(item, index\) => index === 0 \|\| !isStalkerLiveGlobalCategory/);

    const providerB = fixtureDb()
      .prepare(LIVE_CATEGORY_FIRST_SEEN_SQL)
      .all("provider-b") as Array<{ category_id: string }>;
    assert.deepEqual(providerB.map((row) => row.category_id), ["Sports", "News"]);
  });

  await scenario("Live drawer reads provider names without losing provider category order", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE catalog_items (
        provider_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL,
        category_id TEXT, name TEXT NOT NULL, PRIMARY KEY (provider_id, kind, item_id)
      );
      CREATE TABLE catalog_categories (
        provider_id TEXT NOT NULL, kind TEXT NOT NULL, category_id TEXT NOT NULL,
        category_name TEXT NOT NULL, PRIMARY KEY (provider_id, kind, category_id)
      );
      INSERT INTO catalog_items VALUES
        ('stalker-a', 'live', '1', '234', 'First channel'),
        ('stalker-a', 'live', '2', '229', 'Second channel'),
        ('stalker-a', 'live', '3', '830', 'Third channel');
      INSERT INTO catalog_categories VALUES
        ('stalker-a', 'live', '229', 'DE | SKY SPORT'),
        ('stalker-a', 'live', '830', 'US | SPORTS'),
        ('stalker-a', 'live', '234', 'TR | ULUSAL');
    `);
    const rows = db.prepare(LIVE_CATEGORIES_WITH_NAMES_SQL).all(
      "stalker-a",
      "stalker-a",
    ) as Array<{ category_id: string; category_name: string | null }>;
    const displayed = rows.map((row) => ({
      id: row.category_id,
      name: resolveLiveCategoryDisplayName(row.category_id, row.category_name),
    }));
    assert.deepEqual(displayed, [
      { id: "229", name: "DE | SKY SPORT" },
      { id: "830", name: "US | SPORTS" },
      { id: "234", name: "TR | ULUSAL" },
    ]);
    assert.equal(displayed.some((category) => category.name === category.id), false);
    assert.equal(resolveLiveCategoryDisplayName("558", null), "Kategori");
    assert.equal(resolveLiveCategoryDisplayName("Sports", null), "Sports");
    assert.match(repositorySource, /persisted\.playbackRef\.type === "stalker-live"/);
    assert.match(repositorySource, /if \(!stalkerLive\)[\s\S]*LIVE_CATEGORY_FIRST_SEEN_SQL/);
    assert.match(repositorySource, /category_name: resolveLiveCategoryDisplayName\(row\.category_id, row\.category_name\)/);
    assert.match(viewsSource, /providerGlobal \? String\(providerGlobal\.category_id\) : "__all__"/);
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
    assert.match(vodBlock, /run\.client\.getVodStreams\(\s*categoryId,/s);
    assert.match(seriesBlock, /run\.client\.getSeries\(\s*categoryId,/s);
    assert.match(xtreamClientSource, /request\("get_vod_streams", \{ category_id: categoryId \}/);
    assert.match(xtreamClientSource, /request\("get_series", \{ category_id: categoryId \}/);
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
    const liveStart = viewsSource.indexOf("export function PagedLiveCatalog");
    const moviesStart = viewsSource.indexOf("export function PagedMoviesCatalog");
    const goldenSeriesStart = viewsSource.indexOf("export function GoldenSeriesCatalog");
    const pagedSeriesStart = viewsSource.indexOf("export function PagedSeriesCatalog");
    assert.ok(liveStart >= 0 && moviesStart > liveStart);
    assert.ok(goldenSeriesStart > moviesStart && pagedSeriesStart > goldenSeriesStart);

    const liveSource = viewsSource.slice(liveStart, moviesStart);
    const moviesSource = viewsSource.slice(moviesStart, goldenSeriesStart);
    const goldenSeriesSource = viewsSource.slice(goldenSeriesStart, pagedSeriesStart);
    const pagedSeriesSource = viewsSource.slice(pagedSeriesStart);

    assert.match(liveSource, /onScrollBeginDrag=\{\(\) => \{[\s\S]*liveUserScrolledRef\.current = true/);
    assert.match(liveSource, /onEndReached=\{\(\) => \{[\s\S]*if \(liveUserScrolledRef\.current\) page\.loadMore\(\)/);
    assert.match(moviesSource, /onEndReached=\{page\.loadMore\}/);
    assert.match(pagedSeriesSource, /onLoadMore=\{page\.loadMore\}/);
    assert.match(goldenSeriesSource, /onEndReached=\{onLoadMore\}/);
    assert.match(viewsSource, /categoryId:\s*category/);
    assert.match(hookSource, /queryKey/);
    assert.match(hookSource, /nextCursor/);
    assert.match(hookSource, /loadingInitial/);
    assert.match(hookSource, /loadingMore/);
    assert.match(hookSource, /hasMore/);
    assert.doesNotMatch(screenSource, /setHomeVodCount|setHomeSeriesCount/);
  });

  await scenario("cross-provider persisted search covers M3U and Xtream Live Movies and Series", () => {
    const configs = [
      { providerType: "m3u" as const, kind: "live" as const, prefix: "Live", categoryId: "Sports", targetId: "1001" },
      { providerType: "m3u" as const, kind: "vod" as const, prefix: "Movie", categoryId: "cat-b", targetId: "1001" },
      { providerType: "m3u" as const, kind: "series" as const, prefix: "Series", categoryId: "cat-b", targetId: "1001" },
      { providerType: "xtream" as const, kind: "live" as const, prefix: "Live", categoryId: "Sports", targetId: "1001" },
      { providerType: "xtream" as const, kind: "vod" as const, prefix: "Movie", categoryId: "cat-b", targetId: "1001" },
      { providerType: "xtream" as const, kind: "series" as const, prefix: "Series", categoryId: "cat-b", targetId: "1001" },
    ];
    for (const config of configs) {
      const searchedRequest = request(config.kind, {
        providerType: config.providerType,
        categoryId: config.categoryId,
        search: `${config.prefix} 01001`,
      });
      const searched = runPlan(buildCatalogPageSql(searchedRequest));
      assert.equal(searched.count, 1, `${config.providerType}/${config.kind} should search beyond page one`);
      assert.equal(String(searched.rows[0]?.item_id), config.targetId);
      assert.ok(searched.rows.every((row) => row.category_id === config.categoryId));

      const broad = request(config.kind, {
        providerType: config.providerType,
        categoryId: config.categoryId,
        search: `${config.prefix} 0`,
      });
      const first = runPlan(buildCatalogPageSql(broad));
      assert.equal(first.rows.length, 100);
      const cursor = cursorAfter(broad, first.rows);
      const second = runPlan(buildCatalogPageSql({ ...broad, cursor }));
      assert.ok(second.rows.length > 0);
      assert.ok(second.rows.every((row) => row.category_id === config.categoryId));
      assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.item_id)).size, first.rows.length + second.rows.length);

      const unfilteredRequest = request(config.kind, {
        providerType: config.providerType,
        categoryId: config.categoryId,
      });
      const unfiltered = runPlan(buildCatalogPageSql(unfilteredRequest));
      assert.equal(unfiltered.rows.length, 100, `${config.providerType}/${config.kind} clear-search should restore category page one`);
      assert.equal(runPlan(buildCatalogPageSql(request(config.kind, {
        providerType: config.providerType,
        categoryId: config.categoryId,
        search: "__no_such_title__",
      }))).count, 0);

      const staleCursor = cursorAfter(unfilteredRequest, unfiltered.rows);
      assert.throws(() => buildCatalogPageSql({ ...searchedRequest, cursor: staleCursor }), /cursor/i);
      assert.notEqual(
        catalogPageQueryKey({ ...searchedRequest, search: "show" }),
        catalogPageQueryKey({ ...searchedRequest, search: "show tv" }),
      );
      assert.notEqual(
        catalogPageQueryKey({ ...searchedRequest, search: "show tv" }),
        catalogPageQueryKey({ ...searchedRequest, search: "" }),
      );
    }
    assert.equal(normalizeCatalogSearchText("I İ Ğ Ü Ş Ö Ç"), "ı i ğ ü ş ö ç");
    assert.equal(shouldUseWholeCatalogLoadingSkeleton(true, 0, ""), true);
    assert.equal(shouldUseWholeCatalogLoadingSkeleton(true, 0, "show"), false);
    assert.equal(shouldUseWholeCatalogLoadingSkeleton(true, 3, ""), false);
    const liveStart = viewsSource.indexOf("export function PagedLiveCatalog");
    const moviesStart = viewsSource.indexOf("export function PagedMoviesCatalog");
    const goldenSeriesStart = viewsSource.indexOf("export function GoldenSeriesCatalog");
    const pagedSeriesStart = viewsSource.indexOf("export function PagedSeriesCatalog");
    const liveSource = viewsSource.slice(liveStart, moviesStart);
    const moviesSource = viewsSource.slice(moviesStart, goldenSeriesStart);
    const goldenSeriesSource = viewsSource.slice(goldenSeriesStart, pagedSeriesStart);
    assert.match(liveSource, /shouldUseWholeCatalogLoadingSkeleton\(page\.loadingInitial, page\.items\.length, search\)/);
    assert.match(moviesSource, /shouldUseWholeCatalogLoadingSkeleton\(page\.loadingInitial, page\.items\.length, search\)/);
    assert.match(goldenSeriesSource, /shouldUseWholeCatalogLoadingSkeleton\(loadingInitial, items\.length, search\)/);
    assert.match(goldenMoviesSource, /shouldUseWholeCatalogLoadingSkeleton\(catalog\.loadingInitial, catalog\.visibleItems\.length, catalog\.search\)/);
  });

  await scenario("Stalker Live search resolves from complete persisted catalog without changing normal lazy paging", () => {
    const searched = runPlan(buildCatalogPageSql(request("live", {
      providerType: "stalker",
      categoryId: "Sports",
      search: "Live 01001",
    })));
    assert.equal(searched.count, 1);
    assert.equal(String(searched.rows[0]?.item_id), "1001");
    assert.match(hookSource, /stalkerPersistedSearch = stalkerLive && Boolean\(request\.search\?\.trim\(\)\)/);
    assert.match(hookSource, /stalkerLive && !stalkerPersistedSearch[\s\S]*getStalkerLazyLivePage[\s\S]*getCachedCatalogPage/);
    assert.match(hookSource, /isStalkerLiveGlobalCategoryId\(categoryId\)[\s\S]*\? undefined/);
    assert.match(repositorySource, /provider\.type === "stalker" && request\.kind === "live"/);
    assert.match(hookSource, /activeQueryKeyRef\.current !== requestQueryKey/);
  });

  await scenario("Stalker Movies search is category-scoped paged stale-safe and Turkish-aware", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const session = {
      async request(params: Record<string, unknown>) {
        calls.push({ ...params });
        const page = Number(params.p);
        const category = String(params.category);
        const title = page === 2 ? "İZMİR ŞAMPİYON" : "Başka Film";
        return {
          total_items: 2,
          max_page_items: 1,
          cur_page: page,
          data: [{ id: `${category}-${page}`, name: title, cmd: `ffmpeg http://example.invalid/${category}/${page}`, category_id: category }],
        };
      },
    };
    const categories = [{ id: "*", title: "All" }, { id: "7", title: "Spor" }, { id: "8", title: "Drama" }];
    const progress: string[][] = [];
    const result = await searchStalkerVodCatalog(session, categories, "izmir şampiyon", {
      categoryId: "7",
      onProgress: (items) => progress.push(items.map((item) => item.portalId)),
    });
    assert.deepEqual(result.map((item) => item.portalId), ["7-2"]);
    assert.deepEqual(progress, [[], ["7-2"]]);
    assert.deepEqual(calls.map((call) => [call.category, call.p]), [["7", 1], ["7", 2]]);
    assert.equal((await searchStalkerVodCatalog(session, categories, "bulunmayan", { categoryId: "7" })).length, 0);
    calls.length = 0;
    const globalResult = await searchStalkerVodCatalog(session, categories, "izmir şampiyon");
    assert.deepEqual(globalResult.map((item) => item.portalId), ["*-2"]);
    assert.deepEqual(calls.map((call) => call.category), ["*", "*"]);
    const staleAbort = new AbortController();
    calls.length = 0;
    await assert.rejects(() => searchStalkerVodCatalog(session, categories, "izmir", {
      categoryId: "7",
      signal: staleAbort.signal,
      onProgress: () => staleAbort.abort(),
    }), /aborted/i);
    assert.deepEqual(calls.map((call) => call.p), [1]);
    const selectStart = moviesSearchSource.indexOf("const selectCategory =");
    const selectEnd = moviesSearchSource.indexOf("const loadMore =", selectStart);
    assert.doesNotMatch(moviesSearchSource.slice(selectStart, selectEnd), /setSearch\(""\)/);
    assert.match(moviesSearchSource, /categoryId: selected\.id/);
    assert.match(moviesSearchSource, /searchWasActiveRef/);
    assert.match(moviesSearchSource, /sequence !== searchSequenceRef\.current/);
    assert.match(moviesSearchSource, /wasActive && selected[\s\S]*loadPage\(selected, 1, false\)/);
    assert.match(moviesSearchSource, /onProgress:[\s\S]*sequence !== searchSequenceRef\.current/);
  });

  await scenario("Stalker Series search is category-scoped paged stale-safe and Turkish-aware", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const session = {
      async handshake() { return { authenticated: true as const }; },
      async request(params: Record<string, unknown>) {
        calls.push({ ...params });
        if (params.action !== "get_ordered_list") return [];
        const page = Number(params.p);
        const category = String(params.category);
        return {
          total_items: 2,
          max_page_items: 1,
          cur_page: page,
          data: [{ id: `${category}-${page}`, name: page === 2 ? "İZMİR ŞAMPİYON" : "Başka Dizi", category_id: category }],
        };
      },
    };
    const controller = createStalkerSeriesProductController(session, "provider-search");
    const categories = [{ id: "*", title: "All" }, { id: "7", title: "Spor" }, { id: "8", title: "Drama" }];
    const progress: string[][] = [];
    const result = await searchStalkerSeriesCatalog(
      controller,
      categories,
      "izmir şampiyon",
      undefined,
      "7",
      (items) => progress.push(items.map((item) => item.id)),
    );
    assert.deepEqual(result.map((item) => item.id), ["7-2"]);
    assert.deepEqual(progress, [[], ["7-2"]]);
    assert.deepEqual(calls.map((call) => [call.category, call.p]), [["7", 1], ["7", 2]]);
    assert.equal((await searchStalkerSeriesCatalog(controller, categories, "bulunmayan", undefined, "7")).length, 0);
    calls.length = 0;
    const globalResult = await searchStalkerSeriesCatalog(controller, categories, "izmir şampiyon");
    assert.deepEqual(globalResult.map((item) => item.id), ["*-2"]);
    assert.deepEqual(calls.map((call) => call.category), ["*", "*"]);
    const staleAbort = new AbortController();
    calls.length = 0;
    await assert.rejects(() => searchStalkerSeriesCatalog(
      controller,
      categories,
      "izmir",
      staleAbort.signal,
      "7",
      () => staleAbort.abort(),
    ), /aborted/i);
    assert.deepEqual(calls.map((call) => call.p), [1]);
    const selectStart = seriesSearchSource.indexOf("const selectCategoryById =");
    const selectEnd = seriesSearchSource.indexOf("useEffect(() => {", selectStart);
    assert.doesNotMatch(seriesSearchSource.slice(selectStart, selectEnd), /setSearchQuery\(""\)/);
    assert.match(seriesSearchSource, /searchStalkerSeriesCatalog\(controller, categories, query, abort\.signal, selectedCategory\.id\)/);
    assert.match(seriesSearchSource, /searchWasActiveRef/);
    assert.match(seriesSearchSource, /searchSequence\.current !== sequence/);
    assert.match(seriesSearchSource, /wasActive && selectedCategory[\s\S]*loadPage\(selectedCategory, 1, false\)/);
    assert.match(seriesSearchSource, /searchStalkerSeriesCatalog\([\s\S]*setSearchResults\(\[\.\.\.results\]\)/);
  });

  assert.equal(passed, 25);
  console.log("catalog paging scenarios: 25/25 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
