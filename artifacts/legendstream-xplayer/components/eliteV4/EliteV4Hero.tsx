import React, { useEffect, useMemo, useState } from "react";
import { ImageBackground, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import type { EliteHomeItem } from "@/lib/eliteV4HomeModel";
import { EliteV4FocusButton } from "./EliteV4FocusSurface";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";
import { useMovieInfoService } from "@/components/tmdb/MovieInfoServiceProvider";
import { MovieInfoModal } from "@/components/tmdb/MovieInfoModal";
import {
  beginMovieEnrichment,
  type MovieEnrichment,
} from "@/lib/tmdb/movieInfoService";
import {
  localXtreamMovie,
  movieInfoPresentation,
  pagedMovieInput,
} from "@/lib/tmdb/movieInfoModel";

export function EliteV4Hero({
  item,
  onOpen,
  providerId,
  providerType,
}: {
  item: EliteHomeItem | null;
  onOpen: (item: EliteHomeItem) => void;
  providerId: string;
  providerType: string;
}) {
  const service = useMovieInfoService();
  const [enrichment, setEnrichment] = useState<MovieEnrichment | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const supported = providerType === "xtream" || providerType === "m3u";
  const input = useMemo(
    () =>
      item?.movie && supported
        ? pagedMovieInput(providerId, providerType, "elite-v4-home", item.movie)
        : null,
    [item?.id, item?.movie, providerId, providerType, supported],
  );
  const local = item?.movie ? localXtreamMovie(item.movie) : null;
  useEffect(() => {
    setEnrichment(null);
    if (!input) return;
    return beginMovieEnrichment(service, input, setEnrichment);
  }, [input, service]);
  const tmdb =
    enrichment?.status === "enriched" ? enrichment.metadata : undefined;
  const presentation =
    input && local ? movieInfoPresentation(local, input, tmdb) : null;
  const background = presentation?.backdrop || item?.image;
  return (
    <View
      style={{
        height: 360,
        borderRadius: theme.radius.hero,
        overflow: "hidden",
        backgroundColor: theme.color.surfaceRaised,
        marginBottom: theme.spacing.xl,
      }}
    >
      {background ? (
        <ImageBackground
          source={{ uri: background }}
          resizeMode="cover"
          style={{ flex: 1, justifyContent: "flex-end" }}
        />
      ) : null}
      <LinearGradient
        colors={[
          "rgba(8,10,14,0.02)",
          "rgba(8,10,14,0.48)",
          "rgba(8,10,14,0.97)",
        ]}
        locations={[0, 0.48, 1]}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <View
        style={{
          position: "absolute",
          left: 34,
          right: 34,
          bottom: 30,
          alignItems: "flex-start",
        }}
      >
        <Text
          style={{
            color: theme.color.accent,
            fontSize: theme.type.eyebrow,
            fontWeight: "800",
            letterSpacing: 2,
            marginBottom: 12,
          }}
        >
          ÖNE ÇIKAN
        </Text>
        <Text
          numberOfLines={2}
          style={{
            color: theme.color.foreground,
            fontSize: theme.type.hero,
            fontWeight: "900",
            maxWidth: 760,
            letterSpacing: -1.4,
          }}
        >
          {presentation?.title || item?.title || "LegendStream"}
        </Text>
        <Text
          numberOfLines={2}
          style={{
            color: theme.color.muted,
            fontSize: theme.type.body,
            marginTop: 8,
            maxWidth: 650,
          }}
        >
          {presentation?.overview ||
            item?.subtitle ||
            "Kataloğunuz hazır olduğunda içerikler burada görünür."}
        </Text>
        {presentation &&
        (presentation.year ||
          presentation.rating !== undefined ||
          presentation.genre) ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
              marginTop: 11,
            }}
          >
            {presentation.year ? (
              <Text
                style={{
                  color: theme.color.foreground,
                  fontSize: 13,
                  fontWeight: "700",
                }}
              >
                {presentation.year}
              </Text>
            ) : null}
            {presentation.rating !== undefined ? (
              <Text
                style={{
                  color: theme.color.accent,
                  fontSize: 13,
                  fontWeight: "800",
                }}
              >
                ★ {presentation.rating.toFixed(1)}
              </Text>
            ) : null}
            {presentation.genre ? (
              <Text
                numberOfLines={1}
                style={{
                  color: theme.color.muted,
                  fontSize: 13,
                  maxWidth: 340,
                }}
              >
                {presentation.genre}
              </Text>
            ) : null}
            {presentation.enriched ? (
              <Text
                style={{
                  color: theme.color.accent,
                  fontSize: 11,
                  fontWeight: "900",
                  letterSpacing: 1,
                }}
              >
                TMDB
              </Text>
            ) : null}
          </View>
        ) : null}
        {item ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              marginTop: 20,
            }}
          >
            <EliteV4FocusButton
              focusId="hero"
              region="content"
              initial
              neighbors={{
                left: "sidebar-home",
                down: "rail-0",
                right: input ? "hero-info" : "rail-0",
              }}
              onPress={() => onOpen(item)}
              accessibilityLabel={`${item.title} oynat`}
              style={{
                marginTop: 0,
                minHeight: 50,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.foreground,
                borderWidth: 2,
                borderColor: "transparent",
                paddingHorizontal: 23,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <Feather name="play" size={17} color={theme.color.background} />
              <Text
                style={{
                  color: theme.color.background,
                  fontWeight: "900",
                  fontSize: 14,
                }}
              >
                Şimdi izle
              </Text>
            </EliteV4FocusButton>
            {input && local ? (
              <EliteV4FocusButton
                focusId="hero-info"
                region="content"
                neighbors={{ left: "hero", down: "rail-0", right: "rail-0" }}
                onPress={() => setShowInfo(true)}
                accessibilityLabel={`${item.title} TMDB bilgileri`}
                style={{
                  minHeight: 50,
                  borderRadius: theme.radius.pill,
                  borderWidth: 1,
                  borderColor: theme.color.border,
                  backgroundColor: theme.color.surfaceGlass,
                  paddingHorizontal: 20,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 9,
                }}
              >
                <Feather name="info" size={17} color={theme.color.foreground} />
                <Text
                  style={{
                    color: theme.color.foreground,
                    fontWeight: "800",
                    fontSize: 14,
                  }}
                >
                  Film bilgisi
                </Text>
              </EliteV4FocusButton>
            ) : null}
          </View>
        ) : null}
      </View>
      {showInfo && input && local ? (
        <MovieInfoModal
          input={input}
          local={local}
          onClose={() => setShowInfo(false)}
          onPlay={() => {
            setShowInfo(false);
            if (item) onOpen(item);
          }}
        />
      ) : null}
    </View>
  );
}
