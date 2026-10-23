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
import { eliteTokens as legacyTokens } from "@/lib/design/eliteTokens";
import { useMovieInfoService } from "@/components/tmdb/MovieInfoServiceProvider";
import {
  beginMovieEnrichment,
  type MovieEnrichment,
} from "@/lib/tmdb/movieInfoService";
import { tmdbImageUrl } from "@/lib/tmdb/metadata";
import { eliteV4Theme } from "@/lib/design/eliteV4Theme";
import type { EnrichmentInput } from "@/lib/tmdb/contract";
import { fetchTmdbSeason } from "@/lib/tmdb/directTransport";
import { enrichV4ProviderEpisodes } from "@/lib/eliteV4Series";
import { inferredYear } from "@/lib/tmdb/matcher";

const v4Selections = new Map<
  string,
  { season: string | null; episode: string | null; offset: number }
>();
/** Shared provider-owned hierarchy; optional V4 metadata never resolves playback. */
export function SeriesInfoModal({
  providerId,
  variant,
  metadataInput: suppliedMetadataInput,
  detail,
  loading,
  error,
  busy = false,
  visible = true,
  onClose,
  onRetry,
  onEpisode,
}: {
  variant?: "eliteV4";
  metadataInput?: EnrichmentInput;
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
  const v4 = variant === "eliteV4";
  const tokens = v4
    ? {
        ...legacyTokens,
        color: {
          ...legacyTokens.color,
          canvas: eliteV4Theme.color.background,
          surface: eliteV4Theme.color.surface,
          text: eliteV4Theme.color.foreground,
          accent: eliteV4Theme.color.accent,
          selected: eliteV4Theme.color.accentSoft,
        },
      }
    : legacyTokens;
  const focusVisualStyle = v4
    ? {
        borderWidth: 1,
        borderColor: eliteV4Theme.color.focus,
        shadowColor: eliteV4Theme.color.focus,
        shadowRadius: 8,
        shadowOpacity: 0.28,
      }
    : undefined;
  const { t } = useI18n();
  const metadataService = useMovieInfoService();
  const metadataInput = useMemo(
    () =>
      suppliedMetadataInput ?? {
        identity: {
          providerId,
          provider: "xtream" as const,
          kind: "series" as const,
          catalogId: detail.id,
        },
        catalogRevision: detail.id,
        title: detail.title,
        year: detail.year ?? inferredYear(detail.title),
      },
    [suppliedMetadataInput, providerId, detail.id, detail.title, detail.year],
  );
  const [metadata, setMetadata] = React.useState<MovieEnrichment | null>(null);
  useEffect(() => {
    setMetadata(null);
    return beginMovieEnrichment(metadataService, metadataInput, setMetadata);
  }, [metadataService, metadataInput]);
  const tmdb =
    metadata?.status === "enriched" && metadata.metadata.kind === "series"
      ? metadata.metadata
      : undefined;
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
  const actionOwner = useRef({
    providerId,
    id: detail.id,
    season: selectedSeasonId,
    visible,
    busy,
  });
  actionOwner.current = {
    providerId,
    id: detail.id,
    season: selectedSeasonId,
    visible,
    busy,
  };
  const episodeLock = useRef(false);
  useEffect(() => {
    if (!busy) episodeLock.current = false;
  }, [busy, visible]);
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
  const remembered = useRef({
    season: selectedSeasonId,
    episode: selectedEpisodeId,
    offset: 0,
  });
  remembered.current = {
    season: selectedSeasonId,
    episode: selectedEpisodeId,
    offset: offset.current,
  };
  useEffect(
    () => () => {
      if (!v4) return;
      const key = JSON.stringify([providerId, detail.id]);
      v4Selections.delete(key);
      v4Selections.set(key, { ...remembered.current, offset: offset.current });
      if (v4Selections.size > 48)
        v4Selections.delete(v4Selections.keys().next().value!);
    },
    [v4, providerId, detail.id],
  );
  const seasonNumber =
    selectedSeason?.seasonNumber ??
    (selectedSeason && /^\d+$/.test(selectedSeason.id)
      ? Number(selectedSeason.id)
      : undefined);
  const seasonKey = JSON.stringify([
    providerId,
    detail.id,
    tmdb?.id,
    seasonNumber,
  ]);
  const [seasonMetadata, setSeasonMetadata] = useState<{
    key: string;
    value: Awaited<ReturnType<typeof fetchTmdbSeason>>;
  } | null>(null);
  useEffect(() => {
    const token = process.env.EXPO_PUBLIC_TMDB_API_TOKEN;
    if (!v4 || !visible || !token || !tmdb || seasonNumber === undefined)
      return;
    let alive = true;
    void fetchTmdbSeason(token, tmdb.id, seasonNumber, "tr-TR")
      .then((value) => {
        if (alive && value.season === seasonNumber)
          setSeasonMetadata({ key: seasonKey, value });
      })
      .catch(() => {
        /* Provider episodes remain authoritative. */
      });
    return () => {
      alive = false;
    };
  }, [v4, visible, seasonKey]);
  const visibleEpisodes =
    v4 && seasonMetadata?.key === seasonKey
      ? enrichV4ProviderEpisodes(
          selectedSeason?.episodes ?? [],
          seasonMetadata.value.episodes,
        )
      : (selectedSeason?.episodes ?? []);
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
    if (v4) {
      const saved = v4Selections.get(JSON.stringify([providerId, detail.id]));
      if (saved) {
        setSelectedSeasonId(saved.season);
        setSelectedEpisodeId(saved.episode);
        offset.current = saved.offset;
      }
    } else offset.current = 0;
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
    minHeight: v4 ? 48 : 60,
    padding: v4 ? 12 : 14,
    borderWidth: v4 ? 1 : 4,
    borderColor: "transparent",
    borderRadius: 12,
    backgroundColor: tokens.color.surface,
  };
  const text = {
    color: tokens.color.text,
    fontSize: Platform.isTV ? (v4 ? 18 : 22) : 16,
  };
  const header = (
    <View
      style={{
        gap: v4 ? 8 : 14,
        paddingBottom: 20,
        paddingRight: v4 && (detail.image || tmdb?.posterPath) ? 104 : 0,
      }}
    >
      <TVPreviewPressable
        eliteVisual
        focusVisualStyle={focusVisualStyle}
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
          style={
            v4
              ? {
                  position: "absolute",
                  right: 0,
                  top: 60,
                  width: 88,
                  aspectRatio: 2 / 3,
                  borderRadius: 8,
                }
              : { width: 120, aspectRatio: 2 / 3, borderRadius: 12 }
          }
          resizeMode="contain"
        />
      ) : null}
      <Text
        accessibilityRole="header"
        style={[
          text,
          { fontSize: Platform.isTV ? (v4 ? 28 : 34) : 26, fontWeight: "800" },
        ]}
      >
        {detail.title || tmdb?.title}
      </Text>
      {detail.genre || tmdb?.genres?.length ? (
        <Text style={text}>
          {detail.genre || tmdb?.genres.map((g) => g.name).join(" · ")}
        </Text>
      ) : null}
      {detail.description || tmdb?.overview ? (
        <Text numberOfLines={v4 ? 3 : undefined} style={text}>
          {detail.description || tmdb?.overview}
        </Text>
      ) : null}
      {v4 &&
      (detail.year || (tmdb?.voteAverage === undefined && detail.rating)) ? (
        <Text style={text}>
          {[
            detail.year,
            tmdb?.voteAverage === undefined && detail.rating
              ? `Sağlayıcı puanı · ${detail.rating}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
      {tmdb?.voteAverage !== undefined ? (
        <Text style={text}>
          TMDB · {tmdb.voteAverage.toFixed(1)} / 10
          {tmdb.year ? ` · ${tmdb.year}` : ""}
        </Text>
      ) : null}
      {!v4 && tmdb?.cast.length ? (
        <Text style={text}>
          Oyuncular ·{" "}
          {tmdb.cast
            .slice(0, 8)
            .map((p) => p.name)
            .join(", ")}
        </Text>
      ) : null}
      {!v4 && tmdb?.directors.length ? (
        <Text style={text}>
          Yapım ekibi · {tmdb.directors.map((p) => p.name).join(", ")}
        </Text>
      ) : null}
      {!v4 && tmdb?.seasons.length ? (
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
              focusVisualStyle={focusVisualStyle}
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
        <Text style={text}>
          {v4 && suppliedMetadataInput?.identity.provider === "m3u"
            ? "Playlist bu dizi için kullanılabilir sezon/bölüm hiyerarşisi sunmuyor."
            : v4 && suppliedMetadataInput?.identity.provider === "stalker"
              ? "Portal kullanılabilir sezon/bölüm hiyerarşisi sunmuyor."
              : t("noEpisodes")}
        </Text>
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
              renderItem={({ item: season, index }) => (
                <TVPreviewPressable
                  eliteVisual
                  focusVisualStyle={focusVisualStyle}
                  focusScope="series-info"
                  focusId={`series-info:${detail.id}:season:${season.id}`}
                  onFocus={
                    v4
                      ? () =>
                          seasonStrip.current?.scrollToIndex({
                            index,
                            viewPosition: 0.5,
                            animated: false,
                          })
                      : undefined
                  }
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: season.id === selectedSeasonId,
                  }}
                  onPress={() => {
                    if (
                      busy ||
                      (v4 &&
                        (!actionOwner.current.visible || episodeLock.current))
                    )
                      return;
                    actionOwner.current.season = season.id;
                    episodeLock.current = false;
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
              onScrollToIndexFailed={
                v4
                  ? (info) =>
                      list.current?.scrollToOffset({
                        offset: info.averageItemLength * info.index,
                        animated: false,
                      })
                  : undefined
              }
              renderItem={({ item: providerEpisode, index }) => {
                const episode = v4
                  ? (visibleEpisodes.find((e) => e.id === providerEpisode.id) ??
                    providerEpisode)
                  : providerEpisode;
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
                    focusVisualStyle={focusVisualStyle}
                    focusScope="series-info"
                    focusId={`series-info:${detail.id}:episode:${selectedSeason!.id}:${episode.id}`}
                    onFocus={
                      v4
                        ? () =>
                            list.current?.scrollToIndex({
                              index,
                              viewPosition: 0.5,
                              animated: false,
                            })
                        : undefined
                    }
                    hasTVPreferredFocus={selectedEpisodeId === episode.id}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: selectedEpisodeId === episode.id,
                      disabled: busy,
                    }}
                    onPress={() => {
                      if (
                        busy ||
                        (v4 &&
                          (episodeLock.current ||
                            !actionOwner.current.visible ||
                            actionOwner.current.id !== detail.id ||
                            actionOwner.current.providerId !== providerId ||
                            actionOwner.current.season !== selectedSeason!.id))
                      )
                        return;
                      if (v4) episodeLock.current = true;
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
                    {v4 && episode.image ? (
                      <Image
                        source={{ uri: episode.image }}
                        style={{
                          width: 112,
                          aspectRatio: 16 / 9,
                          borderRadius: 6,
                          marginBottom: 8,
                        }}
                        resizeMode="cover"
                      />
                    ) : null}
                    <Text numberOfLines={v4 ? 2 : undefined} style={text}>
                      {v4 && episode.episodeNumber !== undefined
                        ? `${episode.episodeNumber}. `
                        : ""}
                      {episode.title}
                    </Text>
                    {episode.description ? (
                      <Text numberOfLines={v4 ? 2 : undefined} style={text}>
                        {episode.description}
                      </Text>
                    ) : null}
                    {episode.duration ? (
                      <Text style={text}>{episode.duration}</Text>
                    ) : null}
                    {progress ? (
                      <Text style={text}>
                        {v4 &&
                        progress.position > 0 &&
                        (!progress.duration ||
                          progress.position < progress.duration * 0.95)
                          ? "Devam et · "
                          : "İzlenen: "}
                        {Math.floor(progress.position / 60)} dk
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
