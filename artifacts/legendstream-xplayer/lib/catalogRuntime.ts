import type { Channel } from "./iptv";
import { normalizeXtreamBaseUrl } from "./iptv";
import { buildM3UStreamUrl } from "./m3uCatalogRefs";
import {
  getVodInfo,
  type XtreamSeriesItem,
  type XtreamVodItem,
} from "./xtreamCatalog";
import {
  getCachedPersistedItems,
  getNewCachedPersistedItems,
} from "./catalogCache";
import {
  makeDirectVodRuntimeSource,
  parseCatalogRuntimeSource,
  type PersistedLiveCatalogItem,
  type PersistedSeriesCatalogItem,
  type PersistedVodCatalogItem,
} from "./catalogPersistence";

export type CatalogRuntimeProvider = {
  id: string;
  type: string;
  url?: string;
  playlistUrl?: string;
  username?: string;
  password?: string;
};

export type CatalogPageRuntimeItem = Channel | XtreamVodItem | XtreamSeriesItem;

function normalizeCatalogRuntimeBaseUrl(value: string) {
  const normalized = normalizeXtreamBaseUrl(value);
  try {
    const url = new URL(normalized);
    const path = url.pathname.replace(/\/+$/, "");
    if (/\/get\.php$/i.test(path)) {
      url.pathname = path.slice(0, path.lastIndexOf("/")) || "/";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    // normalizeXtreamBaseUrl already validates the value.
  }
  return normalized;
}

function requireXtreamCredentials(provider: CatalogRuntimeProvider) {
  if (provider.type !== "xtream" || !provider.username || !provider.password) {
    throw new Error("Cached playback credentials are unavailable.");
  }
  const source = provider.url || provider.playlistUrl || "";
  return {
    baseUrl: normalizeCatalogRuntimeBaseUrl(source),
    username: provider.username,
    password: provider.password,
  };
}

function providerSource(provider: CatalogRuntimeProvider) {
  return provider.url || provider.playlistUrl || "";
}

export function liveRuntimeItem(
  persisted: PersistedLiveCatalogItem,
  provider: CatalogRuntimeProvider,
): Channel {
  let streamUrl = "";
  if (persisted.playbackRef.type === "xtream-live") {
    try {
      const credentials = requireXtreamCredentials(provider);
      if (provider.id === persisted.providerId) {
        streamUrl = `${credentials.baseUrl}/live/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${encodeURIComponent(persisted.playbackRef.streamId)}.${persisted.playbackRef.containerExtension}`;
      }
    } catch {
      streamUrl = "";
    }
  } else if (persisted.playbackRef.type === "m3u-path" && provider.type === "m3u") {
    streamUrl = buildM3UStreamUrl(providerSource(provider), persisted.playbackRef) ?? "";
  }
  return {
    id: persisted.id,
    providerId: persisted.providerId,
    name: persisted.name,
    streamUrl,
    logoUrl: persisted.logoUrl,
    category: persisted.category,
    tvgId: persisted.tvgId,
    streamType: persisted.streamType,
    contentType: "live",
    nowPlaying: persisted.nowPlaying,
    nextPlaying: persisted.nextPlaying,
  };
}

export function vodRuntimeItem(
  persisted: PersistedVodCatalogItem,
  provider: CatalogRuntimeProvider,
): XtreamVodItem {
  let directSource: string | undefined;
  if (persisted.playbackRef.type === "m3u-path" && provider.type === "m3u") {
    directSource = buildM3UStreamUrl(providerSource(provider), persisted.playbackRef) ?? undefined;
  } else if (
    persisted.playbackRef.type === "xtream-vod" &&
    persisted.playbackRef.sourceMode === "direct"
  ) {
    directSource = makeDirectVodRuntimeSource(persisted);
  }
  return {
    stream_id: persisted.stream_id,
    name: persisted.name,
    stream_icon: persisted.stream_icon,
    rating: persisted.rating,
    rating_5based: persisted.rating_5based,
    added: persisted.added,
    category_id: persisted.category_id,
    container_extension: persisted.container_extension,
    direct_source: directSource,
    plot: persisted.plot,
    cast: persisted.cast,
    director: persisted.director,
    genre: persisted.genre,
    releaseDate: persisted.releaseDate,
    release_date: persisted.release_date,
    youtube_trailer: persisted.youtube_trailer,
  };
}

export function seriesRuntimeItem(persisted: PersistedSeriesCatalogItem): XtreamSeriesItem {
  return {
    series_id: persisted.series_id,
    name: persisted.name,
    cover: persisted.cover,
    plot: persisted.plot,
    cast: persisted.cast,
    director: persisted.director,
    genre: persisted.genre,
    releaseDate: persisted.releaseDate,
    release_date: persisted.release_date,
    rating: persisted.rating,
    category_id: persisted.category_id,
    backdrop_path: persisted.backdrop_path,
  };
}

export async function getCachedLiveItems(
  provider: CatalogRuntimeProvider,
  categoryId?: string,
  limit?: number,
): Promise<Channel[]> {
  const rows = await getCachedPersistedItems(provider.id, "live", categoryId, limit);
  return rows
    .filter((row): row is PersistedLiveCatalogItem => row.catalogKind === "live")
    .map((row) => liveRuntimeItem(row, provider));
}

export async function getCachedVodItems(
  provider: CatalogRuntimeProvider,
  categoryId?: string,
  limit?: number,
): Promise<XtreamVodItem[]> {
  const rows = await getCachedPersistedItems(provider.id, "vod", categoryId, limit);
  return rows
    .filter((row): row is PersistedVodCatalogItem => row.catalogKind === "vod")
    .map((row) => vodRuntimeItem(row, provider));
}

export async function getCachedSeriesItems(
  provider: CatalogRuntimeProvider,
  categoryId?: string,
  limit?: number,
): Promise<XtreamSeriesItem[]> {
  const rows = await getCachedPersistedItems(provider.id, "series", categoryId, limit);
  return rows
    .filter((row): row is PersistedSeriesCatalogItem => row.catalogKind === "series")
    .map(seriesRuntimeItem);
}

export async function getNewCachedLiveItems(provider: CatalogRuntimeProvider, limit = 24) {
  const rows = await getNewCachedPersistedItems(provider.id, "live", limit);
  return rows
    .filter((row): row is PersistedLiveCatalogItem => row.catalogKind === "live")
    .map((row) => liveRuntimeItem(row, provider));
}

export async function getNewCachedVodItems(provider: CatalogRuntimeProvider, limit = 24) {
  const rows = await getNewCachedPersistedItems(provider.id, "vod", limit);
  return rows
    .filter((row): row is PersistedVodCatalogItem => row.catalogKind === "vod")
    .map((row) => vodRuntimeItem(row, provider));
}

export async function getNewCachedSeriesItems(provider: CatalogRuntimeProvider, limit = 24) {
  const rows = await getNewCachedPersistedItems(provider.id, "series", limit);
  return rows
    .filter((row): row is PersistedSeriesCatalogItem => row.catalogKind === "series")
    .map(seriesRuntimeItem);
}

export async function resolveCatalogRuntimeSource(
  source: string,
  provider: CatalogRuntimeProvider | null | undefined,
): Promise<string> {
  const ref = parseCatalogRuntimeSource(source);
  if (!ref) return source;
  if (!provider || provider.id !== ref.providerId) {
    throw new Error("Cached playback provider is unavailable.");
  }
  const credentials = requireXtreamCredentials(provider);
  if (ref.kind === "vod-direct") {
    const info = await getVodInfo(credentials, ref.streamId);
    const directSource = info.movie_data?.direct_source?.trim();
    if (!directSource || parseCatalogRuntimeSource(directSource)) {
      throw new Error("The cached direct playback address could not be refreshed.");
    }
    return directSource;
  }
  return source;
}
