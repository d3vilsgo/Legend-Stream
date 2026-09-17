export type GoldenSeriesCardModel = { id: string; title: string; image?: string };
export type GoldenSeriesEpisodeModel = { id: string; title: string; seasonId: string };
export type GoldenSeriesSeasonModel = { id: string; label: string; episodes: GoldenSeriesEpisodeModel[] };
export type GoldenSeriesDetailModel = { id: string; title: string; seasons: GoldenSeriesSeasonModel[] };

function numericIdentity(value: string) {
  const normalized = value.trim();
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

export function orderGoldenSeriesEpisodes(episodes: readonly GoldenSeriesEpisodeModel[]) {
  return [...episodes].sort((a, b) => {
    const aNumber = numericIdentity(a.id);
    const bNumber = numericIdentity(b.id);
    if (aNumber != null && bNumber != null) return aNumber - bNumber;
    if (aNumber != null) return -1;
    if (bNumber != null) return 1;
    return a.title.localeCompare(b.title, "tr", { numeric: true, sensitivity: "base" });
  });
}

export function orderGoldenSeriesSeasons(seasons: readonly GoldenSeriesSeasonModel[]) {
  return [...seasons]
    .sort((a, b) => {
      const aNumber = numericIdentity(a.id);
      const bNumber = numericIdentity(b.id);
      if (aNumber != null && bNumber != null) return aNumber - bNumber;
      if (aNumber != null) return -1;
      if (bNumber != null) return 1;
      return a.label.localeCompare(b.label, "tr", { numeric: true, sensitivity: "base" });
    })
    .map((season) => ({
      ...season,
      episodes: orderGoldenSeriesEpisodes(season.episodes),
    }));
}

export function initialGoldenSeriesSeasonId(seasons: readonly GoldenSeriesSeasonModel[]) {
  return seasons.length === 1 ? seasons[0]!.id : null;
}

export function selectedGoldenSeriesSeason(
  seasons: readonly GoldenSeriesSeasonModel[],
  selectedSeasonId: string | null,
) {
  return selectedSeasonId == null
    ? null
    : seasons.find((season) => season.id === selectedSeasonId) ?? null;
}

export function goldenSeriesBackTarget(
  selectedSeasonId: string | null,
  seasonCount: number,
): "seasons" | "catalog" {
  return selectedSeasonId != null && seasonCount > 1 ? "seasons" : "catalog";
}
