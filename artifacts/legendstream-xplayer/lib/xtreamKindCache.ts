import * as SQLite from "expo-sqlite";
import { enqueueCatalogDbWrite } from "./catalogDbWriter";
import type { CatalogKind } from "./catalogPersistence";
import type { XtreamCategory } from "./xtreamCatalog";

const DB_NAME = "legendstream-catalog-v1.db";
const STAGING_PROVIDER_PREFIX = "__staging__";
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function database() {
  if (!databasePromise) databasePromise = SQLite.openDatabaseAsync(DB_NAME);
  return databasePromise;
}

export function stagingCatalogProviderId(
  providerId: string,
  generation: number,
  kind: CatalogKind,
) {
  return `${STAGING_PROVIDER_PREFIX}${providerId}:xtream:${generation}:${kind}`;
}

export async function cleanupCatalogKindStaging(stagingId: string, kind: CatalogKind) {
  return enqueueCatalogDbWrite(async () => {
    const db = await database();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync(
        "DELETE FROM catalog_items WHERE provider_id = ? AND kind = ?",
        stagingId,
        kind,
      );
      await txn.runAsync(
        "DELETE FROM catalog_categories WHERE provider_id = ? AND kind = ?",
        stagingId,
        kind,
      );
    });
  });
}

type PublishStagedCatalogKindOptions = {
  providerId: string;
  stagingId: string;
  kind: CatalogKind;
  categories?: XtreamCategory[];
  expectedCount?: number;
  canPublish?: () => boolean;
};

type CountRow = { count: number };

export async function publishStagedCatalogKind(
  options: PublishStagedCatalogKindOptions,
): Promise<{ published: boolean; stagedCount: number; activeCount: number }> {
  return enqueueCatalogDbWrite(async () => {
    if (options.canPublish && !options.canPublish()) {
      return { published: false, stagedCount: 0, activeCount: 0 };
    }
    const db = await database();
    let result = { published: false, stagedCount: 0, activeCount: 0 };
    await db.withExclusiveTransactionAsync(async (txn) => {
      if (options.canPublish && !options.canPublish()) return;
      const staged = await txn.getFirstAsync<CountRow>(
        "SELECT COUNT(*) AS count FROM catalog_items WHERE provider_id = ? AND kind = ?",
        options.stagingId,
        options.kind,
      );
      const stagedCount = Number(staged?.count ?? 0);
      if (options.expectedCount !== undefined && stagedCount !== options.expectedCount) {
        throw new Error("Xtream staging count validation failed.");
      }

      await txn.runAsync(
        "DELETE FROM catalog_items WHERE provider_id = ? AND kind = ?",
        options.providerId,
        options.kind,
      );
      await txn.runAsync(
        "UPDATE catalog_items SET provider_id = ? WHERE provider_id = ? AND kind = ?",
        options.providerId,
        options.stagingId,
        options.kind,
      );

      if (options.kind !== "live" && options.categories) {
        await txn.runAsync(
          "DELETE FROM catalog_categories WHERE provider_id = ? AND kind = ?",
          options.providerId,
          options.kind,
        );
        for (const category of options.categories) {
          await txn.runAsync(
            `INSERT OR REPLACE INTO catalog_categories
             (provider_id, kind, category_id, category_name, parent_id)
             VALUES (?, ?, ?, ?, ?)`,
            options.providerId,
            options.kind,
            String(category.category_id),
            category.category_name || String(category.category_id),
            category.parent_id ?? null,
          );
        }
      }

      const active = await txn.getFirstAsync<CountRow>(
        "SELECT COUNT(*) AS count FROM catalog_items WHERE provider_id = ? AND kind = ?",
        options.providerId,
        options.kind,
      );
      if (options.canPublish && !options.canPublish()) {
        throw new Error("Xtream staging publish ownership lost.");
      }
      result = {
        published: true,
        stagedCount,
        activeCount: Number(active?.count ?? 0),
      };
    });
    return result;
  });
}
