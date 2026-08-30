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
  installM3UCatalog,
  type Channel,
  type Provider,
  type ProviderLoadResult,
} from "./iptv";
import {
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
import { buildM3UDirectHydration } from "./m3uCatalogHydration";
import {
  noteM3UCacheHydration,
  noteM3UNetworkCatalogCounts,
} from "./m3uSwitchMetrics";
import type { XtreamCategory } from "./xtreamCatalog";

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
  movies: ReturnType<typeof buildM3UDirectHydration>["movies"];
  series: ReturnType<typeof buildM3UDirectHydration>["series"];
  newChannels: Channel[];
  newMovies: ReturnType<typeof buildM3UDirectHydration>["movies"];
  newSeries: ReturnType<typeof buildM3UDirectHydration>["series"];
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
  if (provider.type !== "m3u" || !parseM3UProviderSource(providerSource(provider))) {
    noteM3UCacheHydration({
      outcome: "null",
      reason: "unsupported-source",
      sqliteReadMs: 0,
      runtimeHydrateMs: 0,
      itemCounts: { live: 0, vod: 0, series: 0 },
    });
    return null;
  }

  let phase: "sqlite" | "runtime" = "sqlite";
  let sqliteReadMs = 0;
  let runtimeStartedAt = 0;
  try {
    const sqliteStartedAt = Date.now();
    await initCatalogCache();
    const [rawLive, rawVod, rawSeries, state] = await Promise.all([
      getCachedPersistedItems(provider.id, "live"),
      getCachedPersistedItems(provider.id, "vod"),
      getCachedPersistedItems(provider.id, "series"),
      getCatalogSyncState(provider.id),
    ]);
    sqliteReadMs = Date.now() - sqliteStartedAt;

    const liveRows = rawLive.filter(
      (row): row is PersistedLiveCatalogItem => row.catalogKind === "live",
    );
    const vodRows = rawVod.filter(
      (row): row is PersistedVodCatalogItem => row.catalogKind === "vod",
    );
    const seriesRows = rawSeries.filter(
      (row): row is PersistedSeriesCatalogItem => row.catalogKind === "series",
    );

    phase = "runtime";
    runtimeStartedAt = Date.now();
    const direct = buildM3UDirectHydration(provider, liveRows, vodRows, seriesRows);
    const runtimeHydrateMs = Date.now() - runtimeStartedAt;
    if (direct.counts.live === 0 && direct.counts.vod === 0 && direct.counts.series === 0) {
      noteM3UCacheHydration({
        outcome: "null",
        reason: "empty-cache",
        sqliteReadMs,
        runtimeHydrateMs,
        itemCounts: direct.counts,
      });
      return null;
    }

    installM3UCatalog(provider.id, direct.catalog);
    noteM3UCacheHydration({
      outcome: "hit",
      reason: "none",
      sqliteReadMs,
      runtimeHydrateMs,
      itemCounts: direct.counts,
    });
    return {
      counts: direct.counts,
      ready: state?.phase === "ready",
      live: direct.live,
      movies: direct.movies,
      series: direct.series,
      newChannels: direct.live.slice(0, 24),
      newMovies: direct.movies.slice(0, 24),
      newSeries: direct.series.slice(0, 24),
      vodCategories: direct.vodCategories,
      seriesCategories: direct.seriesCategories,
    };
  } catch (caught) {
    noteM3UCacheHydration({
      outcome: "error",
      reason: phase === "sqlite" ? "sqlite-read-error" : "runtime-hydrate-error",
      sqliteReadMs,
      runtimeHydrateMs: runtimeStartedAt ? Date.now() - runtimeStartedAt : 0,
      itemCounts: { live: 0, vod: 0, series: 0 },
    });
    throw caught;
  }
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
  if (provider.type !== "m3u") return false;
  const liveInput = loaded.liveChannels ?? loaded.channels;
  const movieInput = loaded.movieItems ?? [];
  const seriesInput = loaded.seriesGroups ?? [];
  noteM3UNetworkCatalogCounts({
    live: liveInput.length,
    vod: movieInput.length,
    series: seriesInput.length,
  });
  if (!parseM3UProviderSource(providerSource(provider))) return false;

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
