import { StalkerPortalError } from "./stalkerPortal";
import type { StalkerIsolatedSession } from "./stalkerIsolatedLogin";
import { redactSensitiveText } from "./safeLog";

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

export type StalkerSeriesPlayerHandoff = {
  source: string;
  title: string;
  subtitle: string;
  mediaKind: "episode";
};

export function buildStalkerSeriesPlayerHandoff(
  detail: StalkerSeriesProductDetail,
  seasonId: string,
  episodeId: string,
  source: string,
): StalkerSeriesPlayerHandoff {
  const season = detail.seasons.find((item) => item.id === seasonId);
  const episode = season?.episodes.find((item) => item.id === episodeId);
  if (!season || !episode) throw new Error("Series episode selection is no longer available.");
  return {
    source,
    title: episode.label,
    subtitle: `${detail.title} · ${season.label}`,
    mediaKind: "episode",
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

type Params = Record<string, string | number | boolean | undefined>;

type OpaqueSeasonPlaybackRef = {
  seriesId: string;
  seasonId: string;
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
  const label = displayText(row.name) || displayText(row.title);
  const match = /^season\s+([^\s]+)$/i.exec(label);
  return match?.[1] ?? null;
}

function seasonLabel(row: Record<string, unknown>, id: string) {
  return displayText(row.name) || displayText(row.title) || `Season ${redactSensitiveText(id).slice(0, 40)}`;
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

function playbackRefKey(seriesId: string, seasonId: string) {
  return JSON.stringify([seriesId, seasonId]);
}

export function stalkerSeriesEpisodeIdentity(providerId: string, seriesId: string, seasonId: string, episodeId: string) {
  return JSON.stringify([providerId, seriesId, seasonId, episodeId]);
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

  return {
    async loadCategories(signal?: AbortSignal): Promise<StalkerSeriesProductCategory[]> {
      const payload = await boundedRequest(session, { type: "series", action: "get_categories" }, signal);
      const seen = new Set<string>();
      const categories: StalkerSeriesProductCategory[] = [];
      for (const raw of rowsFromEnvelope(payload).slice(0, MAX_ROWS)) {
        const row = objectValue(raw);
        if (!row) continue;
        const id = exactScalarIdentifier(row.id ?? row.category_id ?? row.genre_id);
        const title = displayText(row.title) || displayText(row.name);
        if (!id || !title || seen.has(id)) continue;
        seen.add(id);
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
      const rows = rowsFromEnvelope(payload).slice(0, MAX_ROWS);
      const rowObjects = rows.map(objectValue).filter((row): row is Record<string, unknown> => Boolean(row));
      const seasons: StalkerSeriesProductSeason[] = [];
      let totalEpisodes = 0;
      let hierarchyTruncated = false;
      playbackRefs.clear();

      for (const row of rowObjects) {
        if (totalEpisodes >= MAX_TOTAL_EPISODES) {
          hierarchyTruncated = true;
          break;
        }
        const id = seasonIdentity(row);
        if (!id) continue;
        const cmd = typeof row.cmd === "string" && row.cmd.trim().length ? row.cmd : null;
        const embedded = Array.isArray(row.series) ? row.series : [];
        const seenEpisodes = new Set<string>();
        const episodes: StalkerSeriesProductEpisode[] = [];
        const remainingTotal = MAX_TOTAL_EPISODES - totalEpisodes;
        const materializeLimit = Math.min(embedded.length, MAX_EPISODES_PER_SEASON, remainingTotal);
        if (embedded.length > materializeLimit) hierarchyTruncated = true;
        for (const rawEpisodeId of embedded.slice(0, materializeLimit)) {
          const episodeId = exactScalarIdentifier(rawEpisodeId);
          if (!episodeId || seenEpisodes.has(episodeId)) continue;
          seenEpisodes.add(episodeId);
          episodes.push({
            key: stalkerSeriesEpisodeIdentity(providerId, item.id, id, episodeId),
            id: episodeId,
            label: `Bölüm ${redactSensitiveText(episodeId).slice(0, 40)}`,
            seasonId: id,
          });
          totalEpisodes += 1;
        }
        if (cmd) playbackRefs.set(playbackRefKey(item.id, id), { seriesId: item.id, seasonId: id, cmd });
        seasons.push({ id, label: seasonLabel(row, id), episodeCount: episodes.length, episodes });
      }

      return {
        seriesId: item.id,
        title: item.title,
        ...mergeMetadata(item, rowObjects),
        seasons,
        hierarchyTruncated,
      };
    },

    async resolveEpisode(
      seriesId: string,
      seasonId: string,
      episodeId: string,
      signal?: AbortSignal,
    ): Promise<string> {
      const ref = playbackRefs.get(playbackRefKey(seriesId, seasonId));
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

export const STALKER_SERIES_PRODUCT_LIMITS = {
  page: 1,
  maxPage: MAX_PAGE,
  maxRows: MAX_ROWS,
  maxEpisodesPerSeason: MAX_EPISODES_PER_SEASON,
  maxTotalEpisodes: MAX_TOTAL_EPISODES,
  maxCreateLinksPerSelection: 1,
  fallbackDialects: 0,
  timeoutMs: REQUEST_TIMEOUT_MS,
} as const;
