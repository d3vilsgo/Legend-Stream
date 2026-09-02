import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { toXtreamCategoryId } from "../lib/catalogCategory";
import {
  buildCatalogPageSql,
  catalogPageCursorFromRow,
  catalogPageQueryKey,
  type CatalogPageRequest,
} from "../lib/catalogPaging";

const viewsSource = readFileSync(
  resolve(process.cwd(), "components/catalog/PagedCatalogViews.tsx"),
  "utf8",
);
const hookSource = readFileSync(
  resolve(process.cwd(), "hooks/useCatalogPage.ts"),
  "utf8",
);
const syncSource = readFileSync(
  resolve(process.cwd(), "context/CatalogSyncContext.tsx"),
  "utf8",
);

type PageRow = Record<string, string | number | null>;

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
for (const [kind, rows] of [
  ["vod", [["1", "17"], ["2", "18"], ["3", "17"]]],
  ["series", [["11", "17"], ["12", "18"], ["13", "17"]]],
] as const) {
  for (const [itemId, categoryId] of rows) {
    const order = Number(itemId);
    insert.run(
      "provider-a",
      kind,
      itemId,
      categoryId,
      `${kind}-${itemId}`,
      order,
      1_700_000_000_000 + order,
      1_700_000_000_000 + order,
    );
  }
}

function request(
  kind: "vod" | "series",
  categoryId: string,
  overrides: Partial<CatalogPageRequest> = {},
): CatalogPageRequest {
  return {
    providerId: "provider-a",
    providerType: "xtream",
    kind,
    categoryId,
    sort: "default",
    limit: 2,
    ...overrides,
  };
}

function execute(req: CatalogPageRequest) {
  const plan = buildCatalogPageSql(req);
  const count = db.prepare(plan.countSql).get(...plan.countArgs) as { count: number } | undefined;
  const rows = db.prepare(plan.pageSql).all(...plan.pageArgs) as PageRow[];
  return { plan, count: Number(count?.count ?? 0), rows };
}

const movieStart = viewsSource.indexOf("export function PagedMoviesCatalog");
const seriesStart = viewsSource.indexOf("export function PagedSeriesCatalog");
assert.ok(movieStart >= 0 && seriesStart > movieStart, "paged Movies and Series owners must exist");
const moviesBlock = viewsSource.slice(movieStart, seriesStart);
const seriesBlock = viewsSource.slice(seriesStart);

const EXPECTED = 8;
let passed = 0;
const scenario = (name: string, run: () => void) => {
  run();
  passed += 1;
  process.stdout.write(`PASS [catalog-category] ${name}\n`);
};

scenario("All-category VOD query omits the persisted category predicate", () => {
  const result = execute(request("vod", "__all__", { limit: 100 }));
  assert.equal(result.count, 3);
  assert.equal(result.rows.length, 3);
  assert.doesNotMatch(result.plan.countSql, /category_id\s*=\s*\?/i);
  assert.doesNotMatch(result.plan.pageSql, /category_id\s*=\s*\?/i);
  assert.equal(result.plan.countArgs.includes("__all__"), false);
  assert.equal(result.plan.pageArgs.includes("__all__"), false);
});

scenario("real VOD category ID is preserved by persisted count and page filtering", () => {
  const result = execute(request("vod", "17", { limit: 100 }));
  assert.equal(result.count, 2);
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every((row) => row.category_id === "17"));
  assert.ok(result.plan.countArgs.includes("17"));
});

scenario("real Series category ID is preserved by persisted count and page filtering", () => {
  const result = execute(request("series", "17", { limit: 100 }));
  assert.equal(result.count, 2);
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every((row) => row.category_id === "17"));
  assert.ok(result.plan.countArgs.includes("17"));
});

scenario("All sentinel is never emitted as an Xtream category_id", () => {
  assert.equal(toXtreamCategoryId("__all__"), undefined);
  assert.match(syncSource, /getVodStreams\(\s*credentials,\s*undefined,\s*controller\.signal/s);
  assert.match(syncSource, /getSeries\(\s*credentials,\s*undefined,\s*controller\.signal/s);
  assert.doesNotMatch(syncSource, /get(?:VodStreams|Series)\([^)]*["']__all__["']/s);
});

scenario("real category ID survives Xtream conversion and ingest category fallback", () => {
  assert.equal(toXtreamCategoryId("17"), "17");
  assert.match(
    syncSource,
    /fetchCategory:\s*\(category\)\s*=>\s*getVodStreams\(credentials, category\.category_id, controller\.signal\)/,
  );
  assert.match(
    syncSource,
    /fetchCategory:\s*\(category\)\s*=>\s*getSeries\(credentials, category\.category_id, controller\.signal\)/,
  );
});

scenario("category change creates a distinct paging identity and rejects the stale cursor", () => {
  const allRequest = request("vod", "__all__");
  const first = execute(allRequest);
  assert.equal(first.rows.length, 2);
  const staleCursor = catalogPageCursorFromRow(
    allRequest,
    first.rows[first.rows.length - 1],
    undefined,
    first.rows.length,
  );
  const categoryRequest = request("vod", "17");
  assert.notEqual(catalogPageQueryKey(allRequest), catalogPageQueryKey(categoryRequest));
  assert.throws(
    () => buildCatalogPageSql({ ...categoryRequest, cursor: staleCursor }),
    /cursor does not match the current request/i,
  );
  assert.match(hookSource, /generationRef\.current \+= 1/);
  assert.match(hookSource, /generationRef\.current !== generation/);
});

scenario("manual refresh re-ingests then re-reads the current category page", () => {
  assert.match(syncSource, /const refreshCatalog = useCallback\(async \(\) => \{\s*await runSync\("manual"\);/s);
  for (const block of [moviesBlock, seriesBlock]) {
    assert.match(block, /Promise\.resolve\(onRefresh\(\)\)\.finally\(\(\) => \{\s*reloadCategories\(\);\s*page\.reload\(\);/s);
    assert.doesNotMatch(block, /setCategory\(["']__all__["']\)/);
  }
});

scenario("empty persisted catalog is owned by sync ingest, not direct UI Xtream fallback", () => {
  assert.match(syncSource, /if \(!usable && state\?\.phase !== "ready"\) \{\s*await runSync\("initial"\);/s);
  assert.match(syncSource, /runCatalogFetchPlan<XtreamVodItem/);
  assert.match(syncSource, /runCatalogFetchPlan<XtreamSeriesItem/);
  assert.match(hookSource, /getCachedCatalogPage\(provider, request\)/);
  assert.doesNotMatch(viewsSource, /\bgetVodStreams\b|\bgetSeries\s*\(/);
});

assert.equal(passed, EXPECTED);
process.stdout.write("catalog category fallback scenarios: 8/8 passed\n");
