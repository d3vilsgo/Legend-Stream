import type {
  Channel,
  M3UCatalog,
  M3UMovieItem,
  M3USeriesEpisode,
  M3USeriesGroup,
} from "./iptv";
import {
  buildM3UStreamUrlFromProvider,
  parseM3UProviderSource,
  type M3UPathPlaybackRef,
  type M3UProviderSource,
} from "./m3uCatalogRefs";
import type {
  PersistedLiveCatalogItem,
  PersistedM3UEpisode,
  PersistedSeriesCatalogItem,
  PersistedVodCatalogItem,
} from "./catalogPersistence";
import type { XtreamCategory, XtreamSeriesItem, XtreamVodItem } from "./xtreamCatalog";

const M3U_HYDRATION_BATCH_SIZE = 200;

type RuntimeUrlBuilder = (ref: M3UPathPlaybackRef) => string | null;

export type M3UDirectHydrationProvider = {
  id: string;
  url?: string;
  playlistUrl?: string;
};

export type M3UDirectHydration = {
  catalog: M3UCatalog;
  live: Channel[];
  movies: XtreamVodItem[];
  series: XtreamSeriesItem[];
  counts: { live: number; vod: number; series: number };
  vodCategories: XtreamCategory[];
  seriesCategories: XtreamCategory[];
};

export type M3UDirectHydrationOptions = {
  batchSize?: number;
  yieldFn: () => Promise<void>;
};

export class M3UDirectHydrationError extends Error {
  constructor() {
    super("Cached M3U runtime references could not be reconstructed.");
    this.name = "M3UDirectHydrationError";
  }
}

function providerSource(provider: M3UDirectHydrationProvider) {
  return provider.url || provider.playlistUrl || "";
}

function parsedProvider(provider: M3UDirectHydrationProvider): M3UProviderSource {
  const parsed = parseM3UProviderSource(providerSource(provider));
  if (!parsed) throw new M3UDirectHydrationError();
  return parsed;
}

function runtimeUrlBuilder(provider: M3UDirectHydrationProvider): RuntimeUrlBuilder {
  const parsed = parsedProvider(provider);
  return (ref) => buildM3UStreamUrlFromProvider(parsed, ref);
}

function categories(values: string[]): XtreamCategory[] {
  return Array.from(new Set(values.filter(Boolean))).map((name) => ({
    category_id: name,
    category_name: name,
  }));
}

function liveRow(buildUrl: RuntimeUrlBuilder, row: PersistedLiveCatalogItem): Channel {
  if (row.playbackRef.type !== "m3u-path" || row.playbackRef.kind !== "live") {
    throw new M3UDirectHydrationError();
  }
  const streamUrl = buildUrl(row.playbackRef);
  if (!streamUrl) throw new M3UDirectHydrationError();
  return {
    id: row.id,
    providerId: row.providerId,
    name: row.name,
    streamUrl,
    logoUrl: row.logoUrl,
    category: row.category,
    tvgId: row.tvgId,
    streamType: row.streamType,
    contentType: "live",
    nowPlaying: row.nowPlaying,
    nextPlaying: row.nextPlaying,
  };
}

function movieRow(buildUrl: RuntimeUrlBuilder, row: PersistedVodCatalogItem): M3UMovieItem {
  if (row.playbackRef.type !== "m3u-path" || row.playbackRef.kind !== "movie") {
    throw new M3UDirectHydrationError();
  }
  const streamUrl = buildUrl(row.playbackRef);
  if (!streamUrl) throw new M3UDirectHydrationError();
  return {
    id: String(row.stream_id),
    providerId: row.providerId,
    name: row.name,
    streamUrl,
    logoUrl: row.stream_icon,
    category: String(row.category_id ?? "Movies"),
    contentType: "movie",
  };
}

function runtimeEpisode(
  buildUrl: RuntimeUrlBuilder,
  providerId: string,
  episode: PersistedM3UEpisode,
): M3USeriesEpisode {
  if (episode.playbackRef.type !== "m3u-path" || episode.playbackRef.kind !== "series") {
    throw new M3UDirectHydrationError();
  }
  const streamUrl = buildUrl(episode.playbackRef);
  if (!streamUrl) throw new M3UDirectHydrationError();
  return {
    id: episode.id,
    providerId,
    title: episode.title,
    streamUrl,
    category: episode.category,
    season: episode.season,
    episode: episode.episode,
    logoUrl: episode.logoUrl,
  };
}

function seriesRow(buildUrl: RuntimeUrlBuilder, row: PersistedSeriesCatalogItem): M3USeriesGroup {
  if (!row.m3uEpisodes?.length) throw new M3UDirectHydrationError();
  const seasons: Record<string, M3USeriesEpisode[]> = {};
  for (const episode of row.m3uEpisodes) {
    const runtime = runtimeEpisode(buildUrl, row.providerId, episode);
    const seasonKey = String(runtime.season);
    const values = seasons[seasonKey] ?? (seasons[seasonKey] = []);
    values.push(runtime);
  }
  for (const values of Object.values(seasons)) {
    values.sort((a, b) => a.episode - b.episode);
  }
  return {
    id: String(row.series_id),
    providerId: row.providerId,
    name: row.name,
    category: String(row.category_id ?? "Series"),
    coverUrl: row.cover,
    contentType: "series",
    seasons,
  };
}

async function mapCooperatively<T, R>(
  input: readonly T[],
  mapper: (value: T, index: number) => R,
  batchSize: number,
  yieldFn: () => Promise<void>,
): Promise<R[]> {
  const output: R[] = new Array(input.length);
  for (let start = 0; start < input.length; start += batchSize) {
    const end = Math.min(start + batchSize, input.length);
    for (let index = start; index < end; index += 1) {
      output[index] = mapper(input[index], index);
    }
    if (end < input.length) await yieldFn();
  }
  return output;
}

function buildResult(
  live: Channel[],
  movieItems: M3UMovieItem[],
  seriesGroups: M3USeriesGroup[],
  movies: XtreamVodItem[],
  series: XtreamSeriesItem[],
): M3UDirectHydration {
  const catalog: M3UCatalog = { movieItems, seriesGroups };
  return {
    catalog,
    live,
    movies,
    series,
    counts: {
      live: live.length,
      vod: movieItems.length,
      series: seriesGroups.length,
    },
    vodCategories: categories(movieItems.map((item) => item.category)),
    seriesCategories: categories(seriesGroups.map((item) => item.category)),
  };
}

export function buildM3UDirectHydration(
  provider: M3UDirectHydrationProvider,
  liveRows: PersistedLiveCatalogItem[],
  vodRows: PersistedVodCatalogItem[],
  seriesRows: PersistedSeriesCatalogItem[],
): M3UDirectHydration {
  const buildUrl = runtimeUrlBuilder(provider);
  const live = liveRows.map((row) => liveRow(buildUrl, row));
  const movieItems = vodRows.map((row) => movieRow(buildUrl, row));
  const seriesGroups = seriesRows.map((row) => seriesRow(buildUrl, row));
  const movies: XtreamVodItem[] = movieItems.map((item) => ({
    stream_id: item.id,
    name: item.name,
    stream_icon: item.logoUrl,
    category_id: item.category,
    direct_source: item.streamUrl,
  }));
  const series: XtreamSeriesItem[] = seriesGroups.map((group) => ({
    series_id: group.id,
    name: group.name,
    cover: group.coverUrl,
    category_id: group.category,
  }));
  return buildResult(live, movieItems, seriesGroups, movies, series);
}

export async function buildM3UDirectHydrationCooperatively(
  provider: M3UDirectHydrationProvider,
  liveRows: PersistedLiveCatalogItem[],
  vodRows: PersistedVodCatalogItem[],
  seriesRows: PersistedSeriesCatalogItem[],
  options: M3UDirectHydrationOptions,
): Promise<M3UDirectHydration> {
  const batchSize = Math.max(1, options.batchSize ?? M3U_HYDRATION_BATCH_SIZE);
  const yieldFn = options.yieldFn;
  const buildUrl = runtimeUrlBuilder(provider);

  const live = await mapCooperatively(
    liveRows,
    (row) => liveRow(buildUrl, row),
    batchSize,
    yieldFn,
  );
  const movieItems = await mapCooperatively(
    vodRows,
    (row) => movieRow(buildUrl, row),
    batchSize,
    yieldFn,
  );
  const seriesGroups = await mapCooperatively(
    seriesRows,
    (row) => seriesRow(buildUrl, row),
    batchSize,
    yieldFn,
  );
  const movies = await mapCooperatively<M3UMovieItem, XtreamVodItem>(
    movieItems,
    (item) => ({
      stream_id: item.id,
      name: item.name,
      stream_icon: item.logoUrl,
      category_id: item.category,
      direct_source: item.streamUrl,
    }),
    batchSize,
    yieldFn,
  );
  const series = await mapCooperatively<M3USeriesGroup, XtreamSeriesItem>(
    seriesGroups,
    (group) => ({
      series_id: group.id,
      name: group.name,
      cover: group.coverUrl,
      category_id: group.category,
    }),
    batchSize,
    yieldFn,
  );

  return buildResult(live, movieItems, seriesGroups, movies, series);
}
