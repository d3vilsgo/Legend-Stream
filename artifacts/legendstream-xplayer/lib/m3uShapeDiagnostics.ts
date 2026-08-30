export type M3UContentType = "live" | "movie" | "series";

export type M3UClassificationSource =
  | "path-live"
  | "path-movie"
  | "path-series"
  | "extension-live"
  | "extension-movie"
  | "group-movie"
  | "group-series"
  | "default-live";

export type M3UShapeDiagnostics = {
  originCompare: {
    total: number;
    protocolMatchCount: number;
    hostnameMatchCount: number;
    portMatchCount: number;
    exactOriginMatchCount: number;
  };
  streamOrigin: {
    distinctOriginCount: number;
  };
  pathShape: {
    hasLiveSegmentCount: number;
    hasMovieSegmentCount: number;
    hasSeriesSegmentCount: number;
    noneOfKnownSegmentsCount: number;
    segmentCountHistogram: Record<string, number>;
  };
  extension: {
    presentCount: number;
    absentCount: number;
    distinctCount: number;
    liveLikeCount: number;
    vodLikeCount: number;
    otherCount: number;
  };
  extinfDuration: {
    negativeOneCount: number;
    positiveCount: number;
    zeroCount: number;
    unparseableCount: number;
  };
  tvgId: {
    presentCount: number;
    absentCount: number;
  };
  classification: {
    byPathLive: number;
    byPathMovie: number;
    byPathSeries: number;
    byExtensionLive: number;
    byExtensionMovie: number;
    byGroupMovie: number;
    byGroupSeries: number;
    byDefaultLive: number;
  };
  conflict: {
    pathLive_groupMovie: number;
    durationNegativeOne_groupMovie: number;
    tvgIdPresent_groupMovie: number;
    pathSeries_extensionMovie: number;
  };
};

export type M3UClassificationDecision = {
  contentType: M3UContentType;
  source: M3UClassificationSource;
};

type ObserverInput = {
  streamUrl: string;
  category: string;
  extinfDuration?: string;
  tvgId?: string;
};

const LIVE_EXTENSIONS = new Set(["ts", "m3u8"]);
const VOD_EXTENSIONS = new Set(["mp4", "mkv", "avi"]);

const emptyDiagnostics = (): M3UShapeDiagnostics => ({
  originCompare: {
    total: 0,
    protocolMatchCount: 0,
    hostnameMatchCount: 0,
    portMatchCount: 0,
    exactOriginMatchCount: 0,
  },
  streamOrigin: { distinctOriginCount: 0 },
  pathShape: {
    hasLiveSegmentCount: 0,
    hasMovieSegmentCount: 0,
    hasSeriesSegmentCount: 0,
    noneOfKnownSegmentsCount: 0,
    segmentCountHistogram: {},
  },
  extension: {
    presentCount: 0,
    absentCount: 0,
    distinctCount: 0,
    liveLikeCount: 0,
    vodLikeCount: 0,
    otherCount: 0,
  },
  extinfDuration: {
    negativeOneCount: 0,
    positiveCount: 0,
    zeroCount: 0,
    unparseableCount: 0,
  },
  tvgId: { presentCount: 0, absentCount: 0 },
  classification: {
    byPathLive: 0,
    byPathMovie: 0,
    byPathSeries: 0,
    byExtensionLive: 0,
    byExtensionMovie: 0,
    byGroupMovie: 0,
    byGroupSeries: 0,
    byDefaultLive: 0,
  },
  conflict: {
    pathLive_groupMovie: 0,
    durationNegativeOne_groupMovie: 0,
    tvgIdPresent_groupMovie: 0,
    pathSeries_extensionMovie: 0,
  },
});

const normalizeHint = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

function pathFor(streamUrl: string) {
  const lowerUrl = streamUrl.toLowerCase();
  try {
    return new URL(streamUrl).pathname.toLowerCase();
  } catch {
    return lowerUrl.split(/[?#]/, 1)[0];
  }
}

function pathSignals(path: string) {
  const segments = path.split("/").filter(Boolean);
  return {
    segments,
    hasLive: segments.includes("live"),
    hasMovie: segments.includes("movie"),
    hasSeries: segments.includes("series"),
  };
}

function extensionFor(path: string) {
  const file = path.split("/").filter(Boolean).at(-1) ?? "";
  const match = file.match(/\.([a-z0-9]{1,16})$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function groupSignals(category: string) {
  const group = normalizeHint(category);
  return {
    movie: /\b(VOD|MOVIE|MOVIES|FILM|FILMLER|SINEMA|CINEMA)\b/.test(group),
    series: /\b(SERIES|SERIE|DIZI|DIZILER)\b/.test(group),
  };
}

export function classifyM3UContentTypeWithSource(
  streamUrl: string,
  category: string,
): M3UClassificationDecision {
  const path = pathFor(streamUrl);

  if (/(^|\/)movie\//i.test(path)) return { contentType: "movie", source: "path-movie" };
  if (/(^|\/)series\//i.test(path)) return { contentType: "series", source: "path-series" };
  if (/(^|\/)live\//i.test(path)) return { contentType: "live", source: "path-live" };

  if (/\.(mp4|mkv|avi)$/i.test(path)) return { contentType: "movie", source: "extension-movie" };
  if (/\.(ts|m3u8)$/i.test(path)) return { contentType: "live", source: "extension-live" };

  const group = groupSignals(category);
  if (group.movie) return { contentType: "movie", source: "group-movie" };
  if (group.series) return { contentType: "series", source: "group-series" };
  return { contentType: "live", source: "default-live" };
}

function effectivePort(url: URL) {
  if (url.port) return url.port;
  if (url.protocol === "http:") return "80";
  if (url.protocol === "https:") return "443";
  return "";
}

function observeDuration(raw: string | undefined, diagnostics: M3UShapeDiagnostics) {
  if (raw === undefined || raw.trim() === "") {
    diagnostics.extinfDuration.unparseableCount += 1;
    return;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    diagnostics.extinfDuration.unparseableCount += 1;
  } else if (value === -1) {
    diagnostics.extinfDuration.negativeOneCount += 1;
  } else if (value > 0) {
    diagnostics.extinfDuration.positiveCount += 1;
  } else if (value === 0) {
    diagnostics.extinfDuration.zeroCount += 1;
  } else {
    diagnostics.extinfDuration.unparseableCount += 1;
  }
}

function incrementClassification(
  source: M3UClassificationSource,
  diagnostics: M3UShapeDiagnostics,
) {
  const key: Record<M3UClassificationSource, keyof M3UShapeDiagnostics["classification"]> = {
    "path-live": "byPathLive",
    "path-movie": "byPathMovie",
    "path-series": "byPathSeries",
    "extension-live": "byExtensionLive",
    "extension-movie": "byExtensionMovie",
    "group-movie": "byGroupMovie",
    "group-series": "byGroupSeries",
    "default-live": "byDefaultLive",
  };
  diagnostics.classification[key[source]] += 1;
}

export function createM3UShapeDiagnosticsObserver(providerSource?: string) {
  const diagnostics = emptyDiagnostics();
  const distinctOrigins = new Set<string>();
  const distinctExtensions = new Set<string>();
  let providerUrl: URL | null = null;
  try {
    providerUrl = providerSource ? new URL(providerSource) : null;
  } catch {
    providerUrl = null;
  }

  return {
    observe(input: ObserverInput): M3UClassificationDecision {
      diagnostics.originCompare.total += 1;

      let streamUrl: URL | null = null;
      try {
        streamUrl = new URL(input.streamUrl);
      } catch {
        streamUrl = null;
      }
      if (streamUrl) {
        distinctOrigins.add(streamUrl.origin);
        if (providerUrl) {
          if (streamUrl.protocol === providerUrl.protocol) diagnostics.originCompare.protocolMatchCount += 1;
          if (streamUrl.hostname === providerUrl.hostname) diagnostics.originCompare.hostnameMatchCount += 1;
          if (effectivePort(streamUrl) === effectivePort(providerUrl)) diagnostics.originCompare.portMatchCount += 1;
          if (streamUrl.origin === providerUrl.origin) diagnostics.originCompare.exactOriginMatchCount += 1;
        }
      }

      const path = pathFor(input.streamUrl);
      const pathInfo = pathSignals(path);
      if (pathInfo.hasLive) diagnostics.pathShape.hasLiveSegmentCount += 1;
      if (pathInfo.hasMovie) diagnostics.pathShape.hasMovieSegmentCount += 1;
      if (pathInfo.hasSeries) diagnostics.pathShape.hasSeriesSegmentCount += 1;
      if (!pathInfo.hasLive && !pathInfo.hasMovie && !pathInfo.hasSeries) {
        diagnostics.pathShape.noneOfKnownSegmentsCount += 1;
      }
      const segmentKey = String(pathInfo.segments.length);
      diagnostics.pathShape.segmentCountHistogram[segmentKey] =
        (diagnostics.pathShape.segmentCountHistogram[segmentKey] ?? 0) + 1;

      const extension = extensionFor(path);
      const extensionIsLive = extension !== null && LIVE_EXTENSIONS.has(extension);
      const extensionIsVod = extension !== null && VOD_EXTENSIONS.has(extension);
      if (extension === null) {
        diagnostics.extension.absentCount += 1;
      } else {
        diagnostics.extension.presentCount += 1;
        distinctExtensions.add(extension);
        if (extensionIsLive) diagnostics.extension.liveLikeCount += 1;
        else if (extensionIsVod) diagnostics.extension.vodLikeCount += 1;
        else diagnostics.extension.otherCount += 1;
      }

      observeDuration(input.extinfDuration, diagnostics);
      const tvgIdPresent = Boolean(input.tvgId?.trim());
      if (tvgIdPresent) diagnostics.tvgId.presentCount += 1;
      else diagnostics.tvgId.absentCount += 1;

      const group = groupSignals(input.category);
      if (pathInfo.hasLive && group.movie) diagnostics.conflict.pathLive_groupMovie += 1;
      if (input.extinfDuration?.trim() === "-1" && group.movie) {
        diagnostics.conflict.durationNegativeOne_groupMovie += 1;
      }
      if (tvgIdPresent && group.movie) diagnostics.conflict.tvgIdPresent_groupMovie += 1;
      if (pathInfo.hasSeries && extensionIsVod) diagnostics.conflict.pathSeries_extensionMovie += 1;

      const decision = classifyM3UContentTypeWithSource(input.streamUrl, input.category);
      incrementClassification(decision.source, diagnostics);
      return decision;
    },

    snapshot(): M3UShapeDiagnostics {
      return {
        ...diagnostics,
        originCompare: { ...diagnostics.originCompare },
        streamOrigin: { distinctOriginCount: distinctOrigins.size },
        pathShape: {
          ...diagnostics.pathShape,
          segmentCountHistogram: { ...diagnostics.pathShape.segmentCountHistogram },
        },
        extension: { ...diagnostics.extension, distinctCount: distinctExtensions.size },
        extinfDuration: { ...diagnostics.extinfDuration },
        tvgId: { ...diagnostics.tvgId },
        classification: { ...diagnostics.classification },
        conflict: { ...diagnostics.conflict },
      };
    },
  };
}

export function formatM3UShapeDiagnosticsFields(diagnostics: M3UShapeDiagnostics) {
  return [
    `m3u.originCompare.total=${diagnostics.originCompare.total}`,
    `m3u.originCompare.protocolMatchCount=${diagnostics.originCompare.protocolMatchCount}`,
    `m3u.originCompare.hostnameMatchCount=${diagnostics.originCompare.hostnameMatchCount}`,
    `m3u.originCompare.portMatchCount=${diagnostics.originCompare.portMatchCount}`,
    `m3u.originCompare.exactOriginMatchCount=${diagnostics.originCompare.exactOriginMatchCount}`,
    `m3u.streamOrigin.distinctOriginCount=${diagnostics.streamOrigin.distinctOriginCount}`,
    `m3u.pathShape.hasLiveSegmentCount=${diagnostics.pathShape.hasLiveSegmentCount}`,
    `m3u.pathShape.hasMovieSegmentCount=${diagnostics.pathShape.hasMovieSegmentCount}`,
    `m3u.pathShape.hasSeriesSegmentCount=${diagnostics.pathShape.hasSeriesSegmentCount}`,
    `m3u.pathShape.noneOfKnownSegmentsCount=${diagnostics.pathShape.noneOfKnownSegmentsCount}`,
    ...Object.entries(diagnostics.pathShape.segmentCountHistogram)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([segments, count]) => `m3u.pathShape.segmentCountHistogram.${segments}=${count}`),
    `m3u.extension.presentCount=${diagnostics.extension.presentCount}`,
    `m3u.extension.absentCount=${diagnostics.extension.absentCount}`,
    `m3u.extension.distinctCount=${diagnostics.extension.distinctCount}`,
    `m3u.extension.liveLikeCount=${diagnostics.extension.liveLikeCount}`,
    `m3u.extension.vodLikeCount=${diagnostics.extension.vodLikeCount}`,
    `m3u.extension.otherCount=${diagnostics.extension.otherCount}`,
    `m3u.extinfDuration.negativeOneCount=${diagnostics.extinfDuration.negativeOneCount}`,
    `m3u.extinfDuration.positiveCount=${diagnostics.extinfDuration.positiveCount}`,
    `m3u.extinfDuration.zeroCount=${diagnostics.extinfDuration.zeroCount}`,
    `m3u.extinfDuration.unparseableCount=${diagnostics.extinfDuration.unparseableCount}`,
    `m3u.tvgId.presentCount=${diagnostics.tvgId.presentCount}`,
    `m3u.tvgId.absentCount=${diagnostics.tvgId.absentCount}`,
    `m3u.classification.byPathLive=${diagnostics.classification.byPathLive}`,
    `m3u.classification.byPathMovie=${diagnostics.classification.byPathMovie}`,
    `m3u.classification.byPathSeries=${diagnostics.classification.byPathSeries}`,
    `m3u.classification.byExtensionLive=${diagnostics.classification.byExtensionLive}`,
    `m3u.classification.byExtensionMovie=${diagnostics.classification.byExtensionMovie}`,
    `m3u.classification.byGroupMovie=${diagnostics.classification.byGroupMovie}`,
    `m3u.classification.byGroupSeries=${diagnostics.classification.byGroupSeries}`,
    `m3u.classification.byDefaultLive=${diagnostics.classification.byDefaultLive}`,
    `m3u.conflict.pathLive_groupMovie=${diagnostics.conflict.pathLive_groupMovie}`,
    `m3u.conflict.durationNegativeOne_groupMovie=${diagnostics.conflict.durationNegativeOne_groupMovie}`,
    `m3u.conflict.tvgIdPresent_groupMovie=${diagnostics.conflict.tvgIdPresent_groupMovie}`,
    `m3u.conflict.pathSeries_extensionMovie=${diagnostics.conflict.pathSeries_extensionMovie}`,
  ];
}
