import { Platform } from "react-native";
import { normalizeXtreamBaseUrl } from "./iptv";
import { yieldToUi } from "./cooperative";

export type XtreamCategory = {
  category_id: string | number;
  category_name: string;
  parent_id?: number;
};

export type XtreamVodItem = {
  stream_id: number | string;
  name: string;
  stream_icon?: string;
  rating?: string | number;
  rating_5based?: number;
  added?: string;
  category_id?: string | number;
  container_extension?: string;
  direct_source?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  release_date?: string;
  youtube_trailer?: string;
};

export type XtreamVodInfo = {
  info?: {
    name?: string;
    movie_image?: string;
    backdrop_path?: string[];
    tmdb_id?: string | number;
    plot?: string;
    description?: string;
    cast?: string;
    director?: string;
    genre?: string;
    releaseDate?: string;
    release_date?: string;
    duration?: string;
    duration_secs?: number | string;
    rating?: string | number;
    country?: string;
    age?: string;
    youtube_trailer?: string;
    kinopoisk_url?: string;
  } & Record<string, unknown>;
  movie_data?: {
    stream_id?: string | number;
    name?: string;
    added?: string;
    category_id?: string | number;
    container_extension?: string;
    custom_sid?: string;
    direct_source?: string;
  } & Record<string, unknown>;
};

export type XtreamSeriesItem = {
  series_id: number | string;
  name: string;
  cover?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  release_date?: string;
  rating?: string | number;
  category_id?: string | number;
  backdrop_path?: string[];
};

export type XtreamEpisode = {
  id: string | number;
  episode_num?: number;
  title?: string;
  container_extension?: string;
  direct_source?: string;
  info?: {
    movie_image?: string;
    plot?: string;
    duration?: string;
    rating?: string | number;
    releaseDate?: string;
  };
};

export type XtreamSeason = {
  season_number: number;
  name?: string;
  cover?: string;
  cover_big?: string;
  episode_count?: number;
  overview?: string;
};

export type XtreamSeriesInfo = {
  info?: XtreamSeriesItem & Record<string, unknown>;
  seasons?: XtreamSeason[];
  episodes?: Record<string, XtreamEpisode[]>;
};

export type XtreamCredentials = {
  baseUrl: string;
  username: string;
  password: string;
};

export type XtreamParseMetrics = {
  bodyReadMs: number;
  jsonParseMs: number;
  parseMs: number;
  responseChars: number;
};

export type XtreamParseMetricsSink = (metrics: XtreamParseMetrics) => void;

export type EpisodePlaybackItem = {
  id: string;
  title: string;
  url: string;
  season: string;
  episodeNumber?: number;
};

export type EpisodePlaybackQueue = {
  items: EpisodePlaybackItem[];
  index: number;
};

export type VodPlaybackItem = {
  id: string;
  title: string;
  url: string;
  categoryId?: string;
  genre?: string;
};

export type VodPlaybackQueue = {
  items: VodPlaybackItem[];
  index: number;
};

export type XtreamCatalogErrorCode =
  | "INVALID_RESPONSE"
  | "UNSUPPORTED_RESPONSE"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "UNREACHABLE"
  | "HTTP_ERROR";

export class XtreamCatalogError extends Error {
  readonly code: XtreamCatalogErrorCode;
  readonly status?: number;

  constructor(code: XtreamCatalogErrorCode, message: string, status?: number) {
    super(message);
    this.name = "XtreamCatalogError";
    this.code = code;
    this.status = status;
  }
}

export function isXtreamCatalogFallbackError(error: unknown) {
  return (
    error instanceof XtreamCatalogError &&
    (error.code === "INVALID_RESPONSE" ||
      error.code === "UNSUPPORTED_RESPONSE" ||
      error.code === "NOT_FOUND")
  );
}

const episodeQueueByUrl = new Map<string, EpisodePlaybackQueue>();
const vodQueueByUrl = new Map<string, VodPlaybackQueue>();

const normalizeCatalogBaseUrl = (value: string) => {
  const normalized = normalizeXtreamBaseUrl(value);
  try {
    const url = new URL(normalized);
    if (/\/get\.php$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/get\.php$/i, "") || "/";
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    // normalizeXtreamBaseUrl already validates URL inputs.
  }
  return normalized;
};

const encodeCredentials = (credentials: XtreamCredentials) => ({
  baseUrl: normalizeCatalogBaseUrl(credentials.baseUrl),
  username: credentials.username.trim(),
  password: credentials.password,
});

async function parseResponse(response: Response, onParseMetrics?: XtreamParseMetricsSink) {
  const bodyReadStartedAt = Date.now();
  const text = await response.text();
  const bodyReadMs = Date.now() - bodyReadStartedAt;
  await yieldToUi();

  if (response.status === 404) {
    throw new XtreamCatalogError(
      "NOT_FOUND",
      "Xtream catalog endpoint is not available on this server.",
      response.status,
    );
  }

  if (response.status >= 500) {
    throw new XtreamCatalogError(
      "HTTP_ERROR",
      `Xtream request failed with HTTP ${response.status}.`,
      response.status,
    );
  }

  let data: unknown;
  const jsonParseStartedAt = Date.now();
  try {
    data = JSON.parse(text);
  } catch {
    if (!response.ok) {
      throw new XtreamCatalogError(
        "HTTP_ERROR",
        `Xtream request failed with HTTP ${response.status}.`,
        response.status,
      );
    }
    throw new XtreamCatalogError(
      "INVALID_RESPONSE",
      "Xtream server returned an invalid JSON response.",
      response.status,
    );
  }
  const jsonParseMs = Date.now() - jsonParseStartedAt;
  onParseMetrics?.({
    bodyReadMs,
    jsonParseMs,
    parseMs: bodyReadMs + jsonParseMs,
    responseChars: text.length,
  });
  if (!response.ok) {
    const message = (data as any)?.error?.message;
    throw new XtreamCatalogError(
      "HTTP_ERROR",
      message || `Xtream request failed with HTTP ${response.status}.`,
      response.status,
    );
  }
  return data as any;
}

function transportError(caught: unknown, target: "server" | "web proxy") {
  const name = caught instanceof Error ? caught.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new XtreamCatalogError("TIMEOUT", `Xtream ${target} timed out.`);
  }
  return new XtreamCatalogError("UNREACHABLE", `Xtream ${target} could not be reached.`);
}

function linkedRequestSignal(external: AbortSignal | undefined, timeoutMs: number) {
  if (!external) {
    return { signal: AbortSignal.timeout(timeoutMs), cleanup: () => undefined };
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  external.addEventListener("abort", onAbort, { once: true });
  if (external.aborted) controller.abort();
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      external.removeEventListener("abort", onAbort);
    },
  };
}

async function requestNative(
  credentials: XtreamCredentials,
  action: string,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
  onParseMetrics?: XtreamParseMetricsSink,
) {
  const normalized = encodeCredentials(credentials);
  const url = new URL("player_api.php", `${normalized.baseUrl}/`);
  url.searchParams.set("username", normalized.username);
  url.searchParams.set("password", normalized.password);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });

  const requestAbort = linkedRequestSignal(signal, 20_000);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "LegendStream-XPlayer/1.0 Android",
      },
      signal: requestAbort.signal,
    });
    return await parseResponse(response, onParseMetrics);
  } catch (caught) {
    if (signal?.aborted) throw caught;
    throw transportError(caught, "server");
  } finally {
    requestAbort.cleanup();
  }
}

async function requestWeb(
  credentials: XtreamCredentials,
  action: string,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
  onParseMetrics?: XtreamParseMetricsSink,
) {
  const requestAbort = linkedRequestSignal(signal, 25_000);
  try {
    const response = await fetch("/api/iptv/xtream/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...encodeCredentials(credentials), action, params }),
      signal: requestAbort.signal,
    });
    return await parseResponse(response, onParseMetrics);
  } catch (caught) {
    if (signal?.aborted) throw caught;
    throw transportError(caught, "web proxy");
  } finally {
    requestAbort.cleanup();
  }
}

async function requestXtream(
  credentials: XtreamCredentials,
  action: string,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
  onParseMetrics?: XtreamParseMetricsSink,
) {
  return Platform.OS === "web"
    ? requestWeb(credentials, action, params, signal, onParseMetrics)
    : requestNative(credentials, action, params, signal, onParseMetrics);
}

function requireArray<T>(data: unknown, label: string): T[] {
  if (!Array.isArray(data)) {
    throw new XtreamCatalogError(
      "UNSUPPORTED_RESPONSE",
      `Xtream server returned an unsupported ${label} response.`,
    );
  }
  return data as T[];
}

export async function getVodCategories(credentials: XtreamCredentials, signal?: AbortSignal) {
  const data = await requestXtream(credentials, "get_vod_categories", {}, signal);
  return requireArray<XtreamCategory>(data, "VOD categories");
}

function registerVodQueue(credentials: XtreamCredentials | null | undefined, rows: XtreamVodItem[]) {
  const items: VodPlaybackItem[] = rows.map((item) => ({
    id: String(item.stream_id),
    title: item.name,
    categoryId: item.category_id === undefined ? undefined : String(item.category_id),
    genre: item.genre,
    url: buildVodStreamUrl(credentials, item),
  }));
  items.forEach((item, index) => {
    vodQueueByUrl.set(item.url, { items, index });
  });
}

export function getVodPlaybackQueue(source: string): VodPlaybackQueue | undefined {
  return vodQueueByUrl.get(source);
}

export async function getVodStreams(
  credentials: XtreamCredentials,
  categoryId?: string | number,
  signal?: AbortSignal,
  onParseMetrics?: XtreamParseMetricsSink,
) {
  const data = await requestXtream(credentials, "get_vod_streams", {
    category_id: categoryId,
  }, signal, onParseMetrics);
  const rows = requireArray<XtreamVodItem>(data, "VOD streams");
  registerVodQueue(credentials, rows);
  await yieldToUi();
  return rows;
}

export function registerLocalVodQueue(rows: XtreamVodItem[]) {
  registerVodQueue(undefined, rows);
}

export function registerVodPlaybackQueue(credentials: XtreamCredentials, rows: XtreamVodItem[]) {
  registerVodQueue(credentials, rows);
}

export async function getVodInfo(
  credentials: XtreamCredentials,
  vodId: string | number,
) {
  const data = await requestXtream(credentials, "get_vod_info", {
    vod_id: vodId,
  });
  return (data ?? {}) as XtreamVodInfo;
}

export async function getSeriesCategories(credentials: XtreamCredentials, signal?: AbortSignal) {
  const data = await requestXtream(credentials, "get_series_categories", {}, signal);
  return requireArray<XtreamCategory>(data, "series categories");
}

export async function getSeries(
  credentials: XtreamCredentials,
  categoryId?: string | number,
  signal?: AbortSignal,
  onParseMetrics?: XtreamParseMetricsSink,
) {
  const data = await requestXtream(credentials, "get_series", {
    category_id: categoryId,
  }, signal, onParseMetrics);
  await yieldToUi();
  return requireArray<XtreamSeriesItem>(data, "series catalog");
}

function registerEpisodeQueue(credentials: XtreamCredentials | null | undefined, info: XtreamSeriesInfo) {
  const items: EpisodePlaybackItem[] = [];
  Object.entries(info.episodes ?? {}).forEach(([season, episodes]) => {
    episodes.forEach((episode) => {
      items.push({
        id: String(episode.id),
        title: episode.title || `S${season} · E${episode.episode_num ?? items.length + 1}`,
        season,
        episodeNumber: episode.episode_num,
        url: buildEpisodeStreamUrl(credentials, episode),
      });
    });
  });
  items.forEach((item, index) => {
    episodeQueueByUrl.set(item.url, { items, index });
  });
}

export function registerLocalEpisodeQueue(info: XtreamSeriesInfo) {
  registerEpisodeQueue(undefined, info);
}

export function getEpisodePlaybackQueue(source: string): EpisodePlaybackQueue | undefined {
  return episodeQueueByUrl.get(source);
}

export async function getSeriesInfo(
  credentials: XtreamCredentials,
  seriesId: string | number,
) {
  const data = (await requestXtream(credentials, "get_series_info", {
    series_id: seriesId,
    series: seriesId,
  })) as XtreamSeriesInfo;
  const info = (data ?? {}) as XtreamSeriesInfo;
  registerEpisodeQueue(credentials, info);
  return info;
}

export function buildVodStreamUrl(
  credentials: XtreamCredentials | null | undefined,
  item: XtreamVodItem,
) {
  if (item.direct_source) return item.direct_source;
  if (!credentials) throw new Error("Xtream credentials are required for this VOD stream.");
  const baseUrl = normalizeCatalogBaseUrl(credentials.baseUrl);
  const extension = item.container_extension || "mp4";
  return `${baseUrl}/movie/${encodeURIComponent(credentials.username)}/${encodeURIComponent(
    credentials.password,
  )}/${encodeURIComponent(String(item.stream_id))}.${extension}`;
}

export function buildEpisodeStreamUrl(
  credentials: XtreamCredentials | null | undefined,
  episode: XtreamEpisode,
) {
  if (episode.direct_source) return episode.direct_source;
  if (!credentials) throw new Error("Xtream credentials are required for this episode stream.");
  const baseUrl = normalizeCatalogBaseUrl(credentials.baseUrl);
  const extension = episode.container_extension || "mp4";
  return `${baseUrl}/series/${encodeURIComponent(credentials.username)}/${encodeURIComponent(
    credentials.password,
  )}/${encodeURIComponent(String(episode.id))}.${extension}`;
}
