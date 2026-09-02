import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (path: string) => {
  const target = resolve(ROOT, path);
  return existsSync(target) ? readFileSync(target, "utf8") : "";
};

const screenSource = readSource("components/OptimizedHomeScreenV6.tsx");
const playerSource = readSource("context/PlayerContext.tsx");
const catalogCacheSource = readSource("lib/catalogCache.ts");
const catalogRuntimeSource = readSource("lib/catalogRuntime.ts");
const repositorySource = readSource("lib/catalogPageRepository.ts");
const pagingSource = readSource("lib/catalogPaging.ts");
const providerSwitchSource = readSource("lib/providerSwitchCache.ts");
const m3uCacheSource = readSource("lib/m3uCatalogCache.ts");
const m3uHydrationSource = readSource("lib/m3uCatalogHydration.ts");
const xtreamSource = readSource("lib/xtreamCatalog.ts");
const videoPlayerSource = readSource("components/CompatibilityVideoPlayerV2.tsx");
const packageSource = readSource("package.json");

let pagingModule: typeof import("../lib/catalogPaging") | null = null;
try {
  pagingModule = await import("../lib/catalogPaging");
} catch {
  pagingModule = null;
}

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

function paging() {
  assert.ok(pagingModule, "catalogPaging module must exist");
  return pagingModule;
}

type SqlPlan = {
  countSql: string;
  countArgs: Array<string | number>;
  pageSql: string;
  pageArgs: Array<string | number>;
};

type PageRow = Record<string, string | number | null>;

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
    namePrefix: string,
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
        `${namePrefix} ${String(index).padStart(5, "0")}`,
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

function runPlan(plan: SqlPlan) {
  const db = fixtureDb();
  const countRow = db.prepare(plan.countSql).get(...plan.countArgs) as { count: number } | undefined;
  const rows = db.prepare(plan.pageSql).all(...plan.pageArgs) as PageRow[];
  return { count: Number(countRow?.count ?? 0), rows };
}

function request(
  kind: "live" | "vod" | "series",
  overrides: Record<string, unknown> = {},
) {
  return {
    providerId: "provider-a",
    providerType: "m3u" as const,
    kind,
    sort: "default" as const,
    limit: 100,
    ...overrides,
  };
}

function cursorAfter(
  req: ReturnType<typeof request>,
  rows: PageRow[],
  previousCursor?: string,
) {
  const module = paging();
  assert.ok(rows.length > 0);
  return module.catalogPageCursorFromRow(req, rows[rows.length - 1], previousCursor);
}

async function main() {
  await scenario("total count is independent from loaded page length for VOD, Series and Live", () => {
    const module = paging();
    assert.equal(module.resolveCatalogTotalCount({ persistedTotal: 8_400, persistedCountKnown: true, snapshotTotal: 100, snapshotCountKnown: true }), 8_400);
    assert.equal(module.resolveCatalogTotalCount({ persistedTotal: 8_779, persistedCountKnown: true, snapshotTotal: 100, snapshotCountKnown: true }), 8_779);
    assert.equal(module.resolveCatalogTotalCount({ persistedTotal: 12_116, persistedCountKnown: true, snapshotTotal: 48, snapshotCountKnown: true }), 12_116);
    assert.doesNotMatch(screenSource, /setHomeVodCount\(items\.length\)|setHomeSeriesCount\(items\.length\)/);
  });

  await scenario("unknown count remains unknown instead of displaying a false zero", () => {
    const module = paging();
    assert.equal(module.resolveCatalogTotalCount({ persistedTotal: 0, persistedCountKnown: false, snapshotTotal: 0, snapshotCountKnown: false }), null);
    assert.equal(module.resolveCatalogTotalCount({ persistedTotal: 0, persistedCountKnown: true, snapshotTotal: null, snapshotCountKnown: false }), 0);
    assert.match(screenSource, /countKnown/);
  });

  await scenario("M3U Movies first-open query is bounded to 100 rows while count stays 8400", () => {
    const module = paging();
    const plan = module.buildCatalogPageSql(request("vod"));
    const result = runPlan(plan);
    assert.equal(result.count, 8_400);
    assert.equal(result.rows.length, 100);
    assert.equal(module.DEFAULT_CATALOG_PAGE_SIZE, 100);
    assert.ok(module.normalizeCatalogPageLimit(10_000) <= module.MAX_CATALOG_PAGE_SIZE);
  });

  await scenario("M3U Series first-open query is bounded to 100 top-level rows", () => {
    const module = paging();
    const plan = module.buildCatalogPageSql(request("series"));
    const result = runPlan(plan);
    assert.equal(result.count, 8_779);
    assert.equal(result.rows.length, 100);
    assert.match(plan.pageSql, /NULL AS payload/i, "Series list page must not deserialize episode payloads");
  });

  await scenario("M3U Live first-open query is bounded to 100 rows", () => {
    const module = paging();
    const plan = module.buildCatalogPageSql(request("live"));
    const result = runPlan(plan);
    assert.equal(result.count, 12_116);
    assert.equal(result.rows.length, 100);
  });

  await scenario("keyset next-page loading returns 100 then 200 without duplicate or skip", () => {
    const module = paging();
    const firstRequest = request("vod");
    const firstPlan = module.buildCatalogPageSql(firstRequest);
    const first = runPlan(firstPlan).rows;
    assert.equal(first.length, 100);
    const cursor = cursorAfter(firstRequest, first);
    const secondRequest = request("vod", { cursor });
    const second = runPlan(module.buildCatalogPageSql(secondRequest)).rows;
    assert.equal(second.length, 100);
    const combined = [...first, ...second].map((row) => String(row.item_id));
    assert.equal(new Set(combined).size, 200);
    assert.equal(combined.length, 200);
    assert.doesNotMatch(module.buildCatalogPageSql(secondRequest).pageSql, /\bOFFSET\b/i);
  });

  await scenario("repeated load-more triggers are single-flight for the same page", () => {
    const module = paging();
    const guard = new module.CatalogPageFlightGuard();
    const key = "provider-a|vod|default|page-2";
    assert.equal(guard.tryStart(key), true);
    assert.equal(guard.tryStart(key), false);
    guard.finish(key);
    assert.equal(guard.tryStart(key), true);
  });

  await scenario("category paging keeps category-specific count and cursor constraints", () => {
    const module = paging();
    const firstRequest = request("vod", { categoryId: "cat-a" });
    const first = runPlan(module.buildCatalogPageSql(firstRequest));
    assert.equal(first.count, 4_200);
    assert.equal(first.rows.length, 100);
    assert.ok(first.rows.every((row) => row.category_id === "cat-a"));
    const cursor = cursorAfter(firstRequest, first.rows);
    const second = runPlan(module.buildCatalogPageSql(request("vod", { categoryId: "cat-a", cursor })));
    assert.ok(second.rows.every((row) => row.category_id === "cat-a"));
    assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.item_id)).size, 200);
  });

  await scenario("search is SQL-paged, resets cursor identity and never requires full hydration", () => {
    const module = paging();
    const defaultRequest = request("vod");
    const firstRows = runPlan(module.buildCatalogPageSql(defaultRequest)).rows;
    const staleCursor = cursorAfter(defaultRequest, firstRows);
    const searchRequest = request("vod", { search: "Movie 00" });
    const searched = runPlan(module.buildCatalogPageSql(searchRequest));
    assert.ok(searched.count > 100 && searched.count < 8_400);
    assert.equal(searched.rows.length, 100);
    assert.ok(searched.rows.every((row) => String(row.name).toLowerCase().includes("movie 00")));
    assert.throws(() => module.buildCatalogPageSql(request("vod", { search: "Movie 00", cursor: staleCursor })), /cursor/i);
    assert.doesNotMatch(screenSource, /const rows = items\.filter\([\s\S]*sortCatalogRows\(/s);
  });

  await scenario("sort changes reset cursor identity and ordering is executed in SQL", () => {
    const module = paging();
    const defaultRequest = request("vod");
    const firstRows = runPlan(module.buildCatalogPageSql(defaultRequest)).rows;
    const staleCursor = cursorAfter(defaultRequest, firstRows);
    const alpha = runPlan(module.buildCatalogPageSql(request("vod", { sort: "alphaAsc" })));
    assert.equal(alpha.rows[0]?.name, "Movie 00001");
    const idDesc = runPlan(module.buildCatalogPageSql(request("vod", { sort: "idDesc" })));
    assert.equal(String(idDesc.rows[0]?.item_id), "8400");
    assert.throws(() => module.buildCatalogPageSql(request("vod", { sort: "alphaAsc", cursor: staleCursor })), /cursor/i);
    assert.doesNotMatch(screenSource, /sortCatalogRows\(rows/);
  });

  await scenario("provider id is part of cursor/query identity and pages never leak across providers", () => {
    const module = paging();
    const providerA = request("vod");
    const rowsA = runPlan(module.buildCatalogPageSql(providerA)).rows;
    const cursorA = cursorAfter(providerA, rowsA);
    assert.throws(
      () => module.buildCatalogPageSql(request("vod", { providerId: "provider-b", cursor: cursorA })),
      /cursor/i,
    );
    const providerB = runPlan(module.buildCatalogPageSql(request("vod", { providerId: "provider-b" })));
    assert.equal(providerB.count, 3);
    assert.ok(providerB.rows.every((row) => row.provider_id === "provider-b"));
  });

  await scenario("M3U provider-switch preview remains max 48 per kind and never installs a partial global catalog", () => {
    assert.match(providerSwitchSource, /initialLimit:\s*HOME_SAMPLE_LIMIT/);
    assert.match(providerSwitchSource, /const HOME_SAMPLE_LIMIT = 48/);
    assert.match(m3uCacheSource, /if \(options\.initialLimit === undefined\)\s*\{\s*installM3UCatalog\(provider\.id, direct\.catalog\);\s*\}/s);
    assert.match(m3uCacheSource, /counts:\s*cacheRawCounts/);
  });

  await scenario("Xtream cached screens page from persisted SQLite without inventing server pagination", () => {
    assert.match(repositorySource, /getCachedCatalogPage/);
    assert.doesNotMatch(repositorySource, /getVodStreams|getSeries\(/);
    assert.match(screenSource, /loadCatalogKindPage/);
    assert.doesNotMatch(screenSource, /getCachedVodItems\(provider, categoryId\)|getCachedSeriesItems\(provider, categoryId\)/);
    assert.match(catalogRuntimeSource, /CatalogPage/);
  });

  await scenario("Xtream transport query semantics remain category-only with no page limit or offset parameters", () => {
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

  await scenario("paged playback keeps VOD play, lazy M3U Series details and bounded Live navigation", () => {
    assert.match(screenSource, /buildVodStreamUrl\(credentials, item\)/);
    assert.match(screenSource, /loadM3USeriesInfoFromCache/);
    const openSeriesStart = screenSource.indexOf("const openSeries = async");
    const playEpisodeStart = screenSource.indexOf("const playEpisode", openSeriesStart);
    assert.ok(openSeriesStart >= 0 && playEpisodeStart > openSeriesStart);
    assert.doesNotMatch(screenSource.slice(openSeriesStart, playEpisodeStart), /getM3UCatalog\(/);
    assert.match(videoPlayerSource, /getCachedLivePlaybackWindow/);
    assert.doesNotMatch(videoPlayerSource, /getCachedLiveItems\(provider\)/);
  });

  await scenario("catalog screen entry never calls full-kind M3U hydration and Live never falls back to global getM3UCatalog", () => {
    assert.doesNotMatch(screenSource, /hydrateM3UProviderKindCache\(/);
    const liveStart = screenSource.indexOf("const applyLocalLive");
    const liveEnd = screenSource.indexOf("const tryCatalogFallbackToM3U", liveStart);
    if (liveStart >= 0 && liveEnd > liveStart) {
      assert.doesNotMatch(screenSource.slice(liveStart, liveEnd), /getM3UCatalog\(/);
    }
    assert.match(providerSwitchSource, /hydrateM3UProviderCache\([\s\S]*initialLimit:\s*HOME_SAMPLE_LIMIT/);
  });

  await scenario("existing cooperative M3U ingest and hydration invariants remain wired", () => {
    assert.match(m3uHydrationSource, /buildM3UDirectHydrationCooperatively/);
    assert.match(m3uHydrationSource, /M3U_HYDRATION_BATCH_SIZE = 200/);
    assert.match(m3uCacheSource, /buildM3UCacheWriteProjectionCooperatively\([\s\S]*batchSize:\s*200[\s\S]*yieldFn:\s*yieldToUi/s);
    assert.match(packageSource, /m3uHydrationYieldScenarios\.ts/);
  });

  await scenario("cold-start active M3U hydration is bounded and cannot reinstall the full runtime catalog", () => {
    assert.match(
      playerSource,
      /hydrateM3UProviderCache\(provider,\s*\{\s*initialLimit:\s*48\s*\}\)/s,
    );
    assert.doesNotMatch(playerSource, /const cached = await hydrateM3UProviderCache\(provider\);/);
    assert.match(catalogCacheSource, /getCatalogCounts/);
    assert.match(pagingSource, /MAX_CATALOG_PAGE_SIZE/);
  });

  if (failed > 0) {
    throw new Error(`catalog paging scenarios: ${passed}/18 passed, ${failed} failed`);
  }
  assert.equal(passed, 18);
  console.log("catalog paging scenarios: 18/18 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
