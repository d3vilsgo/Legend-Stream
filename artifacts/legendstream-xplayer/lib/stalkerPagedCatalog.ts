import { StalkerPortalError, type StalkerPortalDiagnosticsContext, type StalkerPortalSession } from "./stalkerPortal";

export type StalkerCatalogKind = "itv" | "vod" | "series";
export type StalkerCategoryDialect = "genre_id" | "genre" | "dual";
export type StalkerPagedCatalogStatus =
  | "NOT_LOADED"
  | "LOADING_FIRST_PAGE"
  | "READY"
  | "LOADING_NEXT_PAGE"
  | "END_REACHED"
  | "ERROR"
  | "CANCELLED";

export type StalkerOrderedPage = {
  kind: StalkerCatalogKind;
  categoryId: string;
  page: number;
  payload: unknown;
  rows: Record<string, unknown>[];
  totalItems: number | null;
  maxPageItems: number | null;
  currentPage: number | null;
  hasMore: boolean;
  dialect: StalkerCategoryDialect;
  compatibilityFallback: boolean;
};

type Portal = Pick<StalkerPortalSession, "request">;

type FetchOrderedPageOptions = {
  session: Portal;
  providerId: string;
  kind: StalkerCatalogKind;
  categoryId: string;
  page: number;
  signal?: AbortSignal;
  diagnostics?: StalkerPortalDiagnosticsContext;
  maxPages?: number;
  compatibilityFallback?: (signal?: AbortSignal) => Promise<StalkerOrderedPage>;
};

const MAX_STALKER_ORDERED_PAGES = 5_000;
const dialectByProvider = new Map<string, StalkerCategoryDialect>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const nonNegativeInt = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && Number.isInteger(parsed) ? parsed : null;
};

const positiveInt = (value: unknown): number | null => {
  const parsed = nonNegativeInt(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

function payloadRows(payload: unknown): Record<string, unknown>[] {
  const root = asObject(payload);
  const candidates: unknown[] = [payload];
  if (root) {
    candidates.push(root.data, root.items, root.channels);
    const nested = asObject(root.data);
    if (nested) candidates.push(nested.data, nested.items, nested.channels);
  }
  const rows = candidates.find(Array.isArray) as unknown[] | undefined;
  if (!rows) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker ordered-list page has an invalid row envelope.");
  }
  return rows.map((value) => {
    const row = asObject(value);
    if (!row) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker ordered-list page contains an invalid row.");
    return row;
  });
}

function pageMetadata(payload: unknown) {
  const root = asObject(payload);
  const nested = asObject(root?.data);
  const read = (key: string) => root?.[key] ?? nested?.[key];
  return {
    totalItems: nonNegativeInt(read("total_items") ?? read("total")),
    maxPageItems: positiveInt(read("max_page_items") ?? read("max_page_size")),
    currentPage: nonNegativeInt(read("cur_page") ?? read("current_page") ?? read("page") ?? read("p")),
  };
}

export function readStalkerCategoryDialect(providerId: string) {
  return dialectByProvider.get(providerId) ?? null;
}

export function clearStalkerCategoryDialect(providerId?: string) {
  if (providerId) dialectByProvider.delete(providerId);
  else dialectByProvider.clear();
}

function dialectCandidates(providerId: string): StalkerCategoryDialect[] {
  const cached = dialectByProvider.get(providerId);
  if (cached) return [cached];
  return ["genre_id", "genre", "dual"];
}

function categoryParams(dialect: StalkerCategoryDialect, categoryId: string) {
  if (dialect === "genre_id") return { genre_id: categoryId };
  if (dialect === "genre") return { genre: categoryId };
  return { genre: categoryId, genre_id: categoryId };
}

function canProbeNextDialect(caught: unknown) {
  if (!(caught instanceof StalkerPortalError)) return false;
  if (caught.code === "INVALID_RESPONSE") return true;
  return caught.code === "HTTP_ERROR" && [400, 404, 405, 422].includes(caught.status ?? 0);
}

export function hasMoreStalkerOrderedPages(input: {
  page: number;
  rowCount: number;
  totalItems: number | null;
  maxPageItems: number | null;
}) {
  if (input.rowCount === 0) return false;
  if (input.totalItems === 0) return false;
  if (input.totalItems !== null && input.maxPageItems !== null) {
    return input.page < Math.max(1, Math.ceil(input.totalItems / input.maxPageItems));
  }
  if (input.maxPageItems !== null && input.rowCount < input.maxPageItems) return false;
  return true;
}

export async function fetchStalkerOrderedPage(options: FetchOrderedPageOptions): Promise<StalkerOrderedPage> {
  if (options.signal?.aborted) {
    throw new StalkerPortalError("CANCELLED", "Stalker ordered-list request was cancelled.");
  }
  const page = Math.trunc(options.page);
  const maxPages = Math.max(1, Math.trunc(options.maxPages ?? MAX_STALKER_ORDERED_PAGES));
  if (page < 1 || page > maxPages) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker ordered-list page exceeded its bounded page range.");
  }
  const categoryId = options.categoryId.trim();
  if (!categoryId) {
    throw new StalkerPortalError("INVALID_RESPONSE", "Stalker ordered-list category is empty.");
  }

  let lastProbeError: unknown = null;
  for (const dialect of dialectCandidates(options.providerId)) {
    try {
      const payload = await options.session.request({
        type: options.kind,
        action: "get_ordered_list",
        p: page,
        ...categoryParams(dialect, categoryId),
      }, options.signal, undefined, {
        syncRunId: options.diagnostics?.syncRunId,
        providerId: options.providerId,
      });
      if (options.signal?.aborted) {
        throw new StalkerPortalError("CANCELLED", "Stalker ordered-list request was cancelled.");
      }
      const rows = payloadRows(payload);
      const metadata = pageMetadata(payload);
      if (!dialectByProvider.has(options.providerId)) dialectByProvider.set(options.providerId, dialect);
      return {
        kind: options.kind,
        categoryId,
        page,
        payload,
        rows,
        ...metadata,
        hasMore: hasMoreStalkerOrderedPages({
          page,
          rowCount: rows.length,
          totalItems: metadata.totalItems,
          maxPageItems: metadata.maxPageItems,
        }),
        dialect,
        compatibilityFallback: false,
      };
    } catch (caught) {
      if (options.signal?.aborted || (caught instanceof StalkerPortalError && caught.code === "CANCELLED")) throw caught;
      lastProbeError = caught;
      if (dialectByProvider.has(options.providerId) || !canProbeNextDialect(caught)) throw caught;
    }
  }

  if (page === 1 && options.compatibilityFallback) {
    const fallback = await options.compatibilityFallback(options.signal);
    return { ...fallback, compatibilityFallback: true };
  }
  throw lastProbeError ?? new StalkerPortalError("INVALID_RESPONSE", "Stalker ordered-list dialect probing failed.");
}

export type StalkerPagedCatalogState<T> = {
  status: StalkerPagedCatalogStatus;
  categoryId: string;
  items: T[];
  totalItems: number | null;
  maxPageItems: number | null;
  nextPage: number;
  hasMore: boolean;
  error: unknown | null;
};

type ControllerPage<T> = {
  items: T[];
  totalItems: number | null;
  maxPageItems: number | null;
  hasMore: boolean;
  fingerprint: string;
};

type ControllerOptions<T> = {
  categoryId: string;
  fetchPage: (page: number, categoryId: string, signal: AbortSignal) => Promise<ControllerPage<T>>;
  identityKey: (item: T) => string;
  semanticKey: (item: T) => string;
  maxPages?: number;
};

export class StalkerPagedCatalogController<T> {
  #options: ControllerOptions<T>;
  #state: StalkerPagedCatalogState<T>;
  #controller: AbortController | null = null;
  #generation = 0;
  #listeners = new Set<(state: StalkerPagedCatalogState<T>) => void>();
  #cache = new Map<string, Map<number, ControllerPage<T>>>();
  #fingerprints = new Map<string, Set<string>>();
  #inFlightPage: number | null = null;

  constructor(options: ControllerOptions<T>) {
    this.#options = options;
    this.#state = {
      status: "NOT_LOADED",
      categoryId: options.categoryId,
      items: [],
      totalItems: null,
      maxPageItems: null,
      nextPage: 1,
      hasMore: true,
      error: null,
    };
  }

  snapshot() { return this.#state; }

  subscribe(listener: (state: StalkerPagedCatalogState<T>) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #publish(next: StalkerPagedCatalogState<T>) {
    this.#state = next;
    for (const listener of this.#listeners) listener(next);
  }

  #abortCurrent() {
    this.#generation += 1;
    this.#controller?.abort();
    this.#controller = null;
    this.#inFlightPage = null;
  }

  cancel() {
    this.#abortCurrent();
    this.#publish({ ...this.#state, status: "CANCELLED", error: null });
  }

  async switchCategory(categoryId: string) {
    const clean = categoryId.trim();
    if (!clean) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker catalog category is empty.");
    this.#abortCurrent();
    const cached = this.#cache.get(clean)?.get(1);
    this.#publish({
      status: cached ? (cached.hasMore ? "READY" : "END_REACHED") : "NOT_LOADED",
      categoryId: clean,
      items: cached?.items ?? [],
      totalItems: cached?.totalItems ?? null,
      maxPageItems: cached?.maxPageItems ?? null,
      nextPage: cached ? 2 : 1,
      hasMore: cached?.hasMore ?? true,
      error: null,
    });
    await this.loadFirst();
  }

  async loadFirst() {
    return this.#load(1, true);
  }

  async loadMore() {
    if (this.#state.status === "LOADING_FIRST_PAGE" || this.#state.status === "LOADING_NEXT_PAGE") return;
    if (!this.#state.hasMore || this.#state.status === "END_REACHED" || this.#state.status === "CANCELLED") return;
    return this.#load(this.#state.nextPage, false);
  }

  async #load(page: number, first: boolean) {
    const maxPages = Math.max(1, Math.trunc(this.#options.maxPages ?? MAX_STALKER_ORDERED_PAGES));
    if (page > maxPages) {
      this.#publish({ ...this.#state, status: "ERROR", error: new StalkerPortalError("INVALID_RESPONSE", "Stalker lazy paging exceeded its safety ceiling.") });
      return;
    }
    if (this.#inFlightPage !== null) return;
    const categoryId = this.#state.categoryId;
    const generation = ++this.#generation;
    const controller = new AbortController();
    this.#controller?.abort();
    this.#controller = controller;
    this.#inFlightPage = page;
    this.#publish({ ...this.#state, status: first && this.#state.items.length === 0 ? "LOADING_FIRST_PAGE" : "LOADING_NEXT_PAGE", error: null });
    try {
      const result = await this.#options.fetchPage(page, categoryId, controller.signal);
      if (controller.signal.aborted || generation !== this.#generation || categoryId !== this.#state.categoryId) return;
      const categoryFingerprints = this.#fingerprints.get(categoryId) ?? new Set<string>();
      if (result.fingerprint && categoryFingerprints.has(result.fingerprint)) {
        throw new StalkerPortalError("INVALID_RESPONSE", "Stalker lazy paging returned a repeated page.");
      }
      if (result.fingerprint) categoryFingerprints.add(result.fingerprint);
      this.#fingerprints.set(categoryId, categoryFingerprints);

      const byId = new Map<string, { item: T; semantic: string }>();
      for (const item of first ? [] : this.#state.items) {
        const id = this.#options.identityKey(item);
        if (id) byId.set(id, { item, semantic: this.#options.semanticKey(item) });
      }
      for (const item of result.items) {
        const id = this.#options.identityKey(item);
        if (!id) throw new StalkerPortalError("INVALID_RESPONSE", "Stalker lazy page item is missing a stable identity.");
        const semantic = this.#options.semanticKey(item);
        const existing = byId.get(id);
        if (existing) {
          if (existing.semantic !== semantic) {
            throw new StalkerPortalError("INVALID_RESPONSE", "Stalker lazy paging found an ambiguous stable item identity.");
          }
          continue;
        }
        byId.set(id, { item, semantic });
      }
      const merged = [...byId.values()].map((entry) => entry.item);
      const cacheForCategory = this.#cache.get(categoryId) ?? new Map<number, ControllerPage<T>>();
      cacheForCategory.set(page, result);
      this.#cache.set(categoryId, cacheForCategory);
      const endReached = !result.hasMore;
      this.#publish({
        status: endReached ? "END_REACHED" : "READY",
        categoryId,
        items: merged,
        totalItems: result.totalItems,
        maxPageItems: result.maxPageItems,
        nextPage: page + 1,
        hasMore: result.hasMore,
        error: null,
      });
    } catch (caught) {
      if (controller.signal.aborted || generation !== this.#generation) return;
      const cancelled = caught instanceof StalkerPortalError && caught.code === "CANCELLED";
      this.#publish({ ...this.#state, status: cancelled ? "CANCELLED" : "ERROR", error: caught });
    } finally {
      if (generation === this.#generation) {
        this.#inFlightPage = null;
        if (this.#controller === controller) this.#controller = null;
      }
    }
  }
}

export function chooseDefaultStalkerCategory(
  categories: readonly { id: string; name: string }[],
  supportsZeroAll = true,
) {
  const realAll = categories.find((item) => /^(?:all|tümü|tum)$/i.test(item.name.trim()));
  if (realAll) return { id: realAll.id, name: realAll.name, synthetic: false };
  if (supportsZeroAll) return { id: "0", name: "Tümü", synthetic: true };
  const first = categories.find((item) => item.id.trim() && item.id.trim() !== "0");
  return first ? { id: first.id, name: first.name, synthetic: false } : null;
}
