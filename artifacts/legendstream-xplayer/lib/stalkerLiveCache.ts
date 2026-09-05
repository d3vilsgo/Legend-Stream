import * as SQLite from "expo-sqlite";
import { enqueueCatalogDbWrite } from "./catalogDbWriter";
import {
  initCatalogCache,
  upsertCatalogItemsBulkNonCancellable,
} from "./catalogCache";
import {
  normalizePersistedCatalogPayload,
  type PersistedLiveCatalogItem,
  type PersistedStalkerLivePlaybackRef,
} from "./catalogPersistence";
import {
  enqueueOwnedStalkerLiveCommit,
  type StalkerLiveCommitOwnershipCheck,
} from "./stalkerLiveCommitOwnership";
import type { StalkerLiveCategory } from "./stalkerLiveCatalog";

const CATALOG_DB_NAME = "legendstream-catalog-v1.db";
const STAGING_PREFIX = "__staging__";
let stalkerDatabasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function stagingProviderId(providerId: string) {
  return `${STAGING_PREFIX}${providerId}`;
}

async function database() {
  await initCatalogCache();
  if (!stalkerDatabasePromise) {
    stalkerDatabasePromise = SQLite.openDatabaseAsync(CATALOG_DB_NAME);
  }
  return stalkerDatabasePromise;
}

export async function cleanupStalkerLiveStaging(providerId: string) {
  const stagingId = stagingProviderId(providerId);
  return enqueueCatalogDbWrite(async () => {
    const db = await database();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync(
        "DELETE FROM catalog_items WHERE provider_id = ? AND kind = 'live'",
        stagingId,
      );
      await txn.runAsync(
        "DELETE FROM catalog_categories WHERE provider_id = ? AND kind = 'live'",
        stagingId,
      );
      await txn.runAsync("DELETE FROM catalog_sync_state WHERE provider_id = ?", stagingId);
    });
  });
}

export async function stageStalkerLivePage(
  providerId: string,
  items: PersistedLiveCatalogItem[],
  seenAt: number,
) {
  const stagingId = stagingProviderId(providerId);
  const staged = items.map((item) => ({ ...item, providerId: stagingId }));
  return upsertCatalogItemsBulkNonCancellable(stagingId, "live", staged, {
    seenAt,
    markNew: false,
  });
}

export async function commitStalkerLiveStaging(
  providerId: string,
  categories: readonly StalkerLiveCategory[],
  isCurrent?: StalkerLiveCommitOwnershipCheck,
) {
  const stagingId = stagingProviderId(providerId);
  return enqueueOwnedStalkerLiveCommit({
    enqueue: enqueueCatalogDbWrite,
    isCurrent,
    mutate: async (assertCurrent) => {
      assertCurrent();
      const db = await database();
      assertCurrent();
      await db.withExclusiveTransactionAsync(async (txn) => {
        assertCurrent();
        await txn.runAsync(
          "DELETE FROM catalog_items WHERE provider_id = ? AND kind = 'live'",
          providerId,
        );
        assertCurrent();
        await txn.runAsync(
          "DELETE FROM catalog_categories WHERE provider_id = ? AND kind = 'live'",
          providerId,
        );
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
            category.name,
          );
        }
        assertCurrent();
        await txn.runAsync(
          "DELETE FROM catalog_categories WHERE provider_id = ? AND kind = 'live'",
          stagingId,
        );
        assertCurrent();
        await txn.runAsync("DELETE FROM catalog_sync_state WHERE provider_id = ?", stagingId);
        assertCurrent();
      });
      assertCurrent();
    },
  });
}

export async function getCachedStalkerLiveCategories(
  providerId: string,
): Promise<StalkerLiveCategory[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ category_id: string; category_name: string }>(
    `SELECT category_id, category_name
       FROM catalog_categories
      WHERE provider_id = ? AND kind = 'live'
      ORDER BY rowid ASC`,
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
    `SELECT payload
       FROM catalog_items
      WHERE provider_id = ? AND kind = 'live' AND item_id = ?
      LIMIT 1`,
    providerId,
    itemId,
  );
  if (!row?.payload) return null;
  try {
    const persisted = normalizePersistedCatalogPayload(
      providerId,
      "live",
      JSON.parse(row.payload),
    );
    return persisted?.catalogKind === "live" && persisted.playbackRef.type === "stalker-live"
      ? persisted.playbackRef
      : null;
  } catch {
    return null;
  }
}
