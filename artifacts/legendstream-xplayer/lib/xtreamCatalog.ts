import { yieldToUi } from "./cooperative";
import {
  createXtreamClient,
  normalizeXtreamBaseUrl,
  type XtreamCategory,
  type XtreamCredentials,
  type XtreamLiveItem,
  type XtreamParseMetrics,
  type XtreamParseMetricsSink,
} from "./xtream/client";
import {
  XtreamCatalogError,
  isXtreamCatalogFallbackError,
  type XtreamCatalogErrorCode,
} from "./xtreamCatalogErrors";

export {
  XtreamCatalogError,
  isXtreamCatalogFallbackError,
  type XtreamCatalogErrorCode,
  type XtreamCategory,
  type XtreamCredentials,
  type XtreamLiveItem,
  type XtreamParseMetrics,
  type XtreamParseMetricsSink,
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

const episodeQueueByUrl = new Map<string, EpisodePlaybackQueue>();
const vodQueueByUrl = new Map<string, VodPlaybackQueue>();

const clientFor = (credentials: XtreamCredentials) => createXtreamClient(credentials);

export async function authenticateXtream(credentials: XtreamCredentials, signal?: AbortSignal) {
  return clientFor(credentials).authenticate(signal);
}

export async function getLiveCategories(credentials: XtreamCredentials, signal?: AbortSignal) {
  return clientFor(credentials).getLiveCategories(signal);
}

export async function getLiveStreams(
  credentials: XtreamCredentials,
  signal?: AbortSignal,
  onParseMetrics?: XtreamParseMetricsSink,
) {
  return clientFor(credentials).getLiveStreams(signal, onParseMetrics);
}

export async function getVodCategories(credentials: XtreamCredentials, signal?: AbortSignal) {
  return clientFor(credentials).getVodCategories(signal);
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
  const rows = await clientFor(credentials).getVodStreams(
    categoryId,
    signal,
    onParseMetrics,
  ) as XtreamVodItem[];
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
  signal?: AbortSignal,
) {
  return await clientFor(credentials).getVodInfo(vodId, signal) as XtreamVodInfo;
}

export async function getSeriesCategories(credentials: XtreamCredentials, signal?: AbortSignal) {
  return clientFor(credentials).getSeriesCategories(signal);
}

export async function getSeries(
  credentials: XtreamCredentials,
  categoryId?: string | number,
  signal?: AbortSignal,
  onParseMetrics?: XtreamParseMetricsSink,
) {
  const rows = await clientFor(credentials).getSeries(
    categoryId,
    signal,
    onParseMetrics,
  ) as XtreamSeriesItem[];
  await yieldToUi();
  return rows;
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
  signal?: AbortSignal,
) {
  const info = await clientFor(credentials).getSeriesInfo(seriesId, signal) as XtreamSeriesInfo;
  registerEpisodeQueue(credentials, info);
  return info;
}

export function buildVodStreamUrl(
  credentials: XtreamCredentials | null | undefined,
  item: XtreamVodItem,
) {
  if (item.direct_source) return item.direct_source;
  if (!credentials) throw new Error("Xtream credentials are required for this VOD stream.");
  const baseUrl = normalizeXtreamBaseUrl(credentials.baseUrl);
  const extension = item.container_extension || "mp4";
  return `${baseUrl}/movie/${encodeURIComponent(credentials.username.trim())}/${encodeURIComponent(
    credentials.password,
  )}/${encodeURIComponent(String(item.stream_id))}.${extension}`;
}

export function buildEpisodeStreamUrl(
  credentials: XtreamCredentials | null | undefined,
  episode: XtreamEpisode,
) {
  if (episode.direct_source) return episode.direct_source;
  if (!credentials) throw new Error("Xtream credentials are required for this episode stream.");
  const baseUrl = normalizeXtreamBaseUrl(credentials.baseUrl);
  const extension = episode.container_extension || "mp4";
  return `${baseUrl}/series/${encodeURIComponent(credentials.username.trim())}/${encodeURIComponent(
    credentials.password,
  )}/${encodeURIComponent(String(episode.id))}.${extension}`;
}
