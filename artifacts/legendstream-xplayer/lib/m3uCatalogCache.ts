import {
  deleteProviderCatalog,
  getCachedPersistedItems,
  getCatalogSyncState,
  initCatalogCache,
  pruneCatalogKind,
  replaceCatalogCategories,
  setCatalogSyncState,
  upsertCatalogItems,
} from "./catalogCache";
import {
  getM3UCatalog,
  parseM3U,
  type Channel,
  type M3UCatalog,
  type Provider,
  type ProviderLoadResult,
} from "./iptv";
import {
  buildM3UStreamUrl,
  parseM3UProviderSource,
  parseM3UStreamRef,
  type M3UPathPlaybackRef,
} from "./m3uCatalogRefs";
import {
  projectCatalogItems,
  type PersistedLiveCatalogItem,
  type PersistedM3UEpisode,
  type PersistedSeriesCatalogItem,
  type PersistedVodCatalogItem,
} from "./catalogPersistence";
import type { XtreamCategory, XtreamSeriesItem, XtreamVodItem } from "./xtreamCatalog";

const M3U_CACHE_STAGE_TOTAL = 3;
const activationProviders = new Set<string>();

export type M3UCatalogCacheProvider = Pick<
  Provider,
  "id" | "type" | "url" | "username" | "password" | "createdAt"
> & { playlistUrl?: string };

export type M3UCatalogCacheHydration = {
  counts: { live: number; vod: number; series: number };
  ready: boolean;
  live: Channel[];
  movies: XtreamVodItem[];
  series: XtreamSeriesItem[];
  newChannels: Channel[];
  newMovies: XtreamVodItem[];
  newSeries: XtreamSeriesItem[];
  vodCategories: XtreamCategory[];
  seriesCategories: XtreamCategory[];
};

function providerSource(provider: M3UCatalogCacheProvider) {
  return provider.url || provider.playlistUrl || "";
}

function categories(values: string[]): XtreamCategory[] {
  return Array.from(new Set(values.filter(Boolean))).map((name) => ({
    category_id: name,
    category_name: name,
  }));
}

function xmlAttribute(value: string | undefined) {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/[\r\n]+/g, " ");
}

function label(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim() || "Untitled";
}

function refUrl(provider: M3UCatalogCacheProvider, ref: M3UPathPlaybackRef) {
  return buildM3UStreamUrl(providerSource(provider), ref);
}

function originalSeriesIndex(value: string | number) {
  const match = String(value).match(/:(\d+):/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function isM3ULive(row: PersistedLiveCatalogItem) {
  return row.playbackRef.type === "m3u-path" && row.playbackRef.kind === "live";
}

function isM3UVod(row: PersistedVodCatalogItem) {
  return row.playbackRef.type === "m3u-path" && row.playbackRef.kind === "movie";
}

function safeSeriesEpisodes(row: PersistedSeriesCatalogItem) {
  return (row.m3uEpisodes ?? []).filter(
    (episode) => episode.playbackRef.type === "m3u-path" && episode.playbackRef.kind === "series",
  );
}

function runtimeLive(provider: M3UCatalogCacheProvider, row: PersistedLiveCatalogItem): Channel | null {
  if (!isM3ULive(row)) return null;
  const streamUrl = refUrl(provider, row.playbackRef as M3UPathPlaybackRef);
  if (!streamUrl) return null;
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

function syntheticCatalog(
  provider: M3UCatalogCacheProvider,
  liveRows: PersistedLiveCatalogItem[],
  vodRows: PersistedVodCatalogItem[],
  seriesRows: PersistedSeriesCatalogItem[],
) {
  const lines = ["#EXTM3U"];
  const push = (name: string, category: string, logo: string | undefined, url: string) => {
    lines.push(
      `#EXTINF:-1 tvg-name="${xmlAttribute(name)}" tvg-logo="${xmlAttribute(logo)}" group-title="${xmlAttribute(category)}",${label(name)}`,
      url,
    );
  };

  for (const row of liveRows) {
    if (!isM3ULive(row)) continue;
    const url = refUrl(provider, row.playbackRef as M3UPathPlaybackRef);
    if (url) push(row.name, row.category, row.logoUrl, url);
  }
  for (const row of vodRows) {
    if (!isM3UVod(row)) continue;
    const url = refUrl(provider, row.playbackRef as M3UPathPlaybackRef);
    if (url) push(row.name, String(row.category_id ?? "Movies"), row.stream_icon, url);
  }
  for (const row of [...seriesRows].sort((a, b) => originalSeriesIndex(a.series_id) - originalSeriesIndex(b.series_id))) {
    for (const episode of safeSeriesEpisodes(row).sort(
      (a, b) => a.season - b.season || a.episode - b.episode,
    )) {
      const url = refUrl(provider, episode.playbackRef);
      if (url) push(episode.title, episode.category, episode.logoUrl ?? row.cover, url);
    }
  }
  return lines.join("\n");
}

function localCatalogRows(catalog: M3UCatalog) {
  const movies: XtreamVodItem[] = catalog.movieItems.map((item) => ({
    stream_id: item.id,
    name: item.name,
    stream_icon: item.logoUrl,
    category_id: item.category,
    direct_source: item.streamUrl,
  }));
  const series: XtreamSeriesItem[] = catalog.seriesGroups.map((group) => ({
    series_id: group.id,
    name: group.name,
    cover: group.coverUrl,
    category_id: group.category,
  }));
  return { movies, series };
}

export function markM3UCacheActivation(providerId: string) {
  activationProviders.add(providerId);
}

export function consumeM3UCacheActivation(providerId: string) {
  if (!activationProviders.has(providerId)) return false;
  activationProviders.delete(providerId);
  return true;
}

export async function hydrateM3UProviderCache(
  provider: M3UCatalogCacheProvider,
): Promise<M3UCatalogCacheHydration | null> {
  if (provider.type !== "m3u" || !parseM3UProviderSource(providerSource(provider))) return null;
  await initCatalogCache();
  const [rawLive, rawVod, rawSeries, state] = await Promise.all([
    getCachedPersistedItems(provider.id, "live"),
    getCachedPersistedItems(provider.id, "vod"),
    getCachedPersistedItems(provider.id, "series"),
    getCatalogSyncState(provider.id),
  ]);

  const liveRows = rawLive.filter(
    (row): row is PersistedLiveCatalogItem => row.catalogKind === "live" && isM3ULive(row),
  );
  const vodRows = rawVod.filter(
    (row): row is PersistedVodCatalogItem => row.catalogKind === "vod" && isM3UVod(row),
  );
  const seriesRows = rawSeries.filter(
    (row): row is PersistedSeriesCatalogItem =>
      row.catalogKind === "series" && safeSeriesEpisodes(row).length > 0,
  );
  const live = liveRows.map((row) => runtimeLive(provider, row)).filter((row): row is Channel => Boolean(row));

  const source = syntheticCatalog(provider, liveRows, vodRows, seriesRows);
  let catalog: M3UCatalog;
  try {
    parseM3U(source, provider.id);
    catalog = getM3UCatalog(provider.id);
  } catch {
    return null;
  }
  const local = localCatalogRows(catalog);
  const counts = {
    live: live.length,
    vod: catalog.movieItems.length,
    series: catalog.seriesGroups.length,
  };
  if (counts.live === 0 && counts.vod === 0 && counts.series === 0) return null;

  return {
    counts,
    ready: state?.phase === "ready",
    live,
    movies: local.movies,
    series: local.series,
    newChannels: live.slice(0, 24),
    newMovies: local.movies.slice(0, 24),
    newSeries: local.series.slice(0, 24),
    vodCategories: categories(catalog.movieItems.map((item) => item.category)),
    seriesCategories: categories(catalog.seriesGroups.map((item) => item.category)),
  };
}

function safeLiveRows(provider: M3UCatalogCacheProvider, loaded: ProviderLoadResult) {
  const source = providerSource(provider);
  const input = loaded.liveChannels ?? loaded.channels;
  return input.map((channel) => {
    const playbackRef = parseM3UStreamRef(source, channel.streamUrl, "live");
    return playbackRef ? { ...channel, playbackRef } : null;
  }).filter((row): row is Channel & { playbackRef: M3UPathPlaybackRef } => Boolean(row));
}

function safeMovieRows(provider: M3UCatalogCacheProvider, loaded: ProviderLoadResult) {
  const source = providerSource(provider);
  return (loaded.movieItems ?? []).map((item) => {
    const playbackRef = parseM3UStreamRef(source, item.streamUrl, "movie");
    if (!playbackRef) return null;
    return {
      stream_id: item.id,
      name: item.name,
      stream_icon: item.logoUrl,
      category_id: item.category,
      container_extension: playbackRef.containerExtension,
      playbackRef,
    };
  }).filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function safeSeriesRows(provider: M3UCatalogCacheProvider, loaded: ProviderLoadResult) {
  const source = providerSource(provider);
  return (loaded.seriesGroups ?? []).map((group) => {
    const allEpisodes = Object.values(group.seasons).flat();
    const episodes: PersistedM3UEpisode[] = [];
    for (const episode of allEpisodes) {
      const playbackRef = parseM3UStreamRef(source, episode.streamUrl, "series");
      if (!playbackRef) return null;
      episodes.push({
        id: episode.id,
        title: episode.title,
        category: episode.category,
        season: episode.season,
        episode: episode.episode,
        logoUrl: episode.logoUrl,
        playbackRef,
      });
    }
    return {
      series_id: group.id,
      name: group.name,
      cover: group.coverUrl,
      category_id: group.category,
      m3uEpisodes: episodes,
    };
  }).filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export async function persistM3UProviderCache(
  provider: M3UCatalogCacheProvider,
  loaded: ProviderLoadResult,
): Promise<boolean> {
  if (provider.type !== "m3u" || !parseM3UProviderSource(providerSource(provider))) return false;
  const liveInput = loaded.liveChannels ?? loaded.channels;
  const movieInput = loaded.movieItems ?? [];
  const seriesInput = loaded.seriesGroups ?? [];
  const liveRows = safeLiveRows(provider, loaded);
  const movieRows = safeMovieRows(provider, loaded);
  const seriesRows = safeSeriesRows(provider, loaded);

  // Fail closed: a partial credential-free projection must never suppress the next
  // blocking playlist load because it would present an incomplete provider as complete.
  if (
    liveRows.length !== liveInput.length ||
    movieRows.length !== movieInput.length ||
    seriesRows.length !== seriesInput.length
  ) {
    await deleteProviderCatalog(provider.id);
    return false;
  }

  const persistedLive = projectCatalogItems(provider.id, "live", liveRows as any);
  const persistedVod = projectCatalogItems(provider.id, "vod", movieRows as any);
  const persistedSeries = projectCatalogItems(provider.id, "series", seriesRows as any);
  if (
    persistedLive.length !== liveRows.length ||
    persistedVod.length !== movieRows.length ||
    persistedSeries.length !== seriesRows.length
  ) {
    await deleteProviderCatalog(provider.id);
    return false;
  }

  await initCatalogCache();
  const seenAt = Date.now();
  await setCatalogSyncState(provider.id, "syncing", 0, M3U_CACHE_STAGE_TOTAL, "M3U cache update started");
  await upsertCatalogItems(provider.id, "live", persistedLive, { seenAt, markNew: true });
  await upsertCatalogItems(provider.id, "vod", persistedVod, { seenAt, markNew: true });
  await upsertCatalogItems(provider.id, "series", persistedSeries, { seenAt, markNew: true });
  await Promise.all([
    replaceCatalogCategories(provider.id, "vod", categories(movieInput.map((item) => item.category))),
    replaceCatalogCategories(provider.id, "series", categories(seriesInput.map((item) => item.category))),
  ]);
  await Promise.all([
    pruneCatalogKind(provider.id, "live", seenAt),
    pruneCatalogKind(provider.id, "vod", seenAt),
    pruneCatalogKind(provider.id, "series", seenAt),
  ]);
  await setCatalogSyncState(
    provider.id,
    "ready",
    M3U_CACHE_STAGE_TOTAL,
    M3U_CACHE_STAGE_TOTAL,
    "M3U cache ready",
    "background",
  );
  return true;
}
