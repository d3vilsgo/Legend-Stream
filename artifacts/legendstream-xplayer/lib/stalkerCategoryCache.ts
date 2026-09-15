import * as SQLite from "expo-sqlite";
import { initCatalogCache } from "./catalogCache";
import { enqueueCatalogDbWrite } from "./catalogDbWriter";
import type { StalkerLiveCategory } from "./stalkerLiveCatalog";

const CATALOG_DB_NAME = "legendstream-catalog-v1.db";
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function database() {
  await initCatalogCache();
  if (!databasePromise) databasePromise = SQLite.openDatabaseAsync(CATALOG_DB_NAME);
  return databasePromise;
}

export async function persistStalkerLiveCategories(
  providerId: string,
  categories: readonly StalkerLiveCategory[],
) {
  const db = await database();
  return enqueueCatalogDbWrite(async () => {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync(
        "DELETE FROM catalog_categories WHERE provider_id = ? AND kind = 'live'",
        providerId,
      );
      for (const category of categories) {
        await txn.runAsync(
          `INSERT OR REPLACE INTO catalog_categories
           (provider_id, kind, category_id, category_name, parent_id)
           VALUES (?, 'live', ?, ?, NULL)`,
          providerId,
          category.id,
          category.name || category.id,
        );
      }
    });
  });
}
