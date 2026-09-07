import * as SQLite from "expo-sqlite";
import { initCatalogCache, upsertCatalogItems } from "./catalogCache";
import { enqueueCatalogDbWrite } from "./catalogDbWriter";
import {
  normalizePersistedCatalogPayload,
  type PersistedLiveCatalogItem,
  type PersistedStalkerLivePlaybackRef,
} from "./catalogPersistence";
import { assertStalkerLiveCommitCurrent, type StalkerLiveCommitOwnershipCheck } from "./stalkerLiveCommitOwnership";
import type { StalkerLiveCategory } from "./stalkerLiveCatalog";

const CATALOG_DB_NAME = "legendstream-catalog-v1.db";
const STALKER_STAGING_PREFIX = "__staging__";
const STALKER_STAGING_MARKER = "__stalker_run__";
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function database() {
  await initCatalogCache();
  if (!databasePromise) databasePromise = SQLite.openDatabaseAsync(CATALOG_DB_NAME);
  return databasePromise;
}

export function stalkerLiveStagingProviderId(providerId: string, runToken: string) {
  const provider = providerId.trim();
  const token = runToken.trim();
  if (!provider || !token) throw new Error("Stalker Live staging requires provider and run identity.");
  return `${STALKER_STAGING_PREFIX}${provider}${STALKER_STAGING_MARKER}${token}`;
}

function assertStalkerLiveStagingTarget(providerId: string, stagingId: string) {
  const expectedPrefix = `${STALKER_STAGING_PREFIX}${providerId.trim()}${STALKER_STAGING_MARKER}`;
  if (!providerId.trim() || !stagingId.startsWith(expectedPrefix) || stagingId.length === expectedPrefix.length) {
    throw new Error("Stalker Live staging target does not belong to this provider run.");
  }
}

export async function cleanupStalkerLiveStaging(providerId: string, stagingId: string) {
  assertStalkerLiveStagingTarget(providerId, stagingId);
  const db = await database();
  return enqueueCatalogDbWrite(async () => {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync("DELETE FROM catalog_items WHERE provider_id = ?", stagingId);
      await txn.runAsync("DELETE FROM catalog_categories WHERE provider_id = ?", stagingId);
      await txn.runAsync("DELETE FROM catalog_sync_state WHERE provider_id = ?", stagingId);
    });
  });
}

export async function stageStalkerLivePage(
  providerId: string,
  stagingId: string,
  items: PersistedLiveCatalogItem[],
  seenAt: number,
  isCurrent?: StalkerLiveCommitOwnershipCheck,
) {
  assertStalkerLiveStagingTarget(providerId, stagingId);
  const assertCurrent = () => assertStalkerLiveCommitCurrent(isCurrent);
  const staged = items.map((item) => ({ ...item, providerId: stagingId }));

  // Each sync run owns a physically distinct staging namespace. Ownership
  // checks still guard queued writes, while stale cleanup can only delete the
  // stale run's own namespace and therefore cannot damage a newer run.
  assertCurrent();
  const written = await upsertCatalogItems(stagingId, "live", staged, {
    seenAt,
    markNew: false,
    isCancelled: () => Boolean(isCurrent && !isCurrent()),
    onBatchStarted: assertCurrent,
    onSqliteStage: assertCurrent,
  });
  assertCurrent();
  if (written !== staged.length) {
    throw new Error("Stalker Live staging write did not commit the complete page.");
  }
  return written;
}

export async function commitStalkerLiveStaging(
  providerId: string,
  stagingId: string,
  categories: readonly StalkerLiveCategory[],
  itemCount: number,
  isCurrent?: StalkerLiveCommitOwnershipCheck,
) {
  assertStalkerLiveStagingTarget(providerId, stagingId);
  const assertCurrent = () => assertStalkerLiveCommitCurrent(isCurrent);
  assertCurrent();
  const db = await database();

  return enqueueCatalogDbWrite(async () => {
    assertCurrent();
    await db.withExclusiveTransactionAsync(async (txn) => {
      assertCurrent();
      const stagedCountRow = await txn.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM catalog_items WHERE provider_id = ? AND kind = 'live'",
        stagingId,
      );
      const stagedCount = Number(stagedCountRow?.count ?? 0);
      if (stagedCount !== itemCount) {
        throw new Error("Stalker Live staging cardinality changed before publish.");
      }

      assertCurrent();
      await txn.runAsync("DELETE FROM catalog_items WHERE provider_id = ? AND kind = 'live'", providerId);
      assertCurrent();
      await txn.runAsync("DELETE FROM catalog_categories WHERE provider_id = ? AND kind = 'live'", providerId);
      assertCurrent();
      await txn.runAsync(
        "UPDATE catalog_items SET provider_id = ? WHERE provider_id = ? AND kind = 'live'",
        providerId,
        stagingId,
      );

      for (const category of categories) {
        assertCurrent();
        await txn.runAsync(
          `INSERT OR REPLACE INTO catalog_categories
           (provider_id, kind, category_id, category_name, parent_id)
           VALUES (?, 'live', ?, ?, NULL)`,
          providerId,
          category.id,
          category.name || category.id,
        );
      }

      assertCurrent();
      const now = Date.now();
      await txn.runAsync(
        `INSERT INTO catalog_sync_state (
           provider_id, phase, completed, total, message, updated_at,
           last_full_sync_at, last_background_sync_at
         ) VALUES (?, 'ready', ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
           phase = excluded.phase,
           completed = excluded.completed,
           total = excluded.total,
           message = excluded.message,
           updated_at = excluded.updated_at,
           last_full_sync_at = COALESCE(excluded.last_full_sync_at, catalog_sync_state.last_full_sync_at),
           last_background_sync_at = COALESCE(excluded.last_background_sync_at, catalog_sync_state.last_background_sync_at)`,
        providerId,
        itemCount,
        itemCount,
        "Stalker Live catalog ready",
        now,
        now,
      );
      assertCurrent();
    });
    assertCurrent();
    return { live: itemCount, vod: 0, series: 0 };
  });
}

export async function getCachedStalkerLiveCategories(providerId: string): Promise<StalkerLiveCategory[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ category_id: string; category_name: string }>(
    `SELECT category_id, category_name FROM catalog_categories
      WHERE provider_id = ? AND kind = 'live' ORDER BY rowid ASC`,
    providerId,
  );
  return rows.map((row) => ({ id: row.category_id, name: row.category_name }));
}

export async function getPersistedStalkerLivePlaybackRef(
  providerId: string,
  itemId: string,
): Promise<PersistedStalkerLivePlaybackRef | null> {
  const db = await database();
  const row = await db.getFirstAsync<{ payload: string }>(
    `SELECT payload FROM catalog_items
      WHERE provider_id = ? AND kind = 'live' AND item_id = ? LIMIT 1`,
    providerId,
    itemId,
  );
  if (!row?.payload) return null;
  try {
    const persisted = normalizePersistedCatalogPayload(providerId, "live", JSON.parse(row.payload));
    return persisted?.catalogKind === "live" && persisted.playbackRef.type === "stalker-live"
      ? persisted.playbackRef
      : null;
  } catch {
    return null;
  }
}
