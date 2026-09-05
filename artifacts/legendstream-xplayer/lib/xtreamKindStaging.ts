import * as SQLite from "expo-sqlite";
import { enqueueCatalogDbWrite } from "./catalogDbWriter";
import type { CatalogKind } from "./catalogPersistence";

const DB_NAME = "legendstream-catalog-v1.db";
const STAGING_PROVIDER_PREFIX = "__staging__";
let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

function database() {
  if (!databasePromise) databasePromise = SQLite.openDatabaseAsync(DB_NAME);
  return databasePromise;
}

export function xtreamKindStagingProviderId(
  providerId: string,
  generation: number,
  kind: CatalogKind,
) {
  return `${STAGING_PROVIDER_PREFIX}${providerId}::xtream::${generation}::${kind}`;
}

export async function cleanupXtreamKindStaging(
  providerId: string,
  generation: number,
  kind: CatalogKind,
) {
  const stagingId = xtreamKindStagingProviderId(providerId, generation, kind);
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

export async function getXtreamKindRowCount(
  providerId: string,
  kind: CatalogKind,
) {
  const db = await database();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM catalog_items WHERE provider_id = ? AND kind = ?",
    providerId,
    kind,
  );
  return Number(row?.count ?? 0);
}

export async function publishXtreamKindStaging(
  providerId: string,
  generation: number,
  kind: CatalogKind,
  isCurrent: () => boolean,
) {
  const stagingId = xtreamKindStagingProviderId(providerId, generation, kind);
  return enqueueCatalogDbWrite(async () => {
    if (!isCurrent()) throw new Error("Xtream catalog staging ownership expired.");
    const db = await database();
    let stagedCount = 0;
    let activeCount = 0;

    await db.withExclusiveTransactionAsync(async (txn) => {
      if (!isCurrent()) throw new Error("Xtream catalog staging ownership expired.");
      const staged = await txn.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM catalog_items WHERE provider_id = ? AND kind = ?",
        stagingId,
        kind,
      );
      stagedCount = Number(staged?.count ?? 0);

      await txn.runAsync(
        "DELETE FROM catalog_items WHERE provider_id = ? AND kind = ?",
        providerId,
        kind,
      );
      if (!isCurrent()) throw new Error("Xtream catalog staging ownership expired.");
      await txn.runAsync(
        "UPDATE catalog_items SET provider_id = ? WHERE provider_id = ? AND kind = ?",
        providerId,
        stagingId,
        kind,
      );

      if (kind !== "live") {
        if (!isCurrent()) throw new Error("Xtream catalog staging ownership expired.");
        await txn.runAsync(
          "DELETE FROM catalog_categories WHERE provider_id = ? AND kind = ?",
          providerId,
          kind,
        );
        await txn.runAsync(
          "UPDATE catalog_categories SET provider_id = ? WHERE provider_id = ? AND kind = ?",
          providerId,
          stagingId,
          kind,
        );
      }

      if (!isCurrent()) throw new Error("Xtream catalog staging ownership expired.");
      const active = await txn.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM catalog_items WHERE provider_id = ? AND kind = ?",
        providerId,
        kind,
      );
      activeCount = Number(active?.count ?? 0);
    });

    return { stagedCount, activeCount };
  });
}
