import { StalkerPortalError } from "./stalkerPortal";
import type { StalkerIsolatedSession } from "./stalkerIsolatedLogin";
import { redactSensitiveText } from "./safeLog";
import { yieldToUi } from "./cooperative";
import { orderSeriesEpisodes } from "./seriesEpisodeOrder";

export type StalkerSeriesProductCategory = { id: string; title: string };
export type StalkerSeriesProductItem = {
  id: string;
  title: string;
  categoryId?: string;
  posterUrl?: string;
  description?: string;
  year?: string;
  genre?: string;
  rating?: string;
  director?: string;
  actors?: string;
};
export type StalkerSeriesProductEpisode = {
  key: string;
  id: string;
  label: string;
  seasonId: string;
  episodeNumber?: number;
};
export type StalkerSeriesProductSeason = {
  id: string;
  label: string;
  episodeCount: number;
  episodes: StalkerSeriesProductEpisode[];
};
export type StalkerSeriesProductDetail = {
  seriesId: string;
  title: string;
  posterUrl?: string;
  description?: string;
  year?: string;
  genre?: string;
  rating?: string;
  director?: string;
  actors?: string;
  seasons: StalkerSeriesProductSeason[];
  hierarchyTruncated: boolean;
};
export type StalkerSeriesProductPage = {
  items: StalkerSeriesProductItem[];
  page: number;
  currentPage: number;
  totalItems?: number;
  maxPageItems?: number;
  hasNextPage: boolean;
};

export type StalkerSeriesEpisodeIdentity = {
  type: "stalker-episode";
  providerId: string;
  seriesId: string;
  seasonId: string;
  episodeId: string;
};

export type StalkerSeriesPlayableIntent = {
  identity: StalkerSeriesEpisodeIdentity;
  url: string;
  title: string;
  subtitle: string;
  kind: "episode";
};

export type StalkerSeriesEpisodeReplayRef = {
  seriesId: string;
  seasonId: string;
  episodeId: string;
};

export function stalkerSeriesEpisodeIdentity(
  providerId: string,
  seriesId: string,
  seasonId: string,
  episodeId: string,
): StalkerSeriesEpisodeIdentity {
  return { type: "stalker-episode", providerId, seriesId, seasonId, episodeId };
}

export function stalkerSeriesEpisodeIdentityKey(identity: StalkerSeriesEpisodeIdentity) {
  return JSON.stringify([
    identity.providerId,
    identity.seriesId,
    identity.seasonId,
    identity.episodeId,
  ]);
}

export function buildStalkerSeriesPlayableIntent(
  providerId: string,
  detail: StalkerSeriesProductDetail,
  seasonId: string,
  episodeId: string,
  url: string,
): StalkerSeriesPlayableIntent {
  const season = detail.seasons.find((item) => item.id === seasonId);
  const episode = season?.episodes.find((item) => item.id === episodeId);
  if (!season || !episode) throw new Error("Series episode selection is no longer available.");
  return {
    identity: stalkerSeriesEpisodeIdentity(providerId, detail.seriesId, seasonId, episodeId),
    url,
    title: detail.title,
    subtitle: `${season.label} · ${episode.label}`,
    kind: "episode",
  };
}

export type StalkerSeriesPlaybackTicket = {
  providerId: string;
  episodeKey: string;
  sequence: number;
};

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ROWS = 30;
const MAX_PAGE = 10_000;
// Production hierarchy bounds are corruption guards, not pagination/materialization caps.
// Real providers can legitimately expose hundreds of embedded episode ids in one detail response.
const MAX_EPISODES_PER_SEASON = 10_000;
const MAX_TOTAL_EPISODES = 50_000;
const SEASON_KEYS = ["season_id", "season", "season_number", "season_num"] as const;
const EPISODE_KEYS = ["episode_id", "episode", "episode_number", "episode_num"] as const;

type Params = Record<string, string | number | boolean | undefined>;

type OpaqueSeasonPlaybackRef = {
  seriesId: string;
  seasonId: string;
  episodeId: string;
  cmd: string;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function envelopeObject(payload: unknown): Record<string, unknown> | null {
  const root = objectValue(payload);
  if (!root) return null;
  const js = objectValue(root.js);
  if (js) return js;
  const data = objectValue(root.data);
  if (data && (Array.isArray(data.data) || data.total_items != null || data.max_page_items != null)) return data;
  return root;
}

function rowsFromEnvelope(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const envelope = envelopeObject(payload);
  if (!envelope) return [];
  if (Array.isArray(envelope.data)) return envelope.data;
  if (Array.isArray(envelope.items)) return envelope.items;
  if (Array.isArray(envelope.js)) return envelope.js;
  return [];
}

function rawText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function displayText(value: unknown): string {
  const valueText = rawText(value);
  return valueText ? redactSensitiveText(valueText).slice(0, 500) : "";
}

function exactScalarIdentifier(value: unknown): string | null {
  if (typeof value === "string") return value.trim().length ? value : null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberField(row: Record<string, unknown> | null, key: string) {
  if (!row) return undefined;
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function metadataFromRow(row: Record<string, unknown>) {
  return {
    posterUrl: rawText(row.screenshot_uri),
    description: displayText(row.description) || undefined,
    year: displayText(row.year) || undefined,
    genre: displayText(row.genre) || undefined,
    rating: displayText(row.rating) || undefined,
    director: displayText(row.director) || undefined,
    actors: displayText(row.actors) || undefined,
  };
}

function mergeMetadata(base: StalkerSeriesProductItem, rows: readonly Record<string, unknown>[]) {
  const candidates = rows.map(metadataFromRow);
  const first = <K extends keyof ReturnType<typeof metadataFromRow>>(key: K) =>
    base[key] || candidates.find((item) => item[key])?.[key];
  return {
    posterUrl: first("posterUrl"),
    description: first("description"),
    year: first("year"),
    genre: first("genre"),
    rating: first("rating"),
    director: first("director"),
    actors: first("actors"),
  };
}

function seasonIdentity(row: Record<string, unknown>): string | null {
  for (const key of SEASON_KEYS) {
    const id = exactScalarIdentifier(row[key]);
    if (id) return id;
  }
  const seasonName = displayText(row.season_name);
  const seasonNameMatch = /^(?:season|sezon)\s+([^\s]+)$/i.exec(seasonName);
  if (seasonNameMatch?.[1]) return seasonNameMatch[1];
  if (seasonName) return seasonName;
  const label = displayText(row.name) || displayText(row.title);
  const match = /^(?:season|sezon)\s+([^\s]+)$/i.exec(label);
  return match?.[1] ?? null;
}

function seasonLabel(row: Record<string, unknown>, id: string) {
  const providerLabel = displayText(row.name) || displayText(row.title) || displayText(row.season_name);
  const numeric = /^\d+$/.test(id) ? Number(id) : undefined;
  if (numeric != null && Number.isFinite(numeric)) return numeric === 0 ? "Özel Bölümler" : `Sezon ${numeric}`;
  const match = /^(?:season|sezon)\s+(\d+)$/i.exec(providerLabel);
  if (match) return Number(match[1]) === 0 ? "Özel Bölümler" : `Sezon ${Number(match[1])}`;
  return providerLabel || `Sezon ${redactSensitiveText(id).slice(0, 40)}`;
}

function episodeIdentity(value: unknown): string | null {
  const row = objectValue(value);
  if (!row) return exactScalarIdentifier(value);
  for (const key of EPISODE_KEYS) {
    const id = exactScalarIdentifier(row[key]);
    if (id) return id;
  }
  return exactScalarIdentifier(row.id);
}

export function stalkerSeriesEpisodeNumber(value: unknown) {
  const row = objectValue(value);
  if (!row) return undefined;
  for (const key of ["episode_number", "episode_num", "episode"] as const) {
    const ordinal = numberField(row, key);
    if (ordinal != null && ordinal >= 0) return ordinal;
  }
  return undefined;
}

function episodeLabel(value: unknown, id: string) {
  const row = objectValue(value);
  return row
    ? displayText(row.name) || displayText(row.title) || `Bölüm ${redactSensitiveText(id).slice(0, 40)}`
    : `Bölüm ${redactSensitiveText(id).slice(0, 40)}`;
}

function hierarchyRows(payload: unknown) {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  const append = (value: unknown, depth: number) => {
    if (depth > 4 || rows.length >= MAX_ROWS) return;
    if (Array.isArray(value)) {
      for (const item of value) append(item, depth + 1);
      return;
    }
    const row = objectValue(value);
    if (!row || seen.has(row)) return;
    seen.add(row);
    if (seasonIdentity(row)) rows.push(row);
    for (const [key, nested] of Object.entries(row)) {
      if (key === "series" || key === "episodes") continue;
      if (nested && typeof nested === "object") append(nested, depth + 1);
    }
  };
  for (const row of rowsFromEnvelope(payload)) append(row, 0);
  if (!rows.length) append(payload, 0);
  return rows;
}

function seasonOrdinal(season: StalkerSeriesProductSeason) {
  const id = season.id.trim();
  if (/^\d+$/.test(id)) return Number(id);
  const match = /(?:season|sezon)\s*(\d+)/i.exec(season.label);
  return match ? Number(match[1]) : null;
}

export function sortStalkerSeriesSeasons(seasons: readonly StalkerSeriesProductSeason[]) {
  return [...seasons].sort((a, b) => {
    const aNumber = seasonOrdinal(a);
    const bNumber = seasonOrdinal(b);
    const aNumeric = aNumber != null && aNumber > 0;
    const bNumeric = bNumber != null && bNumber > 0;
    if (aNumeric && bNumeric) return aNumber - bNumber;
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    const aZero = aNumber === 0;
    const bZero = bNumber === 0;
    if (aZero !== bZero) return aZero ? -1 : 1;
    return a.label.localeCompare(b.label, "tr", { numeric: true, sensitivity: "base" });
  });
}

export function firstStalkerSeriesSeasonId(seasons: readonly StalkerSeriesProductSeason[]) {
  const firstNumeric = seasons.find((season) => {
    const ordinal = seasonOrdinal(season);
    return ordinal != null && ordinal > 0;
  });
  return firstNumeric?.id ?? seasons[0]?.id ?? null;
}

export function mergeStalkerSeriesItems(
  existing: readonly StalkerSeriesProductItem[],
  incoming: readonly StalkerSeriesProductItem[],
) {
  const seen = new Set(existing.map((item) => item.id));
  const merged = [...existing];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

export type StalkerSeriesSortMode = "default" | "alphaAsc" | "alphaDesc" | "idAsc" | "idDesc";

export function sortStalkerSeriesItems(
  items: readonly StalkerSeriesProductItem[],
  mode: StalkerSeriesSortMode,
) {
  if (mode === "default") return [...items];
  const sorted = [...items];
  if (mode === "alphaAsc" || mode === "alphaDesc") {
    const direction = mode === "alphaAsc" ? 1 : -1;
    return sorted.sort((a, b) => direction * a.title.localeCompare(b.title, "tr", { numeric: true, sensitivity: "base" }));
  }
  const direction = mode === "idAsc" ? 1 : -1;
  return sorted.sort((a, b) => direction * a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }));
}

function normalizedSearchText(value: string) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim();
}

function linkedTimeoutSignal(external?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  external?.addEventListener("abort", abort, { once: true });
  if (external?.aborted) controller.abort();
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      external?.removeEventListener("abort", abort);
    },
  };
}

async function boundedRequest(session: StalkerIsolatedSession, params: Params, signal?: AbortSignal) {
  const linked = linkedTimeoutSignal(signal);
  try {
    return await session.request(params, linked.signal, undefined, { providerId: "stalker-series-product" });
  } finally {
    linked.cleanup();
  }
}

function playableUrlFromCreateLink(payload: unknown) {
  const candidates: string[] = [];
  if (typeof payload === "string") candidates.push(payload);
  const root = objectValue(payload);
  const js = objectValue(root?.js);
  for (const object of [root, js]) {
    if (!object) continue;
    for (const key of ["cmd", "url", "link"] as const) {
      const value = object[key];
      if (typeof value === "string") candidates.push(value);
    }
  }
  for (const candidate of candidates) {
    const source = candidate.replace(/^ffmpeg\s+/i, "").trim();
    if (!source) continue;
    try {
      const parsed = new URL(source);
      if (["http:", "https:", "rtsp:", "rtmp:"].includes(parsed.protocol)) return source;
    } catch {
      // Ignore unrelated response fields. No alternate request is attempted.
    }
  }
  throw new StalkerPortalError("INVALID_RESPONSE", "Stalker portal did not return a playable Series link.");
}

function episodePlaybackRefKey(seriesId: string, seasonId: string, episodeId: string) {
  return JSON.stringify([seriesId, seasonId, episodeId]);
}

export class StalkerSeriesPlaybackOwnership {
  private providerId: string;
  private sequence = 0;

  constructor(providerId: string) {
    this.providerId = providerId;
  }

  switchProvider(providerId: string) {
    this.providerId = providerId;
    this.sequence += 1;
  }

  invalidate() {
    this.sequence += 1;
  }

  begin(episodeKey: string): StalkerSeriesPlaybackTicket {
    return { providerId: this.providerId, episodeKey, sequence: ++this.sequence };
  }

  isCurrent(ticket: StalkerSeriesPlaybackTicket) {
    return ticket.providerId === this.providerId && ticket.sequence === this.sequence;
  }
}

export function createStalkerSeriesProductController(session: StalkerIsolatedSession, providerId: string) {
  const playbackRefs = new Map<string, OpaqueSeasonPlaybackRef>();

  const normalizeDetail = (payload: unknown, item: StalkerSeriesProductItem) => {
    const rowObjects = hierarchyRows(payload);
    const seasonsById = new Map<string, {
      row: Record<string, unknown>;
      episodes: Map<string, StalkerSeriesProductEpisode>;
      commands: Map<string, string>;
    }>();
    let totalEpisodes = 0;
    let hierarchyTruncated = false;

    for (const row of rowObjects) {
      if (totalEpisodes >= MAX_TOTAL_EPISODES) {
        hierarchyTruncated = true;
        break;
      }
      const seasonId = seasonIdentity(row);
      if (!seasonId) continue;
      const bucket = seasonsById.get(seasonId) ?? {
        row,
        episodes: new Map<string, StalkerSeriesProductEpisode>(),
        commands: new Map<string, string>(),
      };
      const seasonCmd = rawText(row.cmd);
      const embedded = [
        ...(Array.isArray(row.series) ? row.series : []),
        ...(Array.isArray(row.episodes) ? row.episodes : []),
      ];
      const hasExplicitEpisodeIdentity = EPISODE_KEYS.some((key) => exactScalarIdentifier(row[key]) !== null);
      const candidates = hasExplicitEpisodeIdentity ? [row, ...embedded] : embedded;
      const remainingTotal = MAX_TOTAL_EPISODES - totalEpisodes;
      const materializeLimit = Math.min(candidates.length, MAX_EPISODES_PER_SEASON, remainingTotal);
      if (candidates.length > materializeLimit) hierarchyTruncated = true;
      for (const candidate of candidates.slice(0, materializeLimit)) {
        const episodeId = episodeIdentity(candidate);
        if (!episodeId || bucket.episodes.has(episodeId)) continue;
        const identity = stalkerSeriesEpisodeIdentity(providerId, item.id, seasonId, episodeId);
        bucket.episodes.set(episodeId, {
          key: stalkerSeriesEpisodeIdentityKey(identity),
          id: episodeId,
          label: episodeLabel(candidate, episodeId),
          seasonId,
          episodeNumber: stalkerSeriesEpisodeNumber(candidate),
        });
        const episodeCmd = rawText(objectValue(candidate)?.cmd) ?? seasonCmd;
        if (episodeCmd) bucket.commands.set(episodeId, episodeCmd);
        totalEpisodes += 1;
      }
      seasonsById.set(seasonId, bucket);
    }

    const refs = new Map<string, OpaqueSeasonPlaybackRef>();
    const seasons = sortStalkerSeriesSeasons([...seasonsById.entries()].map(([seasonId, bucket]) => {
      const episodes = orderSeriesEpisodes([...bucket.episodes.values()]);
      for (const episode of episodes) {
        const cmd = bucket.commands.get(episode.id) ?? rawText(bucket.row.cmd);
        if (cmd) refs.set(episodePlaybackRefKey(item.id, seasonId, episode.id), {
          seriesId: item.id,
          seasonId,
          episodeId: episode.id,
          cmd,
        });
      }
      return {
        id: seasonId,
        label: seasonLabel(bucket.row, seasonId),
        episodeCount: episodes.length,
        episodes,
      };
    }));

    return {
      detail: {
        seriesId: item.id,
        title: item.title,
        ...mergeMetadata(item, rowObjects),
        seasons,
        hierarchyTruncated,
      } satisfies StalkerSeriesProductDetail,
      refs,
      episodeCount: totalEpisodes,
    };
  };

  return {
    async loadCategories(signal?: AbortSignal): Promise<StalkerSeriesProductCategory[]> {
      const payload = await boundedRequest(session, { type: "series", action: "get_categories" }, signal);
      const seen = new Set<string>();
      const categories: StalkerSeriesProductCategory[] = [];
      let hasGlobalCategory = false;
      for (const raw of rowsFromEnvelope(payload)) {
        const row = objectValue(raw);
        if (!row) continue;
        const id = exactScalarIdentifier(row.id ?? row.category_id ?? row.genre_id);
        const title = displayText(row.title) || displayText(row.name);
        if (!id || !title || seen.has(id)) continue;
        const global = isStalkerSeriesGlobalCategory({ id, title });
        if (global && hasGlobalCategory) continue;
        seen.add(id);
        if (global) hasGlobalCategory = true;
        categories.push({ id, title });
      }
      return categories;
    },

    async loadPage(
      category: StalkerSeriesProductCategory,
      page = 1,
      signal?: AbortSignal,
    ): Promise<StalkerSeriesProductPage> {
      const requestedPage = Math.trunc(page);
      if (requestedPage < 1 || requestedPage > MAX_PAGE) {
        throw new StalkerPortalError("INVALID_RESPONSE", "Stalker Series page is outside the bounded range.");
      }
      const payload = await boundedRequest(session, {
        type: "series",
        action: "get_ordered_list",
        category: category.id,
        p: requestedPage,
      }, signal);
      const envelope = envelopeObject(payload);
      const seen = new Set<string>();
      const items: StalkerSeriesProductItem[] = [];
      for (const raw of rowsFromEnvelope(payload).slice(0, MAX_ROWS)) {
        const row = objectValue(raw);
        if (!row) continue;
        const id = exactScalarIdentifier(row.id ?? row.series_id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const metadata = metadataFromRow(row);
        items.push({
          id,
          title: displayText(row.name) || displayText(row.title) || redactSensitiveText(id).slice(0, 80),
          categoryId: rawText(row.category_id),
          ...metadata,
        });
      }
      const totalItems = numberField(envelope, "total_items");
      const maxPageItems = numberField(envelope, "max_page_items");
      const providerPage = numberField(envelope, "cur_page");
      const currentPage = providerPage != null && providerPage >= 1 ? Math.trunc(providerPage) : requestedPage;
      const hasNextPage = totalItems != null && maxPageItems != null && maxPageItems > 0
        ? currentPage * maxPageItems < totalItems
        : maxPageItems != null && maxPageItems > 0
          ? items.length >= maxPageItems
          : false;
      return {
        items,
        page: currentPage,
        currentPage,
        totalItems,
        maxPageItems,
        hasNextPage: hasNextPage && currentPage < MAX_PAGE,
      };
    },

    async loadDetail(item: StalkerSeriesProductItem, signal?: AbortSignal): Promise<StalkerSeriesProductDetail> {
      const payload = await boundedRequest(session, {
        type: "series",
        action: "get_ordered_list",
        movie_id: item.id,
        p: 1,
      }, signal);
      let normalized = normalizeDetail(payload, item);
      if (normalized.episodeCount === 0 && !signal?.aborted) {
        try {
          const fallbackPayload = await boundedRequest(session, {
            type: "vod",
            action: "get_ordered_list",
            movie_id: item.id,
            season_id: 0,
            episode_id: 0,
            p: 1,
          }, signal);
          const fallback = normalizeDetail(fallbackPayload, item);
          if (fallback.episodeCount > 0) normalized = fallback;
        } catch (caught) {
          if (signal?.aborted) throw caught;
          // The primary hierarchy remains authoritative when the compatibility
          // candidate is unsupported or temporarily unavailable.
        }
      }
      playbackRefs.clear();
      for (const [key, ref] of normalized.refs) playbackRefs.set(key, ref);
      return normalized.detail;
    },

    async resolveEpisode(
      seriesId: string,
      seasonId: string,
      episodeId: string,
      signal?: AbortSignal,
    ): Promise<string> {
      const ref = playbackRefs.get(episodePlaybackRefKey(seriesId, seasonId, episodeId));
      if (!ref || !ref.cmd) throw new StalkerPortalError("INVALID_RESPONSE", "Series season playback reference is unavailable.");
      const payload = await boundedRequest(session, {
        type: "vod",
        action: "create_link",
        cmd: ref.cmd,
        series: episodeId,
      }, signal);
      return playableUrlFromCreateLink(payload);
    },

    clear() {
      playbackRefs.clear();
    },
  };
}

export type StalkerSeriesProductController = ReturnType<typeof createStalkerSeriesProductController>;

/**
 * Rebuilds the transient Series playback reference from durable identity.
 * `loadDetail(movie_id)` is the provider's targeted hierarchy lookup: its
 * current response supplies both the season cmd and the embedded episode ids.
 */
export async function resolveStalkerSeriesHistoryEpisode(
  session: StalkerIsolatedSession,
  providerId: string,
  ref: StalkerSeriesEpisodeReplayRef,
  seriesTitle: string,
  signal?: AbortSignal,
): Promise<StalkerSeriesPlayableIntent> {
  const controller = createStalkerSeriesProductController(session, providerId);
  try {
    const detail = await controller.loadDetail({ id: ref.seriesId, title: seriesTitle }, signal);
    const season = detail.seasons.find((item) => item.id === ref.seasonId);
    if (!season) {
      throw new StalkerPortalError("INVALID_RESPONSE", "Series season is no longer available.");
    }
    if (!season.episodes.some((item) => item.id === ref.episodeId)) {
      throw new StalkerPortalError("INVALID_RESPONSE", "Series episode is no longer available.");
    }
    const url = await controller.resolveEpisode(
      ref.seriesId,
      ref.seasonId,
      ref.episodeId,
      signal,
    );
    return buildStalkerSeriesPlayableIntent(
      providerId,
      detail,
      ref.seasonId,
      ref.episodeId,
      url,
    );
  } finally {
    controller.clear();
  }
}

export function findStalkerSeriesGlobalCategory(categories: readonly StalkerSeriesProductCategory[]) {
  return categories.find(isStalkerSeriesGlobalCategory) ?? null;
}

export function isStalkerSeriesGlobalCategory(category: StalkerSeriesProductCategory) {
  const title = normalizedSearchText(category.title);
  return category.id.trim() === "*" || title === "all" || title === "tumu" || title === "tum";
}

export async function searchStalkerSeriesCatalog(
  controller: StalkerSeriesProductController,
  categories: readonly StalkerSeriesProductCategory[],
  query: string,
  signal?: AbortSignal,
  categoryId?: string,
  onProgress?: (results: readonly StalkerSeriesProductItem[]) => void,
) {
  const needle = normalizedSearchText(query);
  if (!needle) return [];
  const requestedCategoryId = categoryId?.trim();
  const searchCategory = requestedCategoryId
    ? categories.find((category) => category.id === requestedCategoryId) ?? null
    : findStalkerSeriesGlobalCategory(categories);
  if (!searchCategory) {
    throw new Error(requestedCategoryId
      ? "Selected Series search category is unavailable."
      : "Global Series search requires the provider All category.");
  }

  const results: StalkerSeriesProductItem[] = [];
  const seen = new Set<string>();
  let page = 1;
  while (page <= MAX_PAGE) {
    if (signal?.aborted) throw new Error("Series search aborted.");
    const result = await controller.loadPage(searchCategory, page, signal);
    for (const item of result.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (normalizedSearchText(item.title).includes(needle)) results.push(item);
    }
    if (!signal?.aborted) onProgress?.([...results]);
    if (!result.hasNextPage) break;
    const nextPage = Math.max(page + 1, result.currentPage + 1);
    if (nextPage <= page) break;
    page = nextPage;
    await yieldToUi();
  }
  return results;
}

export const STALKER_SERIES_PRODUCT_LIMITS = {
  page: 1,
  maxPage: MAX_PAGE,
  maxRows: MAX_ROWS,
  maxEpisodesPerSeason: MAX_EPISODES_PER_SEASON,
  maxTotalEpisodes: MAX_TOTAL_EPISODES,
  maxCreateLinksPerSelection: 1,
  fallbackDialects: 1,
  timeoutMs: REQUEST_TIMEOUT_MS,
} as const;
