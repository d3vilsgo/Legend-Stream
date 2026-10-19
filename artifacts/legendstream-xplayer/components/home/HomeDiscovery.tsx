import { responsiveHomeHeroLayout } from "@/lib/homeHeroLayout";
import { useUiPresentation } from "@/context/UiPresentationContext";
import { nativeTvHomeLayout } from "@/lib/design/nativeTvHomeLayout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ImageStyle, LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
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
import { markStartupEvent } from "@/lib/performanceDiagnostics";

export type HomeContentView = "home" | "live" | "movies" | "series" | "history" | "downloads" | "settings";

type HomeHeroEntry = {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  description?: string;
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
  tvViewportHeight,
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
  onWatchMovie,
  interactionBlocked = false,
  onOpenSeries,
  onOpenMedia,
  onRemoveLive,
}: {
  provider: ProviderConfig;
  tvViewportHeight?: number;
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
  onWatchMovie?: (item: XtreamVodItem) => void;
  interactionBlocked?: boolean;
  onOpenSeries: (item: XtreamSeriesItem) => void;
  onOpenMedia: (item: MediaProgress) => void;
  onRemoveLive: (id: string) => void;
}) {
  const colors = useColors();
  const { width: homeWidth, height: homeHeight } = useWindowDimensions();
  const { tvPreview } = useUiPresentation();
  const shelvesFirst = Platform.isTV || tvPreview || homeWidth > homeHeight;
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
      .filter((item) => item.position > 0 && (item.duration <= 0 || item.position < Math.max(0, item.duration - 30)))
      .slice(0, 14),
    [entries],
  );

  const artworkForProgress = (entry: MediaProgress) => {
    const title = entry.title.trim().toLocaleLowerCase("tr");
    const subtitle = entry.subtitle?.trim().toLocaleLowerCase("tr");
    const movie = homeMovies.find((item) => item.name.trim().toLocaleLowerCase("tr") === title);
    if (movie?.stream_icon) return movie.stream_icon;
    const show = homeSeries.find((item) => {
      const name = item.name.trim().toLocaleLowerCase("tr");
      return name === title || Boolean(subtitle && name === subtitle);
    });
    return show?.cover;
  };

  const heroItems = useMemo<HomeHeroEntry[]>(() => {
    const movieRows: HomeHeroEntry[] = [];
    for (const item of homeMovies) {
      const image = normalizeImageUrl(item.stream_icon);
      movieRows.push({
        id: `movie-${item.stream_id}`,
        title: item.name,
        subtitle: [item.genre, item.releaseDate || item.release_date].filter(Boolean).join(" · ") || t("movies"),
        description: item.plot,
        image: image ?? "",
        movie: item,
      });
    }
    const seriesRows: HomeHeroEntry[] = [];
    for (const item of homeSeries) {
      const image = normalizeImageUrl(item.cover);
      seriesRows.push({
        id: `series-${item.series_id}`,
        title: item.name,
        subtitle: t("series"),
        image: image ?? "",
        series: item,
      });
    }
    return [...movieRows, ...seriesRows].slice(0, 6);
  }, [homeMovies, homeSeries, t]);

  const liveValue = live === null ? null : live.toLocaleString();
  const movieValue = vod === null ? null : vod.toLocaleString();
  const seriesValue = series === null ? null : series.toLocaleString();

  const continueShelf = continueEntries.map<HomeShelfEntry>((item) => {
    const progress = visibleProgressRatio(item.position, item.duration);
    return {
      id: item.id,
      title: item.title,
      subtitle: item.subtitle,
      image: artworkForProgress(item),
      progress: progress ?? undefined,
      progressLabel: progress !== null ? `${Math.round(progress * 100)}%` : undefined,
      onPress: () => onOpenMedia(item),
      onRemove: () => void removeProgress(item.source),
    };
  });
  const recentShelf = recentChannels.map<HomeShelfEntry>((channel) => ({
    id: channel.id,
    title: channel.name,
    subtitle: channel.category,
    image: channel.logoUrl,
    onPress: () => onOpenLive(channel),
    onRemove: () => onRemoveLive(channel.id),
  }));
  const liveShelf = homeChannels.slice(0, 6).map<HomeShelfEntry>((channel) => ({
    id: `live-${channel.id}`,
    title: channel.name,
    subtitle: channel.category,
    image: channel.logoUrl,
    onPress: () => onOpenLive(channel),
  }));
  const movieShelf = homeMovies.slice(0, 6).map<HomeShelfEntry>((item) => ({
    id: `movie-${item.stream_id}`,
    title: item.name,
    subtitle: item.genre || t("movies"),
    image: item.stream_icon,
    onPress: () => onOpenMovie(item),
  }));
  const seriesShelf = homeSeries.slice(0, 6).map<HomeShelfEntry>((item) => ({
    id: `series-${item.series_id}`,
    title: item.name,
    subtitle: t("series"),
    image: item.cover,
    onPress: () => onOpenSeries(item),
  }));
  const newMovieShelf = newMovies.map<HomeShelfEntry>((item) => ({
    id: `new-movie-${item.stream_id}`,
    title: item.name,
    subtitle: item.genre || t("movies"),
    image: item.stream_icon,
    onPress: () => onOpenMovie(item),
  }));
  const newSeriesShelf = newSeries.map<HomeShelfEntry>((item) => ({
    id: `new-series-${item.series_id}`,
    title: item.name,
    subtitle: t("series"),
    image: item.cover,
    onPress: () => onOpenSeries(item),
  }));
  const newChannelShelf = newChannels.map<HomeShelfEntry>((channel) => ({
    id: `new-channel-${channel.id}`,
    title: channel.name,
    subtitle: channel.category,
    image: channel.logoUrl,
    onPress: () => onOpenLive(channel),
  }));
  const effectiveLoading = !homeMovies.length && !homeSeries.length && !homeChannels.length && (
    catalogLoading || live === null || vod === null || series === null
  );
  useEffect(() => {
    if (!effectiveLoading) markStartupEvent("HOME_FIRST_USABLE_RENDER");
  }, [effectiveLoading]);

  // Only content focus changes this state; StageRail focus is not a Hero event.
  const [heroInShelves, setHeroInShelves] = useState(false);
  const foldHero = () => { if (Platform.isTV) setHeroInShelves(true); };
  const expandHero = () => { if (Platform.isTV) setHeroInShelves(false); };

  const sectionCards = (
    <View style={s.homeCompactStats}>
      <HomeCountCard onContentFocus={foldHero} focusId="home:live" icon="radio" label={t("liveTv")} value={liveValue} accent={colors.primary} preferredFocus={false} onPress={() => onNavigate("live")} />
      <HomeCountCard onContentFocus={foldHero} focusId="home:movies" icon="film" label={t("movies")} value={movieValue} accent="#49B9FF" onPress={() => onNavigate("movies")} />
      <HomeCountCard onContentFocus={foldHero} focusId="home:series" icon="tv" label={t("series")} value={seriesValue} accent="#8C8CFF" onPress={() => onNavigate("series")} />
    </View>
  );

  return <View style={s.homeDiscoveryShell}>
    <HomeHeroCarousel
      items={heroItems}
      collapsed={Platform.isTV && heroInShelves}
      onHeroFocus={expandHero}
      tvViewportHeight={tvViewportHeight}
      eyebrow={copy.featured}
      providerName={provider.name}
      paused={interactionBlocked}
      onOpen={(item) => item.movie ? onOpenMovie(item.movie) : item.series ? onOpenSeries(item.series) : undefined}
      onWatch={onWatchMovie ? item => { if (item.movie) onWatchMovie(item.movie); } : undefined}
      onDiscover={() => onNavigate("movies")}
      discoverLabel={copy.discover}
      loading={effectiveLoading}
    />

    {continueShelf.length || !mediaLibraryLoaded ? <HomeShelf onContentFocus={foldHero} title={copy.continue} seeAll={copy.seeAll} items={continueShelf} onSeeAll={() => onNavigate("history")} loading={!mediaLibraryLoaded} /> : null}
    {recentShelf.length ? <HomeShelf onContentFocus={foldHero} title={copy.recent} seeAll={copy.seeAll} items={recentShelf} onSeeAll={() => onNavigate("history")} compact /> : null}
    <HomeShelf onContentFocus={foldHero} title={t("liveTv")} seeAll={copy.seeAll} items={liveShelf} onSeeAll={() => onNavigate("live")} compact emptyLabel={live === 0 ? copy.noLive : copy.discover} loading={live === null} />
    <HomeShelf onContentFocus={foldHero} title={t("movies")} seeAll={copy.seeAll} items={movieShelf} onSeeAll={() => onNavigate("movies")} emptyLabel={vod === 0 ? copy.noMovies : copy.discover} loading={vod === null} />
    <HomeShelf onContentFocus={foldHero} title={t("series")} seeAll={copy.seeAll} items={seriesShelf} onSeeAll={() => onNavigate("series")} emptyLabel={series === 0 ? copy.noSeries : copy.discover} loading={series === null} />
    {newMovieShelf.length ? <HomeShelf onContentFocus={foldHero} title={copy.newMovies} seeAll={copy.seeAll} items={newMovieShelf} onSeeAll={() => onNavigate("movies")} /> : null}
    {newSeriesShelf.length ? <HomeShelf onContentFocus={foldHero} title={copy.newSeries} seeAll={copy.seeAll} items={newSeriesShelf} onSeeAll={() => onNavigate("series")} /> : null}
    {newChannelShelf.length ? <HomeShelf onContentFocus={foldHero} title={copy.newChannels} seeAll={copy.seeAll} items={newChannelShelf} onSeeAll={() => onNavigate("live")} compact /> : null}
    {sectionCards}
  </View>;
}

function TvFocusPressable({ children, onPress, onLongPress, preferredFocus = false, style, onFocus, onLayout, focusId, accessibilityLabel }: {
  children: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  preferredFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  onFocus?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  focusId?: string;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return <TVPreviewPressable
    eliteVisual
    focusId={focusId}
    accessibilityLabel={accessibilityLabel}
    focusable
    hasTVPreferredFocus={Platform.isTV && preferredFocus}
    onFocus={() => {
      if (Platform.isTV) setFocused(true);
      onFocus?.();
    }}
    onBlur={() => Platform.isTV && setFocused(false)}
    onLayout={onLayout}
    onPress={onPress}
    onLongPress={onLongPress}
    style={[
      style,
      Platform.isTV ? s.homeTvFocusBase : null,
      Platform.isTV && focused ? [s.homeTvFocusActive, { borderColor: "#fff", shadowOpacity: 0, shadowRadius: 0, elevation: 0 }] : null,
    ]}
  >{children}</TVPreviewPressable>;
}

function ResilientCatalogImage({ uri, style, resizeMode = "cover", fallbackIcon = "film", showFallbackIcon = true }: {
  uri?: string;
  style: CatalogImageStyle;
  resizeMode?: "cover" | "contain" | "stretch" | "repeat" | "center";
  fallbackIcon?: keyof typeof Feather.glyphMap;
  showFallbackIcon?: boolean;
}) {
  const colors = useColors();
  const normalized = normalizeImageUrl(uri);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [normalized]);
  if (!normalized || failed) {
    return <View style={[style, { alignItems: "center", justifyContent: "center", backgroundColor: colors.muted }]}>
      {showFallbackIcon ? <Feather name={fallbackIcon} size={30} color={colors.primary} /> : null}
    </View>;
  }
  return <Image source={{ uri: normalized }} resizeMode={resizeMode} style={style} onError={() => setFailed(true)} />;
}

/** Production Home presentation: both actions preserve the selected provider object.
 * Series starts at Info/episode selection; Home never manufactures an episode URL. */
export function HomeHeroCarousel({
  items,
  collapsed = false,
  onHeroFocus,
  tvViewportHeight,
  eyebrow,
  providerName,
  onOpen,
  onWatch,
  onDiscover,
  discoverLabel,
  loading = false,
  paused = false,
}: {
  items: HomeHeroEntry[];
  collapsed?: boolean;
  onHeroFocus?: () => void;
  tvViewportHeight?: number;
  eyebrow: string;
  providerName: string;
  onOpen: (item: HomeHeroEntry) => void;
  onWatch?: (item: HomeHeroEntry) => void;
  onDiscover: () => void;
  discoverLabel: string;
  loading?: boolean;
  paused?: boolean;
}) {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { tvPreview } = useUiPresentation();
  const [index, setIndex] = useState(0);
  const selectedId = useRef<string | null>(null);
  const itemIds = items.map((item) => item.id).join("\u0000");
  useEffect(() => {
    const found = items.findIndex((item) => item.id === selectedId.current);
    setIndex(found < 0 ? 0 : found);
  }, [itemIds]);
  const item = items[index] ?? items[0];
  if (item) selectedId.current = item.id;
  const responsive = responsiveHomeHeroLayout({
    width,
    height,
    fontScale,
    tvPreview,
    safeArea: insets,
    viewportHeight: tvViewportHeight,
  });
  const native = nativeTvHomeLayout({
    width,
    height,
    fontScale,
    safeArea: insets,
    viewportHeight: tvViewportHeight,
  });
  // Very short windows get an explicit compact introduction with actions, never a 1dp strip.
  const compact = width > height || tvPreview || Platform.isTV;
  // Respect the measured content viewport in Preview and compact touch layouts,
  // leaving a visible start of the first shelf instead of reserving a fixed 160dp.
  const availableHomeHeight = Math.max(
    1,
    (tvViewportHeight ?? height) - insets.top - insets.bottom,
  );
  const shelfReserve = Math.min(160, Math.max(76, availableHomeHeight * 0.24));
  // Preserve the existing Home action/readability contract in touch layouts.
  // Never trade away the portrait 310dp or compact 160dp minimum for shelf space.
  const textAndActionFloor = compact ? 160 : Math.ceil(240 + 70 * Math.max(1, fontScale));
  const heroHeight = Platform.isTV
    ? collapsed
      ? Math.max(96, Math.min(native.heroHeight, Math.round(native.availableHeight * 0.20)))
      : native.heroHeight
    : Math.max(
        textAndActionFloor,
        Math.min(
          Math.max(textAndActionFloor, availableHomeHeight - shelfReserve),
          responsive.height,
        ),
      );
  const titleStyle = Platform.isTV
    ? { fontSize: native.titleFont, lineHeight: native.titleLineHeight }
    : { fontSize: compact ? 24 : 34, lineHeight: compact ? 28 : 39 };
  const action = (label: string, id: string, primary = false) => (
    <TVPreviewPressable
      eliteVisual
      focusId={`home-hero:${item?.id ?? "empty"}:${id}`}
      accessibilityRole="button"
      accessibilityLabel={collapsed && Platform.isTV ? "Öne çıkan içeriğe dön" : label}
      hasTVPreferredFocus={id === "watch"}
      onFocus={onHeroFocus}
      disabled={paused || loading}
      onPress={() => { if (collapsed && Platform.isTV) { onHeroFocus?.(); return; } item ? id === "watch" && item.movie && onWatch ? onWatch(item) : onOpen(item) : onDiscover(); }}
      style={{
        maxWidth: "100%",
        flexShrink: 1,
        minHeight: Platform.isTV ? 56 : 48,
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: primary ? "#56ddd0" : "#728088",
        backgroundColor: primary ? "#56ddd0" : "#1c252dcc",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontSize: Platform.isTV ? 18 : 15,
          fontWeight: "800",
          color: primary ? "#071c20" : "white",
        }}
      >
        {label}
      </Text>
    </TVPreviewPressable>
  );
  return (
    <View
      style={{
        minHeight: heroHeight,
        borderRadius: 24,
        overflow: "hidden",
        backgroundColor: "#17252d",
        borderWidth: 1,
        borderColor: "#33454b",
      }}
      accessibilityLabel="Öne çıkan içerik"
    >
      {item?.image ? (
        <ResilientCatalogImage
          uri={item.image}
          showFallbackIcon={false}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <LinearGradient
        colors={["#101b24ee", "#101b2488", "#101b24ee"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View
        style={{
          flex: 1,
          padding: compact ? 16 : 24,
          justifyContent: "flex-end",
          flexDirection: compact ? "row" : "column",
          alignItems: compact ? "center" : "stretch",
          gap: 16,
        }}
      >
        <View
          style={{ flex: 1, minWidth: 0, justifyContent: "flex-end", gap: 6 }}
        >
          {(!Platform.isTV || (!collapsed && heroHeight >= native.titleLineHeight * fontScale * native.titleLines + 60)) ? <Text
            numberOfLines={1}
            style={{
              color: "#67e8d1",
              fontSize: 11,
              fontWeight: "800",
              letterSpacing: 2,
            }}
          >
            LEGEND ELITE ·{" "}
            {loading ? "YÜKLENİYOR" : eyebrow.toLocaleUpperCase("tr")}
          </Text> : null}
          <Text
            numberOfLines={Platform.isTV ? (collapsed ? 1 : native.titleLines) : compact ? 1 : 2}
            style={[{ color: "white", fontWeight: "900" }, titleStyle]}
          >
            {loading
              ? "Kataloğunuz hazırlanıyor…"
              : (item?.title ?? "İzleyecek yeni bir şey keşfedin")}
          </Text>
          {!collapsed && !loading && (!Platform.isTV || native.showMeta) ? (
            <Text numberOfLines={1} style={{ color: "#c4d0d5", fontSize: 14 }}>
              {item?.subtitle ?? providerName}
            </Text>
          ) : null}
          {!collapsed && item?.description && (!compact || (Platform.isTV && native.showMeta)) ? (
            <Text numberOfLines={2} style={{ color: "#c4d0d5", fontSize: 14 }}>
              {item.description}
            </Text>
          ) : null}
        </View>
        {!loading ? (
          <View
            style={{
              flexDirection: compact && !Platform.isTV ? "column" : "row",
              flexWrap: "wrap",
              maxWidth: compact ? "55%" : "100%",
              gap: 8,
              flexShrink: 1,
            }}
          >
            {collapsed && Platform.isTV ? action("↑", item ? "watch" : "discover", true) : item ? action(item.series ? "Bölümleri Gör" : onWatch ? "İzle" : "Film Bilgisi", "watch", true) : action(discoverLabel, "discover", true)}
            {!collapsed && item?.movie && onWatch ? action("Detay / Bilgi", "info") : null}
            {!collapsed && Platform.isTV && items.length > 1 ? <TVPreviewPressable eliteVisual focusId="home-hero:next" accessibilityLabel="Sonraki öne çıkan içerik" disabled={paused} onPress={()=>setIndex(current=>(current+1)%items.length)} style={{minWidth:56,minHeight:56,padding:12,borderRadius:12,backgroundColor:"#1c252d",justifyContent:"center",alignItems:"center"}}><Text style={{color:"white",fontSize:22}}>→</Text></TVPreviewPressable> : null}
          </View>
        ) : (
          <Text accessibilityRole="progressbar" style={{ color: "#c4d0d5" }}>
            İçerikler yükleniyor
          </Text>
        )}
      </View>
      {!Platform.isTV && items.length > 1 && !loading ? (
        <View style={{ position: "absolute", right: 12, top: 8 }}>
          <TVPreviewPressable
            eliteVisual
            focusId="home-hero:next"
            accessibilityLabel="Sonraki öne çıkan içerik"
            disabled={paused}
            onPress={() => setIndex((current) => (current + 1) % items.length)}
            style={{
              padding: 8,
              borderRadius: 10,
              backgroundColor: "#101b24cc",
            }}
          >
            <Text style={{ color: "white" }}>
              {index + 1} / {items.length} →
            </Text>
          </TVPreviewPressable>
        </View>
      ) : null}
    </View>
  );
}

function HomeCountCard({ focusId, icon, label, value, accent, onPress, onContentFocus, preferredFocus = false }: {
  focusId: string;
  onContentFocus?: () => void;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string | null;
  accent: string;
  onPress: () => void;
  preferredFocus?: boolean;
}) {
  const colors = useColors();
  return <TvFocusPressable focusId={focusId} onFocus={onContentFocus} preferredFocus={preferredFocus} onPress={onPress} style={[s.homeCompactStatCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <LinearGradient colors={[`${accent}18`, "rgba(255,255,255,0.015)"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
    <View style={[s.homeCompactStatIcon, { backgroundColor: `${accent}18` }]}><Feather name={icon} size={18} color={accent} /></View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={[s.homeCompactStatLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {value === null
        ? <View style={[s.homeSkeletonLine, { width: "58%", backgroundColor: colors.muted, marginTop: 4 }]} />
        : <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.45} style={[s.homeCompactStatValue, { color: colors.foreground }]}>{value}</Text>}
    </View>
  </TvFocusPressable>;
}

function HomeShelf({ title, seeAll, items, onSeeAll, compact = false, emptyLabel, loading = false, onContentFocus }: {
  title: string;
  seeAll: string;
  items: HomeShelfEntry[];
  onContentFocus?: () => void;
  onSeeAll: () => void;
  compact?: boolean;
  emptyLabel?: string;
  loading?: boolean;
}) {
  const colors = useColors();
  const listRef = useRef<FlatList<HomeShelfEntry>>(null);
  return <View style={s.homeShelfSection}>
    <View style={s.homeShelfHeader}>
      <Text style={[s.homeShelfTitle, { color: colors.foreground }]}>{title}</Text>
      <TvFocusPressable focusId={`home-shelf:${title}:more`} onFocus={onContentFocus} onPress={onSeeAll} style={s.homeSeeAllButton}>
        <Text style={[s.homeSeeAllText, { color: colors.primary }]}>{seeAll}</Text>
        <Feather name="arrow-right" size={15} color={colors.primary} />
      </TvFocusPressable>
    </View>
    {items.length ? <FlatList
      ref={listRef}
      horizontal
      removeClippedSubviews={Platform.isTV ? false : undefined}
      data={items}
      keyExtractor={(item) => item.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.homeShelfList}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={5}
      renderItem={({ item, index: itemIndex }) => <TvFocusPressable
        focusId={`home-shelf:${title}:${item.id}`}
        onPress={item.onPress}
        onLongPress={Platform.isTV ? item.onRemove : undefined}
        onFocus={() => { onContentFocus?.(); listRef.current?.scrollToIndex({ index: itemIndex, animated: true, viewPosition: 0.45 }); }}
        style={[compact ? s.homeShelfCardCompact : s.homeShelfCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={[compact ? s.homeShelfImageCompact : s.homeShelfImage, { backgroundColor: colors.muted }]}>
          <ResilientCatalogImage uri={item.image} resizeMode="cover" style={StyleSheet.absoluteFill} fallbackIcon={compact ? "radio" : "play-circle"} />
          {!Platform.isTV && item.onRemove ? <Pressable onPress={item.onRemove} hitSlop={8} style={s.homeShelfRemove}><Feather name="x" size={14} color="#fff" /></Pressable> : null}
        </View>
        <Text numberOfLines={1} style={[s.homeShelfCardTitle, { color: colors.foreground }]}>{item.title}</Text>
        {item.subtitle ? <Text numberOfLines={1} style={[s.homeShelfCardMeta, { color: colors.mutedForeground }]}>{item.subtitle}</Text> : null}
        {item.progress !== undefined ? <>
          <View style={[s.homeProgressTrack, { backgroundColor: colors.muted }]}><View style={[s.homeProgressFill, { width: `${Math.round(item.progress * 100)}%`, backgroundColor: colors.primary }]} /></View>
          {item.progressLabel ? <Text style={[s.homeProgressLabel, { color: colors.mutedForeground }]}>{item.progressLabel}</Text> : null}
        </> : null}
      </TvFocusPressable>}
    /> : loading ? <View style={s.homeShelfSkeletonRow}>{[0, 1, 2].map((itemIndex) => <View key={itemIndex} style={[s.homeShelfSkeletonCard, { borderColor: colors.border, backgroundColor: colors.card }]}><View style={[s.homeShelfSkeletonImage, { backgroundColor: colors.muted }]} /><View style={[s.homeSkeletonLine, { width: "72%", backgroundColor: colors.muted }]} /></View>)}</View> : <TvFocusPressable focusId={`home-shelf:${title}:empty`} onFocus={onContentFocus} onPress={onSeeAll} style={[s.homeShelfEmpty, { borderColor: colors.border }]}><Text style={{ color: colors.mutedForeground }}>{emptyLabel || "—"}</Text><Feather name="arrow-right" size={17} color={colors.primary} /></TvFocusPressable>}
  </View>;
}

const s = StyleSheet.create({
  homeDiscoveryShell: { paddingTop: 4, paddingBottom: 26, gap: 4 },
  homeHeroCard: { aspectRatio: 2.25, minHeight: 190, maxHeight: 520, borderRadius: 24, overflow: "hidden", borderWidth: 2, justifyContent: "flex-end" },
  homeHeroEmpty: { width: "100%", aspectRatio: 2.25, minHeight: 190, maxHeight: 420, borderRadius: 24, borderWidth: 1, overflow: "hidden", padding: 24 },
  homeHeroCaption: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 70, maxWidth: 760 },
  homeHeroEyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 7 },
  homeHeroImageTitle: { color: "#FFFFFF", fontSize: 30, lineHeight: 35, fontWeight: "800", textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 8, textShadowOffset: { width: 0, height: 2 } },
  homeHeroImageMeta: { color: "rgba(255,255,255,0.78)", fontSize: 13, fontWeight: "600", marginTop: 7 },
  homeHeroTitle: { fontSize: 28, lineHeight: 34, fontWeight: "700", maxWidth: 620 },
  homeHeroMeta: { fontSize: 13, marginTop: 7 },
  homeHeroDots: { flexDirection: "row", justifyContent: "center", gap: 6, paddingTop: 10 },
  homeHeroDot: { width: 6, height: 6, borderRadius: 6 },
  homeCompactStats: { flexDirection: "row", gap: 10, marginTop: 18, marginBottom: 14 },
  homeCompactStatCard: { flex: 1, minWidth: 0, minHeight: 76, borderWidth: 1, borderRadius: 16, paddingHorizontal: 9, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 7, overflow: "hidden" },
  homeCompactStatIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  homeCompactStatLabel: { fontSize: 10, lineHeight: 13, fontWeight: "600" },
  homeCompactStatValue: { fontSize: 17, lineHeight: 21, fontWeight: "800", marginTop: 1, flexShrink: 1 },
  homeShelfSection: { marginTop: 24 },
  homeShelfHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  homeShelfTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700", letterSpacing: -0.25 },
  homeSeeAllButton: { borderWidth: 2, borderColor: "transparent", borderRadius: 9, paddingHorizontal: 7, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  homeSeeAllText: { fontSize: 12, fontWeight: "700" },
  homeShelfList: { gap: 11, paddingVertical: 3, paddingHorizontal: 2 },
  homeShelfCard: { width: 142, borderWidth: 2, borderRadius: 16, padding: 7, overflow: "hidden" },
  homeShelfCardCompact: { width: 154, borderWidth: 2, borderRadius: 16, padding: 7, overflow: "hidden" },
  homeShelfImage: { width: "100%", aspectRatio: 2 / 3, borderRadius: 11, overflow: "hidden" },
  homeShelfImageCompact: { width: "100%", aspectRatio: 16 / 10, borderRadius: 11, overflow: "hidden" },
  homeShelfRemove: { position: "absolute", top: 6, right: 6, width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.70)" },
  homeShelfCardTitle: { fontSize: 13, lineHeight: 18, fontWeight: "700", marginTop: 7 },
  homeShelfCardMeta: { fontSize: 11, lineHeight: 15, marginTop: 1 },
  homeProgressTrack: { height: 5, borderRadius: 4, overflow: "hidden", marginTop: 7 },
  homeProgressFill: { height: "100%", borderRadius: 3 },
  homeProgressLabel: { fontSize: 10, lineHeight: 13, fontWeight: "700", marginTop: 3, textAlign: "right" },
  homeShelfEmpty: { minHeight: 58, borderWidth: 1, borderRadius: 14, borderStyle: "dashed", paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  homeSkeletonLine: { height: 12, borderRadius: 8, opacity: 0.72 },
  homeShelfSkeletonRow: { flexDirection: "row", gap: 11, paddingVertical: 3 },
  homeShelfSkeletonCard: { width: 142, borderWidth: 1, borderRadius: 16, padding: 7, gap: 9 },
  homeShelfSkeletonImage: { width: "100%", aspectRatio: 2 / 3, borderRadius: 11, opacity: 0.72 },
  homeTvFocusBase: { borderWidth: 4, borderColor: "transparent" },
  homeTvFocusActive: { borderWidth: 4, shadowOpacity: 0.78, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
});
