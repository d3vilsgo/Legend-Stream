import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Text, View } from "react-native";
import { usePlayer } from "@/context/PlayerContext";
import { loadLibraryDetail, type LibraryTarget } from "@/lib/eliteV4Library";
import type { V4Movie } from "@/lib/eliteV4Movies";
import type { V4Series } from "@/lib/eliteV4Series";
import { MovieInfoModal } from "@/components/tmdb/MovieInfoModal";
import { createStalkerSeriesProductController } from "@/lib/stalkerSeriesProduct";
import { readCurrentStalkerProductSession } from "@/lib/stalkerProductSession";
import {
  EliteV4PagedSeriesDetail,
  EliteV4StalkerSeriesDetail,
  type V4SeriesPlayable,
} from "./EliteV4SeriesCatalog";
import { EliteV4FavoriteAction } from "./EliteV4FavoriteAction";
import {
  TVPreviewFocusRegion,
  TVPreviewPressable,
  useTVPreviewFocus,
} from "@/components/tvPreview/TVPreviewFocus";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";
export function EliteV4LibraryDetail({
  target,
  active,
  onClose,
  onMovie,
  onSeries,
}: {
  target: LibraryTarget;
  active: boolean;
  onClose: () => void;
  onMovie: (movie: V4Movie) => Promise<void>;
  onSeries: (value: V4SeriesPlayable) => void;
}) {
  const { provider } = usePlayer(),
    [item, setItem] = useState<V4Movie | V4Series | null>(null),
    [error, setError] = useState(false),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  const alive = useRef(true),
    latest = useRef({ target, active, provider });
  latest.current = { target, active, provider };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!provider) return;
    let current = true;
    const abort = new AbortController();
    setItem(null);
    setError(false);
    void loadLibraryDetail(provider, target, abort.signal)
      .then((value) => {
        if (current && !abort.signal.aborted) setItem(value);
      })
      .catch(() => {
        if (current && !abort.signal.aborted) setError(true);
      });
    return () => {
      current = false;
      abort.abort();
    };
  }, [provider, target, revision]);
  const controller = useMemo(() => {
    try {
      return provider?.type === "stalker" && target.kind === "series"
        ? createStalkerSeriesProductController(
            readCurrentStalkerProductSession({ ...provider, type: "stalker" })
              .session,
            provider.id,
          )
        : null;
    } catch {
      return null;
    }
  }, [provider, target.kind]);
  if (!provider || target.providerId !== provider.id) return null;
  if (!item)
    return active ? (
      <LibraryDetailPending
        error={error}
        onClose={onClose}
        onRetry={() => setRevision((v) => v + 1)}
      />
    ) : null;
  if (item.input.identity.kind === "series") {
    const props = {
      provider,
      item: item as V4Series,
      active,
      onBack: onClose,
      close: onClose,
      onPlayable: (value: V4SeriesPlayable) => {
        if (
          alive.current &&
          latest.current.active &&
          latest.current.provider?.id === value.providerId
        )
          onSeries(value);
      },
    };
    return controller ? (
      <EliteV4StalkerSeriesDetail {...props} controller={controller} />
    ) : (
      <EliteV4PagedSeriesDetail {...props} />
    );
  }
  if (!active) return null;
  return (
    <MovieInfoModal
      input={item.input}
      local={item.local}
      onClose={onClose}
      closeOnPlay={false}
      playback={{
        busy,
        error: error ? "İçerik açılamadı. Yeniden deneyin." : null,
      }}
      focusVisualStyle={{ borderWidth: 1, borderColor: theme.color.focus }}
      favoriteAction={
        <EliteV4FavoriteAction
          target={target}
          focusId="v4-library-detail-favorite"
          scope="movie-info"
        />
      }
      onPlay={() => {
        if (
          busy ||
          !latest.current.active ||
          latest.current.provider?.id !== target.providerId
        )
          return;
        setBusy(true);
        setError(false);
        void onMovie(item as V4Movie)
          .catch(() => {
            if (alive.current) setError(true);
          })
          .finally(() => {
            if (alive.current) setBusy(false);
          });
      }}
    />
  );
}

export function LibraryDetailPending({
  error,
  onClose,
  onRetry,
}: {
  error: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const focus = useTVPreviewFocus();
  useEffect(() => focus.pushFocusScope("library-info"), [focus.pushFocusScope]);
  useEffect(
    () => focus.registerBackAction(onClose),
    [focus.registerBackAction, onClose],
  );
  return (
    <Modal
      visible
      animationType="none"
      onRequestClose={onClose}
      onShow={() => {
        if (Platform.isTV) void focus.modalShown?.("library-info");
      }}
      accessibilityViewIsModal
    >
      <TVPreviewFocusRegion>
        <View
          style={{
            flex: 1,
            padding: 24,
            backgroundColor: theme.color.background,
            gap: 12,
          }}
        >
          {error ? (
            <Text
              accessibilityRole="alert"
              style={{ color: theme.color.danger }}
            >
              Kaynak artık kullanılamıyor veya sağlayıcıya erişilemiyor.
            </Text>
          ) : (
            <ActivityIndicator color={theme.color.accent} />
          )}
          {[
            { id: "back", label: "Kataloğa dön", press: onClose },
            ...(error
              ? [{ id: "retry", label: "Yeniden dene", press: onRetry }]
              : []),
          ].map((item) => (
            <TVPreviewPressable
              key={item.id}
              focusScope="library-info"
              focusId={`v4-library-detail-${item.id}`}
              eliteVisual
              focusVisualStyle={{
                borderWidth: 1,
                borderColor: theme.color.focus,
              }}
              onPress={item.press}
              style={{
                padding: 16,
                borderWidth: 1,
                borderColor: theme.color.border,
                borderRadius: 8,
              }}
            >
              <Text style={{ color: theme.color.foreground }}>
                {item.label}
              </Text>
            </TVPreviewPressable>
          ))}
        </View>
      </TVPreviewFocusRegion>
    </Modal>
  );
}
