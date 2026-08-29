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
