import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  TVPreviewPressable,
  useTVPreviewFocus,
} from "@/components/tvPreview/TVPreviewFocus";
import { TVRemoteInspectorOverlay } from "@/components/tvPreview/TVRemoteInspector";
import { eliteTokens as t, eliteLayout } from "@/lib/design/eliteTokens";
import { matchCacheKey } from "@/lib/tmdb/cache";
import type { EnrichmentInput } from "@/lib/tmdb/contract";
import {
  movieInfoPresentation,
  type LocalMovieInfo,
} from "@/lib/tmdb/movieInfoModel";
import {
  beginMovieEnrichment,
  type MovieEnrichment,
  type MovieInfoService,
} from "@/lib/tmdb/movieInfoService";

import { useMovieInfoService } from "./MovieInfoServiceProvider";

/** Local IPTV data renders immediately. No fixture data, TMDB token or playback resolution here. */
export function MovieInfoModal({
  input,
  local,
  onClose,
  onPlay,
  service: injectedService,
  closeOnPlay = true,
  playback,
}: {
  input: EnrichmentInput;
  local: LocalMovieInfo;
  onClose: () => void;
  onPlay: () => void;
  service?: MovieInfoService;
  closeOnPlay?: boolean;
  playback?: { busy: boolean; error: string | null };
}) {
  const contextualService = useMovieInfoService();
  const service = injectedService ?? contextualService;
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const layout = eliteLayout(
    width,
    height,
    Platform.isTV ? "nativeTv" : "mobile",
    fontScale,
    insets,
  );
  const focus = useTVPreviewFocus();
  const [result, setResult] = useState<{
    key: string;
    value: MovieEnrichment;
  } | null>(null);
  const key = matchCacheKey(input);
  const state = result?.key === key ? result.value : null;
  const [backdropFailed, setBackdropFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  useEffect(() => {
    const pop = focus.pushFocusScope("movie-info");
    return pop;
  }, [focus.pushFocusScope]);
  useEffect(
    () => focus.registerBackAction(onClose),
    [focus.registerBackAction, onClose],
  );
  useEffect(() => {
    setResult(null);
    setBackdropFailed(false);
    setPosterFailed(false);
    return beginMovieEnrichment(service, input, (value) =>
      setResult({ key, value }),
    );
  }, [service, key]);
  const info = useMemo(
    () =>
      movieInfoPresentation(
        local,
        input,
        state?.status === "enriched" ? state.metadata : undefined,
      ),
    [local, input, state],
  );
  const text = { color: t.color.text, fontSize: Platform.isTV ? 20 : 16 };
  const muted = { color: t.color.muted, fontSize: Platform.isTV ? 18 : 14 };
  const infoRow = (label: string, value: string | undefined) =>
    value ? (
      <View style={s.field}>
        <Text style={muted}>{label}</Text>
        <Text selectable={!Platform.isTV} style={text}>
          {value}
        </Text>
      </View>
    ) : null;
  return (
    <Modal
      visible
      animationType="none"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={s.root}>
        {info.backdrop && !backdropFailed ? (
          <Image
            source={{ uri: info.backdrop }}
            style={[s.backdrop, { height: Math.min(400, height * 0.55) }]}
            resizeMode="cover"
            onError={() => setBackdropFailed(true)}
          />
        ) : null}
        <View pointerEvents="none" style={s.scrim} />
        <ScrollView
          contentContainerStyle={{
            paddingTop: layout.top,
            paddingBottom: layout.bottom,
            paddingLeft: layout.left,
            paddingRight: layout.right,
            gap: 20,
          }}
        >
          <TVPreviewPressable
            eliteVisual
            focusScope="movie-info"
            focusId="movie-info:back"
            hasTVPreferredFocus
            accessibilityRole="button"
            accessibilityLabel="Film bilgilerini kapat"
            onPress={onClose}
            style={s.control}
          >
            <Text style={text}>← Geri</Text>
          </TVPreviewPressable>
          <View style={[s.header, width < 720 && { flexDirection: "column" }]}>
            {info.poster && !posterFailed ? (
              <Image
                source={{ uri: info.poster }}
                style={{
                  width: width < 720 ? 130 : 180,
                  aspectRatio: 2 / 3,
                  borderRadius: 12,
                }}
                resizeMode="contain"
                onError={() => setPosterFailed(true)}
              />
            ) : null}
            <View
              style={[
                { minWidth: 0, gap: 14 },
                width < 720 ? { width: "100%" } : { flex: 1 },
              ]}
            >
              <Text
                accessibilityRole="header"
                selectable={!Platform.isTV}
                style={[
                  text,
                  { fontSize: Platform.isTV ? 36 : 28, fontWeight: "800" },
                ]}
              >
                {info.title}
              </Text>
              {info.originalTitle && info.originalTitle !== info.title ? (
                <Text style={muted}>{info.originalTitle}</Text>
              ) : null}
              <Text style={muted}>
                {[
                  info.year,
                  info.runtime ? `${info.runtime} dk` : null,
                  info.genre,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {info.rating !== undefined ? (
                <Text style={text}>TMDB · {info.rating.toFixed(1)} / 10</Text>
              ) : local.rating ? (
                <Text style={muted}>Sağlayıcı puanı · {local.rating}</Text>
              ) : null}
              <TVPreviewPressable
                eliteVisual
                focusScope="movie-info"
                focusId="movie-info:play"
                accessibilityRole="button"
                accessibilityLabel={
                  playback?.error
                    ? "Filmi tekrar başlatmayı dene"
                    : "IPTV kaynağından filmi izle"
                }
                disabled={playback?.busy}
                onPress={() => {
                  if (closeOnPlay) onClose();
                  onPlay();
                }}
                style={s.control}
              >
                <Text style={text}>
                  {playback?.busy
                    ? "Film hazırlanıyor…"
                    : playback?.error
                      ? "Tekrar dene"
                      : "▶ İzle"}
                </Text>
              </TVPreviewPressable>
              {playback?.error ? (
                <Text accessibilityRole="alert" style={text}>
                  {playback.error}
                </Text>
              ) : null}
              <Text style={muted}>
                {state === null
                  ? "Film bilgileri yükleniyor…"
                  : info.enriched
                    ? "Film bilgileri · TMDB"
                    : "IPTV bilgileri gösteriliyor. Ek film bilgisi şu anda kullanılamıyor."}
              </Text>
            </View>
          </View>
          {infoRow("Özet", info.overview ?? "Özet bilgisi bulunmuyor.")}
          {infoRow("Oyuncular", info.cast)}
          {infoRow("Yönetmen", info.director)}
          {info.enriched ? (
            <View style={s.field}>
              <Text style={muted}>
                Benzer içerikler, IPTV kataloğuyla eşleştirildiğinde
                gösterilecek.
              </Text>
              <Text style={muted}>
                This product uses the TMDB API but is not endorsed or certified
                by TMDB.
              </Text>
              <TVPreviewPressable
                eliteVisual
                focusScope="movie-info"
                focusId="movie-info:attribution"
                accessibilityRole="link"
                accessibilityLabel="TMDB hakkında"
                onPress={() => {
                  void Linking.openURL("https://www.themoviedb.org").catch(
                    () => undefined,
                  );
                }}
                style={s.control}
              >
                <Text style={text}>TMDB hakkında</Text>
              </TVPreviewPressable>
            </View>
          ) : null}
        </ScrollView>
        <TVRemoteInspectorOverlay />
      </View>
    </Modal>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.color.canvas },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, opacity: 0.4 },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(9,12,16,0.72)",
  },
  header: { flexDirection: "row", gap: 24, alignItems: "flex-start" },
  control: {
    alignSelf: "flex-start",
    minHeight: 64,
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "transparent",
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: t.color.surface,
  },
  field: {
    padding: 18,
    gap: 8,
    borderRadius: 12,
    backgroundColor: "rgba(9,12,16,0.94)",
  },
});
