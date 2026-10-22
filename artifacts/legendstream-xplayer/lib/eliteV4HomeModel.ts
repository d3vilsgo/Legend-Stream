import type { Channel } from "@/context/PlayerContext";
import type { MediaProgressV2 } from "@/lib/mediaProgress";
import type { XtreamSeriesItem, XtreamVodItem } from "@/lib/xtreamCatalog";
import { normalizeImageUrl } from "@/lib/imageUrl";

export type EliteHomeItem = Readonly<{
  id: string;
  kind: "movie" | "live" | "series";
  title: string;
  subtitle?: string;
  image?: string;
  movie?: XtreamVodItem;
  channel?: Channel;
  series?: XtreamSeriesItem;
  progressFraction?: number;
}>;

export type EliteHomeSections = Readonly<{
  featured: readonly EliteHomeItem[];
  continueWatching: readonly EliteHomeItem[];
  live: readonly EliteHomeItem[];
  movies: readonly EliteHomeItem[];
  series: readonly EliteHomeItem[];
}>;

const movieItem = (movie: XtreamVodItem): EliteHomeItem => ({
  id: `movie-${movie.stream_id}`,
  kind: "movie",
  title: movie.name,
  subtitle:
    [movie.genre, movie.releaseDate || movie.release_date]
      .filter(Boolean)
      .join(" · ") || "Film",
  image: normalizeImageUrl(movie.stream_icon) ?? undefined,
  movie,
});

const liveItem = (channel: Channel): EliteHomeItem => ({
  id: `live-${channel.id}`,
  kind: "live",
  title: channel.name,
  subtitle: channel.category || "Canlı TV",
  image: normalizeImageUrl(channel.logoUrl) ?? undefined,
  channel,
});

const seriesItem = (series: XtreamSeriesItem): EliteHomeItem => ({
  id: `series-${series.series_id}`,
  kind: "series",
  title: series.name,
  subtitle:
    [series.genre, series.releaseDate || series.release_date]
      .filter(Boolean)
      .join(" · ") || "Dizi",
  image: normalizeImageUrl(series.cover) ?? undefined,
  series,
});

function movieForProgress(
  movies: readonly XtreamVodItem[],
  entry: MediaProgressV2,
): XtreamVodItem | undefined {
  const ref = entry.playbackRef;
  if (ref.type === "xtream-vod")
    return movies.find((movie) => String(movie.stream_id) === ref.streamId);
  if (ref.type === "m3u-vod")
    return movies.find((movie) => String(movie.stream_id) === ref.itemId);
  return undefined;
}

export function createEliteHomeItems(
  movies: readonly XtreamVodItem[],
  channels: readonly Channel[],
): EliteHomeItem[] {
  if (movies.length) return movies.slice(0, 12).map(movieItem);
  return channels.slice(0, 12).map(liveItem);
}

export function createEliteHomeSections(
  movies: readonly XtreamVodItem[],
  channels: readonly Channel[],
  series: readonly XtreamSeriesItem[],
  featuredMovies: readonly XtreamVodItem[] = [],
  progress: readonly MediaProgressV2[] = [],
): EliteHomeSections {
  const movieItems = movies.map(movieItem);
  const progressItems = progress
    .filter(
      (entry) =>
        entry.kind === "movie" &&
        entry.duration > 0 &&
        entry.position > 0 &&
        entry.position / entry.duration < 0.95,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .flatMap((entry) => {
      const movie = movieForProgress(movies, entry);
      if (!movie) return [];
      return [
        {
          ...movieItem(movie),
          progressFraction: Math.max(
            0,
            Math.min(1, entry.position / entry.duration),
          ),
        },
      ];
    })
    .slice(0, 12);
  return {
    featured: featuredMovies.slice(0, 8).map(movieItem),
    continueWatching: progressItems,
    live: channels.slice(0, 24).map(liveItem),
    movies: movieItems.slice(0, 24),
    series: series.slice(0, 24).map(seriesItem),
  };
}
