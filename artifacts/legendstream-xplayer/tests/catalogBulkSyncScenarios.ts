import fs from "node:fs";
import path from "node:path";
import { projectCatalogItem } from "../lib/catalogPersistence";
import { CATALOG_FALLBACK_CONCURRENCY, runCatalogFetchPlan } from "../lib/catalogSyncStrategy";

type Category = { category_id: string; category_name: string };
type Row = { id: number; category_id?: string };

type PlanOptions = Parameters<typeof runCatalogFetchPlan<Row, Category>>[0];

const categories: Category[] = Array.from({ length: 12 }, (_, index) => ({
  category_id: String(index + 1),
  category_name: `Category ${index + 1}`,
}));

let passed = 0;
const expect = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  passed += 1;
};

const baseOptions = (overrides: Partial<PlanOptions> = {}): PlanOptions => ({
  categories,
  fetchBulk: async () => [{ id: 1, category_id: "1" }, { id: 2, category_id: "2" }, { id: 3, category_id: "3" }, { id: 4, category_id: "4" }, { id: 5, category_id: "5" }, { id: 6, category_id: "6" }],
  fetchCategory: async (category: Category) => [{ id: Number(category.category_id), category_id: category.category_id }],
  writeRows: async () => undefined,
  categoryIdOf: (row: Row) => row.category_id,
  ...overrides,
});

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
    contextSource.includes("getVodStreams(\n            credentials,\n            undefined,\n            controller.signal") &&
    contextSource.includes("getSeries(\n            credentials,\n            undefined,\n            controller.signal"),
    "Cancel must abort the active bulk request through the existing controller signal",
  );

  const vod = projectCatalogItem("provider-A", "vod", { stream_id: 7, name: "Movie", category_id: "42" });
  const series = projectCatalogItem("provider-A", "series", { series_id: 8, name: "Series", category_id: "84" });
  expect(
    vod?.catalogKind === "vod" && String(vod.category_id) === "42" &&
    series?.catalogKind === "series" && String(series.category_id) === "84",
    "bulk DTO projection must preserve item category_id for SQLite category assignment",
  );

  process.stdout.write(`catalog bulk sync scenarios: ${passed}/7 passed\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
