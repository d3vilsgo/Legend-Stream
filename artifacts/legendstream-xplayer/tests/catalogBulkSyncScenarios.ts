import fs from "node:fs";
import path from "node:path";
import { projectCatalogItem } from "../lib/catalogPersistence";
import { CATALOG_FALLBACK_CONCURRENCY, runCatalogFetchPlan } from "../lib/catalogSyncStrategy";

type Category = { category_id: string; category_name: string };
type Row = { id: number; category_id?: string };
type VodUnionRow = { stream_id: number; category_id?: string | null };

type PlanOptions = Parameters<typeof runCatalogFetchPlan<Row, Category>>[0];

const categories: Category[] = Array.from({ length: 12 }, (_, index) => ({
  category_id: String(index + 1),
  category_name: `Category ${index + 1}`,
}));

let passed = 0;
let unionPassed = 0;
const expect = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  passed += 1;
};
const unionExpect = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  unionPassed += 1;
};

const baseOptions = (overrides: Partial<PlanOptions> = {}): PlanOptions => ({
  categories,
  fetchBulk: async () => [{ id: 1, category_id: "1" }, { id: 2, category_id: "2" }, { id: 3, category_id: "3" }, { id: 4, category_id: "4" }, { id: 5, category_id: "5" }, { id: 6, category_id: "6" }],
  fetchCategory: async (category: Category) => [{ id: Number(category.category_id), category_id: category.category_id }],
  writeRows: async () => undefined,
  categoryIdOf: (row: Row) => row.category_id,
  ...overrides,
});

type VodUnionHarnessOptions = {
  bulkRows?: VodUnionRow[];
  categoryRows: Record<string, VodUnionRow[]>;
  bulkFails?: boolean;
  categoryAlwaysFails?: string;
};

async function runVodUnionHarness(options: VodUnionHarnessOptions) {
  const staging = new Map<string, VodUnionRow>();
  let active = new Map<string, VodUnionRow>([["99", { stream_id: 99, category_id: "old" }]]);
  let published = false;
  const categoryDefs = Object.keys(options.categoryRows).map((categoryId) => ({
    category_id: categoryId,
    category_name: `Category ${categoryId}`,
  }));

  try {
    await runCatalogFetchPlan<VodUnionRow, Category>({
      categories: categoryDefs,
      fetchBulk: async () => {
        if (options.bulkFails) throw new Error("bulk failed");
        return options.bulkRows ?? [];
      },
      fetchCategory: async (category) => {
        if (category.category_id === options.categoryAlwaysFails) {
          throw new Error("category verification failed");
        }
        return options.categoryRows[category.category_id] ?? [];
      },
      writeRows: async (rows) => {
        for (const row of rows) staging.set(String(row.stream_id), row);
      },
      categoryIdOf: (row) => row.category_id ?? undefined,
      forceCategoryFallback: true,
    });
    active = new Map(staging);
    published = true;
  } catch {
    // A failed verification must not publish staging over the old active catalog.
  }

  return {
    stagingIds: new Set(staging.keys()),
    activeIds: new Set(active.keys()),
    published,
  };
}

const sameIds = (actual: Set<string>, expected: string[]) =>
  actual.size === expected.length && expected.every((id) => actual.has(id));

async function main() {
  let categoryCalls = 0;
  const bulkSuccess = await runCatalogFetchPlan<Row, Category>(baseOptions({
    fetchCategory: async (category) => {
      categoryCalls += 1;
      return [{ id: Number(category.category_id), category_id: category.category_id }];
    },
  }));
  expect(bulkSuccess.path === "bulk" && categoryCalls === 0, "successful bulk must skip category requests entirely");

  categoryCalls = 0;
  const emptyBulk = await runCatalogFetchPlan<Row, Category>(baseOptions({
    fetchBulk: async () => [],
    fetchCategory: async (category) => {
      categoryCalls += 1;
      return [{ id: Number(category.category_id), category_id: category.category_id }];
    },
  }));
  expect(emptyBulk.path === "parallel" && emptyBulk.fallbackReason === "empty" && categoryCalls === categories.length, "empty bulk must enter parallel category fallback");

  categoryCalls = 0;
  const failedBulk = await runCatalogFetchPlan<Row, Category>(baseOptions({
    fetchBulk: async () => { throw new Error("bulk failed"); },
    fetchCategory: async (category) => {
      categoryCalls += 1;
      return [{ id: Number(category.category_id), category_id: category.category_id }];
    },
  }));
  expect(failedBulk.path === "parallel" && failedBulk.fallbackReason === "bulk-error" && categoryCalls === categories.length, "bulk error must enter parallel category fallback");

  const attempts = new Map<string, number>();
  const serialFallback = await runCatalogFetchPlan<Row, Category>(baseOptions({
    fetchBulk: async () => { throw new Error("bulk failed"); },
    fetchCategory: async (category) => {
      const attempt = (attempts.get(category.category_id) ?? 0) + 1;
      attempts.set(category.category_id, attempt);
      if (category.category_id === "1" && attempt === 1) throw new Error("parallel failed");
      return [{ id: Number(category.category_id), category_id: category.category_id }];
    },
  }));
  expect(serialFallback.path === "serial" && serialFallback.fallbackReason === "parallel-error" && (attempts.get("1") ?? 0) >= 2, "parallel failure must retry through the serial compatibility loop");

  let active = 0;
  let maxActive = 0;
  const concurrencyResult = await runCatalogFetchPlan<Row, Category>(baseOptions({
    fetchBulk: async () => [],
    fetchCategory: async (category) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active -= 1;
      return [{ id: Number(category.category_id), category_id: category.category_id }];
    },
  }));
  expect(concurrencyResult.path === "parallel" && maxActive <= CATALOG_FALLBACK_CONCURRENCY && maxActive === 6, "parallel fallback must never exceed the six-request concurrency ceiling");

  const contextSource = fs.readFileSync(path.join(process.cwd(), "context/CatalogSyncContext.tsx"), "utf8");
  const controller = new AbortController();
  let bulkAborted = false;
  const cancelledRun = runCatalogFetchPlan<Row, Category>(baseOptions({
    isCancelled: () => controller.signal.aborted,
    fetchBulk: async () => new Promise<Row[]>((_, reject) => {
      controller.signal.addEventListener("abort", () => {
        bulkAborted = true;
        reject(new Error("aborted"));
      }, { once: true });
    }),
  }));
  controller.abort();
  let cancelRejected = false;
  try { await cancelledRun; } catch { cancelRejected = true; }
  expect(
    bulkAborted && cancelRejected &&
    /getVodStreams\(\s*credentials,\s*undefined,\s*controller\.signal/.test(contextSource) &&
    /getSeries\(\s*credentials,\s*undefined,\s*controller\.signal/.test(contextSource),
    "Cancel must abort the active bulk request through the existing controller signal",
  );

  const vod = projectCatalogItem("provider-A", "vod", { stream_id: 7, name: "Movie", category_id: "42" });
  const series = projectCatalogItem("provider-A", "series", { series_id: 8, name: "Series", category_id: "84" });
  expect(
    vod?.catalogKind === "vod" && String(vod.category_id) === "42" &&
    series?.catalogKind === "series" && String(series.category_id) === "84",
    "bulk DTO projection must preserve item category_id for SQLite category assignment",
  );

  const bulkSuperset = await runVodUnionHarness({
    bulkRows: [1, 2, 3, 4].map((stream_id) => ({ stream_id, category_id: String(Math.min(stream_id, 3)) })),
    categoryRows: {
      "1": [{ stream_id: 1, category_id: "1" }],
      "2": [{ stream_id: 2, category_id: "2" }],
      "3": [{ stream_id: 3, category_id: "3" }],
    },
  });
  unionExpect(
    bulkSuperset.published && sameIds(bulkSuperset.activeIds, ["1", "2", "3", "4"]),
    "VOD union must preserve valid bulk-only stream IDs when category verification is a subset",
  );

  const categorySuperset = await runVodUnionHarness({
    bulkRows: [1, 2, 3].map((stream_id) => ({ stream_id, category_id: String(stream_id) })),
    categoryRows: {
      "1": [{ stream_id: 1, category_id: "1" }],
      "2": [{ stream_id: 2, category_id: "2" }],
      "3": [{ stream_id: 3, category_id: "3" }],
      "4": [{ stream_id: 4, category_id: "4" }],
    },
  });
  unionExpect(
    categorySuperset.published && sameIds(categorySuperset.activeIds, ["1", "2", "3", "4"]),
    "VOD union must preserve category-only stream IDs when category verification is a superset",
  );

  const uncategorizedBulk = await runVodUnionHarness({
    bulkRows: [
      { stream_id: 1, category_id: "1" },
      { stream_id: 2, category_id: "2" },
      { stream_id: 3, category_id: "3" },
      { stream_id: 4, category_id: null },
    ],
    categoryRows: {
      "1": [{ stream_id: 1, category_id: "1" }],
      "2": [{ stream_id: 2, category_id: "2" }],
      "3": [{ stream_id: 3, category_id: "3" }],
    },
  });
  unionExpect(
    uncategorizedBulk.published && sameIds(uncategorizedBulk.activeIds, ["1", "2", "3", "4"]),
    "VOD union must retain a valid uncategorized bulk stream in the All view set",
  );

  const duplicateAcrossSources = await runVodUnionHarness({
    bulkRows: [
      { stream_id: 1, category_id: "1" },
      { stream_id: 2, category_id: "2" },
    ],
    categoryRows: {
      "1": [{ stream_id: 1, category_id: "1" }, { stream_id: 2, category_id: "1" }],
      "2": [{ stream_id: 2, category_id: "2" }, { stream_id: 3, category_id: "2" }],
    },
  });
  unionExpect(
    duplicateAcrossSources.published && sameIds(duplicateAcrossSources.activeIds, ["1", "2", "3"]),
    "VOD union must dedupe repeated bulk/category identities by stream_id",
  );

  const failedVerification = await runVodUnionHarness({
    bulkRows: [
      { stream_id: 1, category_id: "1" },
      { stream_id: 2, category_id: "2" },
    ],
    categoryRows: {
      "1": [{ stream_id: 1, category_id: "1" }],
      "2": [{ stream_id: 2, category_id: "2" }],
    },
    categoryAlwaysFails: "2",
  });
  unionExpect(
    !failedVerification.published && sameIds(failedVerification.activeIds, ["99"]),
    "failed VOD category verification must not publish partial staging over the old active cache",
  );

  const bulkFailureFallback = await runVodUnionHarness({
    bulkFails: true,
    categoryRows: {
      "1": [{ stream_id: 1, category_id: "1" }],
      "2": [{ stream_id: 2, category_id: "2" }],
      "3": [{ stream_id: 3, category_id: "3" }],
    },
  });
  unionExpect(
    bulkFailureFallback.published && sameIds(bulkFailureFallback.activeIds, ["1", "2", "3"]),
    "bulk failure must retain the existing category-only fallback publish behavior",
  );

  process.stdout.write(`catalog bulk sync scenarios: ${passed}/7 passed\n`);
  process.stdout.write(`xtream vod union scenarios: ${unionPassed}/6 passed\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});