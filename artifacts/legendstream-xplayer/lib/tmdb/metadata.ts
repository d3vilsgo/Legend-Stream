import type { TmdbMetadata } from "./contract";
/** Field-level fallback only for the SAME content identity; missing remains missing. */
export function localizedMetadata(
  turkish: TmdbMetadata,
  english?: TmdbMetadata,
): TmdbMetadata {
  if (turkish.locale !== "tr-TR") throw new Error("INVALID_METADATA_LOCALE");
  if (
    english &&
    (english.kind !== turkish.kind ||
      english.id !== turkish.id ||
      english.locale !== "en-US")
  )
    throw new Error("METADATA_IDENTITY_MISMATCH");
  const primary = (value?: string, fallback?: string) =>
    value?.trim() || fallback?.trim() || undefined;
  return {
    ...turkish,
    title: primary(turkish.title, english?.title),
    originalTitle: primary(turkish.originalTitle, english?.originalTitle),
    overview: primary(turkish.overview, english?.overview),
    posterPath: primary(turkish.posterPath, english?.posterPath),
    backdropPath: primary(turkish.backdropPath, english?.backdropPath),
    runtimeMinutes: turkish.runtimeMinutes ?? english?.runtimeMinutes,
    year: turkish.year ?? english?.year,
    voteAverage: turkish.voteAverage ?? english?.voteAverage,
    genres: turkish.genres.length ? turkish.genres : (english?.genres ?? []),
    cast: turkish.cast.length ? turkish.cast : (english?.cast ?? []),
    directors: turkish.directors.length
      ? turkish.directors
      : (english?.directors ?? []),
    seasons: turkish.seasons.length
      ? turkish.seasons
      : (english?.seasons ?? []),
    similar: turkish.similar.length
      ? turkish.similar
      : (english?.similar ?? []),
    fieldLocales: {
      title: turkish.title?.trim()
        ? "tr-TR"
        : english?.title?.trim()
          ? "en-US"
          : undefined,
      overview: turkish.overview?.trim()
        ? "tr-TR"
        : english?.overview?.trim()
          ? "en-US"
          : undefined,
    },
  };
}
/** Image paths only; provider URLs, query parameters and arbitrary hosts are rejected. */
export function tmdbImageUrl(
  path: string | undefined,
  size: "w342" | "w780" | "w1280",
): string | null {
  return path && /^\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/u.test(path)
    ? `https://image.tmdb.org/t/p/${size}${path}`
    : null;
}
