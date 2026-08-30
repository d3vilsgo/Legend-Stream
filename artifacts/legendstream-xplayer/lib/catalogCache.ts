import * as SQLite from "expo-sqlite";
import { yieldToUi } from "./cooperative";
import type { XtreamCategory } from "./xtreamCatalog";
import {
  normalizePersistedCatalogPayload,
  type CatalogKind,
  type PersistedCatalogItem,
} from "./catalogPersistence";

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

export async function initCatalogCache() {
  await database();
}

export async function setCatalogSyncState(
  providerId: string,
  phase: CatalogSyncPhase,
  completed: number,
  total: number,
  message?: string,
  stamp?: "full" | "background",
) {
  const db = await database();
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
  const db = await database();
  await db.withTransactionAsync(async () => {
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
  options: { markNew?: boolean; seenAt?: number; onProgress?: (written: number) => void; isCancelled?: () => boolean } = {},
) {
  const db = await database();
  const now = options.seenAt ?? Date.now();
  let written = 0;

  for (let start = 0; start < items.length; start += WRITE_BATCH_SIZE) {
    if (options.isCancelled?.()) break;
    const batch = items.slice(start, start + WRITE_BATCH_SIZE);
    await db.withTransactionAsync(async () => {
      for (const persisted of batch) {
        if (options.isCancelled?.()) break;
        if (persisted.catalogKind !== kind || persisted.providerId !== providerId) {
          throw new Error("Catalog persistence DTO does not match its write target.");
        }
        const id = itemIdentity(persisted);
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
          id,
          itemCategory(persisted),
          itemName(persisted),
          itemImage(persisted),
          JSON.stringify(persisted),
          itemAdded(persisted),
          now,
          now,
          options.markNew ? 1 : 0,
        );
      }
    });
    written += batch.length;
    options.onProgress?.(Math.min(written, items.length));
    await yieldToUi();
  }

  return written;
}

export async function replaceCatalogKind(
  providerId: string,
  kind: CatalogKind,
  items: PersistedCatalogItem[],
  options: { onProgress?: (written: number) => void; isCancelled?: () => boolean } = {},
) {
  const db = await database();
  await db.runAsync("DELETE FROM catalog_items WHERE provider_id = ? AND kind = ?", providerId, kind);
  return upsertCatalogItems(providerId, kind, items, {
    ...options,
    markNew: false,
  });
}

export async function pruneCatalogKind(providerId: string, kind: CatalogKind, seenAt: number) {
  const db = await database();
  const result = await db.runAsync(
    `DELETE FROM catalog_items
     WHERE provider_id = ? AND kind = ? AND last_seen_at < ?`,
    providerId,
    kind,
    seenAt,
  );
  return result.changes;
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
  const db = await database();
  await db.runAsync("UPDATE catalog_items SET is_new = 0 WHERE provider_id = ?", providerId);
}

export async function deleteProviderCatalog(providerId: string) {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync("DELETE FROM catalog_categories WHERE provider_id = ?", providerId);
    await txn.runAsync("DELETE FROM catalog_items WHERE provider_id = ?", providerId);
    await txn.runAsync("DELETE FROM catalog_sync_state WHERE provider_id = ?", providerId);
  });
}
