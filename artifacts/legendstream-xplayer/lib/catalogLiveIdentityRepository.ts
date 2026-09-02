import * as SQLite from "expo-sqlite";
import { initCatalogCache } from "./catalogCache";
import {
  chunkLiveIdentityIds,
  normalizeLiveIdentityIds,
} from "./catalogLiveIdentity";
import {
  liveRuntimeItem,
  type CatalogRuntimeProvider,
} from "./catalogRuntime";
import { normalizePersistedCatalogPayload } from "./catalogPersistence";
import type { Channel } from "./iptv";

const CATALOG_DB_NAME = "legendstream-catalog-v1.db";
let liveIdentityDbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function liveIdentityDatabase() {
  await initCatalogCache();
  if (!liveIdentityDbPromise) {
    liveIdentityDbPromise = SQLite.openDatabaseAsync(CATALOG_DB_NAME);
  }
  return liveIdentityDbPromise;
}

export async function getCachedLiveItemsByIds(
  provider: CatalogRuntimeProvider,
  ids: readonly string[],
): Promise<Channel[]> {
  if (provider.type !== "m3u" && provider.type !== "xtream") return [];
  const requestedIds = normalizeLiveIdentityIds(ids);
  if (!requestedIds.length) return [];

  const db = await liveIdentityDatabase();
  const resolved = new Map<string, Channel>();
  for (const chunk of chunkLiveIdentityIds(requestedIds)) {
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db.getAllAsync<{ item_id: string; payload: string | null }>(
      `SELECT item_id, payload
         FROM catalog_items
        WHERE provider_id = ?
          AND kind = 'live'
          AND item_id IN (${placeholders})`,
      provider.id,
      ...chunk,
    );
    for (const row of rows) {
      if (!row.payload) continue;
      try {
        const persisted = normalizePersistedCatalogPayload(
          JSON.parse(row.payload),
          provider.id,
          "live",
        );
        if (persisted.catalogKind !== "live" || persisted.providerId !== provider.id) continue;
        resolved.set(row.item_id, liveRuntimeItem(persisted, provider));
      } catch {
        // Malformed persisted rows are skipped without widening the requested ID set.
      }
    }
  }

  return requestedIds.map((id) => resolved.get(id))
    .filter((item): item is Channel => Boolean(item));
}
