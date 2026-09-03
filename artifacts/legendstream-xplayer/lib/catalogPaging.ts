export type CatalogPageKind = "live" | "vod" | "series";
export type CatalogPageProviderType = "m3u" | "xtream";
export type CatalogPageSort = "default" | "alphaAsc" | "alphaDesc" | "idAsc" | "idDesc" | "added";

export const DEFAULT_CATALOG_PAGE_SIZE = 100;
export const MAX_CATALOG_PAGE_SIZE = 200;
export const LIVE_CATEGORY_FIRST_SEEN_SQL = `SELECT category_id, MIN(rowid) AS first_row_id
   FROM catalog_items
  WHERE provider_id = ?
    AND kind = 'live'
    AND category_id IS NOT NULL
    AND TRIM(category_id) <> ''
    AND category_id <> '__all__'
  GROUP BY category_id
  ORDER BY first_row_id ASC`;

export type CatalogPageRequest = {
  providerId: string;
  providerType: CatalogPageProviderType;
  kind: CatalogPageKind;
  categoryId?: string;
  search?: string;
  sort: CatalogPageSort;
  cursor?: string;
  limit?: number;
};

export type CatalogPageSqlRow = {
  row_id: number;
  provider_id: string;
  kind: CatalogPageKind;
  item_id: string;
  category_id: string | null;
  name: string;
  image_url: string | null;
  payload: string | null;
  added_at: number;
  first_seen_at: number;
  last_seen_at: number;
  effective_order: number;
  numeric_id: number;
  added_fallback: number;
};

export type CatalogPageSqlPlan = {
  countSql: string;
  countArgs: Array<string | number>;
  pageSql: string;
  pageArgs: Array<string | number>;
  limit: number;
};

type CatalogCursor = {
  v: 1;
  queryKey: string;
  seen: number;
  rowId: number;
  itemId: string;
  name: string;
  effectiveOrder: number;
  numericId: number;
  addedAt: number;
  addedFallback: number;
};

export type CatalogCountResolution = {
  persistedTotal: number | null;
  persistedCountKnown: boolean;
  snapshotTotal: number | null;
  snapshotCountKnown: boolean;
};

export type CatalogCountUpdateResolution = CatalogCountResolution & {
  currentTotal: number | null;
  currentCountKnown: boolean;
};

const EFFECTIVE_ORDER_SQL = "CASE WHEN added_at > 0 THEN added_at ELSE first_seen_at END";
const NUMERIC_ID_SQL = "CASE WHEN item_id <> '' AND item_id NOT GLOB '*[^0-9]*' THEN CAST(item_id AS INTEGER) ELSE 9223372036854775807 END";
const ADDED_FALLBACK_SQL = "CASE WHEN added_at = 0 THEN first_seen_at ELSE 0 END";
const TURKISH_SEARCH_NAME_SQL = "LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(name, 'İ', 'i'), 'I', 'ı'), 'Ğ', 'ğ'), 'Ü', 'ü'), 'Ş', 'ş'), 'Ö', 'ö'), 'Ç', 'ç'))";

export function normalizeCatalogPageLimit(value?: number) {
  const numeric = Number(value ?? DEFAULT_CATALOG_PAGE_SIZE);
  if (!Number.isFinite(numeric)) return DEFAULT_CATALOG_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_CATALOG_PAGE_SIZE, Math.trunc(numeric)));
}

function normalizedCategory(value?: string) {
  const category = value?.trim();
  return !category || category === "__all__" ? "" : category;
}

export function normalizeCatalogSearchText(value?: string) {
  return value?.trim().normalize("NFC").toLocaleLowerCase("tr") ?? "";
}

export function catalogPageQueryKey(request: CatalogPageRequest) {
  return JSON.stringify({
    providerId: request.providerId,
    providerType: request.providerType,
    kind: request.kind,
    categoryId: normalizedCategory(request.categoryId),
    search: normalizeCatalogSearchText(request.search),
    sort: request.sort,
    limit: normalizeCatalogPageLimit(request.limit),
  });
}

function encodeCursor(cursor: CatalogCursor) {
  return encodeURIComponent(JSON.stringify(cursor));
}

function decodeCursor(value: string): CatalogCursor {
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<CatalogCursor>;
    if (
      parsed.v !== 1 ||
      typeof parsed.queryKey !== "string" ||
      typeof parsed.seen !== "number" ||
      typeof parsed.rowId !== "number" ||
      typeof parsed.itemId !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.effectiveOrder !== "number" ||
      typeof parsed.numericId !== "number" ||
      typeof parsed.addedAt !== "number" ||
      typeof parsed.addedFallback !== "number"
    ) {
      throw new Error("shape");
    }
    return parsed as CatalogCursor;
  } catch {
    throw new Error("Catalog page cursor is invalid.");
  }
}

function cursorForRequest(request: CatalogPageRequest) {
  if (!request.cursor) return null;
  const cursor = decodeCursor(request.cursor);
  if (cursor.queryKey !== catalogPageQueryKey({ ...request, cursor: undefined })) {
    throw new Error("Catalog page cursor does not match the current request.");
  }
  return cursor;
}

export function catalogPageCursorSeen(cursor?: string) {
  return cursor ? decodeCursor(cursor).seen : 0;
}

export function catalogPageCursorFromRow(
  request: CatalogPageRequest,
  row: Record<string, unknown>,
  previousCursor?: string,
  rowsReturned = normalizeCatalogPageLimit(request.limit),
) {
  const cleanRequest = { ...request, cursor: undefined };
  const previous = previousCursor ? decodeCursor(previousCursor) : null;
  if (previous && previous.queryKey !== catalogPageQueryKey(cleanRequest)) {
    throw new Error("Catalog page cursor does not match the current request.");
  }
  const numberField = (key: string) => {
    const value = Number(row[key]);
    if (!Number.isFinite(value)) throw new Error(`Catalog page cursor row is missing ${key}.`);
    return value;
  };
  const stringField = (key: string) => {
    const value = row[key];
    if (typeof value !== "string") throw new Error(`Catalog page cursor row is missing ${key}.`);
    return value;
  };
  return encodeCursor({
    v: 1,
    queryKey: catalogPageQueryKey(cleanRequest),
    seen: (previous?.seen ?? 0) + Math.max(0, Math.trunc(rowsReturned)),
    rowId: numberField("row_id"),
    itemId: stringField("item_id"),
    name: stringField("name"),
    effectiveOrder: numberField("effective_order"),
    numericId: numberField("numeric_id"),
    addedAt: numberField("added_at"),
    addedFallback: numberField("added_fallback"),
  });
}

export function resolveCatalogTotalCount(input: CatalogCountResolution): number | null {
  if (input.persistedCountKnown && input.persistedTotal !== null) {
    return Math.max(0, Math.trunc(input.persistedTotal));
  }
  if (input.snapshotCountKnown && input.snapshotTotal !== null) {
    return Math.max(0, Math.trunc(input.snapshotTotal));
  }
  return null;
}

export function resolveCatalogTotalCountUpdate(input: CatalogCountUpdateResolution): number | null {
  const incoming = resolveCatalogTotalCount(input);
  if (input.persistedCountKnown) return incoming;
  if (input.currentCountKnown && input.currentTotal !== null) {
    return Math.max(0, Math.trunc(input.currentTotal));
  }
  return incoming;
}

export function mergeCatalogPageItems<T>(
  current: readonly T[],
  incoming: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  if (!current.length) return [...incoming];
  const seen = new Set(current.map(keyOf));
  const merged = [...current];
  for (const item of incoming) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export class CatalogPageFlightGuard {
  private readonly active = new Set<string>();

  tryStart(key: string) {
    if (this.active.has(key)) return false;
    this.active.add(key);
    return true;
  }

  finish(key: string) {
    this.active.delete(key);
  }

  clear() {
    this.active.clear();
  }
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function filters(request: CatalogPageRequest) {
  const clauses = ["provider_id = ?", "kind = ?"];
  const args: Array<string | number> = [request.providerId, request.kind];
  const category = normalizedCategory(request.categoryId);
  if (category) {
    clauses.push("category_id = ?");
    args.push(category);
  }
  const search = request.search?.trim();
  if (search) {
    clauses.push(`(name LIKE ? ESCAPE '\\' COLLATE NOCASE OR ${TURKISH_SEARCH_NAME_SQL} LIKE ? ESCAPE '\\')`);
    args.push(`%${escapeLike(search)}%`, `%${escapeLike(normalizeCatalogSearchText(search))}%`);
  }
  return { clauses, args };
}

function nameAfter(direction: "asc" | "desc", cursor: CatalogCursor) {
  if (direction === "asc") {
    return {
      sql: "(name COLLATE NOCASE > ? OR (name COLLATE NOCASE = ? AND item_id > ?))",
      args: [cursor.name, cursor.name, cursor.itemId] as Array<string | number>,
    };
  }
  return {
    sql: "(name COLLATE NOCASE < ? OR (name COLLATE NOCASE = ? AND item_id > ?))",
    args: [cursor.name, cursor.name, cursor.itemId] as Array<string | number>,
  };
}

function cursorClause(request: CatalogPageRequest, cursor: CatalogCursor | null) {
  if (!cursor) return { sql: "", args: [] as Array<string | number> };

  if (request.sort === "default" && request.kind === "live") {
    return { sql: "rowid > ?", args: [cursor.rowId] };
  }

  if (request.sort === "default") {
    return {
      sql: `(${EFFECTIVE_ORDER_SQL} < ? OR (${EFFECTIVE_ORDER_SQL} = ? AND (name COLLATE NOCASE > ? OR (name COLLATE NOCASE = ? AND item_id > ?))))`,
      args: [cursor.effectiveOrder, cursor.effectiveOrder, cursor.name, cursor.name, cursor.itemId],
    };
  }

  if (request.sort === "alphaAsc") return nameAfter("asc", cursor);
  if (request.sort === "alphaDesc") return nameAfter("desc", cursor);

  if (request.sort === "idAsc") {
    return {
      sql: `(${NUMERIC_ID_SQL} > ? OR (${NUMERIC_ID_SQL} = ? AND (name COLLATE NOCASE > ? OR (name COLLATE NOCASE = ? AND item_id > ?))))`,
      args: [cursor.numericId, cursor.numericId, cursor.name, cursor.name, cursor.itemId],
    };
  }

  if (request.sort === "idDesc") {
    return {
      sql: `(${NUMERIC_ID_SQL} < ? OR (${NUMERIC_ID_SQL} = ? AND (name COLLATE NOCASE > ? OR (name COLLATE NOCASE = ? AND item_id > ?))))`,
      args: [cursor.numericId, cursor.numericId, cursor.name, cursor.name, cursor.itemId],
    };
  }

  return {
    sql: `(added_at < ? OR (added_at = ? AND (${ADDED_FALLBACK_SQL} < ? OR (${ADDED_FALLBACK_SQL} = ? AND (name COLLATE NOCASE > ? OR (name COLLATE NOCASE = ? AND item_id > ?))))))`,
    args: [
      cursor.addedAt,
      cursor.addedAt,
      cursor.addedFallback,
      cursor.addedFallback,
      cursor.name,
      cursor.name,
      cursor.itemId,
    ],
  };
}

function orderBy(request: CatalogPageRequest) {
  if (request.sort === "default") {
    return request.kind === "live"
      ? "rowid ASC"
      : `${EFFECTIVE_ORDER_SQL} DESC, name COLLATE NOCASE ASC, item_id ASC`;
  }
  if (request.sort === "alphaAsc") return "name COLLATE NOCASE ASC, item_id ASC";
  if (request.sort === "alphaDesc") return "name COLLATE NOCASE DESC, item_id ASC";
  if (request.sort === "idAsc") return `${NUMERIC_ID_SQL} ASC, name COLLATE NOCASE ASC, item_id ASC`;
  if (request.sort === "idDesc") return `${NUMERIC_ID_SQL} DESC, name COLLATE NOCASE ASC, item_id ASC`;
  return `added_at DESC, ${ADDED_FALLBACK_SQL} DESC, name COLLATE NOCASE ASC, item_id ASC`;
}

export function buildCatalogPageSql(request: CatalogPageRequest): CatalogPageSqlPlan {
  if (!request.providerId.trim()) throw new Error("Catalog page providerId is required.");
  const limit = normalizeCatalogPageLimit(request.limit);
  const base = filters(request);
  const cursor = cursorForRequest(request);
  const cursorFilter = cursorClause(request, cursor);
  const pageClauses = cursorFilter.sql ? [...base.clauses, cursorFilter.sql] : base.clauses;
  const payloadSelection = request.kind === "series" ? "NULL AS payload" : "payload";

  return {
    countSql: `SELECT COUNT(*) AS count FROM catalog_items WHERE ${base.clauses.join(" AND ")}`,
    countArgs: [...base.args],
    pageSql: `SELECT rowid AS row_id, provider_id, kind, item_id, category_id, name, image_url, ${payloadSelection}, added_at, first_seen_at, last_seen_at, ${EFFECTIVE_ORDER_SQL} AS effective_order, ${NUMERIC_ID_SQL} AS numeric_id, ${ADDED_FALLBACK_SQL} AS added_fallback FROM catalog_items WHERE ${pageClauses.join(" AND ")} ORDER BY ${orderBy(request)} LIMIT ?`,
    pageArgs: [...base.args, ...cursorFilter.args, limit],
    limit,
  };
}
