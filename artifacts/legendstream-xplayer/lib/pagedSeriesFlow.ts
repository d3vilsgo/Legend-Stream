import type {
  XtreamEpisode,
  XtreamSeriesInfo,
  XtreamSeriesItem,
} from "./xtreamCatalog";
import type { MediaPlaybackRef } from "./mediaProgress";
import { episodeProgressRef } from "./seriesInfo";
export type SeriesOrigin = "home" | "series";
export type PagedSeriesState = {
  ticket: object;
  item: XtreamSeriesItem;
  info: XtreamSeriesInfo | null;
  origin: SeriesOrigin;
  loading: boolean;
  busy: boolean;
  error: string | null;
};
export function createPagedSeriesFlow(options: {
  provider: "xtream" | "m3u";
  isCurrent: () => boolean;
  load: (
    item: XtreamSeriesItem,
    signal: AbortSignal,
  ) => Promise<XtreamSeriesInfo | null>;
  resolve: (episode: XtreamEpisode, signal: AbortSignal) => Promise<string>;
  register: (info: XtreamSeriesInfo) => void;
  onState: (state: PagedSeriesState | null) => void;
  onPlaybackStart: () => void;
  recover?: (error: unknown) => Promise<boolean>;
  onPlayable: (value: {
    title: string;
    subtitle: string;
    url: string;
    origin: SeriesOrigin;
    progressRef: MediaPlaybackRef;
  }) => void;
}) {
  let state: PagedSeriesState | null = null;
  let abort: AbortController | null = null;
  let consumed = false;
  const owns = (ticket: object) =>
    options.isCurrent() && state?.ticket === ticket;
  const publish = (next: PagedSeriesState | null) => {
    state = next;
    options.onState(next);
  };
  const close = (ticket?: object) => {
    if (ticket && state?.ticket !== ticket) return;
    abort?.abort();
    abort = null;
    consumed = false;
    publish(null);
  };
  const open = async (item: XtreamSeriesItem, origin: SeriesOrigin) => {
    if (!options.isCurrent()) return;
    close();
    const ticket = {},
      request = new AbortController();
    abort = request;
    publish({
      ticket,
      item,
      origin,
      info: null,
      loading: true,
      busy: false,
      error: null,
    });
    try {
      const info = await options.load(item, request.signal);
      if (!owns(ticket) || request.signal.aborted) return;
      if (!info) throw new Error("No cached hierarchy");
      options.register(info);
      publish({ ...state!, info, loading: false });
    } catch (error) {
      if (!owns(ticket) || request.signal.aborted) return;
      let recovered = false;
      try {
        recovered = (await options.recover?.(error)) ?? false;
      } catch {
        /* Keep the local retry path. */
      }
      if (recovered) {
        if (owns(ticket)) close(ticket);
        return;
      }
      if (owns(ticket) && !request.signal.aborted)
        publish({
          ...state!,
          loading: false,
          error:
            "Dizi bilgisi yüklenemedi. Tekrar deneyin; M3U için kayıtlı dizi hiyerarşisini kontrol edin.",
        });
    }
  };
  const play = async (ticket: object, seasonId: string, episodeId: string) => {
    if (
      !owns(ticket) ||
      !state?.info ||
      state.loading ||
      state.busy ||
      consumed
    )
      return;
    if (
      !state.info.episodes?.[seasonId]?.some((e) => String(e.id) === episodeId)
    ) {
      publish({
        ...state,
        error: "Seçilen bölüm artık bu sezonda bulunmuyor.",
      });
      return;
    }
    const request = new AbortController();
    abort?.abort();
    abort = request;
    publish({ ...state, busy: true, error: null });
    options.onPlaybackStart();
    try {
      let info = state!.info!;
      if (options.provider === "m3u") {
        const next = await options.load(state!.item, request.signal);
        if (!owns(ticket) || request.signal.aborted) return;
        if (!next) throw new Error("Missing series");
        info = next;
      }
      const episode = info.episodes?.[seasonId]?.find(
        (e) => String(e.id) === episodeId,
      );
      if (!episode) throw new Error("Missing episode");
      const url = await options.resolve(episode, request.signal);
      if (!owns(ticket) || request.signal.aborted) return;
      consumed = true;
      publish({ ...state!, info, busy: false });
      options.onPlayable({
        title: episode.title || String(episode.id),
        subtitle: state!.item.name,
        url,
        origin: state!.origin,
        progressRef: episodeProgressRef(
          options.provider,
          String(state!.item.series_id),
          episode,
        ),
      });
    } catch {
      if (owns(ticket) && !request.signal.aborted)
        publish({
          ...state!,
          busy: false,
          error: "Bölüm açılamadı. Seçimi kontrol edip tekrar deneyin.",
        });
    }
  };
  return {
    open,
    close,
    play,
    retry: (ticket: object) => {
      if (owns(ticket)) void open(state!.item, state!.origin);
    },
    resume: () => {
      consumed = false;
    },
    owns,
  };
}
