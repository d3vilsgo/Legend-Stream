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
  degradedToHealthyBulk?: boolean;
};

export class CatalogFetchPlanError extends Error {
  readonly catalogStage = "category-retry";
  readonly catalogCode = "CATEGORY_RECOVERY_FAILED";
  readonly fallbackPath = "required-category-recovery";
  readonly errorClass: string;

  constructor(errorClass: string) {
    super("Catalog category recovery failed.");
    this.name = "CatalogFetchPlanError";
    this.errorClass = errorClass;
  }
}

export function catalogErrorClass(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : "UnknownError";
}

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
  allowHealthyBulkOnCategoryFailure?: boolean;
  onFallbackProgress?: (completedCategories: number, totalCategories: number, path: "parallel" | "serial") => Promise<void> | void;
};

export function suspiciousBulkResult<T, C extends CategoryLike>(
  rows: T[],
  categories: C[],
  categoryIdOf: (row: T) => string | number | undefined,
): BulkSuspicionReason | null {
  if (rows.length === 0) return "empty";
  if (categories.length < 4) return null;
  if (rows.length < Math.ceil(categories.length / 2)) return "too-few-items";
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
  let healthyBulk = false;
  let healthyBulkRows: T[] | null = null;
  const recoveredRows: T[] = [];
  const failedCategories: C[] = [];

  const cancelled = () => options.isCancelled?.() === true;
  const metrics = (path: CatalogFetchPath, degradedToHealthyBulk = false): CatalogFetchMetrics => ({
    path,
    itemCount,
    bulkParseMs,
    sqliteWriteMs,
    totalMs: Date.now() - startedAt,
    parallelMaxObserved,
    fallbackReason,
    ...(degradedToHealthyBulk ? { degradedToHealthyBulk: true } : {}),
  });
  const writeAuthoritative = async (rows: T[]) => {
    if (cancelled()) return;
    const writeStartedAt = Date.now();
    await options.writeRows(rows);
    sqliteWriteMs += Date.now() - writeStartedAt;
    itemCount = rows.length;
  };

  try {
    const bulkRows = await options.fetchBulk((parseMs) => {
      bulkParseMs = parseMs;
    });
    if (cancelled()) return metrics("bulk");
    const suspicion = suspiciousBulkResult(bulkRows, options.categories, options.categoryIdOf);
    healthyBulk = suspicion === null;
    if (healthyBulk) healthyBulkRows = bulkRows;
    const verifyByCategory = options.forceCategoryFallback === true && options.categories.length > 0;
    if (healthyBulk && !verifyByCategory) {
      await writeAuthoritative(bulkRows);
      return metrics("bulk");
    }
    fallbackReason = suspicion ?? "category-verification";
  } catch (caught) {
    if (cancelled()) throw caught;
    fallbackReason = "bulk-error";
    healthyBulk = false;
  }

  if (options.categories.length > 0 && !cancelled()) {
    let completedCategories = 0;
    for (let start = 0; start < options.categories.length; start += limit) {
      if (cancelled()) break;
      const batch = options.categories.slice(start, start + limit);
      parallelMaxObserved = Math.max(parallelMaxObserved, batch.length);
      const settled = await Promise.allSettled(batch.map((category) => options.fetchCategory(category)));
      if (cancelled()) break;
      for (let index = 0; index < settled.length; index += 1) {
        const result = settled[index];
        if (result.status === "fulfilled") recoveredRows.push(...result.value);
        else failedCategories.push(batch[index]);
      }
      completedCategories += batch.length;
      await options.onFallbackProgress?.(completedCategories, options.categories.length, "parallel");
    }
    if (!cancelled() && failedCategories.length === 0) {
      const authoritative = healthyBulkRows ? [...healthyBulkRows, ...recoveredRows] : recoveredRows;
      await writeAuthoritative(authoritative);
      return metrics("parallel");
    }
    if (failedCategories.length > 0) fallbackReason = "parallel-error";
  }

  if (cancelled()) return metrics("serial");

  if (options.categories.length === 0) {
    const rows = await options.fetchBulk((parseMs) => {
      bulkParseMs = parseMs;
    });
    if (cancelled()) return metrics("serial");
    const suspicion = suspiciousBulkResult(rows, options.categories, options.categoryIdOf);
    if (suspicion) throw new CatalogFetchPlanError("CatalogCompletenessError");
    await writeAuthoritative(rows);
    return metrics("serial");
  }

  const retryFailures: unknown[] = [];
  let completedRetries = 0;
  for (const category of failedCategories) {
    if (cancelled()) break;
    try {
      const rows = await options.fetchCategory(category);
      if (cancelled()) break;
      recoveredRows.push(...rows);
    } catch (caught) {
      if (cancelled()) throw caught;
      retryFailures.push(caught);
    }
    completedRetries += 1;
    await options.onFallbackProgress?.(completedRetries, failedCategories.length, "serial");
  }

  if (cancelled()) return metrics("serial");
  if (retryFailures.length > 0) {
    if (healthyBulkRows && options.allowHealthyBulkOnCategoryFailure === true) {
      await writeAuthoritative(healthyBulkRows);
      return metrics("serial", true);
    }
    throw new CatalogFetchPlanError(catalogErrorClass(retryFailures[0]));
  }

  const authoritative = healthyBulkRows ? [...healthyBulkRows, ...recoveredRows] : recoveredRows;
  await writeAuthoritative(authoritative);
  return metrics("serial");
}
