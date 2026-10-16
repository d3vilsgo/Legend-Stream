import type { M3UMovieItem, M3USeriesGroup } from "../iptv";
import type { StalkerVodItem } from "../stalkerVod";
import type { StalkerSeriesProductItem } from "../stalkerSeriesProduct";
import type {
  XtreamSeriesItem,
  XtreamVodInfo,
  XtreamVodItem,
} from "../xtreamCatalog";
import type { EnrichmentInput } from "./contract";
/** Only provider release fields are parsed here; bare numeric title text is never a year. */
function year(value?: string): number | undefined {
  const first = value?.match(/^((?:18|19|20)\d{2})(?:$|[-/])/u)?.[1];
  return first ? Number(first) : undefined;
}
function tmdbId(value: unknown): number | undefined {
  const text = String(value ?? "");
  const id = /^[1-9]\d*$/u.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(id) ? id : undefined;
}
export function xtreamMovieInput(
  providerId: string,
  catalogRevision: string,
  item: XtreamVodItem,
  info?: XtreamVodInfo,
): EnrichmentInput {
  // Runtime info can be stale: accept its hint only if it carries the requested stream identity.
  const sameInfo =
    info?.movie_data?.stream_id !== undefined &&
    String(info.movie_data.stream_id) === String(item.stream_id);
  return {
    identity: {
      providerId,
      provider: "xtream",
      kind: "movie",
      catalogId: String(item.stream_id),
    },
    catalogRevision,
    title: item.name,
    year: year(item.releaseDate ?? item.release_date),
    providerTmdbId: sameInfo ? tmdbId(info?.info?.tmdb_id) : undefined,
  };
}
export function xtreamSeriesInput(
  providerId: string,
  catalogRevision: string,
  item: XtreamSeriesItem,
): EnrichmentInput {
  return {
    identity: {
      providerId,
      provider: "xtream",
      kind: "series",
      catalogId: String(item.series_id),
    },
    catalogRevision,
    title: item.name,
    year: year(item.releaseDate ?? item.release_date),
  };
}
export function m3uMovieInput(
  catalogRevision: string,
  item: M3UMovieItem,
): EnrichmentInput {
  return {
    identity: {
      providerId: item.providerId,
      provider: "m3u",
      kind: "movie",
      catalogId: item.id,
    },
    catalogRevision,
    title: item.name,
  };
}
export function m3uSeriesInput(
  catalogRevision: string,
  item: M3USeriesGroup,
): EnrichmentInput {
  return {
    identity: {
      providerId: item.providerId,
      provider: "m3u",
      kind: "series",
      catalogId: item.id,
    },
    catalogRevision,
    title: item.name,
  };
}
export function stalkerMovieInput(
  providerId: string,
  catalogRevision: string,
  item: StalkerVodItem,
): EnrichmentInput {
  return {
    identity: {
      providerId,
      provider: "stalker",
      kind: "movie",
      catalogId: item.portalId,
    },
    catalogRevision,
    title: item.title,
    year: year(item.year),
  };
}
export function stalkerSeriesInput(
  providerId: string,
  catalogRevision: string,
  item: StalkerSeriesProductItem,
): EnrichmentInput {
  return {
    identity: {
      providerId,
      provider: "stalker",
      kind: "series",
      catalogId: item.id,
    },
    catalogRevision,
    title: item.title,
    year: year(item.year),
  };
}
