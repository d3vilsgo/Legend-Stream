export type SemanticEpisodeOrder = { episodeNumber?: number };

function validOrdinal(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function orderSeriesEpisodes<T extends SemanticEpisodeOrder>(episodes: readonly T[]): T[] {
  return episodes
    .map((item, originalIndex) => ({ item, originalIndex, ordinal: validOrdinal(item.episodeNumber) }))
    .sort((a, b) => {
      if (a.ordinal != null && b.ordinal != null) return a.ordinal - b.ordinal || a.originalIndex - b.originalIndex;
      if (a.ordinal != null) return -1;
      if (b.ordinal != null) return 1;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ item }) => item);
}

export function orderSeriesSeasons<T>(
  seasons: readonly T[],
  seasonNumber: (season: T) => number | undefined,
): T[] {
  return seasons
    .map((item, originalIndex) => ({ item, originalIndex, ordinal: validOrdinal(seasonNumber(item)) }))
    .sort((a, b) => {
      if (a.ordinal != null && b.ordinal != null) return a.ordinal - b.ordinal || a.originalIndex - b.originalIndex;
      if (a.ordinal != null) return -1;
      if (b.ordinal != null) return 1;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ item }) => item);
}
