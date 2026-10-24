import type { V4CatalogCard } from "./eliteV4Movies";
import type { XtreamSeriesItem } from "./xtreamCatalog";
import type { StalkerSeriesProductItem } from "./stalkerSeriesProduct";
import { xtreamSeriesInput, stalkerSeriesInput } from "./tmdb/providerInput";
export type V4Series = V4CatalogCard & {
  source:
    | { kind: "paged"; item: XtreamSeriesItem }
    | { kind: "stalker"; item: StalkerSeriesProductItem };
};
export function v4PagedSeries(
  providerId: string,
  provider: "xtream" | "m3u",
  revision: string,
  items: readonly XtreamSeriesItem[],
): V4Series[] {
  return items.map((item) => {
    const input = xtreamSeriesInput(providerId, revision, item);
    return {
      id: String(item.series_id),
      title: item.name,
      poster: item.cover,
      backdrop: item.backdrop_path?.[0],
      input: { ...input, identity: { ...input.identity, provider } },
      local: {
        title: item.name,
        poster: item.cover,
        overview: item.plot,
        genre: item.genre,
        year: input.year,
      },
      source: { kind: "paged", item },
    };
  });
}
export function v4StalkerSeries(
  providerId: string,
  scope: string,
  items: readonly StalkerSeriesProductItem[],
): V4Series[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    poster: item.posterUrl,
    input: stalkerSeriesInput(providerId, scope, item),
    local: {
      title: item.title,
      poster: item.posterUrl,
      overview: item.description,
      genre: item.genre,
      year: Number(item.year) || undefined,
    },
    source: { kind: "stalker", item },
  }));
}

/** Metadata can fill provider episode fields only when explicit numbers match uniquely. */
export function enrichV4ProviderEpisodes<
  T extends {
    episodeNumber?: number;
    title: string;
    description?: string;
    image?: string;
  },
>(
  episodes: readonly T[],
  metadata: readonly {
    number: number;
    title: string;
    overview?: string;
    stillPath?: string;
  }[],
): T[] {
  return episodes.map((episode) => {
    const number = episode.episodeNumber;
    if (
      !Number.isInteger(number) ||
      episodes.filter((e) => e.episodeNumber === number).length !== 1
    )
      return episode;
    const matches = metadata.filter((e) => e.number === number);
    if (matches.length !== 1) return episode;
    const match = matches[0];
    return {
      ...episode,
      title: episode.title.trim() || match.title,
      description: episode.description || match.overview,
      image:
        episode.image ||
        (match.stillPath
          ? `https://image.tmdb.org/t/p/w500${match.stillPath}`
          : undefined),
    };
  });
}
