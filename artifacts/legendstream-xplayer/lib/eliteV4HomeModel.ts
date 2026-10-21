import type { Channel } from "@/context/PlayerContext";
import type { XtreamVodItem } from "@/lib/xtreamCatalog";
import { normalizeImageUrl } from "@/lib/imageUrl";

export type EliteHomeItem = Readonly<{
  id: string;
  kind: "movie" | "live";
  title: string;
  subtitle?: string;
  image?: string;
  movie?: XtreamVodItem;
  channel?: Channel;
}>;

export function createEliteHomeItems(
  movies: readonly XtreamVodItem[],
  channels: readonly Channel[],
): EliteHomeItem[] {
  if (movies.length)
    return movies.slice(0, 12).map((movie) => ({
      id: `movie-${movie.stream_id}`,
      kind: "movie",
      title: movie.name,
      subtitle:
        [movie.genre, movie.releaseDate || movie.release_date]
          .filter(Boolean)
          .join(" · ") || "Film",
      image: normalizeImageUrl(movie.stream_icon) ?? undefined,
      movie,
    }));
  return channels.slice(0, 12).map((channel) => ({
    id: `live-${channel.id}`,
    kind: "live",
    title: channel.name,
    subtitle: channel.category || "Canlı TV",
    image: normalizeImageUrl(channel.logoUrl) ?? undefined,
    channel,
  }));
}
