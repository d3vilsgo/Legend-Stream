import * as SQLite from "expo-sqlite";
import { initCatalogCache, getCachedCategories, getCatalogSyncState } from "./catalogCache";
import {
  buildCatalogPageSql,
  catalogPageCursorFromRow,
  catalogPageCursorSeen,
  LIVE_CATEGORIES_WITH_NAMES_SQL,
  LIVE_CATEGORY_FIRST_SEEN_SQL,
  normalizeCatalogPageLimit,
  resolveLiveCategoryDisplayName,
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
import {
  recordM3UFirstQueryTiming,
  recordM3UIndexTiming,
  recordM3UPageDbOpen,
  recordM3USourceShape,
  type M3USourceShape,
} from "./m3uInAppDiagnostics";
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

async function pageDatabase(diagnosticM3U = false) {
  const startedAt = Date.now();
  if (diagnosticM3U) {
    safeLog.info("M3U_DB_PAGE_OPEN_BEGIN", { timestamp: startedAt });
  }
  await initCatalogCache();
  if (!pageDatabasePromise) pageDatabasePromise = SQLite.openDatabaseAsync(CATALOG_DB_NAME);
  const db = await pageDatabasePromise;
  if (!pageIndexesReady) {
    const indexes = [
      {
        name: "provider_kind_effective_name",
        sql: `
          CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_kind_effective_name
            ON catalog_items(
              provider_id,
              kind,
              (CASE WHEN added_at > 0 THEN added_at ELSE first_seen_at END) DESC,
              name COLLATE NOCASE,
              item_id
            );
        `,
      },
      {
        name: "provider_kind_category_effective_name",
        sql: `
          CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_kind_category_effective_name
            ON catalog_items(
              provider_id,
              kind,
              category_id,
              (CASE WHEN added_at > 0 THEN added_at ELSE first_seen_at END) DESC,
              name COLLATE NOCASE,
              item_id
            );
        `,
      },
      {
        name: "provider_kind_name",
        sql: `
          CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_kind_name
            ON catalog_items(provider_id, kind, name COLLATE NOCASE, item_id);
        `,
      },
    ] as const;
    for (const index of indexes) {
      const indexStartedAt = Date.now();
      if (diagnosticM3U) {
        safeLog.info("M3U_INDEX_CREATE_BEGIN", { index: index.name, timestamp: indexStartedAt });
      }
      await db.execAsync(index.sql);
      if (diagnosticM3U) {
        const elapsedMs = Date.now() - indexStartedAt;
        safeLog.info("M3U_INDEX_CREATE_END", {
          index: index.name,
          elapsedMs,
          timestamp: Date.now(),
        });
        recordM3UIndexTiming(index.name, elapsedMs);
      }
    }
    pageIndexesReady = true;
  }
  if (diagnosticM3U) {
    const elapsedMs = Date.now() - startedAt;
    safeLog.info("M3U_DB_PAGE_OPEN_END", {
      elapsedMs,
      timestamp: Date.now(),
    });
    recordM3UPageDbOpen(elapsedMs);
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
    provider.type === request.providerType &&
    (
      provider.type === "m3u" ||
      provider.type === "xtream" ||
      (provider.type === "stalker" && request.kind === "live")
    )
  );
}

export async function getCachedCatalogPage<K extends CatalogPageKind>(
  provider: CatalogRuntimeProvider,
  request: CatalogPageRequest & { kind: K },
): Promise<CatalogPageResult<CatalogPageItem<K>>> {
  if (!compatibleProvider(provider, request)) {
    throw new Error("Catalog page provider does not match the active request.");
  }
  const db = await pageDatabase(request.providerType === "m3u");
  const plan = buildCatalogPageSql(request);

  const countStartedAt = Date.now();
  const countRow = await db.getFirstAsync<{ count: number }>(plan.countSql, ...plan.countArgs);
  const rawTotal = Math.max(0, Number(countRow?.count ?? 0));
  const state = await getCatalogSyncState(request.providerId);
  const countKnown = rawTotal > 0 || state?.phase === "ready";
  const catalogCountMs = Date.now() - countStartedAt;
  if (request.providerType === "m3u") recordM3UFirstQueryTiming("countQueryMs", catalogCountMs);

  const pageReadStartedAt = Date.now();
  const rows = await db.getAllAsync<CatalogPageSqlRow>(plan.pageSql, ...plan.pageArgs);
  const catalogPageReadMs = Date.now() - pageReadStartedAt;
  if (request.providerType === "m3u") recordM3UFirstQueryTiming("pageQueryMs", catalogPageReadMs);

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

export async function getM3UDiagnosticSourceShape(providerId: string): Promise<M3USourceShape> {
  const db = await pageDatabase(true);
  const aggregate = await db.getFirstAsync<{
    live_items: number | null;
    vod_items: number | null;
    series_items: number | null;
    live_categories: number | null;
    vod_categories: number | null;
    series_categories: number | null;
    empty_categories: number | null;
    avg_payload_len: number | null;
    max_payload_len: number | null;
    avg_name_len: number | null;
    max_name_len: number | null;
  }>(
    `SELECT
      SUM(CASE WHEN kind = 'live' THEN 1 ELSE 0 END) AS live_items,
      SUM(CASE WHEN kind = 'vod' THEN 1 ELSE 0 END) AS vod_items,
      SUM(CASE WHEN kind = 'series' THEN 1 ELSE 0 END) AS series_items,
      COUNT(DISTINCT CASE WHEN kind = 'live' AND COALESCE(category_id, '') <> '' THEN category_id END) AS live_categories,
      COUNT(DISTINCT CASE WHEN kind = 'vod' AND COALESCE(category_id, '') <> '' THEN category_id END) AS vod_categories,
      COUNT(DISTINCT CASE WHEN kind = 'series' AND COALESCE(category_id, '') <> '' THEN category_id END) AS series_categories,
      SUM(CASE WHEN category_id IS NULL OR TRIM(category_id) = '' THEN 1 ELSE 0 END) AS empty_categories,
      AVG(LENGTH(COALESCE(payload, ''))) AS avg_payload_len,
      MAX(LENGTH(COALESCE(payload, ''))) AS max_payload_len,
      AVG(LENGTH(COALESCE(name, ''))) AS avg_name_len,
      MAX(LENGTH(COALESCE(name, ''))) AS max_name_len
    FROM catalog_items
    WHERE provider_id = ?`,
    providerId,
  );
  const maxCategory = await db.getFirstAsync<{ max_items: number | null }>(
    `SELECT MAX(item_count) AS max_items FROM (
      SELECT kind, COALESCE(category_id, '') AS category_key, COUNT(*) AS item_count
      FROM catalog_items
      WHERE provider_id = ?
      GROUP BY kind, COALESCE(category_id, '')
    )`,
    providerId,
  );
  const duplicates = await db.getFirstAsync<{ duplicate_count: number | null }>(
    `SELECT COALESCE(SUM(item_count - 1), 0) AS duplicate_count FROM (
      SELECT kind, item_id, COUNT(*) AS item_count
      FROM catalog_items
      WHERE provider_id = ?
      GROUP BY kind, item_id
      HAVING COUNT(*) > 1
    )`,
    providerId,
  );
  const shape: M3USourceShape = {
    liveItems: Math.max(0, Number(aggregate?.live_items ?? 0)),
    vodItems: Math.max(0, Number(aggregate?.vod_items ?? 0)),
    seriesItems: Math.max(0, Number(aggregate?.series_items ?? 0)),
    liveCategories: Math.max(0, Number(aggregate?.live_categories ?? 0)),
    vodCategories: Math.max(0, Number(aggregate?.vod_categories ?? 0)),
    seriesCategories: Math.max(0, Number(aggregate?.series_categories ?? 0)),
    maxCategoryItems: Math.max(0, Number(maxCategory?.max_items ?? 0)),
    duplicateIds: Math.max(0, Number(duplicates?.duplicate_count ?? 0)),
    emptyCategories: Math.max(0, Number(aggregate?.empty_categories ?? 0)),
    avgPayloadLen: Math.max(0, Math.round(Number(aggregate?.avg_payload_len ?? 0))),
    maxPayloadLen: Math.max(0, Number(aggregate?.max_payload_len ?? 0)),
    avgNameLen: Math.max(0, Math.round(Number(aggregate?.avg_name_len ?? 0))),
    maxNameLen: Math.max(0, Number(aggregate?.max_name_len ?? 0)),
  };
  recordM3USourceShape(shape);
  return shape;
}

export async function getCachedCatalogCategories(
  providerId: string,
  kind: CatalogPageKind,
  diagnosticM3U = false,
): Promise<XtreamCategory[]> {
  const categoryStartedAt = Date.now();
  if (kind !== "live") {
    const result = await getCachedCategories(providerId, kind);
    if (diagnosticM3U) recordM3UFirstQueryTiming("categoryQueryMs", Date.now() - categoryStartedAt);
    return result;
  }
  const db = await pageDatabase(diagnosticM3U);
  const sample = await db.getFirstAsync<{ payload: string | null }>(
    `SELECT payload FROM catalog_items
      WHERE provider_id = ? AND kind = 'live'
      ORDER BY rowid ASC LIMIT 1`,
    providerId,
  );
  let stalkerLive = false;
  if (sample?.payload) {
    try {
      const persisted = normalizePersistedCatalogPayload(providerId, "live", JSON.parse(sample.payload));
      stalkerLive = persisted?.catalogKind === "live" && persisted.playbackRef.type === "stalker-live";
    } catch {
      stalkerLive = false;
    }
  }
  if (!stalkerLive) {
    const rows = await db.getAllAsync<{ category_id: string }>(
      LIVE_CATEGORY_FIRST_SEEN_SQL,
      providerId,
    );
    if (diagnosticM3U) recordM3UFirstQueryTiming("categoryQueryMs", Date.now() - categoryStartedAt);
    return rows.map((row) => ({
      category_id: row.category_id,
      category_name: row.category_id,
    }));
  }
  const rows = await db.getAllAsync<{ category_id: string; category_name: string | null }>(
    LIVE_CATEGORIES_WITH_NAMES_SQL,
    providerId,
    providerId,
  );
  if (diagnosticM3U) recordM3UFirstQueryTiming("categoryQueryMs", Date.now() - categoryStartedAt);
  return rows.map((row) => ({
    category_id: row.category_id,
    category_name: resolveLiveCategoryDisplayName(row.category_id, row.category_name),
  }));
}

export async function getCachedCatalogCategoryMetadata(
  providerId: string,
  diagnosticM3U = false,
): Promise<CatalogCategoryMetadata> {
  const db = await pageDatabase(diagnosticM3U);
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
