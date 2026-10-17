import { useCallback, useEffect, useRef, useState } from "react";
import type { XtreamVodItem } from "@/lib/xtreamCatalog";
import {
  currentMovie,
  localXtreamMovie,
  pagedMovieInput,
} from "@/lib/tmdb/movieInfoModel";

type Selection = { providerId: string; itemId: string };
type Options = {
  providerId?: string;
  providerType?: string;
  revision: string;
  items: readonly XtreamVodItem[];
  enabled: boolean;
  onPlay: (item: XtreamVodItem) => void;
};

/** Home stores a scoped identity, never a playable URL or TMDB identity. */
export function useHomeMovieInfo(options: Options) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const { providerId, providerType, revision, items, enabled } = options;
  const supported = providerType === "xtream" || providerType === "m3u";
  const movie =
    enabled && supported && selection && selection.providerId === providerId
      ? currentMovie(items, selection.itemId, (item) => String(item.stream_id))
      : null;
  const consumed = useRef<Selection | null>(null);
  const latest = useRef({ options, selection, movie });
  latest.current = { options, selection, movie };
  const close = useCallback(() => setSelection(null), []);
  useEffect(() => {
    if (selection && !movie) close();
  }, [selection, movie, close]);

  const select = (item: XtreamVodItem) => {
    if (!enabled || !supported || !providerId) return;
    if (
      !currentMovie(items, String(item.stream_id), (row) =>
        String(row.stream_id),
      )
    )
      return;
    setSelection({ providerId, itemId: String(item.stream_id) });
  };
  // A retained callback from an old modal cannot start a new provider/selection.
  const play = () => {
    const now = latest.current;
    if (
      !selection ||
      consumed.current === selection ||
      now.selection !== selection ||
      !now.movie ||
      now.options.providerId !== selection.providerId ||
      !now.options.enabled
    )
      return;
    consumed.current = selection;
    close();
    now.options.onPlay(now.movie);
  };
  return {
    movie,
    input:
      movie && providerId && supported
        ? pagedMovieInput(providerId, providerType, revision, movie)
        : null,
    local: movie ? localXtreamMovie(movie) : null,
    select,
    close,
    play,
  };
}
