import type { XtreamVodItem } from "./xtreamCatalog";
import type { StalkerVodItem } from "./stalkerVod";
import type { EnrichmentInput } from "./tmdb/contract";
import {
  localStalkerMovie,
  localXtreamMovie,
  pagedMovieInput,
  type LocalMovieInfo,
} from "./tmdb/movieInfoModel";
import { stalkerMovieInput } from "./tmdb/providerInput";
import type { CatalogPageSort } from "./catalogPaging";

export type V4Movie = {
  id: string;
  title: string;
  poster?: string;
  input: EnrichmentInput;
  local: LocalMovieInfo;
  source:
    | { kind: "paged"; item: XtreamVodItem }
    | { kind: "stalker"; item: StalkerVodItem };
};
export function v4PagedMovies(
  providerId: string,
  type: "xtream" | "m3u",
  revision: string,
  items: readonly XtreamVodItem[],
): V4Movie[] {
  return items.map((item) => ({
    id: String(item.stream_id),
    title: item.name,
    poster: item.stream_icon,
    input: pagedMovieInput(providerId, type, revision, item),
    local: localXtreamMovie(item),
    source: { kind: "paged", item },
  }));
}
export function v4StalkerMovies(
  providerId: string,
  scope: string,
  items: readonly StalkerVodItem[],
  sort: CatalogPageSort,
): V4Movie[] {
  const sorted =
    sort === "default"
      ? items
      : [...items].sort((a, b) => {
          const value =
            sort === "alphaAsc" || sort === "alphaDesc"
              ? a.title.localeCompare(b.title, "tr", { sensitivity: "base" })
              : a.portalId.localeCompare(b.portalId, "tr", { numeric: true });
          return sort === "alphaDesc" || sort === "idDesc" ? -value : value;
        });
  return sorted.map((item) => ({
    id: item.portalId,
    title: item.title,
    poster: item.posterUrl,
    input: stalkerMovieInput(providerId, scope, item),
    local: localStalkerMovie(item),
    source: { kind: "stalker", item },
  }));
}
export const v4MovieFocusId = (id: string) => `v4-movies-card:${id}`;
export function v4MoviesLayout(
  width: number,
  height: number,
  fontScale = 1,
  tv = true,
) {
  const padding = width < 600 ? 14 : 24;
  const available = Math.max(1, width - padding * 2);
  const gap = 16;
  const minimum = Math.max(tv ? 176 : 132, (tv ? 160 : 120) * fontScale);
  const columns = Math.max(
    1,
    Math.min(tv ? 6 : 5, Math.floor((available + gap) / (minimum + gap))),
  );
  const cardWidth = Math.floor((available - gap * (columns - 1)) / columns);
  return {
    padding,
    gap,
    columns,
    cardWidth,
    posterHeight: Math.round(cardWidth * 1.4),
    captionHeight: Math.ceil((tv ? 48 : 42) * fontScale + 20),
    heroHeight: Math.max(164, Math.min(280, Math.round(height * 0.3))),
  };
}
