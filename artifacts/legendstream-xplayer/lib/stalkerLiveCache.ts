import * as SQLite from "expo-sqlite";
import {
  cleanupStagingCatalog,
  initCatalogCache,
  stagingProviderId,
  swapStagingToProvider,
  upsertCatalogItemsBulkNonCancellable,
} from "./catalogCache";
import {
  normalizePersistedCatalogPayload,
  type PersistedLiveCatalogItem,
  type PersistedStalkerLivePlaybackRef,
} from "./catalogPersistence";
import { assertStalkerLiveCommitCurrent, type StalkerLiveCommitOwnershipCheck } from "./stalkerLiveCommitOwnership";
import type { StalkerLiveCategory } from "./stalkerLiveCatalog";

const CATALOG_DB_NAME = "legendstream-catalog-v1.db";
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function database() {
  await initCatalogCache();
  if (!databasePromise) databasePromise = SQLite.openDatabaseAsync(CATALOG_DB_NAME);
  return databasePromise;
}

export async function cleanupStalkerLiveStaging(providerId: string) {
  return cleanupStagingCatalog(providerId);
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
  itemCount: number,
  isCurrent?: StalkerLiveCommitOwnershipCheck,
) {
  const assertCurrent = () => assertStalkerLiveCommitCurrent(isCurrent);
  assertCurrent();
  return swapStagingToProvider({
    providerId,
    kinds: ["live"],
    liveCategories: categories.map((category) => ({
      category_id: category.id,
      category_name: category.name,
    })),
    vodCategories: [],
    seriesCategories: [],
    readyMessage: "Stalker Live catalog ready",
    readyStamp: "background",
    syncTotal: itemCount,
    committedCounts: { live: itemCount, vod: 0, series: 0 },
    assertStillOwned: assertCurrent,
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
