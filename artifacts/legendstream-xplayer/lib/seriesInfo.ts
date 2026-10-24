import type {
  XtreamEpisode,
  XtreamSeriesInfo,
  XtreamSeriesItem,
} from "./xtreamCatalog";
import type { MediaPlaybackRef } from "./mediaProgress";
import type { GoldenSeriesDetailModel } from "./goldenSeriesDetail";
import type {
  StalkerSeriesProductDetail,
  StalkerSeriesProductItem,
} from "./stalkerSeriesProduct";

export function episodeProgressRef(
  provider: "xtream" | "m3u",
  seriesId: string,
  episode: XtreamEpisode,
): MediaPlaybackRef {
  return provider === "m3u"
    ? { type: "m3u-episode", itemId: String(episode.id) }
    : {
        type: "xtream-episode",
        seriesId,
        episodeId: String(episode.id),
        containerExtension: episode.container_extension || "mp4",
        sourceMode: episode.direct_source ? "direct" : "canonical",
      };
}
export function pagedSeriesDetail(
  providerId: string,
  provider: "xtream" | "m3u",
  item: XtreamSeriesItem,
  info: XtreamSeriesInfo | null,
): GoldenSeriesDetailModel {
  const local = info?.info;
  return {
    id: JSON.stringify([providerId, String(item.series_id)]),
    title: local?.name || item.name,
    image: local?.cover || item.cover,
    description: local?.plot || item.plot,
    genre: local?.genre || item.genre,
    rating:
      local?.rating !== undefined
        ? String(local.rating)
        : item.rating !== undefined
          ? String(item.rating)
          : undefined,
    year:
      parseInt(
        String(
          local?.releaseDate || item.releaseDate || item.release_date || "",
        ).slice(0, 4),
        10,
      ) || undefined,
    seasons: Object.entries(info?.episodes ?? {}).map(([id, episodes]) => ({
      id,
      label:
        info?.seasons?.find((s) => String(s.season_number) === id)?.name ||
        `Sezon ${id}`,
      seasonNumber: /^\d+$/.test(id) ? Number(id) : undefined,
      episodes: episodes.map((episode) => ({
        id: String(episode.id),
        seasonId: id,
        title: episode.title || String(episode.id),
        episodeNumber: episode.episode_num,
        description: episode.info?.plot,
        duration: episode.info?.duration,
        image: episode.info?.movie_image,
        progressRef: episodeProgressRef(
          provider,
          String(item.series_id),
          episode,
        ),
      })),
    })),
  };
}
export function stalkerSeriesDetail(
  providerId: string,
  scope: string,
  item: StalkerSeriesProductItem,
  detail: StalkerSeriesProductDetail | null,
): GoldenSeriesDetailModel {
  return {
    id: JSON.stringify([providerId, scope, item.id]),
    title: detail?.title || item.title,
    image: detail?.posterUrl || item.posterUrl,
    description: detail?.description || item.description,
    genre: detail?.genre || item.genre,
    rating: detail?.rating || item.rating,
    year:
      parseInt(String(detail?.year || item.year || "").slice(0, 4), 10) ||
      undefined,
    seasons: (detail?.seasons ?? []).map((season) => ({
      ...season,
      episodes: season.episodes.map((episode) => ({
        id: episode.id,
        title: episode.label,
        seasonId: season.id,
        episodeNumber: episode.episodeNumber,
        progressRef: {
          type: "stalker-episode" as const,
          seriesId: item.id,
          seasonId: season.id,
          episodeId: episode.id,
        },
      })),
    })),
  };
}
