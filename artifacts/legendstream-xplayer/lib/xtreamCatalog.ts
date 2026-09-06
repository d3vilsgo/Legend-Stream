import { yieldToUi } from "./cooperative";
import {
  createXtreamClient,
  normalizeXtreamBaseUrl,
  normalizeXtreamCredentials,
  type XtreamCategory,
  type XtreamClient,
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

type PreparedRun = {
  client: XtreamClient;
  externalSignal?: AbortSignal;
  requestController: AbortController;
  requestSignal: AbortSignal;
  provisional: boolean;
  auth: Promise<void>;
  liveTaxonomy: Promise<XtreamCategory[]>;
  vodTaxonomy: Promise<XtreamCategory[]>;
  seriesTaxonomy: Promise<XtreamCategory[]>;
};

const episodeQueueByUrl = new Map<string, EpisodePlaybackQueue>();
const vodQueueByUrl = new Map<string, VodPlaybackQueue>();
const preparedRuns = new Map<string, PreparedRun>();

const credentialsKey = (credentials: XtreamCredentials) => {
  const normalized = normalizeXtreamCredentials(credentials);
  return `${normalized.baseUrl}\u0000${normalized.username}\u0000${normalized.password}`;
};

const clientFor = (credentials: XtreamCredentials) => createXtreamClient(credentials);

function linkExternalAbort(signal: AbortSignal | undefined, controller: AbortController) {
  if (!signal) return;
  if (signal.aborted) {
    controller.abort();
    return;
  }
  signal.addEventListener("abort", () => controller.abort(), { once: true });
}

export function beginXtreamCatalogRun(
  credentials: XtreamCredentials,
  signal?: AbortSignal,
  options: { provisional?: boolean } = {},
): PreparedRun {
  const key = credentialsKey(credentials);
  const existing = preparedRuns.get(key);
  if (existing && !existing.requestSignal.aborted) {
    if (existing.externalSignal === signal) return existing;
    if (existing.provisional && existing.externalSignal === undefined && signal) {
      existing.externalSignal = signal;
      existing.provisional = false;
      linkExternalAbort(signal, existing.requestController);
      return existing;
    }
  }

  const client = clientFor(credentials);
  const requestController = new AbortController();
  linkExternalAbort(signal, requestController);
  const requestSignal = requestController.signal;
  const auth = (async () => {
    await client.authenticate(requestSignal);
  })();
  const liveTaxonomy = auth.then(() => client.getLiveCategories(requestSignal));
  const vodTaxonomy = auth.then(() => client.getVodCategories(requestSignal));
  const seriesTaxonomy = auth.then(() => client.getSeriesCategories(requestSignal));
  const run: PreparedRun = {
    client,
    externalSignal: signal,
    requestController,
    requestSignal,
    provisional: options.provisional === true,
    auth,
    liveTaxonomy,
    vodTaxonomy,
    seriesTaxonomy,
  };
  preparedRuns.set(key, run);

  void auth.catch(() => {
    if (preparedRuns.get(key) === run) preparedRuns.delete(key);
  });
  void liveTaxonomy.catch(() => undefined);
  void vodTaxonomy.catch(() => undefined);
  void seriesTaxonomy.catch(() => undefined);
  return run;
}

export function releaseXtreamCatalogRun(credentials: XtreamCredentials, signal?: AbortSignal) {
  const key = credentialsKey(credentials);
  const run = preparedRuns.get(key);
  if (run && (signal === undefined || run.externalSignal === signal)) preparedRuns.delete(key);
}

function preparedClient(credentials: XtreamCredentials, signal?: AbortSignal) {
  const run = preparedRuns.get(credentialsKey(credentials));
  return run && (run.externalSignal === signal || signal === undefined) ? run.client : clientFor(credentials);
}

export async function authenticateXtream(credentials: XtreamCredentials, signal?: AbortSignal) {
  return clientFor(credentials).authenticate(signal);
}

export async function getLiveCategories(credentials: XtreamCredentials, signal?: AbortSignal) {
  return await beginXtreamCatalogRun(credentials, signal).liveTaxonomy;
}

export async function getLiveStreams(
  credentials: XtreamCredentials,
  signal?: AbortSignal,
  onParseMetrics?: XtreamParseMetricsSink,
) {
  const run = beginXtreamCatalogRun(credentials, signal);
  await run.auth;
  return run.client.getLiveStreams(run.requestSignal, onParseMetrics);
}

export async function getVodCategories(credentials: XtreamCredentials, signal?: AbortSignal) {
  return await beginXtreamCatalogRun(credentials, signal).vodTaxonomy;
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
  const run = beginXtreamCatalogRun(credentials, signal);
  await run.auth;
  const rows = await run.client.getVodStreams(
    categoryId,
    run.requestSignal,
    onParseMetrics,
  ) as XtreamVodItem[];
  // Catalog refresh must not materialize a whole-provider playback registry. Paged
  // playback resolves its bounded window from SQLite; explicit legacy callers may
  // still register a queue on demand through registerVodPlaybackQueue.
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
  return await beginXtreamCatalogRun(credentials, signal).seriesTaxonomy;
}

export async function getSeries(
  credentials: XtreamCredentials,
  categoryId?: string | number,
  signal?: AbortSignal,
  onParseMetrics?: XtreamParseMetricsSink,
) {
  const run = beginXtreamCatalogRun(credentials, signal);
  await run.auth;
  const rows = await run.client.getSeries(
    categoryId,
    run.requestSignal,
    onParseMetrics,
  ) as XtreamSeriesItem[];
  await yieldToUi();
  return rows;
}

export async function loadXtreamLiveCatalog(
  credentials: XtreamCredentials,
  signal?: AbortSignal,
  onParseMetrics?: XtreamParseMetricsSink,
) {
  const run = beginXtreamCatalogRun(credentials, signal);
  const categories = await run.liveTaxonomy;
  const streams = await run.client.getLiveStreams(run.requestSignal, onParseMetrics);
  return { categories, streams, authValidated: true as const };
}

export async function loadXtreamLiveCatalogFromPreparedRun(
  credentials: XtreamCredentials,
  onParseMetrics?: XtreamParseMetricsSink,
) {
  let run = preparedRuns.get(credentialsKey(credentials));
  if (!run || run.requestSignal.aborted) {
    run = beginXtreamCatalogRun(credentials, undefined, { provisional: true });
  }
  const categories = await run.liveTaxonomy;
  const streams = await run.client.getLiveStreams(run.requestSignal, onParseMetrics);
  return { categories, streams, authValidated: true as const };
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
