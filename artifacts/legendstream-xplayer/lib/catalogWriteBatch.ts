import type { CatalogKind, PersistedCatalogItem } from "./catalogPersistence";
import { classifyM3USqliteError } from "./sqliteWriteDiagnostics";

export const CATALOG_UPSERT_VALUES_PER_ROW = 11;
export const CATALOG_MULTI_ROW_MAX = 50;
export const CATALOG_LOGICAL_BATCH_MAX = 200;
export const CATALOG_ADAPTIVE_WIDTHS = [50, 25, 12, 6, 3, 1] as const;

export type CatalogBindValue = string | number | null;

export type CatalogWriteCounters = {
  prepareCount: number;
  executeCount: number;
  finalizeCount: number;
};

export type CatalogPreparedStatement = {
  executeAsync(params: CatalogBindValue[]): Promise<unknown>;
  finalizeAsync(): Promise<void>;
};

export type CatalogWriteTransaction = {
  prepareAsync(sql: string): Promise<CatalogPreparedStatement>;
};

export type CatalogWriteDatabase = {
  withExclusiveTransactionAsync(
    task: (transaction: CatalogWriteTransaction) => Promise<void>,
  ): Promise<void>;
};

export type CatalogWriteAttempt = {
  width: number;
  outcome: "committed" | "rolled-back";
  counters: CatalogWriteCounters;
};

const CATALOG_INSERT_COLUMNS = [
  "provider_id",
  "kind",
  "item_id",
  "category_id",
  "name",
  "image_url",
  "payload",
  "added_at",
  "first_seen_at",
  "last_seen_at",
  "is_new",
] as const;

const CATALOG_UPDATE_ASSIGNMENTS = [
  "category_id = excluded.category_id",
  "name = excluded.name",
  "image_url = excluded.image_url",
  "payload = excluded.payload",
  "added_at = excluded.added_at",
  "last_seen_at = excluded.last_seen_at",
] as const;

function requireRowCount(rowCount: number) {
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > CATALOG_MULTI_ROW_MAX) {
    throw new RangeError(`Catalog UPSERT rowCount must be between 1 and ${CATALOG_MULTI_ROW_MAX}.`);
  }
}

export function buildCatalogMultiRowUpsert(rowCount: number) {
  requireRowCount(rowCount);
  const values = Array.from(
    { length: rowCount },
    () => `(${Array(CATALOG_UPSERT_VALUES_PER_ROW).fill("?").join(", ")})`,
  ).join(",\n       ");
  return `INSERT INTO catalog_items (
         ${CATALOG_INSERT_COLUMNS.join(", ")}
       ) VALUES ${values}
       ON CONFLICT(provider_id, kind, item_id) DO UPDATE SET
         ${CATALOG_UPDATE_ASSIGNMENTS.join(",\n         ")}`;
}

export const CATALOG_SINGLE_ROW_UPSERT_SQL = buildCatalogMultiRowUpsert(1);

function catalogItemIdentity(item: PersistedCatalogItem) {
  if (item.catalogKind === "live") return String(item.id);
  if (item.catalogKind === "vod") return String(item.stream_id);
  return String(item.series_id);
}

function catalogItemCategory(item: PersistedCatalogItem) {
  if (item.catalogKind === "live") return String(item.category || "");
  return String(item.category_id ?? "");
}

function catalogItemImage(item: PersistedCatalogItem) {
  if (item.catalogKind === "live") return item.logoUrl ?? null;
  if (item.catalogKind === "vod") return item.stream_icon ?? null;
  return item.cover ?? null;
}

function catalogItemAdded(item: PersistedCatalogItem) {
  if (item.catalogKind !== "vod") return 0;
  const value = item.added;
  if (value === undefined || value === null || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildCatalogItemBindValues(options: {
  providerId: string;
  kind: CatalogKind;
  item: PersistedCatalogItem;
  seenAt: number;
  markNew: boolean;
}): CatalogBindValue[] {
  const { providerId, kind, item, seenAt, markNew } = options;
  if (item.catalogKind !== kind || item.providerId !== providerId) {
    throw new Error("Catalog persistence DTO does not match its write target.");
  }
  return [
    providerId,
    kind,
    catalogItemIdentity(item),
    catalogItemCategory(item),
    item.name,
    catalogItemImage(item),
    JSON.stringify(item),
    catalogItemAdded(item),
    seenAt,
    seenAt,
    markNew ? 1 : 0,
  ];
}

export function buildCatalogItemsBindValues(options: {
  providerId: string;
  kind: CatalogKind;
  items: PersistedCatalogItem[];
  seenAt: number;
  markNew: boolean;
}) {
  return options.items.flatMap((item) => buildCatalogItemBindValues({ ...options, item }));
}

export function createCatalogWriteCounters(): CatalogWriteCounters {
  return { prepareCount: 0, executeCount: 0, finalizeCount: 0 };
}

function addCounters(target: CatalogWriteCounters, source: CatalogWriteCounters) {
  target.prepareCount += source.prepareCount;
  target.executeCount += source.executeCount;
  target.finalizeCount += source.finalizeCount;
}

async function executePreparedGroups(options: {
  transaction: CatalogWriteTransaction;
  providerId: string;
  kind: CatalogKind;
  items: PersistedCatalogItem[];
  seenAt: number;
  markNew: boolean;
  width: number;
  counters: CatalogWriteCounters;
}) {
  const { transaction, items, width, counters } = options;
  const fullRowCount = Math.floor(items.length / width) * width;

  const executeShape = async (shapeRows: number, starts: number[]) => {
    counters.prepareCount += 1;
    const statement = await transaction.prepareAsync(buildCatalogMultiRowUpsert(shapeRows));
    try {
      for (const start of starts) {
        const chunk = items.slice(start, start + shapeRows);
        const bindValues = buildCatalogItemsBindValues({ ...options, items: chunk });
        counters.executeCount += 1;
        await statement.executeAsync(bindValues);
      }
    } finally {
      counters.finalizeCount += 1;
      await statement.finalizeAsync();
    }
  };

  if (fullRowCount > 0) {
    const starts = Array.from({ length: fullRowCount / width }, (_, index) => index * width);
    await executeShape(width, starts);
  }
  const tailRows = items.length - fullRowCount;
  if (tailRows > 0) {
    await executeShape(tailRows, [fullRowCount]);
  }
}

function requireLogicalBatch(items: PersistedCatalogItem[]) {
  if (items.length < 1 || items.length > CATALOG_LOGICAL_BATCH_MAX) {
    throw new RangeError(`Catalog logical batch must contain 1..${CATALOG_LOGICAL_BATCH_MAX} rows.`);
  }
}

export async function executePreparedCatalogMultiRowBatch(options: {
  database: CatalogWriteDatabase;
  providerId: string;
  kind: CatalogKind;
  items: PersistedCatalogItem[];
  seenAt: number;
  markNew: boolean;
  onAttemptCompleted?: (attempt: CatalogWriteAttempt) => void;
}) {
  requireLogicalBatch(options.items);
  const counters = createCatalogWriteCounters();
  const attempts: CatalogWriteAttempt[] = [];

  for (const width of CATALOG_ADAPTIVE_WIDTHS) {
    const attemptCounters = createCatalogWriteCounters();
    try {
      await options.database.withExclusiveTransactionAsync(async (transaction) => {
        await executePreparedGroups({ ...options, transaction, width, counters: attemptCounters });
      });
      addCounters(counters, attemptCounters);
      const attempt = { width, outcome: "committed" as const, counters: { ...attemptCounters } };
      attempts.push(attempt);
      options.onAttemptCompleted?.(attempt);
      return { actualExecutedRows: options.items.length, width, counters, attempts };
    } catch (caught) {
      addCounters(counters, attemptCounters);
      const attempt = { width, outcome: "rolled-back" as const, counters: { ...attemptCounters } };
      attempts.push(attempt);
      options.onAttemptCompleted?.(attempt);
      const isVariableLimit = classifyM3USqliteError(caught).sqliteErrorReason === "TOO_MANY_VARIABLES";
      if (!isVariableLimit || width === 1) throw caught;
    }
  }

  throw new Error("Catalog adaptive UPSERT widths were exhausted.");
}

export async function executePreparedCatalogSingleRowBatch(options: {
  database: CatalogWriteDatabase;
  providerId: string;
  kind: CatalogKind;
  items: PersistedCatalogItem[];
  seenAt: number;
  markNew: boolean;
  isCancelled?: () => boolean;
}) {
  requireLogicalBatch(options.items);
  const counters = createCatalogWriteCounters();
  let actualExecutedRows = 0;

  await options.database.withExclusiveTransactionAsync(async (transaction) => {
    counters.prepareCount += 1;
    const statement = await transaction.prepareAsync(CATALOG_SINGLE_ROW_UPSERT_SQL);
    try {
      for (const item of options.items) {
        if (options.isCancelled?.()) break;
        const bindValues = buildCatalogItemBindValues({ ...options, item });
        counters.executeCount += 1;
        await statement.executeAsync(bindValues);
        actualExecutedRows += 1;
      }
    } finally {
      counters.finalizeCount += 1;
      await statement.finalizeAsync();
    }
  });

  return {
    actualExecutedRows,
    cancelled: actualExecutedRows < options.items.length,
    counters,
  };
}
