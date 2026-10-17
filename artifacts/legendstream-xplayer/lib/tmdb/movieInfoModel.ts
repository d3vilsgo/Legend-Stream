import type { EnrichmentInput, TmdbMetadata } from "./contract";
import { xtreamMovieInput } from "./providerInput";
import { tmdbImageUrl } from "./metadata";
import type { XtreamVodItem } from "../xtreamCatalog";
import type { StalkerVodItem } from "../stalkerVod";
export type LocalMovieInfo = Readonly<{
  title: string;
  poster?: string;
  overview?: string;
  genre?: string;
  cast?: string;
  director?: string;
  year?: number;
  rating?: string;
}>;
export function localXtreamMovie(item: XtreamVodItem): LocalMovieInfo {
  return {
    title: item.name,
    poster: item.stream_icon,
    overview: item.plot,
    genre: item.genre,
    cast: item.cast,
    director: item.director,
    rating: item.rating === undefined ? undefined : String(item.rating),
  };
}
export function localStalkerMovie(item: StalkerVodItem): LocalMovieInfo {
  return {
    title: item.title,
    poster: item.posterUrl,
    overview: item.description,
    genre: item.genre,
    cast: item.actors,
    director: item.director,
    rating: item.rating,
  };
}
/** Enriched metadata is presentation only; no playback ID, URL or playable flag can come from it. */
export function movieInfoPresentation(
  local: LocalMovieInfo,
  input: EnrichmentInput,
  metadata?: TmdbMetadata,
) {
  const m = metadata?.kind === "movie" ? metadata : undefined;
  return {
    title: m?.title?.trim() || local.title,
    originalTitle: m?.originalTitle,
    poster: tmdbImageUrl(m?.posterPath, "w342") ?? local.poster,
    backdrop: tmdbImageUrl(m?.backdropPath, "w1280"),
    overview: m?.overview?.trim() || local.overview,
    genre: m?.genres.length
      ? m.genres.map((g) => g.name).join(" · ")
      : local.genre,
    cast: m?.cast.length
      ? m.cast
          .slice(0, 12)
          .map((p) => p.name)
          .join(", ")
      : local.cast,
    director: m?.directors.length
      ? m.directors.map((p) => p.name).join(", ")
      : local.director,
    year: m?.year ?? input.year ?? local.year,
    runtime: m?.runtimeMinutes,
    rating: m?.voteAverage,
    ratingSource: m?.voteAverage !== undefined ? "TMDB" : undefined,
    similarCount: m?.similar.length ?? 0,
    enriched: !!m,
  };
}

/** Paged M3U rows use the VOD DTO shape, but retain M3U playback identity. */
export function pagedMovieInput(
  providerId: string,
  provider: "m3u" | "xtream",
  revision: string,
  item: XtreamVodItem,
): EnrichmentInput {
  const input = xtreamMovieInput(providerId, revision, item);
  return { ...input, identity: { ...input.identity, provider } };
}
export function currentMovie<T>(
  items: readonly T[],
  id: string,
  getId: (item: T) => string,
): T | null {
  return items.find((item) => getId(item) === id) ?? null;
}
