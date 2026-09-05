export const CATALOG_FALLBACK_CONCURRENCY = 6;

export type CatalogFetchPath = "bulk" | "parallel" | "serial";
export type BulkSuspicionReason =
  | "empty"
  | "too-few-items"
  | "missing-category-ids";

export type CatalogFetchMetrics = {
  path: CatalogFetchPath;
  itemCount: number;
  bulkParseMs: number;
  sqliteWriteMs: number;
  totalMs: number;
  parallelMaxObserved: number;
  fallbackReason?: BulkSuspicionReason | "bulk-error" | "parallel-error" | "category-verification";
};

type CategoryLike = { category_id: string | number };

type RunCatalogFetchPlanOptions<T, C extends CategoryLike> = {
  categories: C[];
  fetchBulk: (onParseMs: (parseMs: number) => void) => Promise<T[]>;
  fetchCategory: (category: C) => Promise<T[]>;
  writeRows: (rows: T[]) => Promise<void>;
  categoryIdOf: (row: T) => string | number | undefined;
  isCancelled?: () => boolean;
  concurrency?: number;
  forceCategoryFallback?: boolean;
  onFallbackProgress?: (completedCategories: number, totalCategories: number, path: "parallel" | "serial") => Promise<void> | void;
};

export function suspiciousBulkResult<T, C extends CategoryLike>(
  rows: T[],
  categories: C[],
  categoryIdOf: (row: T) => string | number | undefined,
): BulkSuspicionReason | null {
  if (rows.length === 0) return "empty";
  if (categories.length < 4) return null;

  // A bulk result with fewer than one item for every two declared categories is
  // implausibly small for a populated Xtream catalog and is safer to verify by category.
  if (rows.length < Math.ceil(categories.length / 2)) return "too-few-items";

  // Bulk mode is only authoritative when it preserves the category relationship that
  // downstream SQLite filtering relies on. A majority of rows without category_id is suspect.
  const categorizedRows = rows.reduce((count, row) => {
    const categoryId = categoryIdOf(row);
    return categoryId === undefined || categoryId === null || String(categoryId).trim() === ""
      ? count
      : count + 1;
  }, 0);
  if (categorizedRows < Math.ceil(rows.length / 2)) return "missing-category-ids";
  return null;
}

export async function runCatalogFetchPlan<T, C extends CategoryLike>(
  options: RunCatalogFetchPlanOptions<T, C>,
): Promise<CatalogFetchMetrics> {
  const startedAt = Date.now();
  const limit = Math.max(1, Math.min(options.concurrency ?? CATALOG_FALLBACK_CONCURRENCY, CATALOG_FALLBACK_CONCURRENCY));
  let bulkParseMs = 0;
  let sqliteWriteMs = 0;
  let itemCount = 0;
  let parallelMaxObserved = 0;
  let fallbackReason: CatalogFetchMetrics["fallbackReason"];

  const cancelled = () => options.isCancelled?.() === true;
  const write = async (rows: T[]) => {
    if (cancelled()) return;
    const writeStartedAt = Date.now();
    await options.writeRows(rows);
    sqliteWriteMs += Date.now() - writeStartedAt;
    itemCount += rows.length;
  };

  try {
    const bulkRows = await options.fetchBulk((parseMs) => {
      bulkParseMs = parseMs;
    });
    if (cancelled()) {
      return { path: "bulk", itemCount: 0, bulkParseMs, sqliteWriteMs, totalMs: Date.now() - startedAt, parallelMaxObserved };
    }
    const suspicion = suspiciousBulkResult(bulkRows, options.categories, options.categoryIdOf);
    const verifyByCategory = options.forceCategoryFallback === true && options.categories.length > 0;
    if (!suspicion && !verifyByCategory) {
      await write(bulkRows);
      return {
        path: "bulk",
        itemCount,
        bulkParseMs,
        sqliteWriteMs,
        totalMs: Date.now() - startedAt,
        parallelMaxObserved,
      };
    }
    fallbackReason = suspicion ?? "category-verification";
  } catch (caught) {
    if (cancelled()) throw caught;
    fallbackReason = "bulk-error";
  }

  if (options.categories.length > 0 && !cancelled()) {
    try {
      let completedCategories = 0;
      for (let start = 0; start < options.categories.length; start += limit) {
        if (cancelled()) break;
        const batch = options.categories.slice(start, start + limit);
        parallelMaxObserved = Math.max(parallelMaxObserved, batch.length);
        const settled = await Promise.allSettled(batch.map((category) => options.fetchCategory(category)));
        if (cancelled()) break;
        const failed = settled.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
        for (const result of settled) {
          if (result.status === "fulfilled") await write(result.value);
        }
        completedCategories += batch.length;
        await options.onFallbackProgress?.(completedCategories, options.categories.length, "parallel");
      }
      if (!cancelled()) {
        return {
          path: "parallel",
          itemCount,
          bulkParseMs,
          sqliteWriteMs,
          totalMs: Date.now() - startedAt,
          parallelMaxObserved,
          fallbackReason,
        };
      }
    } catch (caught) {
      if (cancelled()) throw caught;
      fallbackReason = "parallel-error";
    }
  }

  if (cancelled()) {
    return {
      path: "serial",
      itemCount,
      bulkParseMs,
      sqliteWriteMs,
      totalMs: Date.now() - startedAt,
      parallelMaxObserved,
      fallbackReason,
    };
  }

  // Final compatibility path: retry each category exactly as the previous implementation did.
  // If the provider exposes no categories, retry the bulk call once because there is no category
  // loop available to fall back to.
  itemCount = 0;
  if (options.categories.length === 0) {
    const rows = await options.fetchBulk((parseMs) => {
      bulkParseMs = parseMs;
    });
    await write(rows);
  } else {
    let completedCategories = 0;
    for (const category of options.categories) {
      if (cancelled()) break;
      const rows = await options.fetchCategory(category);
      if (cancelled()) break;
      await write(rows);
      completedCategories += 1;
      await options.onFallbackProgress?.(completedCategories, options.categories.length, "serial");
    }
  }

  return {
    path: "serial",
    itemCount,
    bulkParseMs,
    sqliteWriteMs,
    totalMs: Date.now() - startedAt,
    parallelMaxObserved,
    fallbackReason,
  };
}
