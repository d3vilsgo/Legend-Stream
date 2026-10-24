import { useEffect, useMemo, useRef, useState } from "react";
import type { ProviderConfig } from "@/context/PlayerContext";
import {
  createPagedSeriesFlow,
  type PagedSeriesState,
  type SeriesOrigin,
} from "@/lib/pagedSeriesFlow";
import {
  getSeriesInfo,
  registerLocalEpisodeQueue,
  type XtreamSeriesItem,
} from "@/lib/xtreamCatalog";
import { loadM3USeriesInfoFromCache } from "@/lib/catalogPageRepository";
import { resolveCatalogPlaybackSource } from "@/lib/catalogRuntime";
import { beginPlaybackAttempt } from "@/lib/performanceDiagnostics";
import { pagedSeriesDetail } from "@/lib/seriesInfo";
export function usePagedSeriesInfo(options: {
  provider: ProviderConfig | null;
  enabled: boolean;
  playing: boolean;
  onPlayable: Parameters<typeof createPagedSeriesFlow>[0]["onPlayable"];
  recover?: (error: unknown) => Promise<boolean>;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [state, setState] = useState<PagedSeriesState | null>(null);
  const currentController = useRef<ReturnType<
    typeof createPagedSeriesFlow
  > | null>(null);
  const controller = useMemo(() => {
    const provider = options.provider;
    if (!provider || (provider.type !== "xtream" && provider.type !== "m3u"))
      return null;
    const result = createPagedSeriesFlow({
      provider: provider.type,
      isCurrent: () =>
        latest.current.provider === provider &&
        latest.current.enabled &&
        currentController.current === result,
      load: (item, signal) =>
        provider.type === "m3u"
          ? loadM3USeriesInfoFromCache(provider, item.series_id)
          : getSeriesInfo(
              {
                baseUrl: provider.url || provider.playlistUrl,
                username: provider.username || "",
                password: provider.password || "",
              },
              item.series_id,
              signal,
            ),
      recover: (error) =>
        latest.current.recover?.(error) ?? Promise.resolve(false),
      register: (info) => {
        if (provider.type === "m3u") registerLocalEpisodeQueue(info);
      },
      resolve: async (episode, signal) =>
        (
          await resolveCatalogPlaybackSource(
            { kind: "episode", item: episode },
            provider,
            signal,
          )
        ).url,
      onState: (next) => {
        if (currentController.current === result) setState(next);
      },
      onPlayable: (next) => latest.current.onPlayable(next),
      onPlaybackStart: () => {
        beginPlaybackAttempt(provider.type as "xtream" | "m3u");
      },
    });
    return result;
  }, [options.provider]);
  currentController.current = controller;
  useEffect(() => () => controller?.close(), [controller]);
  useEffect(() => {
    if (!options.enabled) controller?.close();
  }, [controller, options.enabled]);
  useEffect(() => {
    if (!options.playing) controller?.resume();
  }, [controller, options.playing]);
  const visible = state && controller?.owns(state.ticket) ? state : null;
  const bound = controller,
    ticket = visible?.ticket;
  return {
    state: visible,
    model:
      visible && options.provider
        ? pagedSeriesDetail(
            options.provider.id,
            options.provider.type as "m3u" | "xtream",
            visible.item,
            visible.info,
          )
        : null,
    open: (item: XtreamSeriesItem, origin: SeriesOrigin) => {
      if (latest.current.provider === options.provider && options.enabled)
        void bound?.open(item, origin);
    },
    close: () => {
      if (ticket) bound?.close(ticket);
    },
    retry: () => {
      if (ticket) bound?.retry(ticket);
    },
    play: (seasonId: string, episodeId: string) => {
      if (ticket) void bound?.play(ticket, seasonId, episodeId);
    },
  };
}
