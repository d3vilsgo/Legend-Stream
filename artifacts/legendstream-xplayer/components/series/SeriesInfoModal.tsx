import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  TVPreviewPressable,
  TVPreviewFocusRegion,
  TVPreviewControls,
  useTVPreviewFocus,
} from "@/components/tvPreview/TVPreviewFocus";
import { TVRemoteInspectorOverlay } from "@/components/tvPreview/TVRemoteInspector";
import { useMediaLibrary } from "@/context/MediaLibraryContext";
import { samePlaybackRef } from "@/lib/mediaProgress";
import {
  orderGoldenSeriesSeasons,
  initialGoldenSeriesSeasonId,
  selectedGoldenSeriesSeason,
  type GoldenSeriesDetailModel,
  type GoldenSeriesEpisodeModel,
} from "@/lib/goldenSeriesDetail";
import { useI18n } from "@/context/I18nContext";
import { eliteTokens as tokens } from "@/lib/design/eliteTokens";
import { useMovieInfoService } from "@/components/tmdb/MovieInfoServiceProvider";
import {
  beginMovieEnrichment,
  type MovieEnrichment,
} from "@/lib/tmdb/movieInfoService";
import { tmdbImageUrl } from "@/lib/tmdb/metadata";
import { inferredYear } from "@/lib/tmdb/matcher";

/** Shared Golden detail presentation. No provider/metadata requests or playback resolution. */
export function SeriesInfoModal({
  providerId,
  detail,
  loading,
  error,
  busy = false,
  visible = true,
  onClose,
  onRetry,
  onEpisode,
}: {
  providerId: string;
  detail: GoldenSeriesDetailModel;
  loading: boolean;
  error?: string | null;
  busy?: boolean;
  visible?: boolean;
  onClose: () => void;
  onRetry?: () => void;
  onEpisode: (seasonId: string, episodeId: string) => void;
}) {
  const { t } = useI18n();
  const metadataService = useMovieInfoService();
  const metadataInput = useMemo(
    () => ({
      identity: {
        providerId,
        provider: "xtream" as const,
        kind: "series" as const,
        catalogId: detail.id,
      },
      catalogRevision: detail.id,
      title: detail.title,
      year: detail.year ?? inferredYear(detail.title),
    }),
    [providerId, detail.id, detail.title, detail.year],
  );
  const [metadata, setMetadata] = React.useState<MovieEnrichment | null>(null);
  useEffect(() => {
    setMetadata(null);
    return beginMovieEnrichment(metadataService, metadataInput, setMetadata);
  }, [metadataService, metadataInput]);
  const tmdb = metadata?.status === "enriched" ? metadata.metadata : undefined;
  const insets = useSafeAreaInsets(),
    focus = useTVPreviewFocus();
  const [dialogShown, setDialogShown] = useState(false);
  useEffect(() => {
    if (!visible) setDialogShown(false);
  }, [visible]);
  useEffect(() => {
    if (Platform.isTV && dialogShown && focus.nativeScope === "series-info")
      void focus.modalShown?.("series-info");
  }, [dialogShown, focus.nativeScope, focus.modalShown]);
  const { entries } = useMediaLibrary();
  const orderedSeasons = useMemo(
    () => orderGoldenSeriesSeasons(detail?.seasons ?? []),
    [detail],
  );
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(
    null,
  );
  const selectedSeason = selectedGoldenSeriesSeason(
    orderedSeasons,
    selectedSeasonId,
  );
  const seasonStrip = useRef<FlatList<(typeof orderedSeasons)[number]>>(null);
  const revealSeason = () => {
    const index = orderedSeasons.findIndex(
      (season) => season.id === selectedSeasonId,
    );
    if (index >= 0)
      seasonStrip.current?.scrollToIndex({
        index,
        viewPosition: 0.5,
        animated: false,
      });
  };
  useEffect(() => {
    if (visible) revealSeason();
  }, [visible, selectedSeasonId, orderedSeasons.length]);
  const list = useRef<FlatList<GoldenSeriesEpisodeModel>>(null),
    offset = useRef(0);
  const restoreContext = JSON.stringify([
    providerId,
    detail.id,
    selectedSeasonId,
    selectedEpisodeId,
    visible,
  ]);
  const currentRestoreContext = useRef(restoreContext);
  currentRestoreContext.current = restoreContext;
  const restorePending = useRef(true);
  const restoreRevision = useRef(0);
  useEffect(() => {
    restorePending.current = visible;
    restoreRevision.current += 1;
    return () => {
      restorePending.current = false;
      restoreRevision.current += 1;
    };
  }, [visible, providerId, detail.id, selectedSeasonId]);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [detail.image, tmdb?.posterPath]);
  useEffect(() => {
    setSelectedSeasonId(initialGoldenSeriesSeasonId(orderedSeasons));
    setSelectedEpisodeId(null);
    offset.current = 0;
    setImageFailed(false);
  }, [providerId, detail.id]);
  useEffect(() => {
    if (selectedSeasonId === null && orderedSeasons.length === 1)
      setSelectedSeasonId(orderedSeasons[0]!.id);
  }, [detail.id, orderedSeasons.length]);
  useEffect(() => {
    if (!visible) return;
    return focus.pushFocusScope("series-info");
  }, [visible, focus.pushFocusScope]);
  useEffect(() => {
    if (!visible) return;
    return focus.registerBackAction(onClose);
  }, [visible, focus.registerBackAction, onClose]);
  const restore = () => {
    if (
      !visible ||
      !restorePending.current ||
      !list.current ||
      currentRestoreContext.current !== restoreContext
    )
      return;
    restorePending.current = false;
    const episodeExists = selectedSeason?.episodes.some(
      (episode) => episode.id === selectedEpisodeId,
    );
    // Scroll first, then let the existing Preview owner validate the mounted target.
    list.current.scrollToOffset({
      offset: !selectedEpisodeId || episodeExists ? offset.current : 0,
      animated: false,
    });
    const ticket = ++restoreRevision.current;
    const focusAtReturn = focus.getFocusedEntry?.()?.id;
    if (focus.enabled && selectedEpisodeId && episodeExists)
      requestAnimationFrame(() => {
        if (
          ticket === restoreRevision.current &&
          currentRestoreContext.current === restoreContext &&
          focus.getFocusedEntry?.()?.id === focusAtReturn
        )
          void focus.restoreFocus(
            `series-info:${detail.id}:episode:${selectedSeasonId}:${selectedEpisodeId}`,
          );
      });
  };
  const control = {
    minHeight: 60,
    padding: 14,
    borderWidth: 4,
    borderColor: "transparent",
    borderRadius: 12,
    backgroundColor: tokens.color.surface,
  };
  const text = { color: tokens.color.text, fontSize: Platform.isTV ? 22 : 16 };
  const header = (
    <View style={{ gap: 14, paddingBottom: 20 }}>
      <TVPreviewPressable
        eliteVisual
        focusScope="series-info"
        focusId={`series-info:${detail.id}:back`}
        hasTVPreferredFocus={!selectedEpisodeId}
        onPress={onClose}
        accessibilityRole="button"
        style={control}
      >
        <Text style={text}>← {t("back")}</Text>
      </TVPreviewPressable>
      {(detail.image || tmdb?.posterPath) && !imageFailed ? (
        <Image
          source={{
            uri:
              detail.image ||
              tmdbImageUrl(tmdb?.posterPath, "w342") ||
              undefined,
          }}
          onError={() => setImageFailed(true)}
          style={{ width: 120, aspectRatio: 2 / 3, borderRadius: 12 }}
          resizeMode="contain"
        />
      ) : null}
      <Text
        accessibilityRole="header"
        style={[text, { fontSize: Platform.isTV ? 34 : 26, fontWeight: "800" }]}
      >
        {detail.title || tmdb?.title}
      </Text>
      {detail.genre || tmdb?.genres?.length ? (
        <Text style={text}>
          {detail.genre || tmdb?.genres.map((g) => g.name).join(" · ")}
        </Text>
      ) : null}
      {detail.description || tmdb?.overview ? (
        <Text style={text}>{detail.description || tmdb?.overview}</Text>
      ) : null}
      {tmdb?.voteAverage !== undefined ? (
        <Text style={text}>
          TMDB · {tmdb.voteAverage.toFixed(1)} / 10
          {tmdb.year ? ` · ${tmdb.year}` : ""}
        </Text>
      ) : null}
      {tmdb?.cast.length ? (
        <Text style={text}>
          Oyuncular ·{" "}
          {tmdb.cast
            .slice(0, 8)
            .map((p) => p.name)
            .join(", ")}
        </Text>
      ) : null}
      {tmdb?.directors.length ? (
        <Text style={text}>
          Yapım ekibi · {tmdb.directors.map((p) => p.name).join(", ")}
        </Text>
      ) : null}
      {tmdb?.seasons.length ? (
        <Text style={text}>
          TMDB sezonları ·{" "}
          {tmdb.seasons
            .map(
              (s) =>
                `S${s.number}${s.episodeCount ? ` (${s.episodeCount} bölüm)` : ""}`,
            )
            .join(" · ")}
        </Text>
      ) : null}
      {error ? (
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="alert" style={text}>
            {error}
          </Text>
          {onRetry ? (
            <TVPreviewPressable
              eliteVisual
              focusScope="series-info"
              focusId={`series-info:${detail.id}:retry`}
              disabled={busy || loading}
              onPress={onRetry}
              style={control}
            >
              <Text style={text}>Tekrar dene</Text>
            </TVPreviewPressable>
          ) : null}
        </View>
      ) : null}
      {loading ? (
        <ActivityIndicator
          accessibilityLabel="Dizi bilgisi yükleniyor"
          color={tokens.color.accent}
        />
      ) : null}
      {!loading && !orderedSeasons.length ? (
        <Text style={text}>{t("noEpisodes")}</Text>
      ) : null}
      {!loading && orderedSeasons.length > 0 && !selectedSeason ? (
        <Text style={text}>{t("selectSeason")}</Text>
      ) : null}
      {busy ? <Text style={text}>Bölüm hazırlanıyor…</Text> : null}
    </View>
  );
  return (
    <Modal
      visible={visible}
      animationType="none"
      onShow={() => {
        setDialogShown(true);
        if (Platform.isTV) void focus.modalShown?.("series-info");
        revealSeason();
        restore();
      }}
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={{ flex: 1 }}>
        <TVPreviewFocusRegion>
          <View
            style={{
              flex: 1,
              backgroundColor: tokens.color.canvas,
              paddingTop: Math.max(insets.top, 24),
              paddingHorizontal: Math.max(insets.left, insets.right, 24),
              paddingBottom: Math.max(insets.bottom, 24),
            }}
          >
            <FlatList
              ref={seasonStrip}
              horizontal
              style={{ flexGrow: 0, flexShrink: 0 }}
              onLayout={revealSeason}
              onContentSizeChange={revealSeason}
              getItemLayout={(_, index) => ({
                length: 180,
                offset: 180 * index,
                index,
              })}
              data={orderedSeasons}
              keyExtractor={(season) => season.id}
              extraData={selectedSeasonId}
              initialNumToRender={8}
              maxToRenderPerBatch={8}
              windowSize={5}
              showsHorizontalScrollIndicator={false}
              renderItem={({ item: season }) => (
                <TVPreviewPressable
                  eliteVisual
                  focusScope="series-info"
                  focusId={`series-info:${detail.id}:season:${season.id}`}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: season.id === selectedSeasonId,
                  }}
                  onPress={() => {
                    if (busy) return;
                    restoreRevision.current += 1;
                    restorePending.current = true;
                    offset.current = 0;
                    setSelectedSeasonId(season.id);
                    setSelectedEpisodeId(null);
                  }}
                  style={[
                    control,
                    {
                      width: 170,
                      marginRight: 10,
                      backgroundColor:
                        season.id === selectedSeasonId
                          ? tokens.color.accent
                          : tokens.color.surface,
                    },
                  ]}
                >
                  <Text
                    style={[
                      text,
                      season.id === selectedSeasonId && {
                        color: tokens.color.canvas,
                      },
                    ]}
                  >
                    {season.label}
                  </Text>
                </TVPreviewPressable>
              )}
            />
            <FlatList
              ref={list}
              data={selectedSeason?.episodes ?? []}
              keyExtractor={(episode) => episode.id}
              ListHeaderComponent={header}
              ListEmptyComponent={
                !loading && selectedSeason ? (
                  <Text style={text}>{t("seasonHasNoEpisodes")}</Text>
                ) : null
              }
              onScroll={(event) => {
                offset.current = event.nativeEvent.contentOffset.y;
              }}
              onScrollBeginDrag={() => {
                restorePending.current = false;
                restoreRevision.current += 1;
              }}
              scrollEventThrottle={32}
              onContentSizeChange={restore}
              renderItem={({ item: episode }) => {
                const progress = episode.progressRef
                  ? entries.find(
                      (entry) =>
                        entry.providerId === providerId &&
                        samePlaybackRef(
                          entry.playbackRef,
                          episode.progressRef!,
                        ),
                    )
                  : undefined;
                return (
                  <TVPreviewPressable
                    eliteVisual
                    focusScope="series-info"
                    focusId={`series-info:${detail.id}:episode:${selectedSeason!.id}:${episode.id}`}
                    hasTVPreferredFocus={selectedEpisodeId === episode.id}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: selectedEpisodeId === episode.id,
                      disabled: busy,
                    }}
                    onPress={() => {
                      if (busy) return;
                      setSelectedEpisodeId(episode.id);
                      onEpisode(selectedSeason!.id, episode.id);
                    }}
                    style={[
                      control,
                      {
                        marginBottom: 10,
                        backgroundColor:
                          selectedEpisodeId === episode.id
                            ? tokens.color.selected
                            : tokens.color.surface,
                      },
                    ]}
                  >
                    <Text style={text}>{episode.title}</Text>
                    {episode.description ? (
                      <Text style={text}>{episode.description}</Text>
                    ) : null}
                    {episode.duration ? (
                      <Text style={text}>{episode.duration}</Text>
                    ) : null}
                    {progress ? (
                      <Text style={text}>
                        İzlenen: {Math.floor(progress.position / 60)} dk
                        {progress.duration > 0
                          ? ` / ${Math.floor(progress.duration / 60)} dk`
                          : ""}
                      </Text>
                    ) : null}
                  </TVPreviewPressable>
                );
              }}
              initialNumToRender={8}
              maxToRenderPerBatch={10}
              windowSize={7}
              removeClippedSubviews={!Platform.isTV && Platform.OS !== "web"}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            />
          </View>
        </TVPreviewFocusRegion>
        <TVPreviewControls />
        <TVRemoteInspectorOverlay />
      </View>
    </Modal>
  );
}
