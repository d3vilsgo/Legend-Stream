import type {
  Channel,
  Provider,
  ProviderLoadResult,
} from "./iptv";
import type { PersistedM3UEpisode } from "./catalogPersistence";
import { parseM3UProviderSource } from "./m3uCatalogRefs";
import { inspectM3UStreamRef } from "./m3uStreamRefDiagnostics";
import {
  emptyM3URefRejectionCounts,
  type M3UCacheCounts,
  type M3UCacheWriteOutcome,
  type M3URefRejectionCounts,
} from "./m3uCacheWriteMeasurement";
import type { M3UPathPlaybackRef } from "./m3uCatalogRefs";

export type M3UCacheWriteProvider = Pick<
  Provider,
  "id" | "type" | "url" | "username" | "password" | "createdAt"
> & { playlistUrl?: string };

export type SafeM3UMovieRow = {
  stream_id: string;
  name: string;
  stream_icon?: string;
  category_id: string;
  container_extension: string;
  playbackRef: M3UPathPlaybackRef;
};

export type SafeM3USeriesRow = {
  series_id: string;
  name: string;
  cover?: string;
  category_id: string;
  m3uEpisodes: PersistedM3UEpisode[];
};

export type M3UCacheWriteProjection = {
  inputCounts: M3UCacheCounts;
  safeCounts: M3UCacheCounts;
  rejectionCounts: M3URefRejectionCounts;
  unsafeOutcome: Exclude<M3UCacheWriteOutcome, "success" | "unsupported-source" | "projection-drop" | "sqlite-error"> | null;
  liveRows: Array<Channel & { playbackRef: M3UPathPlaybackRef }>;
  movieRows: SafeM3UMovieRow[];
  seriesRows: SafeM3USeriesRow[];
};

function providerSource(provider: M3UCacheWriteProvider) {
  return provider.url || provider.playlistUrl || "";
}

export function buildM3UCacheWriteProjection(
  provider: M3UCacheWriteProvider,
  loaded: ProviderLoadResult,
): M3UCacheWriteProjection | null {
  const source = providerSource(provider);
  const parsedProvider = parseM3UProviderSource(source);
  if (!parsedProvider) return null;

  const liveInput = loaded.liveChannels ?? loaded.channels;
  const movieInput = loaded.movieItems ?? [];
  const seriesInput = loaded.seriesGroups ?? [];
  const rejectionCounts = emptyM3URefRejectionCounts();

  const liveRows: Array<Channel & { playbackRef: M3UPathPlaybackRef }> = [];
  for (const channel of liveInput) {
    const inspection = inspectM3UStreamRef(parsedProvider, channel.streamUrl, "live");
    if (!inspection.ref) {
      rejectionCounts[inspection.reason] += 1;
      continue;
    }
    liveRows.push({ ...channel, playbackRef: inspection.ref });
  }

  const movieRows: SafeM3UMovieRow[] = [];
  for (const item of movieInput) {
    const inspection = inspectM3UStreamRef(parsedProvider, item.streamUrl, "movie");
    if (!inspection.ref) {
      rejectionCounts[inspection.reason] += 1;
      continue;
    }
    movieRows.push({
      stream_id: item.id,
      name: item.name,
      stream_icon: item.logoUrl,
      category_id: item.category,
      container_extension: inspection.ref.containerExtension,
      playbackRef: inspection.ref,
    });
  }

  const seriesRows: SafeM3USeriesRow[] = [];
  for (const group of seriesInput) {
    const allEpisodes = Object.values(group.seasons).flat();
    const episodes: PersistedM3UEpisode[] = [];
    let unsafe = false;
    for (const episode of allEpisodes) {
      const inspection = inspectM3UStreamRef(parsedProvider, episode.streamUrl, "series");
      if (!inspection.ref) {
        rejectionCounts[inspection.reason] += 1;
        unsafe = true;
        continue;
      }
      episodes.push({
        id: episode.id,
        title: episode.title,
        category: episode.category,
        season: episode.season,
        episode: episode.episode,
        logoUrl: episode.logoUrl,
        playbackRef: inspection.ref,
      });
    }
    if (unsafe) continue;
    seriesRows.push({
      series_id: group.id,
      name: group.name,
      cover: group.coverUrl,
      category_id: group.category,
      m3uEpisodes: episodes,
    });
  }

  const inputCounts = {
    live: liveInput.length,
    vod: movieInput.length,
    series: seriesInput.length,
  };
  const safeCounts = {
    live: liveRows.length,
    vod: movieRows.length,
    series: seriesRows.length,
  };
  const unsafeOutcome = safeCounts.live !== inputCounts.live
    ? "unsafe-live-ref"
    : safeCounts.vod !== inputCounts.vod
      ? "unsafe-vod-ref"
      : safeCounts.series !== inputCounts.series
        ? "unsafe-series-ref"
        : null;

  return {
    inputCounts,
    safeCounts,
    rejectionCounts,
    unsafeOutcome,
    liveRows,
    movieRows,
    seriesRows,
  };
}
