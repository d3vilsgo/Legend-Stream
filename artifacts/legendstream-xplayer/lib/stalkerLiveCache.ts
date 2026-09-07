import * as SQLite from "expo-sqlite";
import {
  cleanupStagingCatalog,
  initCatalogCache,
  stagingProviderId,
  swapStagingToProvider,
  upsertCatalogItems,
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
  isCurrent?: StalkerLiveCommitOwnershipCheck,
) {
  const assertCurrent = () => assertStalkerLiveCommitCurrent(isCurrent);
  const stagingId = stagingProviderId(providerId);
  const staged = items.map((item) => ({ ...item, providerId: stagingId }));

  // Stalker uses the cancellable shared writer path here on purpose. The
  // ownership check runs before queueing, again after the shared-writer wait,
  // and at the SQLite transaction/statement boundary. Therefore a stale run
  // can either finish before a newer run's serialized cleanup (and be erased)
  // or observe lost ownership after that cleanup (and perform no mutation).
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
