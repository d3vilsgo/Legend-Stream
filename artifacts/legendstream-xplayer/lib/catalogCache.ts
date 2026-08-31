import * as SQLite from "expo-sqlite";
import { yieldToUi } from "./cooperative";
import { enqueueCatalogDbWrite } from "./catalogDbWriter";
import type { XtreamCategory } from "./xtreamCatalog";
import {
  normalizePersistedCatalogPayload,
  type CatalogKind,
  type PersistedCatalogItem,
} from "./catalogPersistence";
import {
  fingerprintM3USqliteColumnNames,
  type M3USqliteSchemaFingerprint,
} from "./sqliteWriteDiagnostics";

export type { CatalogKind } from "./catalogPersistence";
export type CatalogSyncPhase = "idle" | "preparing" | "syncing" | "ready" | "cancelled" | "error";

export type CatalogSyncState = {
  providerId: string;
  phase: CatalogSyncPhase;
  completed: number;
  total: number;
  message?: string;
  updatedAt: number;
};

export type CatalogCounts = {
  live: number;
  vod: number;
  series: number;
};

export type CatalogWriteBatchObservation = {
  batchIndex: number;
  batchRows: number;
  committedRows: number;
};

export type CatalogWriteSqliteStage = "begin-transaction" | "insert-statement" | "commit";
export type CatalogAtomicWriteStage =
  | "set-syncing"
  | CatalogWriteSqliteStage
  | "replace-categories"
  | "prune"
  | "set-ready";

type CatalogWriteOptions = {
  markNew?: boolean;
  seenAt?: number;
  onProgress?: (written: number) => void;
  isCancelled?: () => boolean;
  onBatchStarted?: (batchIndex: number) => void;
  onBatchCommitted?: (observation: CatalogWriteBatchObservation) => void;
  onSqliteStage?: (stage: CatalogWriteSqliteStage) => void;
};

type CacheRow = {
  payload: string;
};

type CountRow = {
  kind: CatalogKind;
  count: number;
};

type CategoryRow = {
  category_id: string;
  category_name: string;
  parent_id: number | null;
};

type TableInfoRow = {
  cid: number;
  name: string;
};

type AtomicReplaceOptions = {
  providerId: string;
  live: PersistedCatalogItem[];
  vod: PersistedCatalogItem[];
  series: PersistedCatalogItem[];
  vodCategories: XtreamCategory[];
  seriesCategories: XtreamCategory[];
  seenAt: number;
  markNew?: boolean;
  readyMessage: string;
  readyStamp?: "full" | "background";
  syncTotal: number;
  onStage?: (stage: CatalogAtomicWriteStage, kind?: CatalogKind) => void;
  onBatchStarted?: (kind: CatalogKind, batchIndex: number) => void;
  onBatchCommitted?: (kind: CatalogKind, observation: CatalogWriteBatchObservation) => void;
};

const DB_NAME = "legendstream-catalog-v1.db";
const WRITE_BATCH_SIZE = 200;
let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

async function database() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS catalog_categories (
          provider_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          category_id TEXT NOT NULL,
          category_name TEXT NOT NULL,
          parent_id INTEGER,
          PRIMARY KEY (provider_id, kind, category_id)
        );

        CREATE TABLE IF NOT EXISTS catalog_items (
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

        CREATE TABLE IF NOT EXISTS catalog_sync_state (
          provider_id TEXT PRIMARY KEY NOT NULL,
          phase TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0,
          total INTEGER NOT NULL DEFAULT 0,
          message TEXT,
          updated_at INTEGER NOT NULL,
          last_full_sync_at INTEGER,
          last_background_sync_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_kind
          ON catalog_items(provider_id, kind);
        CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_kind_category
          ON catalog_items(provider_id, kind, category_id);
        CREATE INDEX IF NOT EXISTS idx_catalog_items_new
          ON catalog_items(provider_id, kind, is_new, first_seen_at DESC);
      `);
      return db;
    });
  }
  return databasePromise;
}

const parsePayload = (
  providerId: string,
  kind: CatalogKind,
  row: CacheRow,
): PersistedCatalogItem | null => {
  try {
    return normalizePersistedCatalogPayload(providerId, kind, JSON.parse(row.payload));
  } catch {
    return null;
  }
};

const addedTime = (value: unknown) => {
  if (value === undefined || value === null || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

function itemIdentity(item: PersistedCatalogItem) {
  if (item.catalogKind === "live") return String(item.id);
  if (item.catalogKind === "vod") return String(item.stream_id);
  return String(item.series_id);
}

function itemCategory(item: PersistedCatalogItem) {
  if (item.catalogKind === "live") return String(item.category || "");
  return String(item.category_id ?? "");
}

function itemName(item: PersistedCatalogItem) {
  return item.name;
}

function itemImage(item: PersistedCatalogItem) {
  if (item.catalogKind === "live") return item.logoUrl ?? null;
  if (item.catalogKind === "vod") return item.stream_icon ?? null;
  return item.cover ?? null;
}

function itemAdded(item: PersistedCatalogItem) {
  return item.catalogKind === "vod" ? addedTime(item.added) : 0;
}

async function writeSyncState(
  db: SQLite.SQLiteDatabase,
  providerId: string,
  phase: CatalogSyncPhase,
  completed: number,
  total: number,
  message?: string,
  stamp?: "full" | "background",
) {
  const now = Date.now();
  const full = stamp === "full" ? now : null;
  const background = stamp === "background" ? now : null;
  await db.runAsync(
    `INSERT INTO catalog_sync_state (
       provider_id, phase, completed, total, message, updated_at,
       last_full_sync_at, last_background_sync_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_id) DO UPDATE SET
       phase = excluded.phase,
       completed = excluded.completed,
       total = excluded.total,
       message = excluded.message,
       updated_at = excluded.updated_at,
       last_full_sync_at = COALESCE(excluded.last_full_sync_at, catalog_sync_state.last_full_sync_at),
       last_background_sync_at = COALESCE(excluded.last_background_sync_at, catalog_sync_state.last_background_sync_at)`,
    providerId,
    phase,
    completed,
    total,
    message ?? null,
    now,
    full,
    background,
  );
}

async function replaceCategories(
  db: SQLite.SQLiteDatabase,
  providerId: string,
  kind: Exclude<CatalogKind, "live">,
  categories: XtreamCategory[],
) {
  await db.runAsync(
    "DELETE FROM catalog_categories WHERE provider_id = ? AND kind = ?",
    providerId,
    kind,
  );
  for (const category of categories) {
    await db.runAsync(
      `INSERT OR REPLACE INTO catalog_categories
       (provider_id, kind, category_id, category_name, parent_id)
       VALUES (?, ?, ?, ?, ?)`,
      providerId,
      kind,
      String(category.category_id),
      category.category_name || String(category.category_id),
      category.parent_id ?? null,
    );
  }
}

async function insertRows(
  db: SQLite.SQLiteDatabase,
  providerId: string,
  kind: CatalogKind,
  rows: PersistedCatalogItem[],
  seenAt: number,
  markNew: boolean,
  isCancelled?: () => boolean,
) {
  for (const persisted of rows) {
    if (isCancelled?.()) break;
    if (persisted.catalogKind !== kind || persisted.providerId !== providerId) {
      throw new Error("Catalog persistence DTO does not match its write target.");
    }
    await db.runAsync(
      `INSERT INTO catalog_items (
         provider_id, kind, item_id, category_id, name, image_url, payload,
         added_at, first_seen_at, last_seen_at, is_new
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_id, kind, item_id) DO UPDATE SET
         category_id = excluded.category_id,
         name = excluded.name,
         image_url = excluded.image_url,
         payload = excluded.payload,
         added_at = excluded.added_at,
         last_seen_at = excluded.last_seen_at`,
      providerId,
      kind,
      itemIdentity(persisted),
      itemCategory(persisted),
      itemName(persisted),
      itemImage(persisted),
      JSON.stringify(persisted),
      itemAdded(persisted),
      seenAt,
      seenAt,
      markNew ? 1 : 0,
    );
  }
}

export async function initCatalogCache() {
  await database();
}

export async function getCatalogItemsSchemaFingerprint(): Promise<M3USqliteSchemaFingerprint> {
  const db = await database();
  const rows = await db.getAllAsync<TableInfoRow>("PRAGMA table_info(catalog_items)");
  return fingerprintM3USqliteColumnNames(rows.map((row) => row.name));
}

export async function setCatalogSyncState(
  providerId: string,
  phase: CatalogSyncPhase,
  completed: number,
  total: number,
  message?: string,
  stamp?: "full" | "background",
) {
  return enqueueCatalogDbWrite(async () => {
    const db = await database();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await writeSyncState(txn, providerId, phase, completed, total, message, stamp);
    });
  });
}

export async function getCatalogSyncState(providerId: string): Promise<CatalogSyncState | null> {
  const db = await database();
  const row = await db.getFirstAsync<{
    provider_id: string;
    phase: CatalogSyncPhase;
    completed: number;
    total: number;
    message: string | null;
    updated_at: number;
  }>(
    "SELECT provider_id, phase, completed, total, message, updated_at FROM catalog_sync_state WHERE provider_id = ?",
    providerId,
  );
  return row
    ? {
        providerId: row.provider_id,
        phase: row.phase,
        completed: row.completed,
        total: row.total,
        message: row.message ?? undefined,
        updatedAt: row.updated_at,
      }
    : null;
}

export async function replaceCatalogCategories(
  providerId: string,
  kind: Exclude<CatalogKind, "live">,
  categories: XtreamCategory[],
) {
  return enqueueCatalogDbWrite(async () => {
    const db = await database();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await replaceCategories(txn, providerId, kind, categories);
    });
  });
}

export async function getCachedCategories(
  providerId: string,
  kind: Exclude<CatalogKind, "live">,
): Promise<XtreamCategory[]> {
  const db = await database();
  const rows = await db.getAllAsync<CategoryRow>(
    `SELECT category_id, category_name, parent_id
     FROM catalog_categories
     WHERE provider_id = ? AND kind = ?
     ORDER BY rowid ASC`,
    providerId,
    kind,
  );
  return rows.map((row) => ({
    category_id: row.category_id,
    category_name: row.category_name,
    parent_id: row.parent_id ?? undefined,
  }));
}

export async function upsertCatalogItems(
  providerId: string,
  kind: CatalogKind,
  items: PersistedCatalogItem[],
  options: CatalogWriteOptions = {},
) {
  return enqueueCatalogDbWrite(async () => {
    const db = await database();
    const now = options.seenAt ?? Date.now();
    let written = 0;

    for (let start = 0; start < items.length; start += WRITE_BATCH_SIZE) {
      if (options.isCancelled?.()) break;
      const batch = items.slice(start, start + WRITE_BATCH_SIZE);
      const batchIndex = Math.floor(start / WRITE_BATCH_SIZE) + 1;
      options.onBatchStarted?.(batchIndex);
      options.onSqliteStage?.("begin-transaction");
      await db.withExclusiveTransactionAsync(async (txn) => {
        options.onSqliteStage?.("insert-statement");
        await insertRows(txn, providerId, kind, batch, now, Boolean(options.markNew), options.isCancelled);
        options.onSqliteStage?.("commit");
      });
      written += batch.length;
      const committedRows = Math.min(written, items.length);
      options.onBatchCommitted?.({ batchIndex, batchRows: batch.length, committedRows });
      options.onProgress?.(committedRows);
      await yieldToUi();
    }

    return written;
  });
}

export async function replaceCatalogKind(
  providerId: string,
  kind: CatalogKind,
  items: PersistedCatalogItem[],
  options: { onProgress?: (written: number) => void; isCancelled?: () => boolean } = {},
) {
  return enqueueCatalogDbWrite(async () => {
    const db = await database();
    let written = 0;
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync("DELETE FROM catalog_items WHERE provider_id = ? AND kind = ?", providerId, kind);
      const seenAt = Date.now();
      for (let start = 0; start < items.length; start += WRITE_BATCH_SIZE) {
        if (options.isCancelled?.()) break;
        const batch = items.slice(start, start + WRITE_BATCH_SIZE);
        await insertRows(txn, providerId, kind, batch, seenAt, false, options.isCancelled);
        written += batch.length;
        options.onProgress?.(Math.min(written, items.length));
      }
    });
    return written;
  });
}

export async function pruneCatalogKind(providerId: string, kind: CatalogKind, seenAt: number) {
  return enqueueCatalogDbWrite(async () => {
    const db = await database();
    let changes = 0;
    await db.withExclusiveTransactionAsync(async (txn) => {
      const result = await txn.runAsync(
        `DELETE FROM catalog_items
         WHERE provider_id = ? AND kind = ? AND last_seen_at < ?`,
        providerId,
        kind,
        seenAt,
      );
      changes = result.changes;
    });
    return changes;
  });
}

export async function replaceProviderCatalogAtomically(options: AtomicReplaceOptions) {
  return enqueueCatalogDbWrite(async () => {
    const db = await database();
    const committed: Array<{ kind: CatalogKind; observation: CatalogWriteBatchObservation }> = [];
    const written: CatalogCounts = { live: 0, vod: 0, series: 0 };

    await db.withExclusiveTransactionAsync(async (txn) => {
      options.onStage?.("set-syncing");
      await writeSyncState(
        txn,
        options.providerId,
        "syncing",
        0,
        options.syncTotal,
        "M3U cache update started",
      );

      // A successful full M3U refresh is also the idempotent cleanup path for
      // legacy rows whose old parser-generated item IDs could change between rounds.
      await txn.runAsync("DELETE FROM catalog_categories WHERE provider_id = ?", options.providerId);
      await txn.runAsync("DELETE FROM catalog_items WHERE provider_id = ?", options.providerId);

      for (const [kind, items] of [
        ["live", options.live],
        ["vod", options.vod],
        ["series", options.series],
      ] as const) {
        let kindWritten = 0;
        for (let start = 0; start < items.length; start += WRITE_BATCH_SIZE) {
          const batch = items.slice(start, start + WRITE_BATCH_SIZE);
          const batchIndex = Math.floor(start / WRITE_BATCH_SIZE) + 1;
          options.onBatchStarted?.(kind, batchIndex);
          options.onStage?.("begin-transaction", kind);
          options.onStage?.("insert-statement", kind);
          await insertRows(txn, options.providerId, kind, batch, options.seenAt, Boolean(options.markNew));
          kindWritten += batch.length;
          written[kind] = kindWritten;
          committed.push({
            kind,
            observation: {
              batchIndex,
              batchRows: batch.length,
              committedRows: kindWritten,
            },
          });
        }
      }

      options.onStage?.("replace-categories");
      await replaceCategories(txn, options.providerId, "vod", options.vodCategories);
      await replaceCategories(txn, options.providerId, "series", options.seriesCategories);

      options.onStage?.("prune");
      // Full replacement above makes a separate prune unnecessary; this stage is
      // retained so diagnostics preserve the established lifecycle vocabulary.

      options.onStage?.("set-ready");
      await writeSyncState(
        txn,
        options.providerId,
        "ready",
        options.syncTotal,
        options.syncTotal,
        options.readyMessage,
        options.readyStamp,
      );
      options.onStage?.("commit");
    });

    // Only report committed batches after the single exclusive transaction has
    // committed. If category/state finalization throws, SQLite rolls back all rows.
    for (const entry of committed) {
      options.onBatchCommitted?.(entry.kind, entry.observation);
    }
    return written;
  });
}

export async function getCachedPersistedItems(
  providerId: string,
  kind: CatalogKind,
  categoryId?: string,
  limit?: number,
): Promise<PersistedCatalogItem[]> {
  const db = await database();
  const args: Array<string | number> = [providerId, kind];
  let sql = `SELECT payload FROM catalog_items WHERE provider_id = ? AND kind = ?`;
  if (categoryId && categoryId !== "__all__") {
    sql += " AND category_id = ?";
    args.push(categoryId);
  }
  sql += kind === "live"
    ? " ORDER BY rowid ASC"
    : " ORDER BY CASE WHEN added_at > 0 THEN added_at ELSE first_seen_at END DESC, name COLLATE NOCASE";
  if (limit && limit > 0) {
    sql += " LIMIT ?";
    args.push(limit);
  }
  const rows = await db.getAllAsync<CacheRow>(sql, ...args);
  return rows
    .map((row) => parsePayload(providerId, kind, row))
    .filter((item): item is PersistedCatalogItem => item !== null);
}

export async function getNewCachedPersistedItems(
  providerId: string,
  kind: CatalogKind,
  limit = 24,
): Promise<PersistedCatalogItem[]> {
  const db = await database();
  const rows = await db.getAllAsync<CacheRow>(
    `SELECT payload FROM catalog_items
     WHERE provider_id = ? AND kind = ? AND is_new = 1
     ORDER BY first_seen_at DESC
     LIMIT ?`,
    providerId,
    kind,
    limit,
  );
  return rows
    .map((row) => parsePayload(providerId, kind, row))
    .filter((item): item is PersistedCatalogItem => item !== null);
}

export async function getCatalogCounts(providerId: string): Promise<CatalogCounts> {
  const db = await database();
  const rows = await db.getAllAsync<CountRow>(
    `SELECT kind, COUNT(*) AS count
     FROM catalog_items
     WHERE provider_id = ?
     GROUP BY kind`,
    providerId,
  );
  const result: CatalogCounts = { live: 0, vod: 0, series: 0 };
  for (const row of rows) result[row.kind] = Number(row.count) || 0;
  return result;
}

export async function hasCatalogCache(providerId: string) {
  const db = await database();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM catalog_items WHERE provider_id = ?",
    providerId,
  );
  return Number(row?.count ?? 0) > 0;
}

export async function clearNewCatalogFlags(providerId: string) {
  return enqueueCatalogDbWrite(async () => {
    const db = await database();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync("UPDATE catalog_items SET is_new = 0 WHERE provider_id = ?", providerId);
    });
  });
}

export async function deleteProviderCatalog(providerId: string) {
  return enqueueCatalogDbWrite(async () => {
    const db = await database();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync("DELETE FROM catalog_categories WHERE provider_id = ?", providerId);
      await txn.runAsync("DELETE FROM catalog_items WHERE provider_id = ?", providerId);
      await txn.runAsync("DELETE FROM catalog_sync_state WHERE provider_id = ?", providerId);
    });
  });
}
