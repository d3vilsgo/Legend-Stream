import * as SQLite from "expo-sqlite";
import { initCatalogCache } from "./catalogCache";
import {
  buildCatalogPageSql,
  catalogPageCursorFromRow,
  catalogPageCursorSeen,
  type CatalogPageRequest,
  type CatalogPageSqlRow,
} from "./catalogPaging";
import { liveRuntimeItem, type CatalogRuntimeProvider } from "./catalogRuntime";
import { normalizePersistedCatalogPayload } from "./catalogPersistence";
import type { Channel } from "./iptv";

const CATALOG_DB_NAME = "legendstream-catalog-v1.db";
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function database() {
  await initCatalogCache();
  if (!databasePromise) databasePromise = SQLite.openDatabaseAsync(CATALOG_DB_NAME);
  return databasePromise;
}

export async function getCachedStalkerLivePage(
  provider: CatalogRuntimeProvider,
  request: CatalogPageRequest & { kind: "live" },
) {
  if (
    provider.type !== "stalker" ||
    request.providerType !== "stalker" ||
    provider.id !== request.providerId
  ) {
    throw new Error("Stalker Live page provider does not match the active request.");
  }

  const db = await database();
  const plan = buildCatalogPageSql(request);
  const countStartedAt = Date.now();
  const countRow = await db.getFirstAsync<{ count: number }>(plan.countSql, ...plan.countArgs);
  const rawTotal = Math.max(0, Number(countRow?.count ?? 0));
  const catalogCountMs = Date.now() - countStartedAt;

  const pageReadStartedAt = Date.now();
  const rows = await db.getAllAsync<CatalogPageSqlRow>(plan.pageSql, ...plan.pageArgs);
  const catalogPageReadMs = Date.now() - pageReadStartedAt;

  const pageMapStartedAt = Date.now();
  const items: Channel[] = [];
  for (const row of rows) {
    if (!row.payload) continue;
    try {
      const persisted = normalizePersistedCatalogPayload(
        provider.id,
        "live",
        JSON.parse(row.payload),
      );
      if (persisted?.catalogKind === "live") items.push(liveRuntimeItem(persisted, provider));
    } catch {
      // Malformed rows stay isolated to this bounded page.
    }
  }
  const catalogPageMapMs = Date.now() - pageMapStartedAt;
  const seen = catalogPageCursorSeen(request.cursor) + rows.length;
  const hasMore = seen < rawTotal;
  const nextCursor = hasMore && rows.length
    ? catalogPageCursorFromRow(request, rows[rows.length - 1], request.cursor, rows.length)
    : null;

  return {
    items,
    totalCount: rawTotal,
    countKnown: true,
    nextCursor,
    hasMore,
    metrics: { catalogCountMs, catalogPageReadMs, catalogPageMapMs },
  };
}
