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
  const insets = useSafeAreaInsets(),
    focus = useTVPreviewFocus();
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
  const list = useRef<FlatList<GoldenSeriesEpisodeModel>>(null),
    offset = useRef(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [detail.image]);
  useEffect(() => {
    setSelectedSeasonId(initialGoldenSeriesSeasonId(orderedSeasons));
    setSelectedEpisodeId(null);
    offset.current = 0;
    setImageFailed(false);
  }, [detail.id]);
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
    list.current?.scrollToOffset({ offset: offset.current, animated: false });
    if (visible && focus.enabled && selectedEpisodeId)
      requestAnimationFrame(() => {
        if (visibleRef.current)
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
      {detail.image && !imageFailed ? (
        <Image
          source={{ uri: detail.image }}
          onError={() => setImageFailed(true)}
          style={{ width: 120, aspectRatio: 2 / 3, borderRadius: 12 }}
          resizeMode="contain"
        />
      ) : null}
      <Text
        accessibilityRole="header"
        style={[text, { fontSize: Platform.isTV ? 34 : 26, fontWeight: "800" }]}
      >
        {detail.title}
      </Text>
      {detail.genre ? <Text style={text}>{detail.genre}</Text> : null}
      {detail.description ? (
        <Text style={text}>{detail.description}</Text>
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
      <FlatList
        horizontal
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
            accessibilityState={{ selected: season.id === selectedSeasonId }}
            onPress={() => {
              if (busy) return;
              offset.current = 0;
              setSelectedSeasonId(season.id);
              setSelectedEpisodeId(null);
            }}
            style={[
              control,
              {
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
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
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
          scrollEventThrottle={32}
          onContentSizeChange={restore}
          renderItem={({ item: episode }) => {
            const progress = episode.progressRef
              ? entries.find(
                  (entry) =>
                    entry.providerId === providerId &&
                    samePlaybackRef(entry.playbackRef, episode.progressRef!),
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
        <TVRemoteInspectorOverlay />
      </View>
    </Modal>
  );
}
