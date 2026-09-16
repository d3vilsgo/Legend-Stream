import { StalkerPortalError, type StalkerPortalSession } from "./stalkerPortal";
import { yieldToUi } from "./cooperative";

export type StalkerVodCategory = { id: string; title: string };
export type StalkerVodItem = {
  portalId: string;
  title: string;
  categoryId?: string;
  cmd: string;
  posterUrl?: string;
  description?: string;
  year?: string;
  genre?: string;
  rating?: string;
  director?: string;
  actors?: string;
};
export type StalkerVodPage = { items: StalkerVodItem[]; currentPage: number; totalItems?: number; maxPageItems?: number; hasNextPage: boolean };
export const STALKER_VOD_MAX_PAGE = 10_000;
type StalkerVodSession = Pick<StalkerPortalSession, "request">;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function arrayRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asObject(payload);
  if (Array.isArray(root?.data)) return root.data;
  if (Array.isArray(root?.js)) return root.js;
  return [];
}
function textField(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
function numberField(row: Record<string, unknown> | null, key: string) {
  if (!row) return undefined;
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}
function normalizedSearchText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("tr-TR").trim();
}

export function normalizeStalkerVodYear(value: unknown) {
  const raw = typeof value === "number" && Number.isFinite(value)
    ? String(Math.trunc(value))
    : typeof value === "string"
      ? value.trim()
      : "";
  if (!raw) return undefined;
  if (/^(?:19|20)\d{2}$/.test(raw)) return raw;
  const standalone = raw.match(/(?:^|\D)((?:19|20)\d{2})(?=\D|$)/);
  return standalone?.[1];
}

export function normalizeStalkerVodCategories(payload: unknown): StalkerVodCategory[] {
  const seen = new Set<string>();
  const categories: StalkerVodCategory[] = [];
  let hasGlobalCategory = false;
  for (const raw of arrayRows(payload)) {
    const row = asObject(raw);
    if (!row) continue;
    const id = textField(row, "id");
    const title = textField(row, "title");
    if (!id || !title || seen.has(id)) continue;
    const global = isStalkerVodGlobalCategory({ id, title });
    if (global && hasGlobalCategory) continue;
    seen.add(id);
    if (global) hasGlobalCategory = true;
    categories.push({ id, title });
  }
  return categories;
}

export function isStalkerVodGlobalCategory(category: StalkerVodCategory) {
  const title = normalizedSearchText(category.title);
  return category.id.trim() === "*" || title === "all" || title === "tumu" || title === "tum";
}

export function normalizeStalkerVodPage(payload: unknown, requestedPage: number): StalkerVodPage {
  const root = asObject(payload);
  const seen = new Set<string>();
  const items: StalkerVodItem[] = [];
  for (const raw of arrayRows(payload)) {
    const row = asObject(raw);
    if (!row) continue;
    const portalId = textField(row, "id");
    const title = textField(row, "name");
    const cmd = textField(row, "cmd");
    if (!portalId || !title || !cmd || seen.has(portalId)) continue;
    seen.add(portalId);
    items.push({
      portalId,
      title,
      cmd,
      categoryId: textField(row, "category_id"),
      posterUrl: textField(row, "screenshot_uri"),
      description: textField(row, "description"),
      year: normalizeStalkerVodYear(row.year),
      genre: textField(row, "genre"),
      rating: textField(row, "rating"),
      director: textField(row, "director"),
      actors: textField(row, "actors"),
    });
  }
  const totalItems = numberField(root, "total_items");
  const maxPageItems = numberField(root, "max_page_items");
  const currentPage = Math.max(1, Math.trunc(numberField(root, "cur_page") ?? requestedPage));
  const hasNextPage = totalItems != null && maxPageItems != null && maxPageItems > 0
    ? currentPage * maxPageItems < totalItems
    : maxPageItems != null && maxPageItems > 0
      ? items.length >= maxPageItems
      : false;
  return { items, currentPage, totalItems, maxPageItems, hasNextPage: hasNextPage && currentPage < STALKER_VOD_MAX_PAGE };
}

export function mergeStalkerVodItems(existing: readonly StalkerVodItem[], incoming: readonly StalkerVodItem[]) {
  const seen = new Set(existing.map((item) => item.portalId));
  const merged = [...existing];
  for (const item of incoming) {
    if (seen.has(item.portalId)) continue;
    seen.add(item.portalId);
    merged.push(item);
  }
  return merged;
}

export function findStalkerVodGlobalCategory(categories: readonly StalkerVodCategory[]) {
  return categories.find(isStalkerVodGlobalCategory) ?? null;
}

export async function loadStalkerVodCategories(session: StalkerVodSession, input: { signal?: AbortSignal } = {}): Promise<StalkerVodCategory[]> {
  const payload = await session.request({ type: "vod", action: "get_categories" }, input.signal, undefined, { providerId: "stalker-vod-categories" });
  return normalizeStalkerVodCategories(payload);
}

export async function loadStalkerVodPage(session: StalkerVodSession, category: StalkerVodCategory, page: number, input: { signal?: AbortSignal } = {}): Promise<StalkerVodPage> {
  const categoryId = category.id.trim();
  const requestedPage = Math.trunc(page);
  if (!categoryId) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker VOD category is invalid.");
  if (requestedPage < 1 || requestedPage > STALKER_VOD_MAX_PAGE) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker VOD page is outside the bounded range.");
  const payload = await session.request({ type: "vod", action: "get_ordered_list", category: categoryId, p: requestedPage }, input.signal, undefined, { providerId: "stalker-vod-page" });
  return normalizeStalkerVodPage(payload, requestedPage);
}

export async function searchStalkerVodCatalog(session: StalkerVodSession, categories: readonly StalkerVodCategory[], query: string, input: { signal?: AbortSignal } = {}) {
  const needle = normalizedSearchText(query);
  if (!needle) return [];
  const globalCategory = findStalkerVodGlobalCategory(categories);
  if (!globalCategory) throw new Error("Global VOD search requires the provider All category.");
  const results: StalkerVodItem[] = [];
  const seen = new Set<string>();
  let page = 1;
  while (page <= STALKER_VOD_MAX_PAGE) {
    if (input.signal?.aborted) throw new Error("VOD search aborted.");
    const result = await loadStalkerVodPage(session, globalCategory, page, input);
    for (const item of result.items) {
      if (seen.has(item.portalId)) continue;
      seen.add(item.portalId);
      if (normalizedSearchText(item.title).includes(needle)) results.push(item);
    }
    if (!result.hasNextPage) break;
    const nextPage = Math.max(page + 1, result.currentPage + 1);
    if (nextPage <= page) break;
    page = nextPage;
    await yieldToUi();
  }
  return results;
}

export function normalizeStalkerVodResolvedUrl(payload: unknown) {
  const raw = typeof payload === "string" ? payload : (() => { const root = asObject(payload); return root ? textField(root, "cmd") : undefined; })();
  const source = raw?.replace(/^ffmpeg\s+/i, "").trim() ?? "";
  if (!source) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker portal did not return a playable VOD link.");
  try {
    const url = new URL(source);
    if (!["http:", "https:", "rtsp:", "rtmp:"].includes(url.protocol)) throw new Error("unsupported protocol");
  } catch {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker portal did not return a playable VOD link.");
  }
  return source;
}

export async function resolveStalkerVodLink(session: StalkerVodSession, item: StalkerVodItem, input: { signal?: AbortSignal } = {}) {
  const cmd = item.cmd.trim();
  if (!cmd) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker VOD item has no playback command.");
  const payload = await session.request({ type: "vod", action: "create_link", cmd, disable_ad: 0, download: 0 }, input.signal, undefined, { providerId: "stalker-vod-playback" });
  return normalizeStalkerVodResolvedUrl(payload);
}

export type StalkerVodHistoryIdentity = { itemId: string; categoryId: string };

export async function findStalkerVodItemByIdentity(
  session: StalkerVodSession,
  identity: StalkerVodHistoryIdentity,
  input: { signal?: AbortSignal } = {},
) {
  const itemId = identity.itemId.trim();
  const categoryId = identity.categoryId.trim();
  if (!itemId || !categoryId) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker VOD history identity is invalid.");
  let page = 1;
  while (page <= STALKER_VOD_MAX_PAGE) {
    if (input.signal?.aborted) throw new Error("VOD history replay aborted.");
    const result = await loadStalkerVodPage(session, { id: categoryId, title: "" }, page, input);
    const match = result.items.find((item) => item.portalId === itemId);
    if (match) return match;
    if (!result.hasNextPage) break;
    const nextPage = Math.max(page + 1, result.currentPage + 1);
    if (nextPage <= page) break;
    page = nextPage;
    await yieldToUi();
  }
  throw new StalkerPortalError("INVALID_RESPONSE", "Stalker VOD history item is no longer available.");
}

export async function resolveStalkerVodHistoryLink(
  session: StalkerVodSession,
  identity: StalkerVodHistoryIdentity,
  input: { signal?: AbortSignal } = {},
) {
  const item = await findStalkerVodItemByIdentity(session, identity, input);
  return {
    item,
    url: await resolveStalkerVodLink(session, item, input),
  };
}
