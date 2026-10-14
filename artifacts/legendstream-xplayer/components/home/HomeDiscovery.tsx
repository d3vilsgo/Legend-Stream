import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ImageStyle, StyleProp, ViewStyle } from "react-native";
import type { ProviderConfig } from "@/context/PlayerContext";
import type { MediaProgress } from "@/context/MediaLibraryContext";
import { useMediaLibrary } from "@/context/MediaLibraryContext";
import { useI18n } from "@/context/I18nContext";
import { useColors } from "@/hooks/useColors";
import { normalizeImageUrl } from "@/lib/imageUrl";
import { visibleProgressRatio } from "@/lib/historyPresentation";
import { TVPreviewPressable } from "@/components/tvPreview/TVPreviewFocus";
import type { Channel } from "@/lib/iptv";
import type { XtreamSeriesItem, XtreamVodItem } from "@/lib/xtreamCatalog";

export type HomeContentView = "home" | "live" | "movies" | "series" | "history" | "downloads" | "settings";

type HomeHeroEntry = {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  movie?: XtreamVodItem;
  series?: XtreamSeriesItem;
};

type HomeShelfEntry = {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  progress?: number;
  progressLabel?: string;
  onPress: () => void;
  onRemove?: () => void;
};

type CatalogImageStyle = StyleProp<ImageStyle & ViewStyle>;

export function HomeDiscovery({
  provider,
  live,
  vod,
  series,
  vodCategories,
  seriesCategories,
  catalogLoading,
  channels,
  history,
  movies,
  seriesItems,
  newChannels,
  newMovies,
  newSeries,
  onNavigate,
  onOpenLive,
  onOpenMovie,
  onOpenSeries,
  onOpenMedia,
  onRemoveLive,
}: {
  provider: ProviderConfig;
  live: number | null;
  vod: number | null;
  series: number | null;
  vodCategories: number;
  seriesCategories: number;
  catalogLoading: boolean;
  channels: Channel[];
  history: string[];
  movies: XtreamVodItem[];
  seriesItems: XtreamSeriesItem[];
  newChannels: Channel[];
  newMovies: XtreamVodItem[];
  newSeries: XtreamSeriesItem[];
  onNavigate: (view: HomeContentView) => void;
  onOpenLive: (channel: Channel) => void;
  onOpenMovie: (item: XtreamVodItem) => void;
  onOpenSeries: (item: XtreamSeriesItem) => void;
  onOpenMedia: (item: MediaProgress) => void;
  onRemoveLive: (id: string) => void;
}) {
  const colors = useColors();
  const { t, language } = useI18n();
  const { entries, loaded: mediaLibraryLoaded, removeProgress } = useMediaLibrary();
  const copy = language === "tr"
    ? {
        continue: "İzlemeye Devam Et",
        recent: "Son İzlenen Kanallar",
        seeAll: "Hepsini Gör",
        discover: "Keşfetmek için dokunun",
        featured: "Öne çıkan içerikler",
        newMovies: "Yeni Filmler",
        newSeries: "Yeni Diziler",
        newChannels: "Yeni Kanallar",
        noLive: "Canlı yayın bulunamadı",
        noMovies: "Film bulunamadı",
        noSeries: "Dizi bulunamadı",
      }
    : {
        continue: "Continue Watching",
        recent: "Recently Watched Channels",
        seeAll: "See All",
        discover: "Tap to discover",
        featured: "Featured picks",
        newMovies: "New Movies",
        newSeries: "New Series",
        newChannels: "New Channels",
        noLive: "No live channels found",
        noMovies: "No movies found",
        noSeries: "No series found",
      };

  const homeMovies = useMemo(() => movies.slice(0, 48), [movies]);
  const homeSeries = useMemo(() => seriesItems.slice(0, 48), [seriesItems]);
  const homeChannels = useMemo(() => channels.slice(0, 48), [channels]);

  const recentChannels = useMemo(
    () => history
      .map((id) => channels.find((channel) => channel.id === id))
      .filter((item): item is Channel => Boolean(item))
      .slice(0, 14),
    [channels, history],
  );
  const continueEntries = useMemo(
    () => entries
      .filter((item) =