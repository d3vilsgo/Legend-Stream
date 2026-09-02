import * as SQLite from "expo-sqlite";
import { initCatalogCache, getCachedCategories, getCatalogSyncState } from "./catalogCache";
import {
  buildCatalogPageSql,
  catalogPageCursorFromRow,
  catalogPageCursorSeen,
  normalizeCatalogPageLimit,
  type CatalogPageKind,
  type CatalogPageRequest,
  type CatalogPageSqlRow,
} from "./catalogPaging";
import {
  liveRuntimeItem,
  vodRuntimeItem,
  type CatalogRuntimeProvider,
} from "./catalogRuntime";
import {
  normalizePersistedCatalogPayload,
  type PersistedLiveCatalogItem,
  type PersistedSeriesCatalogItem,
  type PersistedVodCatalogItem,
} from "./catalogPersistence";
import { buildM3UDirectHydrationCooperatively } from "./m3uCatalogHydration";
import { safeLog } from "./safeLog";
import { yieldToUi } from "./cooperative";
import type { Channel } from "./iptv";
import type {
  XtreamCategory,
  XtreamSeriesInfo,
  XtreamSeriesItem,
  XtreamVodItem,
} from "./xtreamCatalog";

const CATALOG_DB_NAME = "legendstream-catalog-v1.db";
const LIVE_PLAYBACK_WINDOW_MAX = 500;
const VOD_PLAYBACK_WINDOW_MAX = 500;

let pageDatabasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let pageIndexesReady = false;

export type CatalogPageMetrics = {
  catalogCountMs: number;
  catalogPageReadMs: number;
  catalogPageMapMs: number;
};

export type CatalogPageResult<T> = {
  items: T[];
  totalCount: number | null;
  countKnown: boolean;
  nextCursor: string | null;
  hasMore: boolean;
  metrics: CatalogPageMetrics;
};

export type CatalogPageItems = {
  live: Channel[];
  vod: XtreamVodItem[];
  series: XtreamSeriesItem[];
};

export type CatalogPageItem<K extends CatalogPageKind> = CatalogPageItems[K][number];

export type CatalogPlaybackIdentity = {
  providerId: string;
  itemId: string;
};

export type CatalogCategoryMetadata = {
  vodCategories: number;
  seriesCategories: number;
  hasMeaningfulM3ULiveGroups: boolean;
};

async function pageDatabase() {
  await initCatalogCache();
  if (!pageDatabasePromise) pageDatabasePromise = SQLite.openDatabaseAsync(CATALOG_DB_NAME);
  const db = await pageDatabasePromise;
  if (!pageIndexesReady) {
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_kind_effective_name
        ON catalog_items(
          provider_id,
          kind,
          (CASE WHEN added_at > 0 THEN added_at ELSE first_seen_at END) DESC,
          name COLLATE NOCASE,
          item_id
        );
      CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_kind_category_effective_name
        ON catalog_items(
          provider_id,
          kind,
          category_id,
          (CASE WHEN added_at > 0 THEN added_at ELSE first_seen_at END) DESC,
          name COLLATE NOCASE,
          item_id
        );
      CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_kind_name
        ON catalog_items(provider_id, kind, name COLLATE NOCASE, item_id);
    `);
    pageIndexesReady = true;
  }
  return db;
}

function safePayload(
  row: CatalogPageSqlRow,
): PersistedLiveCatalogItem | PersistedVodCatalogItem | PersistedSeriesCatalogItem | null {
  if (!row.payload) return null;
  try {
    return normalizePersistedCatalogPayload(
      row.provider_id,
      row.kind,
      JSON.parse(row.payload),
    );
  } catch {
    return null;
  }
}

function mapRows(
  provider: CatalogRuntimeProvider,
  request: CatalogPageRequest,
  rows: CatalogPageSqlRow[],
): CatalogPageItems[CatalogPageKind] {
  if (request.kind === "series") {
    return rows.map<XtreamSeriesItem>((row) => ({
      series_id: row.item_id,
      name: row.name,
      cover: row.image_url ?? undefined,
      category_id: row.category_id ?? undefined,
    }));
  }

  if (request.kind === "live") {
    const items: Channel[] = [];
    for (const row of rows) {
      const persisted = safePayload(row);
      if (persisted?.catalogKind === "live") {
        items.push(liveRuntimeItem(persisted, provider));
      }
    }
    return items;
  }

  const items: XtreamVodItem[] = [];
  for (const row of rows) {
    const persisted = safePayload(row);
    if (persisted?.catalogKind === "vod") {
      items.push(vodRuntimeItem(persisted, provider));
    }
  }
  return items;
}

function compatibleProvider(provider: CatalogRuntimeProvider, request: CatalogPageRequest) {
  return (
    provider.id === request.providerId &&
    (provider.type === "m3u" || provider.type === "xtream") &&
    provider.type === request.providerType
  );
}

export async function getCachedCatalogPage<K extends CatalogPageKind>(
  provider: CatalogRuntimeProvider,
  request: CatalogPageRequest & { kind: K },
): Promise<CatalogPageResult<CatalogPageItem<K>>> {
  if (!compatibleProvider(provider, request)) {
    throw new Error("Catalog page provider does not match the active request.");
  }
  const db = await pageDatabase();
  const plan = buildCatalogPageSql(request);

  const countStartedAt = Date.now();
  const countRow = await db.getFirstAsync<{ count: number }>(plan.countSql, ...plan.countArgs);
  const rawTotal = Math.max(0, Number(countRow?.count ?? 0));
  const state = await getCatalogSyncState(request.providerId);
  const countKnown = rawTotal > 0 || state?.phase === "ready";
  const catalogCountMs = Date.now() - countStartedAt;

  const pageReadStartedAt = Date.now();
  const rows = await db.getAllAsync<CatalogPageSqlRow>(plan.pageSql, ...plan.pageArgs);
  const catalogPageReadMs = Date.now() - pageReadStartedAt;

  const pageMapStartedAt = Date.now();
  const items = mapRows(provider, request, rows) as CatalogPageItem<K>[];
  const catalogPageMapMs = Date.now() - pageMapStartedAt;

  const seen = catalogPageCursorSeen(request.cursor) + rows.length;
  const hasMore = countKnown
    ? seen < rawTotal
    : rows.length === plan.limit;
  const nextCursor = hasMore && rows.length
    ? catalogPageCursorFromRow(request, rows[rows.length - 1], request.cursor, rows.length)
    : null;
  const totalCount = countKnown ? rawTotal : null;

  safeLog.info("LS_CATALOG_PAGE", {
    providerType: request.providerType,
    kind: request.kind,
    limit: plan.limit,
    rowsReturned: items.length,
    hasMore,
    catalogCountMs,
    catalogPageReadMs,
    catalogPageMapMs,
  });

  return {
    items,
    totalCount,
    countKnown,
    nextCursor,
    hasMore,
    metrics: { catalogCountMs, catalogPageReadMs, catalogPageMapMs },
  };
}

export function noteCatalogPageCommit(
  request: Pick<CatalogPageRequest, "providerType" | "kind" | "limit">,
  rowsReturned: number,
  hasMore: boolean,
  catalogPageCommitMs: number,
) {
  safeLog.info("LS_CATALOG_PAGE_COMMIT", {
    providerType: request.providerType,
    kind: request.kind,
    limit: normalizeCatalogPageLimit(request.limit),
    rowsReturned,
    hasMore,
    catalogPageCommitMs: Math.max(0, Math.trunc(catalogPageCommitMs)),
  });
}

export async function getCachedCatalogCategories(
  providerId: string,
  kind: CatalogPageKind,
): Promise<XtreamCategory[]> {
  if (kind !== "live") return getCachedCategories(providerId, kind);
  const db = await pageDatabase();
  const rows = await db.getAllAsync<{ category_id: string }>(
    `SELECT DISTINCT category_id
       FROM catalog_items
      WHERE provider_id = ?
        AND kind = 'live'
        AND category_id IS NOT NULL
        AND category_id <> ''
      ORDER BY category_id COLLATE NOCASE ASC`,
    providerId,
  );
  return rows.map((row) => ({
    category_id: row.category_id,
    category_name: row.category_id,
  }));
}

export async function getCachedCatalogCategoryMetadata(
  providerId: string,
): Promise<CatalogCategoryMetadata> {
  const db = await pageDatabase();
  const row = await db.getFirstAsync<{
    vod_categories: number;
    series_categories: number;
    meaningful_live_groups: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM catalog_categories WHERE provider_id = ? AND kind = 'vod') AS vod_categories,
       (SELECT COUNT(*) FROM catalog_categories WHERE provider_id = ? AND kind = 'series') AS series_categories,
       EXISTS(
         SELECT 1
           FROM catalog_items
          WHERE provider_id = ?
            AND kind = 'live'
            AND category_id IS NOT NULL
            AND TRIM(category_id) <> ''
            AND LOWER(TRIM(category_id)) NOT IN ('uncategorized', 'live tv')
          LIMIT 1
       ) AS meaningful_live_groups`,
    providerId,
    providerId,
    providerId,
  );
  return {
    vodCategories: Math.max(0, Number(row?.vod_categories ?? 0)),
    seriesCategories: Math.max(0, Number(row?.series_categories ?? 0)),
    hasMeaningfulM3ULiveGroups: Number(row?.meaningful_live_groups ?? 0) === 1,
  };
}

async function persistedSeriesRow(providerId: string, seriesId: string) {
  const db = await pageDatabase();
  const row = await db.getFirstAsync<{ payload: string }>(
    `SELECT payload
       FROM catalog_items
      WHERE provider_id = ? AND kind = 'series' AND item_id = ?
      LIMIT 1`,
    providerId,
    seriesId,
  );
  if (!row?.payload) return null;
  try {
    const persisted = normalizePersistedCatalogPayload(
      providerId,
      "series",
      JSON.parse(row.payload),
    );
    return persisted?.catalogKind === "series" ? persisted : null;
  } catch {
    return null;
  }
}

export async function loadM3USeriesInfoFromCache(
  provider: CatalogRuntimeProvider,
  seriesId: string | number,
): Promise<XtreamSeriesInfo | null> {
  if (provider.type !== "m3u") return null;
  const persisted = await persistedSeriesRow(provider.id, String(seriesId));
  if (!persisted) return null;
  const direct = await buildM3UDirectHydrationCooperatively(
    provider,
    [],
    [],
    [persisted],
    { yieldFn: yieldToUi },
  );
  const group = direct.catalog.seriesGroups[0];
  const item = direct.series[0];
  if (!group || !item) return null;
  return {
    info: item,
    episodes: Object.fromEntries(
      Object.entries(group.seasons).map(([season, episodes]) => [
        season,
        episodes.map((episode) => ({
          id: episode.id,
          episode_num: episode.episode,
          title: episode.title,
          direct_source: episode.streamUrl,
        })),
      ]),
    ),
  };
}

function rowCategoryPredicate(categoryId: string | null) {
  return categoryId === null
    ? { sql: "category_id IS NULL", args: [] as string[] }
    : { sql: "category_id = ?", args: [categoryId] };
}

async function currentCatalogRow(providerId: string, kind: "live" | "vod", itemId: string) {
  const db = await pageDatabase();
  return db.getFirstAsync<{
    row_id: number;
    item_id: string;
    category_id: string | null;
    name: string;
    payload: string;
    effective_order: number;
  }>(
    `SELECT rowid AS row_id, item_id, category_id, name, payload,
            CASE WHEN added_at > 0 THEN added_at ELSE first_seen_at END AS effective_order
       FROM catalog_items
      WHERE provider_id = ? AND kind = ? AND item_id = ?
      LIMIT 1`,
    providerId,
    kind,
    itemId,
  );
}

export async function getCachedLivePlaybackWindow(
  provider: CatalogRuntimeProvider,
  identity: CatalogPlaybackIdentity,
  limit = LIVE_PLAYBACK_WINDOW_MAX,
): Promise<Channel[]> {
  if (provider.id !== identity.providerId) return [];
  const db = await pageDatabase();
  const current = await currentCatalogRow(provider.id, "live", identity.itemId);
  if (!current) return [];
  const safeLimit = Math.max(1, Math.min(LIVE_PLAYBACK_WINDOW_MAX, Math.trunc(limit)));
  const beforeLimit = Math.floor((safeLimit - 1) / 2);
  const afterLimit = safeLimit - beforeLimit - 1;
  const category = rowCategoryPredicate(current.category_id);
  const before = await db.getAllAsync<{ payload: string }>(
    `SELECT payload
       FROM catalog_items
      WHERE provider_id = ? AND kind = 'live' AND ${category.sql} AND rowid < ?
      ORDER BY rowid DESC
      LIMIT ?`,
    provider.id,
    ...category.args,
    current.row_id,
    beforeLimit,
  );
  const after = await db.getAllAsync<{ payload: string }>(
    `SELECT payload
       FROM catalog_items
      WHERE provider_id = ? AND kind = 'live' AND ${category.sql} AND rowid > ?
      ORDER BY rowid ASC
      LIMIT ?`,
    provider.id,
    ...category.args,
    current.row_id,
    afterLimit,
  );
  const payloads = [...before.reverse(), { payload: current.payload }, ...after];
  const channels: Channel[] = [];
  for (const row of payloads) {
    try {
      const persisted = normalizePersistedCatalogPayload(provider.id, "live", JSON.parse(row.payload));
      if (persisted?.catalogKind === "live") channels.push(liveRuntimeItem(persisted, provider));
    } catch {
      // Skip malformed persisted rows without widening the bounded playback window.
    }
  }
  return channels;
}

export async function getCachedVodPlaybackWindow(
  provider: CatalogRuntimeProvider,
  identity: CatalogPlaybackIdentity,
  limit = VOD_PLAYBACK_WINDOW_MAX,
): Promise<XtreamVodItem[]> {
  if (provider.id !== identity.providerId) return [];
  const db = await pageDatabase();
  const current = await currentCatalogRow(provider.id, "vod", identity.itemId);
  if (!current) return [];
  const safeLimit = Math.max(1, Math.min(VOD_PLAYBACK_WINDOW_MAX, Math.trunc(limit)));
  const beforeLimit = Math.floor((safeLimit - 1) / 2);
  const afterLimit = safeLimit - beforeLimit - 1;
  const category = rowCategoryPredicate(current.category_id);
  const before = await db.getAllAsync<{ payload: string }>(
    `SELECT payload
       FROM catalog_items
      WHERE provider_id = ? AND kind = 'vod' AND ${category.sql}
        AND (
          (CASE WHEN added_at > 0 THEN added_at ELSE first_seen_at END) > ? OR
          ((CASE WHEN added_at > 0 THEN added_at ELSE first_seen_at END) = ? AND
            (name COLLATE NOCASE < ? OR (name COLLATE NOCASE = ? AND item_id < ?)))
        )
      ORDER BY (CASE WHEN added_at > 0 THEN added_at ELSE first_seen_at END) ASC,
               name COLLATE NOCASE DESC,
               item_id DESC
      LIMIT ?`,
    provider.id,
    ...category.args,
    current.effective_order,
    current.effective_order,
    current.name,
    current.name,
    current.item_id,
    beforeLimit,
  );
  const after = await db.getAllAsync<{ payload: string }>(
    `SELECT payload
       FROM catalog_items
      WHERE provider_id = ? AND kind = 'vod' AND ${category.sql}
        AND (
          (CASE WHEN added_at > 0 THEN added_at ELSE first_seen_at END) < ? OR
          ((CASE WHEN added_at > 0 THEN added_at ELSE first_seen_at END) = ? AND
            (name COLLATE NOCASE > ? OR (name COLLATE NOCASE = ? AND item_id > ?)))
        )
      ORDER BY (CASE WHEN added_at > 0 THEN added_at ELSE first_seen_at END) DESC,
               name COLLATE NOCASE ASC,
               item_id ASC
      LIMIT ?`,
    provider.id,
    ...category.args,
    current.effective_order,
    current.effective_order,
    current.name,
    current.name,
    current.item_id,
    afterLimit,
  );
  const payloads = [...before.reverse(), { payload: current.payload }, ...after];
  const items: XtreamVodItem[] = [];
  for (const row of payloads) {
    try {
      const persisted = normalizePersistedCatalogPayload(provider.id, "vod", JSON.parse(row.payload));
      if (persisted?.catalogKind === "vod") items.push(vodRuntimeItem(persisted, provider));
    } catch {
      // Skip malformed persisted rows without widening the bounded playback window.
    }
  }
  return items;
}
