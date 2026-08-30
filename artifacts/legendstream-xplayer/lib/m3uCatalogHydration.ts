import type {
  Channel,
  M3UCatalog,
  M3UMovieItem,
  M3USeriesEpisode,
  M3USeriesGroup,
} from "./iptv";
import { buildM3UStreamUrl, type M3UPathPlaybackRef } from "./m3uCatalogRefs";
import type {
  PersistedLiveCatalogItem,
  PersistedM3UEpisode,
  PersistedSeriesCatalogItem,
  PersistedVodCatalogItem,
} from "./catalogPersistence";
import type { XtreamCategory, XtreamSeriesItem, XtreamVodItem } from "./xtreamCatalog";

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

export class M3UDirectHydrationError extends Error {
  constructor() {
    super("Cached M3U runtime references could not be reconstructed.");
    this.name = "M3UDirectHydrationError";
  }
}

function providerSource(provider: M3UDirectHydrationProvider) {
  return provider.url || provider.playlistUrl || "";
}

function categories(values: string[]): XtreamCategory[] {
  return Array.from(new Set(values.filter(Boolean))).map((name) => ({
    category_id: name,
    category_name: name,
  }));
}

function runtimeUrl(provider: M3UDirectHydrationProvider, ref: M3UPathPlaybackRef) {
  return buildM3UStreamUrl(providerSource(provider), ref);
}

function liveRow(provider: M3UDirectHydrationProvider, row: PersistedLiveCatalogItem): Channel {
  if (row.playbackRef.type !== "m3u-path" || row.playbackRef.kind !== "live") {
    throw new M3UDirectHydrationError();
  }
  const streamUrl = runtimeUrl(provider, row.playbackRef);
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

function movieRow(provider: M3UDirectHydrationProvider, row: PersistedVodCatalogItem): M3UMovieItem {
  if (row.playbackRef.type !== "m3u-path" || row.playbackRef.kind !== "movie") {
    throw new M3UDirectHydrationError();
  }
  const streamUrl = runtimeUrl(provider, row.playbackRef);
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
  provider: M3UDirectHydrationProvider,
  providerId: string,
  episode: PersistedM3UEpisode,
): M3USeriesEpisode {
  if (episode.playbackRef.type !== "m3u-path" || episode.playbackRef.kind !== "series") {
    throw new M3UDirectHydrationError();
  }
  const streamUrl = runtimeUrl(provider, episode.playbackRef);
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

function seriesRow(
  provider: M3UDirectHydrationProvider,
  row: PersistedSeriesCatalogItem,
): M3USeriesGroup {
  if (!row.m3uEpisodes?.length) throw new M3UDirectHydrationError();
  const seasons: Record<string, M3USeriesEpisode[]> = {};
  for (const episode of row.m3uEpisodes) {
    const runtime = runtimeEpisode(provider, row.providerId, episode);
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

export function buildM3UDirectHydration(
  provider: M3UDirectHydrationProvider,
  liveRows: PersistedLiveCatalogItem[],
  vodRows: PersistedVodCatalogItem[],
  seriesRows: PersistedSeriesCatalogItem[],
): M3UDirectHydration {
  const live = liveRows.map((row) => liveRow(provider, row));
  const movieItems = vodRows.map((row) => movieRow(provider, row));
  const seriesGroups = seriesRows.map((row) => seriesRow(provider, row));
  const catalog: M3UCatalog = { movieItems, seriesGroups };
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
