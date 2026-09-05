import type { CatalogKind, PersistedCatalogItem } from "./catalogPersistence";

export type CatalogBaselineBindValue = string | number | null;

// Frozen Stage-A control that mirrors the production row-by-row UPSERT semantics.
// Production must not import this benchmark oracle, and this oracle must not import
// the prepared candidate module; keeping the control independent avoids common-mode
// SQL/bind failures when comparing CURRENT with prepared candidates.
export const CURRENT_CATALOG_SINGLE_ROW_UPSERT_SQL = `INSERT INTO catalog_items (
         provider_id, kind, item_id, category_id, name, image_url, payload,
         added_at, first_seen_at, last_seen_at, is_new
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_id, kind, item_id) DO UPDATE SET
         category_id = excluded.category_id,
         name = excluded.name,
         image_url = excluded.image_url,
         payload = excluded.payload,
         added_at = excluded.added_at,
         last_seen_at = excluded.last_seen_at`;

const addedTime = (value: unknown) => {
  if (value === undefined || value === null || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

function itemIdentity(item: PersistedCatalogItem) {
  if (item.catalogKind === "live") return String(item.id);
  if (item.catalogKind === "vod") return String(item.stream_id);
  return String(item.series_id);
}

function itemCategory(item: PersistedCatalogItem) {
  if (item.catalogKind === "live") return String(item.category || "");
  return String(item.category_id ?? "");
}

function itemImage(item: PersistedCatalogItem) {
  if (item.catalogKind === "live") return item.logoUrl ?? null;
  if (item.catalogKind === "vod") return item.stream_icon ?? null;
  return item.cover ?? null;
}

function itemAdded(item: PersistedCatalogItem) {
  return item.catalogKind === "vod" ? addedTime(item.added) : 0;
}

export function buildCurrentCatalogItemBindValues(options: {
  providerId: string;
  kind: CatalogKind;
  item: PersistedCatalogItem;
  seenAt: number;
  markNew: boolean;
}): CatalogBaselineBindValue[] {
  const { providerId, kind, item, seenAt, markNew } = options;
  if (item.catalogKind !== kind || item.providerId !== providerId) {
    throw new Error("Catalog persistence DTO does not match its write target.");
  }
  return [
    providerId,
    kind,
    itemIdentity(item),
    itemCategory(item),
    item.name,
    itemImage(item),
    JSON.stringify(item),
    itemAdded(item),
    seenAt,
    seenAt,
    markNew ? 1 : 0,
  ];
}
