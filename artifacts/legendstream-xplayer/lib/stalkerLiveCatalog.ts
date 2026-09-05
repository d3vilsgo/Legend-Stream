import { StalkerPortalError, type StalkerPortalSession } from "./stalkerPortal";
import type { PersistedLiveCatalogItem } from "./catalogPersistence";

export const MAX_STALKER_LIVE_PAGES = 5_000;

export type StalkerLiveCategory = {
  id: string;
  name: string;
};

export type StalkerLiveChannel = {
  portalId: string;
  id: string;
  name: string;
  logoUrl?: string;
  categoryId: string;
  categoryName: string;
  tvgId?: string;
  cmd: string;
};

export type StalkerLivePage = {
  page: number;
  items: StalkerLiveChannel[];
  totalItems: number | null;
  maxPageItems: number | null;
  rawCount: number;
};

type StalkerLivePortal = Pick<StalkerPortalSession, "request">;

type TraverseOptions = {
  session: StalkerLivePortal;
  providerId: string;
  categories?: readonly StalkerLiveCategory[];
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  persistPage: (items: PersistedLiveCatalogItem[], page: StalkerLivePage) => Promise<void>;
  yieldFn?: () => void | Promise<void>;
  maxPages?: number;
};

export type StagedStalkerLiveSyncOptions = {
  session: StalkerLivePortal;
  providerId: string;
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  cleanupStaging: () => Promise<void>;
  persistPage: (items: PersistedLiveCatalogItem[], page: StalkerLivePage) => Promise<void>;
  commit: (
    categories: readonly StalkerLiveCategory[],
    result: StalkerLiveTraversalResult,
  ) => Promise<void>;
  yieldFn?: () => void | Promise<void>;
  onCategories?: (categories: readonly StalkerLiveCategory[]) => void | Promise<void>;
  maxPages?: number;
};

export type StalkerLiveTraversalResult = {
  pagesFetched: number;
  uniqueItems: number;
  persisted: number;
  totalItems: number | null;
  maxPageItems: number | null;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const stringValue = (value: unknown) => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const finitePositiveInt = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
};

function rowsFromPayload(payload: unknown, keys: readonly string[]) {
  if (Array.isArray(payload)) return payload;
  const root = asObject(payload);
  if (!root) return [];
  for (const key of keys) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  const data = asObject(root.data);
  if (data) {
    for (const key of keys) {
      if (Array.isArray(data[key])) return data[key] as unknown[];
    }
    if (Array.isArray(data.data)) return data.data;
  }
  return [];
}

function metadataFromPayload(payload: unknown) {
  const root = asObject(payload);
  const nested = asObject(root?.data);
  const lookup = (key: string) => root?.[key] ?? nested?.[key];
  return {
    totalItems: finitePositiveInt(lookup("total_items")) ?? finitePositiveInt(lookup("total")),
    maxPageItems: finitePositiveInt(lookup("max_page_items")) ?? finitePositiveInt(lookup("max_page_size")),
  };
}

export function normalizeStalkerLiveCategories(payload: unknown): StalkerLiveCategory[] {
  const rows = rowsFromPayload(payload, ["data", "genres", "categories"]);
  const seen = new Set<string>();
  const categories: StalkerLiveCategory[] = [];
  for (const value of rows) {
    const row = asObject(value);
    if (!row) continue;
    const id = stringValue(row.id ?? row.genre_id ?? row.category_id);
    if (!id || seen.has(id)) continue;
    const name = stringValue(row.title ?? row.name ?? row.genre_name ?? row.category_name) || id;
    seen.add(id);
    categories.push({ id, name });
  }
  return categories;
}

export function isStalkerLiveCategoryCapabilityAbsent(caught: unknown) {
  return caught instanceof StalkerPortalError
    && caught.code === "HTTP_ERROR"
    && (caught.status === 404 || caught.status === 405);
}

export async function fetchStalkerLiveCategories(
  session: StalkerLivePortal,
  signal?: AbortSignal,
): Promise<StalkerLiveCategory[]> {
  try {
    const payload = await session.request({ type: "itv", action: "get_genres" }, signal);
    return normalizeStalkerLiveCategories(payload);
  } catch (caught) {
    if (isStalkerLiveCategoryCapabilityAbsent(caught)) return [];
    throw caught;
  }
}

export function stableStalkerLiveChannelId(providerId: string, portalId: string) {
  return `${providerId}:stalker:${portalId}`;
}

export function normalizeStalkerLivePage(
  payload: unknown,
  providerId: string,
  page: number,
  categories: readonly StalkerLiveCategory[] = [],
): StalkerLivePage {
  const rows = rowsFromPayload(payload, ["data", "items", "channels"]);
  const categoryNames = new Map(categories.map((category) => [category.id, category.name] as const));
  const metadata = metadataFromPayload(payload);
  const items: StalkerLiveChannel[] = [];
  for (const value of rows) {
    const row = asObject(value);
    if (!row) continue;
    const portalId = stringValue(row.id ?? row.ch_id ?? row.stream_id);
    if (!portalId) continue;
    const categoryId = stringValue(row.tv_genre_id ?? row.genre_id ?? row.category_id) || "0";
    const categoryName = categoryNames.get(categoryId)
      || stringValue(row.tv_genre_name ?? row.genre_name ?? row.category_name)
      || categoryId;
    items.push({
      portalId,
      id: stableStalkerLiveChannelId(providerId, portalId),
      name: stringValue(row.name ?? row.title) || `Channel ${portalId}`,
      logoUrl: stringValue(row.logo ?? row.logo_url ?? row.stream_icon) || undefined,
      categoryId,
      categoryName,
      tvgId: stringValue(row.xmltv_id ?? row.epg_channel_id) || undefined,
      cmd: stringValue(row.cmd ?? row.url),
    });
  }
  return {
    page,
    items,
    totalItems: metadata.totalItems,
    maxPageItems: metadata.maxPageItems,
    rawCount: rows.length,
  };
}

export async function fetchStalkerLivePage(
  session: StalkerLivePortal,
  providerId: string,
  page: number,
  categories: readonly StalkerLiveCategory[] = [],
  signal?: AbortSignal,
) {
  const payload = await session.request({
    type: "itv",
    action: "get_ordered_list",
    p: page,
  }, signal);
  return normalizeStalkerLivePage(payload, providerId, page, categories);
}

export function projectStalkerLiveItem(
  providerId: string,
  channel: StalkerLiveChannel,
): PersistedLiveCatalogItem {
  return {
    schemaVersion: 1,
    catalogKind: "live",
    providerId,
    id: channel.id,
    name: channel.name,
    logoUrl: channel.logoUrl,
    category: channel.categoryId,
    categoryName: channel.categoryName,
    tvgId: channel.tvgId,
    streamType: "stalker",
    contentType: "live",
    playbackRef: {
      type: "stalker-live",
      portalId: channel.portalId,
      cmd: channel.cmd,
    },
  };
}

function throwIfCancelled(signal?: AbortSignal, isCurrent?: () => boolean) {
  if (signal?.aborted || (isCurrent && !isCurrent())) {
    throw new StalkerPortalError("CANCELLED", "Stalker portal request was cancelled.");
  }
}

export function normalizedStalkerLivePageCeiling(value?: number) {
  const numeric = Number(value ?? MAX_STALKER_LIVE_PAGES);
  if (!Number.isFinite(numeric)) return MAX_STALKER_LIVE_PAGES;
  return Math.max(1, Math.trunc(numeric));
}

export function stalkerLivePageCeilingExceeded(
  page: number,
  maxPages = MAX_STALKER_LIVE_PAGES,
) {
  return page > normalizedStalkerLivePageCeiling(maxPages);
}

function assertWithinPageCeiling(page: number, maxPages?: number) {
  if (!stalkerLivePageCeilingExceeded(page, normalizedStalkerLivePageCeiling(maxPages))) return;
  throw new StalkerPortalError(
    "INVALID_RESPONSE",
    "Stalker Live pagination exceeded the safety ceiling without terminal evidence.",
  );
}

export async function traverseStalkerLivePages(options: TraverseOptions): Promise<StalkerLiveTraversalResult> {
  const seenIds = new Set<string>();
  const pageFingerprints = new Set<string>();
  const maxPages = normalizedStalkerLivePageCeiling(options.maxPages);
  let pageNumber = 1;
  let persisted = 0;
  let totalItems: number | null = null;
  let maxPageItems: number | null = null;

  while (true) {
    throwIfCancelled(options.signal, options.isCurrent);
    assertWithinPageCeiling(pageNumber, maxPages);
    const page = await fetchStalkerLivePage(
      options.session,
      options.providerId,
      pageNumber,
      options.categories,
      options.signal,
    );
    throwIfCancelled(options.signal, options.isCurrent);

    if (page.totalItems !== null) totalItems = page.totalItems;
    if (page.maxPageItems !== null) maxPageItems = page.maxPageItems;
    if (page.rawCount === 0) break;

    const fingerprint = page.items.map((item) => item.portalId).join("\u001f");
    if (fingerprint && pageFingerprints.has(fingerprint)) break;
    if (fingerprint) pageFingerprints.add(fingerprint);

    const novel: StalkerLiveChannel[] = [];
    for (const item of page.items) {
      if (seenIds.has(item.portalId)) continue;
      seenIds.add(item.portalId);
      novel.push(item);
    }
    if (!novel.length) break;

    const projected = novel.map((item) => projectStalkerLiveItem(options.providerId, item));
    throwIfCancelled(options.signal, options.isCurrent);
    await options.persistPage(projected, page);
    throwIfCancelled(options.signal, options.isCurrent);
    persisted += projected.length;
    await options.yieldFn?.();
    throwIfCancelled(options.signal, options.isCurrent);

    if (totalItems !== null && seenIds.size >= totalItems) break;
    if (maxPageItems !== null && page.rawCount < maxPageItems) break;
    pageNumber += 1;
  }

  return {
    pagesFetched: pageNumber,
    uniqueItems: seenIds.size,
    persisted,
    totalItems,
    maxPageItems,
  };
}

export async function runStagedStalkerLiveSync(
  options: StagedStalkerLiveSyncOptions,
) {
  let primaryError: unknown = null;
  await options.cleanupStaging();
  try {
    throwIfCancelled(options.signal, options.isCurrent);
    const categories = await fetchStalkerLiveCategories(options.session, options.signal);
    throwIfCancelled(options.signal, options.isCurrent);
    await options.onCategories?.(categories);
    const result = await traverseStalkerLivePages({
      session: options.session,
      providerId: options.providerId,
      categories,
      signal: options.signal,
      isCurrent: options.isCurrent,
      persistPage: options.persistPage,
      yieldFn: options.yieldFn,
      maxPages: options.maxPages,
    });
    throwIfCancelled(options.signal, options.isCurrent);
    if (result.uniqueItems === 0) {
      throw new StalkerPortalError(
        "INVALID_RESPONSE",
        "The Stalker Portal returned no live channels.",
      );
    }
    await options.commit(categories, result);
    throwIfCancelled(options.signal, options.isCurrent);
    return { categories, result };
  } catch (caught) {
    primaryError = caught;
    throw caught;
  } finally {
    try {
      await options.cleanupStaging();
    } catch (cleanupError) {
      if (primaryError === null) throw cleanupError;
    }
  }
}

function playableUrlFromCreateLink(payload: unknown) {
  if (typeof payload === "string") return payload.replace(/^ffmpeg\s+/i, "").trim();
  const row = asObject(payload);
  if (!row) return "";
  return stringValue(row.cmd ?? row.url ?? row.link).replace(/^ffmpeg\s+/i, "").trim();
}

export async function resolveStalkerLiveCreateLink(
  session: StalkerLivePortal,
  cmd: string,
  signal?: AbortSignal,
) {
  if (!cmd.trim()) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker channel has no playback command.");
  }
  const payload = await session.request({
    type: "itv",
    action: "create_link",
    cmd,
  }, signal);
  const source = playableUrlFromCreateLink(payload);
  if (!source) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker portal did not return a playable link.");
  }
  try {
    const url = new URL(source);
    if (!["http:", "https:", "rtsp:", "rtmp:"].includes(url.protocol)) {
      throw new Error("protocol");
    }
  } catch {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker portal did not return a playable link.");
  }
  return source;
}
