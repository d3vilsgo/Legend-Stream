import type { MediaPlaybackRef } from "./mediaProgress";
import { orderSeriesEpisodes, orderSeriesSeasons } from "./seriesEpisodeOrder";

export type GoldenSeriesCardModel = {
  id: string;
  title: string;
  image?: string;
};
export type GoldenSeriesEpisodeModel = {
  id: string;
  title: string;
  seasonId: string;
  episodeNumber?: number;
  description?: string;
  duration?: string;
  image?: string;
  progressRef?: MediaPlaybackRef;
};
export type GoldenSeriesSeasonModel = {
  id: string;
  label: string;
  seasonNumber?: number;
  episodes: GoldenSeriesEpisodeModel[];
};
export type GoldenSeriesDetailModel = {
  id: string;
  title: string;
  image?: string;
  description?: string;
  genre?: string;
  year?: number;
  rating?: string;
  seasons: GoldenSeriesSeasonModel[];
};

function numericIdentity(value: string) {
  const normalized = value.trim();
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

export function orderGoldenSeriesEpisodes(
  episodes: readonly GoldenSeriesEpisodeModel[],
) {
  return orderSeriesEpisodes(episodes);
}

export function orderGoldenSeriesSeasons(
  seasons: readonly GoldenSeriesSeasonModel[],
) {
  return orderSeriesSeasons(
    seasons,
    (season) => season.seasonNumber ?? numericIdentity(season.id) ?? undefined,
  ).map((season) => ({
    ...season,
    episodes: orderGoldenSeriesEpisodes(season.episodes),
  }));
}

export function initialGoldenSeriesSeasonId(
  seasons: readonly GoldenSeriesSeasonModel[],
) {
  return seasons.length === 1 ? seasons[0]!.id : null;
}

export function selectedGoldenSeriesSeason(
  seasons: readonly GoldenSeriesSeasonModel[],
  selectedSeasonId: string | null,
) {
  return selectedSeasonId == null
    ? null
    : (seasons.find((season) => season.id === selectedSeasonId) ?? null);
}

export function goldenSeriesBackTarget(
  selectedSeasonId: string | null,
  seasonCount: number,
): "seasons" | "catalog" {
  return selectedSeasonId != null && seasonCount > 1 ? "seasons" : "catalog";
}
