import { StalkerPortalError, type StalkerPortalDiagnosticsContext, type StalkerPortalSession } from "./stalkerPortal";
import type { PersistedLiveCatalogItem } from "./catalogPersistence";
import { traceStalkerConnectCheckpoint } from "./stalkerConnectTrace";

export const MAX_STALKER_LIVE_PAGES = 5_000;

export type StalkerLiveCategory = { id: string; name: string };
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
export type StalkerLiveTraversalResult = {
  pagesFetched: number;
  uniqueItems: number;
  persisted: number;
  totalItems: number | null;
  maxPageItems: number | null;
};

type Portal = Pick<StalkerPortalSession, "request">;
type TraverseOptions = {
  session: Portal;
  providerId: string;
  syncRunId?: string;
  categories?: readonly StalkerLiveCategory[];
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  persistPage: (items: PersistedLiveCatalogItem[], page: StalkerLivePage) => Promise<void>;
  yieldFn?: () => void | Promise<void>;
  maxPages?: number;
};
type StagedOptions = TraverseOptions & {
  cleanupStaging: () => Promise<void>;
  commit: (categories: readonly StalkerLiveCategory[], result: StalkerLiveTraversalResult) => Promise<void>;
  onCategories?: (categories: readonly StalkerLiveCategory[]) => void | Promise<void>;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const stringValue = (value: unknown) => typeof value === "string"
  ? value.trim()
  : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
const positiveInt = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

function rowsFromPayload(payload: unknown, keys: readonly string[]): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  const root = asObject(payload);
  if (!root) return null;
  for (const key of keys) if (Array.isArray(root[key])) return root[key] as unknown[];
  const nested = asObject(root.data);
  if (nested) {
    for (const key of keys) if (Array.isArray(nested[key])) return nested[key] as unknown[];
    if (Array.isArray(nested.data)) return nested.data;
  }
  return null;
}

function metadataFromPayload(payload: unknown) {
  const root = asObject(payload);
  const nested = asObject(root?.data);
  const lookup = (key: string) => root?.[key] ?? nested?.[key];
  return {
    totalItems: positiveInt(lookup("total_items")) ?? positiveInt(lookup("total")),
    maxPageItems: positiveInt(lookup("max_page_items")) ?? positiveInt(lookup("max_page_size")),
  };
}

export function normalizeStalkerLiveCategories(payload: unknown): StalkerLiveCategory[] {
  const rows = rowsFromPayload(payload, ["data", "genres", "categories"]);
  if (!rows) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker category response has an invalid shape.");
  const seen = new Set<string>();
  const result: StalkerLiveCategory[] = [];
  for (const value of rows) {
    const row = asObject(value);
    if (!row) continue;
    const id = stringValue(row.id ?? row.genre_id ?? row.category_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      name: stringValue(row.title ?? row.name ?? row.genre_name ?? row.category_name) || id,
    });
  }
  return result;
}

export function isStalkerLiveCategoryCapabilityAbsent(caught: unknown) {
  return caught instanceof StalkerPortalError && caught.code === "HTTP_ERROR" && (caught.status === 404 || caught.status === 405);
}

export async function fetchStalkerLiveCategories(
  session: Portal,
  signal?: AbortSignal,
  diagnostics?: StalkerPortalDiagnosticsContext,
) {
  try {
    const payload = await session.request({ type: "itv", action: "get_genres" }, signal, undefined, diagnostics);
    const categories = normalizeStalkerLiveCategories(payload);
    traceStalkerConnectCheckpoint("CATEGORIES_NORMALIZED", { categoryCount: categories.length });
    return categories;
  } catch (caught) {
    if (isStalkerLiveCategoryCapabilityAbsent(caught)) return [];
    throw caught;
  }
}

export function stableStalkerLiveChannelId(providerId: string, portalId: string) {
  if (!providerId.trim() || !portalId.trim()) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker channel is missing a stable portal identifier.");
  }
  return `${providerId}:stalker:${portalId}`;
}

export function normalizeStalkerLivePage(
  payload: unknown,
  providerId: string,
  page: number,
  categories: readonly StalkerLiveCategory[] = [],
): StalkerLivePage {
  const rows = rowsFromPayload(payload, ["data", "items", "channels"]);
  if (!rows) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live page has an invalid shape.");
  const names = new Map(categories.map((item) => [item.id, item.name] as const));
  const items: StalkerLiveChannel[] = [];
  for (const value of rows) {
    const row = asObject(value);
    if (!row) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live page contains an invalid channel row.");
    const portalId = stringValue(row.id ?? row.ch_id ?? row.stream_id);
    if (!portalId) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker channel is missing a stable portal identifier.");
    const cmd = stringValue(row.cmd ?? row.url);
    if (!cmd) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker channel is missing its canonical playback command.");
    const categoryId = stringValue(row.tv_genre_id ?? row.genre_id ?? row.category_id) || "0";
    items.push({
      portalId,
      id: stableStalkerLiveChannelId(providerId, portalId),
      name: stringValue(row.name ?? row.title) || `Channel ${portalId}`,
      logoUrl: stringValue(row.logo ?? row.logo_url ?? row.stream_icon) || undefined,
      categoryId,
      categoryName: names.get(categoryId) || stringValue(row.tv_genre_name ?? row.genre_name ?? row.category_name) || categoryId,
      tvgId: stringValue(row.xmltv_id ?? row.epg_channel_id) || undefined,
      cmd,
    });
  }
  return { page, items, ...metadataFromPayload(payload), rawCount: rows.length };
}

export async function fetchStalkerLivePage(
  session: Portal,
  providerId: string,
  page: number,
  categories: readonly StalkerLiveCategory[] = [],
  signal?: AbortSignal,
  diagnostics?: StalkerPortalDiagnosticsContext,
) {
  return normalizeStalkerLivePage(
    await session.request({ type: "itv", action: "get_ordered_list", p: page }, signal, undefined, diagnostics),
    providerId,
    page,
    categories,
  );
}

export function projectStalkerLiveItem(providerId: string, channel: StalkerLiveChannel): PersistedLiveCatalogItem {
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
    playbackRef: { type: "stalker-live", portalId: channel.portalId, cmd: channel.cmd },
  };
}

function assertCurrent(signal?: AbortSignal, isCurrent?: () => boolean) {
  if (signal?.aborted || (isCurrent && !isCurrent())) {
    throw new StalkerPortalError("CANCELLED", "Stalker portal request was cancelled.");
  }
}

export function normalizedStalkerLivePageCeiling(value?: number) {
  const n = Number(value ?? MAX_STALKER_LIVE_PAGES);
  return Number.isFinite(n) ? Math.max(1, Math.trunc(n)) : MAX_STALKER_LIVE_PAGES;
}
export function stalkerLivePageCeilingExceeded(page: number, maxPages = MAX_STALKER_LIVE_PAGES) {
  return page > normalizedStalkerLivePageCeiling(maxPages);
}

export async function traverseStalkerLivePages(options: TraverseOptions): Promise<StalkerLiveTraversalResult> {
  const seenIds = new Set<string>();
  const fingerprints = new Set<string>();
  const maxPages = normalizedStalkerLivePageCeiling(options.maxPages);
  let pageNumber = 1;
  let pagesFetched = 0;
  let persisted = 0;
  let totalItems: number | null = null;
  let maxPageItems: number | null = null;

  while (true) {
    assertCurrent(options.signal, options.isCurrent);
    if (stalkerLivePageCeilingExceeded(pageNumber, maxPages)) {
      throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live pagination exceeded the safety ceiling without terminal evidence.");
    }
    const page = await fetchStalkerLivePage(
      options.session,
      options.providerId,
      pageNumber,
      options.categories,
      options.signal,
      { syncRunId: options.syncRunId, providerId: options.providerId },
    );
    pagesFetched += 1;
    assertCurrent(options.signal, options.isCurrent);
    if (page.totalItems !== null) totalItems = page.totalItems;
    if (page.maxPageItems !== null) maxPageItems = page.maxPageItems;
    if (page.rawCount === 0) break;

    const pageIds = page.items.map((item) => item.portalId);
    const fingerprint = pageIds.join("\u001f");
    if (!fingerprint) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live page made no progress.");
    if (fingerprints.has(fingerprint)) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live returned a repeated page.");
    fingerprints.add(fingerprint);

    const pageSet = new Set<string>();
    for (const id of pageIds) {
      if (pageSet.has(id) || seenIds.has(id)) {
        throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live returned a duplicate stable channel identifier.");
      }
      pageSet.add(id);
    }
    if (pageSet.size === 0) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live page made no progress.");
    for (const id of pageSet) seenIds.add(id);

    const projected = page.items.map((item) => projectStalkerLiveItem(options.providerId, item));
    await options.persistPage(projected, page);
    assertCurrent(options.signal, options.isCurrent);
    persisted += projected.length;
    await options.yieldFn?.();
    assertCurrent(options.signal, options.isCurrent);

    if (totalItems !== null && seenIds.size >= totalItems) break;
    if (maxPageItems !== null && page.rawCount < maxPageItems) break;
    pageNumber += 1;
  }

  if (totalItems !== null && seenIds.size < totalItems) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Live traversal ended before total_items was satisfied.");
  }
  return { pagesFetched, uniqueItems: seenIds.size, persisted, totalItems, maxPageItems };
}

export async function runStagedStalkerLiveSync(options: StagedOptions) {
  let primaryError: unknown = null;
  await options.cleanupStaging();
  try {
    assertCurrent(options.signal, options.isCurrent);
    const categories = await fetchStalkerLiveCategories(options.session, options.signal);
    assertCurrent(options.signal, options.isCurrent);
    await options.onCategories?.(categories);
    const result = await traverseStalkerLivePages({ ...options, categories });
    assertCurrent(options.signal, options.isCurrent);
    if (result.uniqueItems === 0) throw new StalkerPortalError("INVALID_RESPONSE", "The Stalker Portal returned no live channels.");
    await options.commit(categories, result);
    assertCurrent(options.signal, options.isCurrent);
    return { categories, result };
  } catch (caught) {
    primaryError = caught;
    throw caught;
  } finally {
    try { await options.cleanupStaging(); } catch (cleanupError) { if (primaryError === null) throw cleanupError; }
  }
}

function playableUrl(payload: unknown) {
  if (typeof payload === "string") return payload.replace(/^ffmpeg\s+/i, "").trim();
  const row = asObject(payload);
  return row ? stringValue(row.cmd ?? row.url ?? row.link).replace(/^ffmpeg\s+/i, "").trim() : "";
}

export async function resolveStalkerLiveCreateLink(session: Portal, cmd: string, signal?: AbortSignal) {
  if (!cmd.trim()) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker channel has no playback command.");
  const source = playableUrl(await session.request({ type: "itv", action: "create_link", cmd }, signal));
  if (!source) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker portal did not return a playable link.");
  try {
    const url = new URL(source);
    if (!["http:", "https:", "rtsp:", "rtmp:"].includes(url.protocol)) throw new Error("protocol");
  } catch {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker portal did not return a playable link.");
  }
  return source;
}
