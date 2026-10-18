import { useEffect, useRef, useState } from "react";
import type { StalkerHomeMoviePreview } from "@/lib/stalkerHomeSummary";
import {
  readCurrentStalkerProductSession,
  type StalkerProductProviderIdentity,
} from "@/lib/stalkerProductSession";
import {
  isRegisteredStalkerPortalSession,
  subscribeStalkerPortalRuntime,
} from "@/lib/stalkerPortalRuntime";
import {
  createStalkerHomeMovieController,
  type HomeMoviePlayable,
  type HomeMovieState,
} from "@/lib/stalkerHomeMovie";
import { stalkerMovieInput } from "@/lib/tmdb/providerInput";
import { beginStalkerPlaybackTrace } from "@/lib/stalkerPlaybackTrace";

type Selection = {
  providerId: string;
  scope: string;
  state: HomeMovieState;
  controller: ReturnType<typeof createStalkerHomeMovieController>;
};
export function useStalkerHomeMovieInfo(options: {
  provider: StalkerProductProviderIdentity | null;
  previews: readonly StalkerHomeMoviePreview[];
  enabled: boolean;
  onPlayable: (movie: HomeMoviePlayable) => void;
  onError?: (message: string) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const active = useRef<Selection | null>(null);
  const generation = useRef(0);
  const [, setSessionRevision] = useState(0);
  const renderedGeneration = generation.current;
  const [selection, setSelection] = useState<Selection | null>(null);
  const cancel = () => {
    active.current?.controller.cancel();
    active.current = null;
    setSelection(null);
  };
  useEffect(
    () => () => {
      active.current?.controller.cancel();
      active.current = null;
    },
    [
      options.provider?.id,
      options.provider?.url,
      options.provider?.playlistUrl,
      options.provider?.mac,
    ],
  );
  useEffect(() => {
    if (!options.enabled) cancel();
  }, [options.enabled]);
  useEffect(
    () =>
      subscribeStalkerPortalRuntime((id) => {
        if (latest.current.provider?.id === id) {
          generation.current += 1;
          setSessionRevision((value) => value + 1);
          cancel();
        }
      }),
    [],
  );

  const select = (portalId: string) => {
    const now = latest.current;
    const preview = now.previews.find((item) => item.id === portalId);
    if (
      !now.enabled ||
      !options.enabled ||
      !now.provider ||
      now.provider !== options.provider ||
      generation.current !== renderedGeneration ||
      !preview
    )
      return;
    cancel();
    const provider = now.provider;
    let current;
    try {
      current = readCurrentStalkerProductSession(provider);
    } catch {
      now.onError?.(
        "Sağlayıcı oturumu açılamadı. Hesabı kontrol edip film kartını yeniden seçin.",
      );
      return;
    }
    const owner = { providerId: provider.id, scope: current.providerScopeId };
    const controller = createStalkerHomeMovieController({
      preview,
      session: current.session,
      isCurrent: () => {
        const next = latest.current;
        return (
          next.enabled &&
          next.provider?.id === provider.id &&
          next.provider.url === provider.url &&
          next.provider.playlistUrl === provider.playlistUrl &&
          next.provider.mac === provider.mac &&
          isRegisteredStalkerPortalSession(provider.id, current.session) &&
          active.current?.controller === controller
        );
      },
      onState: (state) => {
        if (active.current?.controller !== controller) return;
        if (state) {
          const next = { ...owner, state, controller };
          active.current = next;
          setSelection(next);
        } else {
          active.current = null;
          setSelection(null);
        }
      },
      onPlayable: (movie) => latest.current.onPlayable(movie),
      onPlaybackStart: () => {
        beginStalkerPlaybackTrace();
      },
    });
    active.current = {
      ...owner,
      state: { preview, busy: false, error: null },
      controller,
    };
    controller.open();
  };
  const visible =
    selection &&
    options.enabled &&
    selection.providerId === options.provider?.id &&
    selection.controller.isCurrent()
      ? selection
      : null;
  const preview = visible?.state.preview;
  return {
    state: visible?.state ?? null,
    input:
      preview && visible
        ? stalkerMovieInput(visible.providerId, visible.scope, {
            portalId: preview.id,
            title: preview.title,
            year: preview.year,
          })
        : null,
    local: preview
      ? {
          title: preview.title,
          poster: preview.image,
          genre: preview.category,
          rating: preview.rating,
        }
      : null,
    select,
    close: () => {
      if (visible && active.current?.controller === visible.controller)
        visible.controller.cancel();
    },
    play: () => {
      if (visible && active.current?.controller === visible.controller)
        void visible.controller.play();
    },
  };
}
