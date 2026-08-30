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
  emptyM3UValidationScan,
  type M3UCacheCounts,
  type M3UCacheValidationScan,
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
  scan: M3UCacheValidationScan;
  unsafeOutcome: Exclude<M3UCacheWriteOutcome, "success" | "unsupported-source" | "projection-drop" | "sqlite-error"> | null;
  liveRows: Array<Channel & { playbackRef: M3UPathPlaybackRef }>;
  movieRows: SafeM3UMovieRow[];
  seriesRows: SafeM3USeriesRow[];
};

function providerSource(provider: M3UCacheWriteProvider) {
  return provider.url || provider.playlistUrl || "";
}

function seriesEpisodeCount(loaded: ProviderLoadResult) {
  return (loaded.seriesGroups ?? []).reduce(
    (total, group) => total + Object.values(group.seasons).reduce(
      (groupTotal, episodes) => groupTotal + episodes.length,
      0,
    ),
    0,
  );
}

export function m3uCacheCandidateCount(loaded: ProviderLoadResult) {
  const diagnosticTotal = loaded.m3uDiagnostics?.originCompare.total;
  if (typeof diagnosticTotal === "number" && Number.isFinite(diagnosticTotal)) {
    return Math.max(0, Math.trunc(diagnosticTotal));
  }
  return (
    (loaded.liveChannels ?? loaded.channels).length +
    (loaded.movieItems ?? []).length +
    seriesEpisodeCount(loaded)
  );
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
  const scan = emptyM3UValidationScan(m3uCacheCandidateCount(loaded));
  const liveRows: Array<Channel & { playbackRef: M3UPathPlaybackRef }> = [];
  const movieRows: SafeM3UMovieRow[] = [];
  const seriesRows: SafeM3USeriesRow[] = [];

  const inputCounts = {
    live: liveInput.length,
    vod: movieInput.length,
    series: seriesInput.length,
  };

  const projection = (
    unsafeOutcome: M3UCacheWriteProjection["unsafeOutcome"],
  ): M3UCacheWriteProjection => ({
    inputCounts,
    safeCounts: {
      live: liveRows.length,
      vod: movieRows.length,
      series: seriesRows.length,
    },
    rejectionCounts,
    scan,
    unsafeOutcome,
    liveRows,
    movieRows,
    seriesRows,
  });

  const reject = (
    kind: Exclude<M3UCacheValidationScan["firstRejectKind"], "none">,
    reason: Exclude<M3UCacheValidationScan["firstRejectReason"], "none">,
  ) => {
    rejectionCounts[reason] += 1;
    scan.firstRejectKind = kind;
    scan.firstRejectReason = reason;
    scan.scanTruncated = scan.scanInspectedCount < scan.scanTotalCandidateCount;
    return projection(
      kind === "live"
        ? "unsafe-live-ref"
        : kind === "vod"
          ? "unsafe-vod-ref"
          : "unsafe-series-ref",
    );
  };

  for (const channel of liveInput) {
    scan.scanInspectedCount += 1;
    const inspection = inspectM3UStreamRef(parsedProvider, channel.streamUrl, "live");
    if (!inspection.ref) return reject("live", inspection.reason);
    liveRows.push({ ...channel, playbackRef: inspection.ref });
  }

  for (const item of movieInput) {
    scan.scanInspectedCount += 1;
    const inspection = inspectM3UStreamRef(parsedProvider, item.streamUrl, "movie");
    if (!inspection.ref) return reject("vod", inspection.reason);
    if (inspection.ref.containerExtension === null) return reject("vod", "missing-extension");
    movieRows.push({
      stream_id: item.id,
      name: item.name,
      stream_icon: item.logoUrl,
      category_id: item.category,
      container_extension: inspection.ref.containerExtension,
      playbackRef: inspection.ref,
    });
  }

  for (const group of seriesInput) {
    const allEpisodes = Object.values(group.seasons).flat();
    const episodes: PersistedM3UEpisode[] = [];
    for (const episode of allEpisodes) {
      scan.scanInspectedCount += 1;
      const inspection = inspectM3UStreamRef(parsedProvider, episode.streamUrl, "series");
      if (!inspection.ref) return reject("series", inspection.reason);
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
    seriesRows.push({
      series_id: group.id,
      name: group.name,
      cover: group.coverUrl,
      category_id: group.category,
      m3uEpisodes: episodes,
    });
  }

  scan.scanTruncated = false;
  return projection(null);
}
