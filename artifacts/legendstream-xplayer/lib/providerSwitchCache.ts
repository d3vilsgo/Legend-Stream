import {
  getCatalogCounts,
  getCatalogSyncState,
  getCachedCategories,
  initCatalogCache,
} from "./catalogCache";
import { hasUsableCatalogCache } from "./catalogAvailability";
import {
  getCachedLiveItems,
  getCachedSeriesItems,
  getCachedVodItems,
  getNewCachedLiveItems,
  getNewCachedSeriesItems,
  getNewCachedVodItems,
} from "./catalogRuntime";
import {
  hydrateM3UProviderCache,
  markM3UCacheActivation,
} from "./m3uCatalogCache";
import { beginM3UProviderSwitchMeasurement } from "./m3uSwitchMetrics";
import { primeProviderSwitchSnapshot } from "./providerSwitchUx";
import type { Channel } from "./iptv";
import type { XtreamCategory, XtreamSeriesItem, XtreamVodItem } from "./xtreamCatalog";

const HOME_SAMPLE_LIMIT = 48;
const NEW_SAMPLE_LIMIT = 24;

export type ProviderSwitchCacheProvider = {
  id: string;
  type: string;
  url?: string;
  playlistUrl?: string;
  username?: string;
  password?: string;
};

export type ProviderSwitchCatalogSnapshot = {
  providerId: string;
  scope: "preview" | "full";
  ready: boolean;
  counts: { live: number; vod: number; series: number };
  live: Channel[];
  movies: XtreamVodItem[];
  series: XtreamSeriesItem[];
  newChannels: Channel[];
  newMovies: XtreamVodItem[];
  newSeries: XtreamSeriesItem[];
};

export type ProviderSwitchCachePreparation = {
  snapshot: ProviderSwitchCatalogSnapshot;
  live: Channel[];
  vodCategories: XtreamCategory[];
  seriesCategories: XtreamCategory[];
};

export async function prepareProviderSwitchCache(
  provider: ProviderSwitchCacheProvider,
): Promise<ProviderSwitchCachePreparation | null> {
  if (provider.type === "m3u") {
    beginM3UProviderSwitchMeasurement(provider.id);
    const cached = await hydrateM3UProviderCache(provider as any, {
      initialLimit: HOME_SAMPLE_LIMIT
    });
    if (!cached) return null;
    const snapshot: ProviderSwitchCatalogSnapshot = {
      providerId: provider.id,
      scope: cached.scope,
      ready: cached.ready,
      counts: cached.counts,
      live: cached.live,
      movies: cached.movies.slice(0, HOME_SAMPLE_LIMIT),
      series: cached.series.slice(0, HOME_SAMPLE_LIMIT),
      newChannels: cached.newChannels,
      newMovies: cached.newMovies,
      newSeries: cached.newSeries,
    };
    primeProviderSwitchSnapshot(provider.id, snapshot);
    markM3UCacheActivation(provider.id);
    return {
      snapshot,
      live: cached.live,
      vodCategories: cached.vodCategories,
      seriesCategories: cached.seriesCategories,
    };
  }
  if (provider.type !== "xtream") return null;

  await initCatalogCache();
  const [counts, state] = await Promise.all([
    getCatalogCounts(provider.id),
    getCatalogSyncState(provider.id),
  ]);
  if (!hasUsableCatalogCache(counts)) return null;

  const [
    live,
    movies,
    series,
    newChannels,
    newMovies,
    newSeries,
    vodCategories,
    seriesCategories,
  ] = await Promise.all([
    getCachedLiveItems(provider),
    getCachedVodItems(provider, undefined, HOME_SAMPLE_LIMIT),
    getCachedSeriesItems(provider, undefined, HOME_SAMPLE_LIMIT),
    getNewCachedLiveItems(provider, NEW_SAMPLE_LIMIT),
    getNewCachedVodItems(provider, NEW_SAMPLE_LIMIT),
    getNewCachedSeriesItems(provider, NEW_SAMPLE_LIMIT),
    getCachedCategories(provider.id, "vod"),
    getCachedCategories(provider.id, "series"),
  ]);

  const snapshot: ProviderSwitchCatalogSnapshot = {
    providerId: provider.id,
    scope: "full",
    ready: state?.phase === "ready",
    counts,
    live: live.slice(0, HOME_SAMPLE_LIMIT),
    movies,
    series,
    newChannels,
    newMovies,
    newSeries,
  };

  primeProviderSwitchSnapshot(provider.id, snapshot);
  return { snapshot, live, vodCategories, seriesCategories };
}
