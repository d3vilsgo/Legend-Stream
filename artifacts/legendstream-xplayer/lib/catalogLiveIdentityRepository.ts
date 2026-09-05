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
import { legacyXtreamLiveStreamId, stableXtreamLiveId } from "./xtreamIdentity";

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

  const lookupByRequested = new Map<string, string>();
  for (const id of requestedIds) {
    const legacyStreamId = provider.type === "xtream" ? legacyXtreamLiveStreamId(id) : null;
    lookupByRequested.set(
      id,
      legacyStreamId ? stableXtreamLiveId(provider.id, legacyStreamId) : id,
    );
  }
  const lookupIds = normalizeLiveIdentityIds(Array.from(lookupByRequested.values()));

  const db = await liveIdentityDatabase();
  const resolved = new Map<string, Channel>();
  for (const chunk of chunkLiveIdentityIds(lookupIds)) {
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
          provider.id,
          "live",
          JSON.parse(row.payload),
        );
        if (persisted?.catalogKind !== "live" || persisted.providerId !== provider.id) continue;
        resolved.set(row.item_id, liveRuntimeItem(persisted, provider));
      } catch {
        // Malformed persisted rows are skipped without widening the requested ID set.
      }
    }
  }

  return requestedIds.map((requestedId) => {
    const lookupId = lookupByRequested.get(requestedId) ?? requestedId;
    const item = resolved.get(lookupId);
    if (!item) return undefined;
    return item.id === requestedId ? item : { ...item, id: requestedId };
  }).filter((item): item is Channel => Boolean(item));
}
