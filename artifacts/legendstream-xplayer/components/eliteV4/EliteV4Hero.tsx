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
  height,
  width,
  firstRailFocusId,
  onFocused,
}: {
  item: EliteHomeItem | null;
  onOpen: (item: EliteHomeItem) => void;
  providerId: string;
  providerType: string;
  height: number;
  width: number;
  firstRailFocusId?: string;
  onFocused?: () => void;
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
  const actionLabel =
    item?.progressFraction !== undefined
      ? "Devam et"
      : item?.kind === "live"
        ? "Canlı yayını izle"
        : item?.kind === "series"
          ? "Bölümleri gör"
          : "Filmi izle";
  const heroLabel =
    item?.kind === "live"
      ? "CANLI YAYIN"
      : item?.progressFraction !== undefined
        ? "İZLEMEYE DEVAM ET"
        : "ÖNE ÇIKAN";
  const compact = height < 240;
  const inset = width < 560 ? 16 : 26;
  const titleSize = Math.max(22, Math.min(theme.type.hero, width * 0.042));

  return (
    <View
      style={{
        minHeight: height,
        borderRadius: theme.radius.hero,
        overflow: "hidden",
        backgroundColor: theme.color.surfaceRaised,
        marginBottom: theme.spacing.lg,
      }}
    >
      {background ? (
        <ImageBackground
          source={{ uri: background }}
          resizeMode="cover"
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
        />
      ) : null}
      <LinearGradient
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        colors={["rgba(5,9,15,0.92)", "rgba(5,9,15,0.60)", "rgba(5,9,15,0.08)"]}
        locations={[0, 0.48, 1]}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <LinearGradient
        colors={["transparent", "rgba(5,9,15,0.84)"]}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          paddingHorizontal: inset,
          paddingVertical: compact ? 14 : 22,
          alignItems: "flex-start",
        }}
      >
        <Text
          style={{
            color: theme.color.accent,
            fontSize: theme.type.eyebrow,
            fontWeight: "600",
            letterSpacing: 1.5,
            marginBottom: 6,
          }}
        >
          {item ? heroLabel : "ELITE V4"}
        </Text>
        <Text
          numberOfLines={compact ? 1 : 2}
          style={{
            color: theme.color.foreground,
            fontSize: titleSize,
            fontWeight: "600",
            maxWidth: Math.min(width - inset * 2, 720),
            lineHeight: Math.round(titleSize * 1.12),
            letterSpacing: -0.5,
          }}
        >
          {presentation?.title || item?.title || "İçerikleriniz burada"}
        </Text>
        <Text
          numberOfLines={compact ? 1 : 2}
          style={{
            color: theme.color.muted,
            fontSize: compact ? 13 : theme.type.body,
            lineHeight: compact ? 18 : 21,
            marginTop: 5,
            maxWidth: Math.min(width * 0.68, 640),
          }}
        >
          {presentation?.overview ||
            item?.subtitle ||
            (item
              ? "Sağlayıcı kataloğunuzdan seçildi."
              : "Sağlayıcı kataloğu yüklendiğinde içerikler burada görünecek.")}
        </Text>
        {!compact &&
        presentation &&
        (presentation.year ||
          presentation.rating !== undefined ||
          presentation.genre) ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              marginTop: 7,
            }}
          >
            {presentation.year ? (
              <Text style={{ color: theme.color.foreground, fontSize: 12 }}>
                {presentation.year}
              </Text>
            ) : null}
            {presentation.rating !== undefined ? (
              <Text style={{ color: theme.color.accent, fontSize: 12 }}>
                ★ {presentation.rating.toFixed(1)}
              </Text>
            ) : null}
            {presentation.genre ? (
              <Text
                numberOfLines={1}
                style={{
                  color: theme.color.muted,
                  fontSize: 12,
                  maxWidth: 260,
                }}
              >
                {presentation.genre}
              </Text>
            ) : null}
            {presentation.enriched ? (
              <Text
                style={{
                  color: theme.color.accent,
                  fontSize: 10,
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
              flexWrap: "wrap",
              maxWidth: "100%",
              alignItems: "center",
              gap: 10,
              marginTop: 13,
            }}
          >
            <EliteV4FocusButton
              focusId="hero"
              region="content"
              initial
              onFocused={onFocused}
              neighbors={{
                left: "sidebar-home",
                down: firstRailFocusId,
                right: input ? "hero-info" : firstRailFocusId,
              }}
              onPress={() => onOpen(item)}
              accessibilityLabel={`${item.title}, ${actionLabel}`}
              style={{
                minHeight: 44,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.accent,
                borderWidth: 1,
                borderColor: "transparent",
                paddingHorizontal: 18,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Feather
                name={item.kind === "live" ? "radio" : "play"}
                size={16}
                color={theme.color.background}
              />
              <Text
                style={{
                  color: theme.color.background,
                  fontWeight: "600",
                  fontSize: 13,
                }}
              >
                {actionLabel}
              </Text>
            </EliteV4FocusButton>
            {input && local ? (
              <EliteV4FocusButton
                focusId="hero-info"
                region="content"
                onFocused={onFocused}
                neighbors={{
                  left: "hero",
                  down: firstRailFocusId,
                  right: firstRailFocusId,
                }}
                onPress={() => setShowInfo(true)}
                accessibilityLabel={`${item.title} film bilgileri`}
                style={{
                  minHeight: 44,
                  borderRadius: theme.radius.pill,
                  borderWidth: 1,
                  borderColor: theme.color.border,
                  backgroundColor: theme.color.surfaceGlass,
                  paddingHorizontal: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Feather name="info" size={16} color={theme.color.foreground} />
                <Text
                  style={{
                    color: theme.color.foreground,
                    fontWeight: "500",
                    fontSize: 13,
                  }}
                >
                  Bilgi
                </Text>
              </EliteV4FocusButton>
            ) : null}
          </View>
        ) : (
          <EliteV4FocusButton
            focusId="hero"
            region="content"
            initial
            onFocused={onFocused}
            neighbors={{ left: "sidebar-home", down: firstRailFocusId }}
            onPress={() => undefined}
            accessibilityLabel="Katalog içerik alanı"
            style={{
              minHeight: 40,
              borderRadius: theme.radius.pill,
              borderWidth: 1,
              borderColor: theme.color.border,
              backgroundColor: theme.color.surfaceGlass,
              paddingHorizontal: 15,
              justifyContent: "center",
            }}
          >
            <Text style={{ color: theme.color.muted, fontSize: 12 }}>
              Katalog içeriği yüklendiğinde burada gösterilir
            </Text>
          </EliteV4FocusButton>
        )}
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
