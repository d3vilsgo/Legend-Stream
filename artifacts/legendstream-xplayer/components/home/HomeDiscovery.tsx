import { responsiveHomeHeroLayout } from "@/lib/homeHeroLayout";
import { useUiPresentation } from "@/context/UiPresentationContext";
import { nativeTvHomeLayout } from "@/lib/design/nativeTvHomeLayout";
import { eliteV3, eliteV3Mode } from "@/lib/design/eliteV3Tokens";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type {
  ImageStyle,
  LayoutChangeEvent,
  StyleProp,
  ViewStyle,
} from "react-native";
import { selectProgramsAt, type ProviderConfig } from "@/context/PlayerContext";
import type { MediaProgress } from "@/context/MediaLibraryContext";
import { useMediaLibrary } from "@/context/MediaLibraryContext";
import { useI18n } from "@/context/I18nContext";
import { normalizeImageUrl } from "@/lib/imageUrl";
import { visibleProgressRatio } from "@/lib/historyPresentation";
import { TVPreviewPressable } from "@/components/tvPreview/TVPreviewFocus";
import type { Channel, EpgProgram } from "@/lib/iptv";
import type { XtreamSeriesItem, XtreamVodItem } from "@/lib/xtreamCatalog";
import { markStartupEvent } from "@/lib/performanceDiagnostics";

// Home uses the shared V3 palette; provider data and Focus ownership stay unchanged.
const homeColors = {
  primary: eliteV3.color.primary,
  foreground: eliteV3.color.text,
  mutedForeground: eliteV3.color.muted,
  border: eliteV3.color.border,
  card: eliteV3.color.panel,
  muted: eliteV3.color.raised,
};

export type HomeContentView =
  "home" | "live" | "movies" | "series" | "history" | "downloads" | "settings";

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
  previewId?: string;
  onPress: () => void;
  onRemove?: () => void;
};

type CatalogImageStyle = StyleProp<ImageStyle & ViewStyle>;

export function HomeDiscovery({
  provider,
  tvViewportHeight,
  tvFirstHome = true,
  live,
  vod,
  series,
  vodCategories,
  seriesCategories,
  catalogLoading,
  channels,
  epgByChannel,
  epgLoading = false,
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
  tvFirstHome?: boolean;
  live: number | null;
  vod: number | null;
  series: number | null;
  vodCategories: number;
  seriesCategories: number;
  catalogLoading: boolean;
  channels: Channel[];
  epgByChannel?: ReadonlyMap<string, readonly EpgProgram[]>;
  epgLoading?: boolean;
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
  const colors = homeColors;
  const { tvPreview } = useUiPresentation();
  const tvFirst = tvFirstHome && (Platform.isTV || tvPreview);
  const { t, language } = useI18n();
  const {
    entries,
    loaded: mediaLibraryLoaded,
    removeProgress,
  } = useMediaLibrary();
  const copy =
    language === "tr"
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
    () =>
      history
        .map((id) => channels.find((channel) => channel.id === id))
        .filter((item): item is Channel => Boolean(item))
        .slice(0, 14),
    [channels, history],
  );
  const continueEntries = useMemo(
    () =>
      entries
        .filter(
          (item) =>
            item.position > 0 &&
            (item.duration <= 0 ||
              item.position < Math.max(0, item.duration - 30)),
        )
        .slice(0, 14),
    [entries],
  );

  const artworkForProgress = (entry: MediaProgress) => {
    const title = entry.title.trim().toLocaleLowerCase("tr");
    const subtitle = entry.subtitle?.trim().toLocaleLowerCase("tr");
    const movie = homeMovies.find(
      (item) => item.name.trim().toLocaleLowerCase("tr") === title,
    );
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
        subtitle:
          [item.genre, item.releaseDate || item.release_date]
            .filter(Boolean)
            .join(" · ") || t("movies"),
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
      progressLabel:
        progress !== null ? `${Math.round(progress * 100)}%` : undefined,
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
    previewId: channel.id,
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
  const effectiveLoading =
    !homeMovies.length &&
    !homeSeries.length &&
    !homeChannels.length &&
    (catalogLoading || live === null || vod === null || series === null);
  useEffect(() => {
    if (!effectiveLoading) markStartupEvent("HOME_FIRST_USABLE_RENDER");
  }, [effectiveLoading]);

  // Only content focus changes this state; StageRail focus is not a Hero event.
  const [heroInShelves, setHeroInShelves] = useState(false);
  const [tvActiveTab, setTvActiveTab] = useState<HomeTvTab>("live");
  const [tvSelectedChannelId, setTvSelectedChannelId] = useState<string | null>(
    homeChannels[0]?.id ?? null,
  );
  // A new provider must not inherit the previous provider's shelf Focus context.
  useEffect(() => {
    setHeroInShelves(false);
  }, [provider.id]);
  useEffect(() => {
    setTvActiveTab("live");
    setTvSelectedChannelId(homeChannels[0]?.id ?? null);
  }, [provider.id]);
  useEffect(() => {
    if (
      tvSelectedChannelId &&
      homeChannels.some((item) => item.id === tvSelectedChannelId)
    )
      return;
    setTvSelectedChannelId(homeChannels[0]?.id ?? null);
  }, [homeChannels, tvSelectedChannelId]);
  const foldHero = () => {
    if (Platform.isTV) setHeroInShelves(true);
  };
  const expandHero = () => {
    if (Platform.isTV) setHeroInShelves(false);
  };

  const hero = (
    <HomeHeroCarousel
      items={heroItems}
      collapsed={Platform.isTV && heroInShelves}
      onHeroFocus={expandHero}
      tvViewportHeight={tvViewportHeight}
      eyebrow={copy.featured}
      providerName={provider.name}
      paused={interactionBlocked}
      onOpen={(item) =>
        item.movie
          ? onOpenMovie(item.movie)
          : item.series
            ? onOpenSeries(item.series)
            : undefined
      }
      onWatch={
        onWatchMovie
          ? (item) => {
              if (item.movie) onWatchMovie(item.movie);
            }
          : undefined
      }
      onDiscover={() => onNavigate("movies")}
      discoverLabel={copy.discover}
      loading={effectiveLoading}
    />
  );

  if (tvFirst) {
    const recommendations = [...movieShelf, ...seriesShelf].slice(0, 12);
    return (
      <HomeTvFirstShell
        activeTab={tvActiveTab}
        onActiveTabChange={setTvActiveTab}
        selectedChannelId={tvSelectedChannelId}
        onSelectedChannelChange={setTvSelectedChannelId}
        hero={hero}
        channels={homeChannels}
        epgByChannel={epgByChannel}
        epgLoading={epgLoading}
        liveCount={live}
        continueItems={continueShelf}
        recommendations={recommendations}
        catalogLoading={catalogLoading}
        mediaLibraryLoaded={mediaLibraryLoaded}
        loadingCopy={
          language === "tr" ? "Katalog hazırlanıyor" : "Preparing catalog"
        }
        emptyLive={
          language === "tr"
            ? "Canlı kanal bulunamadı"
            : "No live channels found"
        }
        emptyContinue={
          language === "tr"
            ? "İzleme geçmişi henüz boş"
            : "No viewing history yet"
        }
        emptyRecommendations={
          language === "tr"
            ? "Gösterilecek içerik bulunamadı"
            : "No content to show"
        }
        onNavigate={onNavigate}
        onContentFocus={foldHero}
        onOpenLive={onOpenLive}
      />
    );
  }

  const sectionCards = (
    <View style={s.homeCompactStats}>
      <HomeCountCard
        onContentFocus={foldHero}
        focusId="home:live"
        icon="radio"
        label={t("liveTv")}
        value={liveValue}
        accent={colors.primary}
        preferredFocus={false}
        onPress={() => onNavigate("live")}
      />
      <HomeCountCard
        onContentFocus={foldHero}
        focusId="home:movies"
        icon="film"
        label={t("movies")}
        value={movieValue}
        accent={eliteV3.color.primary}
        onPress={() => onNavigate("movies")}
      />
      <HomeCountCard
        onContentFocus={foldHero}
        focusId="home:series"
        icon="tv"
        label={t("series")}
        value={seriesValue}
        accent={eliteV3.color.primary}
        onPress={() => onNavigate("series")}
      />
    </View>
  );

  return (
    <View style={s.homeDiscoveryShell}>
      {hero}

      {continueShelf.length || !mediaLibraryLoaded ? (
        <HomeShelf
          onContentFocus={foldHero}
          title={copy.continue}
          compact
          seeAll={copy.seeAll}
          items={continueShelf}
          onSeeAll={() => onNavigate("history")}
          loading={!mediaLibraryLoaded}
        />
      ) : null}
      {recentShelf.length ? (
        <HomeShelf
          onContentFocus={foldHero}
          title={copy.recent}
          seeAll={copy.seeAll}
          items={recentShelf}
          onSeeAll={() => onNavigate("history")}
          compact
        />
      ) : null}
      <HomeShelf
        onContentFocus={foldHero}
        title={t("liveTv")}
        seeAll={copy.seeAll}
        items={liveShelf}
        onSeeAll={() => onNavigate("live")}
        compact
        emptyLabel={live === 0 ? copy.noLive : copy.discover}
        loading={live === null}
      />
      <HomeShelf
        onContentFocus={foldHero}
        title={t("movies")}
        seeAll={copy.seeAll}
        items={movieShelf}
        onSeeAll={() => onNavigate("movies")}
        emptyLabel={vod === 0 ? copy.noMovies : copy.discover}
        loading={vod === null}
      />
      <HomeShelf
        onContentFocus={foldHero}
        title={t("series")}
        seeAll={copy.seeAll}
        items={seriesShelf}
        onSeeAll={() => onNavigate("series")}
        emptyLabel={series === 0 ? copy.noSeries : copy.discover}
        loading={series === null}
      />
      {newMovieShelf.length ? (
        <HomeShelf
          onContentFocus={foldHero}
          title={copy.newMovies}
          seeAll={copy.seeAll}
          items={newMovieShelf}
          onSeeAll={() => onNavigate("movies")}
        />
      ) : null}
      {newSeriesShelf.length ? (
        <HomeShelf
          onContentFocus={foldHero}
          title={copy.newSeries}
          seeAll={copy.seeAll}
          items={newSeriesShelf}
          onSeeAll={() => onNavigate("series")}
        />
      ) : null}
      {newChannelShelf.length ? (
        <HomeShelf
          onContentFocus={foldHero}
          title={copy.newChannels}
          seeAll={copy.seeAll}
          items={newChannelShelf}
          onSeeAll={() => onNavigate("live")}
          compact
        />
      ) : null}
      {sectionCards}
    </View>
  );
}

function TvFocusPressable({
  children,
  onPress,
  onLongPress,
  preferredFocus = false,
  style,
  onFocus,
  onLayout,
  focusId,
  accessibilityLabel,
  selected = false,
}: {
  children: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  preferredFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  onFocus?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  focusId?: string;
  accessibilityLabel?: string;
  selected?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TVPreviewPressable
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
        selected ? { backgroundColor: eliteV3.color.selected } : null,
        Platform.isTV ? s.homeTvFocusBase : null,
        Platform.isTV && focused
          ? [
              s.homeTvFocusActive,
              {
                borderColor: eliteV3.color.focus,
                shadowOpacity: 0,
                shadowRadius: 0,
                elevation: 0,
              },
            ]
          : null,
      ]}
    >
      {children}
    </TVPreviewPressable>
  );
}

type HomeTvTab = "live" | "continue" | "discover";

function HomeTvFirstShell({
  activeTab,
  onActiveTabChange,
  selectedChannelId,
  onSelectedChannelChange,
  hero,
  channels,
  epgByChannel,
  epgLoading,
  liveCount,
  continueItems,
  recommendations,
  catalogLoading,
  mediaLibraryLoaded,
  loadingCopy,
  emptyLive,
  emptyContinue,
  emptyRecommendations,
  onNavigate,
  onContentFocus,
  onOpenLive,
}: {
  activeTab: HomeTvTab;
  onActiveTabChange: (tab: HomeTvTab) => void;
  selectedChannelId: string | null;
  onSelectedChannelChange: (id: string | null) => void;
  hero: React.ReactNode;
  channels: Channel[];
  epgByChannel?: ReadonlyMap<string, readonly EpgProgram[]>;
  epgLoading: boolean;
  liveCount: number | null;
  continueItems: HomeShelfEntry[];
  recommendations: HomeShelfEntry[];
  catalogLoading: boolean;
  mediaLibraryLoaded: boolean;
  loadingCopy: string;
  emptyLive: string;
  emptyContinue: string;
  emptyRecommendations: string;
  onNavigate: (view: HomeContentView) => void;
  onContentFocus: () => void;
  onOpenLive: (channel: Channel) => void;
}) {
  const { language } = useI18n();
  const isTurkish = language === "tr";
  const selectedChannel =
    channels.find((item) => item.id === selectedChannelId) ?? channels[0];
  const programs = selectedChannel
    ? selectProgramsAt(epgByChannel?.get(selectedChannel.id))
    : {};
  const current = programs.now;
  const next = programs.next;
  const now = Date.now();
  const validCurrent =
    current &&
    Number.isFinite(current.start) &&
    Number.isFinite(current.end) &&
    current.end > current.start
      ? current
      : undefined;
  const progress = validCurrent
    ? Math.max(
        0,
        Math.min(
          1,
          (now - validCurrent.start) / (validCurrent.end - validCurrent.start),
        ),
      )
    : null;
  const timeLabel = (value?: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? new Date(value).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  const labels = isTurkish
    ? {
        live: "Canlı Kanallar",
        continue: "İzlemeye Devam Et",
        discover: "Öne Çıkanlar",
        now: "Şu an",
        next: "Sonraki",
        noProgram: "Program bilgisi yok",
      }
    : {
        live: "Live Channels",
        continue: "Continue Watching",
        discover: "Featured",
        now: "Now",
        next: "Next",
        noProgram: "Program information unavailable",
      };
  const tabs: {
    id: HomeTvTab;
    label: string;
    icon: keyof typeof Feather.glyphMap;
  }[] = [
    { id: "live", label: labels.live, icon: "radio" },
    { id: "continue", label: labels.continue, icon: "play-circle" },
    { id: "discover", label: labels.discover, icon: "compass" },
  ];
  const liveLoading = catalogLoading || liveCount === null;
  const activeShelf =
    activeTab === "live"
      ? {
          title: labels.live,
          items: channels.map<HomeShelfEntry>((channel) => ({
            id: `live-${channel.id}`,
            previewId: channel.id,
            title: channel.name,
            subtitle: channel.category,
            image: channel.logoUrl,
            onPress: () => onOpenLive(channel),
          })),
          loading: liveLoading,
          empty: emptyLive,
          onSeeAll: () => onNavigate("live"),
        }
      : activeTab === "continue"
        ? {
            title: labels.continue,
            items: continueItems,
            loading: !mediaLibraryLoaded,
            empty: emptyContinue,
            onSeeAll: () => onNavigate("history"),
          }
        : {
            title: labels.discover,
            items: recommendations,
            loading: catalogLoading,
            empty: emptyRecommendations,
            onSeeAll: () => onNavigate("movies"),
          };

  return (
    <View style={s.homeDiscoveryShell} testID="home-tv-first-shell">
      {hero}
      {selectedChannel ? (
        <View
          style={s.homeTvEpgPanel}
          accessibilityLabel={`Canlı kanal bilgisi: ${selectedChannel.name}`}
          testID="home-tv-epg-panel"
        >
          <View style={s.homeTvEpgHeading}>
            <Feather
              name="radio"
              size={eliteV3.icon.compact}
              color={eliteV3.color.primary}
            />
            <Text numberOfLines={1} style={s.homeTvEpgChannel}>
              {selectedChannel.name}
            </Text>
            {selectedChannel.category ? (
              <Text numberOfLines={1} style={s.homeTvEpgCategory}>
                {selectedChannel.category}
              </Text>
            ) : null}
          </View>
          <View style={s.homeTvEpgPrograms}>
            <Text numberOfLines={1} style={s.homeTvEpgProgram}>
              {validCurrent?.title ??
                (epgLoading ? loadingCopy : labels.noProgram)}
            </Text>
            {validCurrent ? (
              <Text style={s.homeTvEpgTime}>
                {[timeLabel(validCurrent.start), timeLabel(validCurrent.end)]
                  .filter(Boolean)
                  .join(" – ")}
              </Text>
            ) : null}
            {next ? (
              <Text numberOfLines={1} style={s.homeTvEpgNext}>
                {labels.next}: {next.title}
                {timeLabel(next.start) ? ` · ${timeLabel(next.start)}` : ""}
              </Text>
            ) : null}
          </View>
          {progress !== null ? (
            <View
              accessibilityLabel={`Program ilerlemesi ${Math.round(progress * 100)} yüzde`}
              style={s.homeTvEpgProgressTrack}
            >
              <View
                testID="home-tv-epg-progress-fill"
                style={[
                  s.homeTvEpgProgressFill,
                  { width: `${progress * 100}%` },
                ]}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={s.homeTvTabs} accessibilityRole="tablist">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <TVPreviewPressable
              key={tab.id}
              eliteVisual
              focusId={`home-tv-tab:${tab.id}`}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}
              onFocus={onContentFocus}
              onPress={() => onActiveTabChange(tab.id)}
              style={[s.homeTvTab, active ? s.homeTvTabActive : null]}
            >
              <Feather
                name={tab.icon}
                size={eliteV3.icon.compact}
                color={active ? eliteV3.color.primary : eliteV3.color.muted}
              />
              <Text
                numberOfLines={1}
                style={[
                  s.homeTvTabLabel,
                  active ? s.homeTvTabLabelActive : null,
                ]}
              >
                {tab.label}
              </Text>
            </TVPreviewPressable>
          );
        })}
      </View>
      <HomeShelf
        title={activeShelf.title}
        seeAll=""
        items={activeShelf.items}
        onSeeAll={activeShelf.onSeeAll}
        onContentFocus={onContentFocus}
        onItemFocus={(item) => {
          if (activeTab !== "live" || !item.previewId) return;
          const channel = channels.find((entry) => entry.id === item.previewId);
          if (!channel) return;
          onSelectedChannelChange(channel.id);
          onContentFocus();
        }}
        selectedId={
          activeTab === "live" && selectedChannel
            ? `live-${selectedChannel.id}`
            : undefined
        }
        compact
        showHeader={false}
        emptyLabel={activeShelf.empty}
        loading={activeShelf.loading}
      />
    </View>
  );
}

function ResilientCatalogImage({
  uri,
  style,
  resizeMode = "cover",
  fallbackIcon = "film",
  showFallbackIcon = true,
}: {
  uri?: string;
  style: CatalogImageStyle;
  resizeMode?: "cover" | "contain" | "stretch" | "repeat" | "center";
  fallbackIcon?: keyof typeof Feather.glyphMap;
  showFallbackIcon?: boolean;
}) {
  const colors = homeColors;
  const normalized = normalizeImageUrl(uri);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [normalized]);
  if (!normalized || failed) {
    return (
      <View
        style={[
          style,
          {
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.muted,
          },
        ]}
      >
        {showFallbackIcon ? (
          <Feather
            name={fallbackIcon}
            size={eliteV3.icon.tv}
            color={colors.primary}
          />
        ) : null}
      </View>
    );
  }
  return (
    <Image
      source={{ uri: normalized }}
      resizeMode={resizeMode}
      style={style}
      onError={() => setFailed(true)}
    />
  );
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
  const tvFirst = Platform.isTV || tvPreview;
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
  const textAndActionFloor = compact
    ? 160
    : Math.ceil(240 + 70 * Math.max(1, fontScale));
  const heroHeight = Platform.isTV
    ? collapsed
      ? Math.max(
          96,
          Math.min(native.heroHeight, Math.round(native.availableHeight * 0.2)),
        )
      : native.heroHeight
    : Math.max(
        textAndActionFloor,
        Math.min(
          Math.max(textAndActionFloor, availableHomeHeight - shelfReserve),
          responsive.height,
        ),
      );
  const mode = eliteV3Mode(width, height, Platform.isTV || tvPreview);
  const type = eliteV3.typography[mode];
  const actionHeight = Math.max(
    eliteV3.target[mode],
    type.body * fontScale + eliteV3.space.md,
  );
  // Put actions below a single-line caption only when the measured TV viewport
  // can fit it. Large text and short windows keep the existing side-by-side mode.
  const stackedCaptionHeight =
    native.padding * 2 +
    native.borderSpace +
    native.titleLineHeight * fontScale +
    (native.showMeta
      ? native.metaLineHeight * fontScale + eliteV3.space.xxs
      : 0) +
    eliteV3.space.xs +
    actionHeight;
  const stacked =
    Platform.isTV && !collapsed && heroHeight >= stackedCaptionHeight;
  const sideBySide = compact && !stacked;
  const titleStyle = Platform.isTV
    ? { fontSize: native.titleFont, lineHeight: native.titleLineHeight }
    : { fontSize: type.title, lineHeight: type.title + eliteV3.space.xxs };
  const action = (label: string, id: string, primary = false) => (
    <TVPreviewPressable
      eliteVisual
      focusId={`home-hero:${item?.id ?? "empty"}:${id}`}
      accessibilityRole="button"
      accessibilityLabel={
        collapsed && Platform.isTV ? "Öne çıkan içeriğe dön" : label
      }
      hasTVPreferredFocus={id === "watch"}
      onFocus={onHeroFocus}
      disabled={paused || loading}
      onPress={() => {
        if (collapsed && Platform.isTV) {
          onHeroFocus?.();
          return;
        }
        item
          ? id === "watch" && item.movie && onWatch
            ? onWatch(item)
            : onOpen(item)
          : onDiscover();
      }}
      style={{
        maxWidth: "100%",
        flexShrink: 1,
        minHeight: actionHeight,
        paddingHorizontal: eliteV3.space.md,
        paddingVertical: eliteV3.space.xs,
        borderRadius: eliteV3.radius.card,
        borderWidth: 2,
        borderColor: primary ? eliteV3.color.primary : eliteV3.color.border,
        backgroundColor: primary ? eliteV3.color.primary : eliteV3.color.panel,
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontSize: type.body,
          fontFamily: eliteV3.typography.strong,
          color: eliteV3.color.text,
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
        borderRadius: eliteV3.radius.hero,
        overflow: "hidden",
        backgroundColor: eliteV3.color.panel,
        borderWidth: 1,
        borderColor: eliteV3.color.border,
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
        colors={eliteV3.home.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View
        style={{
          flex: 1,
          padding: Platform.isTV ? native.padding : eliteV3.space.md,
          justifyContent: "flex-end",
          flexDirection: sideBySide ? "row" : "column",
          alignItems: sideBySide ? "center" : "stretch",
          gap: eliteV3.space.xs,
        }}
      >
        <View
          style={{
            flex: 1,
            minWidth: 0,
            justifyContent: "flex-end",
            gap: eliteV3.space.xxs,
          }}
        >
          {!compact && !collapsed ? (
            <Text
              numberOfLines={1}
              style={{
                color: eliteV3.color.primary,
                fontSize: eliteV3.typography.mobile.meta,
                fontFamily: eliteV3.typography.strong,
                letterSpacing: 2,
              }}
            >
              {loading ? "YÜKLENİYOR" : eyebrow.toLocaleUpperCase("tr")}
            </Text>
          ) : null}
          <Text
            numberOfLines={
              Platform.isTV
                ? collapsed || stacked
                  ? 1
                  : native.titleLines
                : compact
                  ? 1
                  : 2
            }
            style={[
              {
                color: eliteV3.color.text,
                fontFamily: eliteV3.typography.strong,
              },
              titleStyle,
            ]}
          >
            {loading
              ? "Kataloğunuz hazırlanıyor…"
              : (item?.title ?? "İzleyecek yeni bir şey keşfedin")}
          </Text>
          {!collapsed && !loading && (!Platform.isTV || native.showMeta) ? (
            <Text
              numberOfLines={1}
              style={{
                color: eliteV3.color.muted,
                fontFamily: eliteV3.typography.family,
                fontSize: Platform.isTV ? native.metaFont : type.meta,
                lineHeight: Platform.isTV
                  ? native.metaLineHeight
                  : type.meta + eliteV3.space.xxs,
              }}
            >
              {item?.subtitle ?? providerName}
            </Text>
          ) : null}
          {!collapsed && item?.description && !compact ? (
            <Text
              numberOfLines={2}
              style={{
                color: eliteV3.color.muted,
                fontFamily: eliteV3.typography.family,
                fontSize: Platform.isTV ? native.metaFont : type.meta,
                lineHeight: Platform.isTV
                  ? native.metaLineHeight
                  : type.meta + eliteV3.space.xxs,
              }}
            >
              {item.description}
            </Text>
          ) : null}
        </View>
        {!loading ? (
          <View
            style={{
              flexDirection: compact && !Platform.isTV ? "column" : "row",
              flexWrap: "wrap",
              maxWidth: sideBySide ? "55%" : "100%",
              gap: eliteV3.space.xs,
              flexShrink: 1,
            }}
          >
            {collapsed && Platform.isTV
              ? action("↑", item ? "watch" : "discover", true)
              : item
                ? action(
                    item.series
                      ? "Bölümleri Gör"
                      : onWatch
                        ? "İzle"
                        : "Film Bilgisi",
                    "watch",
                    true,
                  )
                : action(discoverLabel, "discover", true)}
            {!collapsed && item?.movie && onWatch
              ? action("Detay / Bilgi", "info")
              : null}
            {!collapsed && Platform.isTV && items.length > 1 ? (
              <TVPreviewPressable
                eliteVisual
                focusId="home-hero:next"
                accessibilityLabel="Sonraki öne çıkan içerik"
                disabled={paused}
                onPress={() =>
                  setIndex((current) => (current + 1) % items.length)
                }
                style={{
                  minWidth: eliteV3.target.tv,
                  minHeight: eliteV3.target.tv,
                  padding: eliteV3.space.sm,
                  borderRadius: eliteV3.radius.card,
                  backgroundColor: eliteV3.color.panel,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: eliteV3.color.text,
                    fontSize: eliteV3.typography.tv.section,
                  }}
                >
                  →
                </Text>
              </TVPreviewPressable>
            ) : null}
          </View>
        ) : (
          <Text
            accessibilityRole="progressbar"
            style={{ color: eliteV3.color.muted }}
          >
            İçerikler yükleniyor
          </Text>
        )}
      </View>
      {!Platform.isTV && items.length > 1 && !loading ? (
        <View
          style={{
            position: "absolute",
            right: eliteV3.space.sm,
            top: eliteV3.space.xs,
          }}
        >
          <TVPreviewPressable
            eliteVisual
            focusId="home-hero:next"
            accessibilityLabel="Sonraki öne çıkan içerik"
            disabled={paused}
            onPress={() => setIndex((current) => (current + 1) % items.length)}
            style={{
              padding: eliteV3.space.xs,
              borderRadius: eliteV3.radius.control,
              backgroundColor: eliteV3.home.overlay,
              minWidth: eliteV3.target.mobile,
              minHeight: eliteV3.target.mobile,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text style={{ color: eliteV3.color.text }}>
              {index + 1} / {items.length} →
            </Text>
          </TVPreviewPressable>
        </View>
      ) : null}
    </View>
  );
}

function HomeCountCard({
  focusId,
  icon,
  label,
  value,
  accent,
  onPress,
  onContentFocus,
  preferredFocus = false,
}: {
  focusId: string;
  onContentFocus?: () => void;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string | null;
  accent: string;
  onPress: () => void;
  preferredFocus?: boolean;
}) {
  const colors = homeColors;
  return (
    <TvFocusPressable
      focusId={focusId}
      onFocus={onContentFocus}
      preferredFocus={preferredFocus}
      onPress={onPress}
      style={[
        s.homeCompactStatCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <LinearGradient
        colors={[`${accent}18`, "rgba(255,255,255,0.015)"]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={[s.homeCompactStatIcon, { backgroundColor: `${accent}18` }]}>
        <Feather name={icon} size={eliteV3.icon.compact} color={accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[s.homeCompactStatLabel, { color: colors.mutedForeground }]}
        >
          {label}
        </Text>
        {value === null ? (
          <View
            style={[
              s.homeSkeletonLine,
              {
                width: "58%",
                backgroundColor: colors.muted,
                marginTop: eliteV3.space.xxs,
              },
            ]}
          />
        ) : (
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.45}
            style={[s.homeCompactStatValue, { color: colors.foreground }]}
          >
            {value}
          </Text>
        )}
      </View>
    </TvFocusPressable>
  );
}

function HomeShelf({
  title,
  seeAll,
  items,
  onSeeAll,
  compact = false,
  emptyLabel,
  loading = false,
  onContentFocus,
  onItemFocus,
  selectedId,
  showHeader = true,
}: {
  title: string;
  seeAll: string;
  items: HomeShelfEntry[];
  onContentFocus?: () => void;
  onSeeAll: () => void;
  compact?: boolean;
  emptyLabel?: string;
  loading?: boolean;
  onItemFocus?: (item: HomeShelfEntry) => void;
  selectedId?: string;
  showHeader?: boolean;
}) {
  const colors = homeColors;
  const listRef = useRef<FlatList<HomeShelfEntry>>(null);
  const { width, height } = useWindowDimensions();
  const { tvPreview } = useUiPresentation();
  const mode = eliteV3Mode(width, height, Platform.isTV || tvPreview);
  const type = eliteV3.typography[mode];
  const cardWidth = compact
    ? eliteV3.home.landscapeWidth[mode]
    : eliteV3.home.posterWidth[mode];
  return (
    <View
      style={[s.homeShelfSection, !showHeader ? s.homeTvActiveShelf : null]}
    >
      {showHeader ? (
        <View style={s.homeShelfHeader}>
          <Text
            numberOfLines={1}
            style={[
              s.homeShelfTitle,
              {
                color: colors.foreground,
                fontSize: type.section,
                minWidth: 0,
                flexShrink: 1,
              },
            ]}
          >
            {title}
          </Text>
          <TvFocusPressable
            focusId={`home-shelf:${title}:more`}
            onFocus={onContentFocus}
            onPress={onSeeAll}
            style={[
              s.homeSeeAllButton,
              !Platform.isTV && { minHeight: eliteV3.target.mobile },
            ]}
          >
            <Text style={[s.homeSeeAllText, { color: colors.primary }]}>
              {seeAll}
            </Text>
            <Feather
              name="arrow-right"
              size={eliteV3.icon.compact}
              color={colors.primary}
            />
          </TvFocusPressable>
        </View>
      ) : null}
      {items.length ? (
        <FlatList
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
          renderItem={({ item, index: itemIndex }) => (
            <TvFocusPressable
              focusId={`home-shelf:${title}:${item.id}`}
              onPress={item.onPress}
              onLongPress={Platform.isTV ? item.onRemove : undefined}
              onFocus={() => {
                onContentFocus?.();
                onItemFocus?.(item);
                listRef.current?.scrollToIndex({
                  index: itemIndex,
                  animated: true,
                  viewPosition: 0.45,
                });
              }}
              style={[
                compact ? s.homeShelfCardCompact : s.homeShelfCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  width: cardWidth,
                },
              ]}
              selected={item.id === selectedId}
            >
              <View
                style={[
                  compact ? s.homeShelfImageCompact : s.homeShelfImage,
                  { backgroundColor: colors.muted },
                ]}
              >
                <ResilientCatalogImage
                  uri={item.image}
                  resizeMode="cover"
                  style={StyleSheet.absoluteFill}
                  fallbackIcon={compact ? "radio" : "play-circle"}
                />
                {!Platform.isTV && item.onRemove ? (
                  <Pressable
                    onPress={item.onRemove}
                    hitSlop={8}
                    style={s.homeShelfRemove}
                  >
                    <Feather name="x" size={14} color={eliteV3.color.text} />
                  </Pressable>
                ) : null}
              </View>
              <Text
                numberOfLines={1}
                style={[
                  s.homeShelfCardTitle,
                  {
                    color: colors.foreground,
                    fontSize: type.meta,
                    lineHeight: type.meta + eliteV3.space.xxs,
                  },
                ]}
              >
                {item.title}
              </Text>
              {item.subtitle ? (
                <Text
                  numberOfLines={1}
                  style={[
                    s.homeShelfCardMeta,
                    {
                      color: colors.mutedForeground,
                      fontSize: type.meta,
                      lineHeight: type.meta + eliteV3.space.xxs,
                    },
                  ]}
                >
                  {item.subtitle}
                </Text>
              ) : null}
              {item.progress !== undefined ? (
                <>
                  <View
                    style={[
                      s.homeProgressTrack,
                      { backgroundColor: colors.muted },
                    ]}
                  >
                    <View
                      style={[
                        s.homeProgressFill,
                        {
                          width: `${Math.round(item.progress * 100)}%`,
                          backgroundColor: colors.primary,
                        },
                      ]}
                    />
                  </View>
                  {item.progressLabel ? (
                    <Text
                      style={[
                        s.homeProgressLabel,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {item.progressLabel}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </TvFocusPressable>
          )}
        />
      ) : loading ? (
        <View style={s.homeShelfSkeletonRow}>
          {[0, 1, 2].map((itemIndex) => (
            <View
              key={itemIndex}
              style={[
                s.homeShelfSkeletonCard,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              <View
                style={[
                  s.homeShelfSkeletonImage,
                  { backgroundColor: colors.muted },
                ]}
              />
              <View
                style={[
                  s.homeSkeletonLine,
                  { width: "72%", backgroundColor: colors.muted },
                ]}
              />
            </View>
          ))}
        </View>
      ) : (
        <TvFocusPressable
          focusId={`home-shelf:${title}:empty`}
          onFocus={onContentFocus}
          onPress={onSeeAll}
          style={[s.homeShelfEmpty, { borderColor: colors.border }]}
        >
          <Text style={{ color: colors.mutedForeground }}>
            {emptyLabel || "—"}
          </Text>
          <Feather
            name="arrow-right"
            size={eliteV3.icon.compact}
            color={colors.primary}
          />
        </TvFocusPressable>
      )}
    </View>
  );
}

const progressTrackSurface = {
  borderRadius: eliteV3.space.xxs,
  overflow: "hidden" as const,
  marginTop: eliteV3.space.xs,
};

const s = StyleSheet.create({
  homeDiscoveryShell: {
    paddingTop: eliteV3.space.xxs,
    paddingBottom: eliteV3.space.xl,
    gap: eliteV3.space.xxs,
  },
  homeTvEpgPanel: {
    minHeight: 68,
    paddingHorizontal: eliteV3.space.md,
    paddingVertical: eliteV3.space.xs,
    borderRadius: eliteV3.radius.panel,
    borderWidth: 1,
    borderColor: eliteV3.color.border,
    backgroundColor: eliteV3.color.panel,
    flexDirection: "row",
    alignItems: "center",
    gap: eliteV3.space.md,
  },
  homeTvEpgHeading: {
    width: "27%",
    minWidth: 120,
    flexDirection: "row",
    alignItems: "center",
    gap: eliteV3.space.xs,
  },
  homeTvEpgChannel: {
    flex: 1,
    color: eliteV3.color.text,
    fontFamily: eliteV3.typography.strong,
    fontSize: eliteV3.typography.tv.body,
  },
  homeTvEpgCategory: {
    color: eliteV3.color.muted,
    fontFamily: eliteV3.typography.family,
    fontSize: eliteV3.typography.tv.meta,
  },
  homeTvEpgPrograms: { flex: 1, minWidth: 0, gap: 2 },
  homeTvEpgProgram: {
    color: eliteV3.color.text,
    fontFamily: eliteV3.typography.strong,
    fontSize: eliteV3.typography.tv.body,
  },
  homeTvEpgTime: {
    color: eliteV3.color.muted,
    fontFamily: eliteV3.typography.family,
    fontSize: eliteV3.typography.tv.meta,
  },
  homeTvEpgNext: {
    color: eliteV3.color.muted,
    fontFamily: eliteV3.typography.family,
    fontSize: eliteV3.typography.tv.meta,
  },
  homeTvEpgProgressTrack: {
    position: "absolute",
    left: eliteV3.space.md,
    right: eliteV3.space.md,
    bottom: 3,
    height: 2,
    overflow: "hidden",
    backgroundColor: eliteV3.color.raised,
  },
  homeTvEpgProgressFill: {
    height: "100%",
    backgroundColor: eliteV3.color.primary,
  },
  homeTvTabs: {
    minHeight: eliteV3.target.tv,
    flexDirection: "row",
    alignItems: "stretch",
    gap: eliteV3.space.xs,
    marginTop: eliteV3.space.xs,
  },
  homeTvTab: {
    minWidth: eliteV3.target.tv,
    minHeight: eliteV3.target.tv,
    paddingHorizontal: eliteV3.space.md,
    borderRadius: eliteV3.radius.control,
    borderWidth: eliteV3.focus.width,
    borderColor: "transparent",
    backgroundColor: eliteV3.color.panel,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: eliteV3.space.xs,
  },
  homeTvTabActive: {
    backgroundColor: eliteV3.color.selected,
    borderBottomColor: eliteV3.color.primary,
  },
  homeTvTabLabel: {
    color: eliteV3.color.muted,
    fontFamily: eliteV3.typography.family,
    fontSize: eliteV3.typography.tv.meta,
  },
  homeTvTabLabelActive: {
    color: eliteV3.color.text,
    fontFamily: eliteV3.typography.strong,
  },
  homeTvActiveShelf: { marginTop: 0 },
  homeCompactStats: {
    flexDirection: "row",
    gap: 10,
    marginTop: eliteV3.space.lg,
    marginBottom: 14,
  },
  homeCompactStatCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 76,
    borderWidth: 1,
    borderRadius: eliteV3.radius.card,
    paddingHorizontal: eliteV3.space.xs,
    paddingVertical: eliteV3.space.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: eliteV3.space.xs,
    overflow: "hidden",
  },
  homeCompactStatIcon: {
    width: 30,
    height: 30,
    borderRadius: eliteV3.radius.control,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  homeCompactStatLabel: {
    fontSize: eliteV3.typography.mobile.meta,
    lineHeight: 13,
    fontFamily: eliteV3.typography.family,
  },
  homeCompactStatValue: {
    fontSize: eliteV3.typography.mobile.body,
    lineHeight: 21,
    fontFamily: eliteV3.typography.strong,
    marginTop: 1,
    flexShrink: 1,
  },
  homeShelfSection: { marginTop: eliteV3.space.sm * 2 },
  homeShelfHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: eliteV3.space.sm,
    marginBottom: 10,
  },
  homeShelfTitle: {
    fontSize: eliteV3.typography.tablet.section,
    lineHeight: 26,
    fontFamily: eliteV3.typography.strong,
    letterSpacing: -0.25,
  },
  homeSeeAllButton: {
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: eliteV3.radius.control,
    paddingHorizontal: eliteV3.space.xs,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  homeSeeAllText: {
    fontSize: eliteV3.typography.mobile.meta,
    fontFamily: eliteV3.typography.strong,
  },
  homeShelfList: {
    gap: eliteV3.space.sm,
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
  homeShelfCard: {
    width: eliteV3.home.posterWidth.tablet,
    borderWidth: 2,
    borderRadius: eliteV3.radius.card,
    padding: eliteV3.space.xs,
    overflow: "hidden",
  },
  homeShelfCardCompact: {
    width: eliteV3.home.landscapeWidth.mobile,
    borderWidth: 2,
    borderRadius: eliteV3.radius.card,
    padding: eliteV3.space.xs,
    overflow: "hidden",
  },
  homeShelfImage: {
    width: "100%",
    aspectRatio: eliteV3.home.posterRatio,
    borderRadius: eliteV3.radius.control,
    overflow: "hidden",
  },
  homeShelfImageCompact: {
    width: "100%",
    aspectRatio: eliteV3.home.landscapeRatio,
    borderRadius: eliteV3.radius.control,
    overflow: "hidden",
  },
  homeShelfRemove: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 25,
    height: 25,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: eliteV3.home.overlay,
  },
  homeShelfCardTitle: {
    fontSize: eliteV3.typography.tablet.meta,
    lineHeight: 18,
    fontFamily: eliteV3.typography.strong,
    marginTop: eliteV3.space.xs,
  },
  homeShelfCardMeta: {
    fontSize: eliteV3.typography.mobile.meta,
    fontFamily: eliteV3.typography.family,
    lineHeight: 15,
    marginTop: 1,
  },
  homeProgressTrack: { height: 5, ...progressTrackSurface },
  homeProgressFill: { height: "100%", borderRadius: 3 },
  homeProgressLabel: {
    fontSize: eliteV3.typography.mobile.meta,
    lineHeight: 13,
    fontFamily: eliteV3.typography.strong,
    marginTop: 3,
    textAlign: "right",
  },
  homeShelfEmpty: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: eliteV3.radius.card,
    borderStyle: "dashed",
    paddingHorizontal: eliteV3.space.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  homeSkeletonLine: { height: 12, borderRadius: 8, opacity: 0.72 },
  homeShelfSkeletonRow: {
    flexDirection: "row",
    gap: eliteV3.space.sm,
    paddingVertical: 3,
  },
  homeShelfSkeletonCard: {
    width: eliteV3.home.posterWidth.tablet,
    borderWidth: 1,
    borderRadius: eliteV3.radius.card,
    padding: eliteV3.space.xs,
    gap: eliteV3.space.xs,
  },
  homeShelfSkeletonImage: {
    width: "100%",
    aspectRatio: eliteV3.home.posterRatio,
    borderRadius: eliteV3.radius.control,
    opacity: 0.72,
  },
  homeTvFocusBase: {
    borderWidth: eliteV3.focus.width,
    borderColor: "transparent",
  },
  homeTvFocusActive: {
    borderWidth: eliteV3.focus.width,
    shadowOpacity: 0.78,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
});
