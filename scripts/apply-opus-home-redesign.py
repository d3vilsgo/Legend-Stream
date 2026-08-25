from pathlib import Path

home_path = Path("artifacts/legendstream-xplayer/components/OptimizedHomeScreenV6.tsx")
text = home_path.read_text()

def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    text = text.replace(old, new, 1)

replace_once(
    'import { MediaProgress } from "@/context/MediaLibraryContext";',
    'import { MediaProgress, useMediaLibrary } from "@/context/MediaLibraryContext";',
    "media library import",
)

replace_once(
    '    recordWatched,\n    setActiveProvider,',
    '    recordWatched,\n    removeWatched,\n    setActiveProvider,',
    "remove watched destructure",
)

old_home_call = '''      {view === "home" ? <Home provider={shownProvider} providers={providers} live={providerChannels.length} vod={homeVodCount} series={homeSeriesCount} vodCategories={vodCats.length} seriesCategories={seriesCats.length} loading={isLoading} onRefresh={() => void refreshProvider()} onNavigate={navigate} onSwitch={(id) => void switchProvider(id)} onAdd={() => setAdding(true)} /> : null}'''
new_home_call = '''      {view === "home" ? <Home
        provider={shownProvider}
        live={providerChannels.length}
        vod={homeVodCount}
        series={homeSeriesCount}
        vodCategories={vodCats.length}
        seriesCategories={seriesCats.length}
        channels={providerChannels}
        history={history}
        movies={vod}
        seriesItems={series}
        onNavigate={navigate}
        onOpenLive={openLive}
        onOpenMovie={openMovie}
        onOpenSeries={openSeries}
        onOpenMedia={openProgress}
        onRemoveLive={(id) => void removeWatched(id)}
      /> : null}'''
replace_once(old_home_call, new_home_call, "home invocation")

start = text.index('function Home(')
end = text.index('\nfunction useCategoryDrawerSwipe', start)
new_home = r'''type HomeHeroEntry = {
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
  onPress: () => void;
  onRemove?: () => void;
};

function Home({ provider, live, vod, series, vodCategories, seriesCategories, channels, history, movies, seriesItems, onNavigate, onOpenLive, onOpenMovie, onOpenSeries, onOpenMedia, onRemoveLive }: {
  provider: ProviderConfig;
  live: number;
  vod: number | null;
  series: number | null;
  vodCategories: number;
  seriesCategories: number;
  channels: Channel[];
  history: string[];
  movies: XtreamVodItem[];
  seriesItems: XtreamSeriesItem[];
  onNavigate: (view: ContentView) => void;
  onOpenLive: (channel: Channel) => void;
  onOpenMovie: (item: XtreamVodItem) => void;
  onOpenSeries: (item: XtreamSeriesItem) => void;
  onOpenMedia: (item: MediaProgress) => void;
  onRemoveLive: (id: string) => void;
}) {
  const colors = useColors();
  const { t, language } = useI18n();
  const { entries, removeProgress } = useMediaLibrary();
  const copy = language === "tr"
    ? {
        continue: "İzlemeye Devam Et",
        recent: "Son İzlenen Kanallar",
        seeAll: "Hepsini Gör",
        discover: "Keşfetmek için dokunun",
        featured: "Öne çıkan içerikler",
      }
    : {
        continue: "Continue Watching",
        recent: "Recently Watched Channels",
        seeAll: "See All",
        discover: "Tap to discover",
        featured: "Featured picks",
      };

  const localCatalog = useMemo(
    () => provider.type === "m3u" ? getM3UCatalog(provider.id) : null,
    [provider.id, provider.type],
  );

  const homeMovies = useMemo<XtreamVodItem[]>(() => {
    if (!localCatalog) return movies.slice(0, 48);
    return localCatalog.movieItems.slice(0, 48).map((item) => ({
      stream_id: item.id,
      name: item.name,
      stream_icon: item.logoUrl,
      category_id: item.category,
      direct_source: item.streamUrl,
    }));
  }, [localCatalog, movies]);

  const homeSeries = useMemo<XtreamSeriesItem[]>(() => {
    if (!localCatalog) return seriesItems.slice(0, 48);
    return localCatalog.seriesGroups.slice(0, 48).map((item) => ({
      series_id: item.id,
      name: item.name,
      cover: item.coverUrl,
      category_id: item.category,
    }));
  }, [localCatalog, seriesItems]);

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
    const movieRows = homeMovies
      .filter((item) => Boolean(item.stream_icon && /^https?:\/\//i.test(item.stream_icon)))
      .map((item) => ({
        id: `movie-${item.stream_id}`,
        title: item.name,
        subtitle: item.genre || t("movies"),
        image: item.stream_icon as string,
        movie: item,
      }));
    const seriesRows = homeSeries
      .filter((item) => Boolean(item.cover && /^https?:\/\//i.test(item.cover)))
      .map((item) => ({
        id: `series-${item.series_id}`,
        title: item.name,
        subtitle: t("series"),
        image: item.cover as string,
        series: item,
      }));
    return [...movieRows, ...seriesRows].slice(0, 6);
  }, [homeMovies, homeSeries, t]);

  const movieValue = vod === null
    ? (vodCategories > 0 ? t("categoryCount", { count: vodCategories.toLocaleString() }) : "—")
    : vod.toLocaleString();
  const seriesValue = series === null
    ? (seriesCategories > 0 ? t("categoryCount", { count: seriesCategories.toLocaleString() }) : "—")
    : series.toLocaleString();

  const continueShelf = continueEntries.map<HomeShelfEntry>((item) => ({
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    image: artworkForProgress(item),
    progress: item.duration > 0 ? Math.max(0, Math.min(1, item.position / item.duration)) : undefined,
    onPress: () => onOpenMedia(item),
    onRemove: () => void removeProgress(item.source),
  }));

  const recentShelf = recentChannels.map<HomeShelfEntry>((channel) => ({
    id: channel.id,
    title: channel.name,
    subtitle: channel.category,
    image: channel.logoUrl,
    onPress: () => onOpenLive(channel),
    onRemove: () => onRemoveLive(channel.id),
  }));

  const liveShelf = channels.slice(0, 18).map<HomeShelfEntry>((channel) => ({
    id: `live-${channel.id}`,
    title: channel.name,
    subtitle: channel.category,
    image: channel.logoUrl,
    onPress: () => onOpenLive(channel),
  }));
  const movieShelf = homeMovies.slice(0, 18).map<HomeShelfEntry>((item) => ({
    id: `movie-${item.stream_id}`,
    title: item.name,
    subtitle: item.genre || t("movies"),
    image: item.stream_icon,
    onPress: () => onOpenMovie(item),
  }));
  const seriesShelf = homeSeries.slice(0, 18).map<HomeShelfEntry>((item) => ({
    id: `series-${item.series_id}`,
    title: item.name,
    subtitle: t("series"),
    image: item.cover,
    onPress: () => onOpenSeries(item),
  }));

  return <View style={s.homeDiscoveryShell}>
    <HomeHeroCarousel
      items={heroItems}
      eyebrow={copy.featured}
      providerName={provider.name}
      onOpen={(item) => item.movie ? onOpenMovie(item.movie) : item.series ? onOpenSeries(item.series) : undefined}
      onDiscover={() => onNavigate("movies")}
      discoverLabel={copy.discover}
    />

    <View style={s.homeCompactStats}>
      <HomeCountCard icon="radio" label={t("liveTv")} value={live.toLocaleString()} accent={colors.primary} preferredFocus={!heroItems.length} onPress={() => onNavigate("live")} />
      <HomeCountCard icon="film" label={t("movies")} value={movieValue} accent="#49B9FF" onPress={() => onNavigate("movies")} />
      <HomeCountCard icon="tv" label={t("series")} value={seriesValue} accent="#8C8CFF" onPress={() => onNavigate("series")} />
    </View>

    {continueShelf.length ? <HomeShelf title={copy.continue} seeAll={copy.seeAll} items={continueShelf} onSeeAll={() => onNavigate("history")} /> : null}
    {recentShelf.length ? <HomeShelf title={copy.recent} seeAll={copy.seeAll} items={recentShelf} onSeeAll={() => onNavigate("history")} compact /> : null}
    <HomeShelf title={t("liveTv")} seeAll={copy.seeAll} items={liveShelf} onSeeAll={() => onNavigate("live")} compact />
    <HomeShelf title={t("movies")} seeAll={copy.seeAll} items={movieShelf} onSeeAll={() => onNavigate("movies")} emptyLabel={copy.discover} />
    <HomeShelf title={t("series")} seeAll={copy.seeAll} items={seriesShelf} onSeeAll={() => onNavigate("series")} emptyLabel={copy.discover} />
  </View>;
}

function TvFocusPressable({ children, onPress, onLongPress, preferredFocus = false, style, onFocus }: {
  children: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  preferredFocus?: boolean;
  style?: any;
  onFocus?: () => void;
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return <Pressable
    focusable
    hasTVPreferredFocus={Platform.isTV && preferredFocus}
    onFocus={() => {
      if (Platform.isTV) setFocused(true);
      onFocus?.();
    }}
    onBlur={() => Platform.isTV && setFocused(false)}
    onPress={onPress}
    onLongPress={onLongPress}
    style={[
      style,
      Platform.isTV ? s.homeTvFocusBase : null,
      Platform.isTV && focused ? [s.homeTvFocusActive, { borderColor: colors.primary, shadowColor: colors.primary }] : null,
    ]}
  >{children}</Pressable>;
}

function HomeHeroCarousel({ items, eyebrow, providerName, onOpen, onDiscover, discoverLabel }: {
  items: HomeHeroEntry[];
  eyebrow: string;
  providerName: string;
  onOpen: (item: HomeHeroEntry) => void;
  onDiscover: () => void;
  discoverLabel: string;
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(280, Math.min(width - 36, 1464));
  const listRef = useRef<FlatList<HomeHeroEntry>>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => {
      setIndex((current) => {
        const next = (current + 1) % items.length;
        listRef.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, 5600);
    return () => clearInterval(timer);
  }, [items.length]);

  if (!items.length) {
    return <TvFocusPressable preferredFocus onPress={onDiscover} style={[s.homeHeroEmpty, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <LinearGradient colors={["rgba(0,212,255,0.12)", "rgba(5,9,20,0.02)"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Text style={[s.homeHeroEyebrow, { color: colors.primary }]}>{providerName}</Text>
        <Text style={[s.homeHeroTitle, { color: colors.foreground }]}>{discoverLabel}</Text>
        <Text style={[s.homeHeroMeta, { color: colors.mutedForeground }]}>{eyebrow}</Text>
      </View>
    </TvFocusPressable>;
  }

  return <View>
    <FlatList
      ref={listRef}
      data={items}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      keyExtractor={(item) => item.id}
      getItemLayout={(_data, itemIndex) => ({ length: cardWidth, offset: cardWidth * itemIndex, index: itemIndex })}
      onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / cardWidth))}
      renderItem={({ item, index: itemIndex }) => <TvFocusPressable
        preferredFocus={itemIndex === 0}
        onPress={() => onOpen(item)}
        onFocus={() => listRef.current?.scrollToIndex({ index: itemIndex, animated: true })}
        style={[s.homeHeroCard, { width: cardWidth, borderColor: "transparent" }]}
      >
        <Image source={{ uri: item.image }} resizeMode="cover" style={StyleSheet.absoluteFill} />
        <LinearGradient colors={["rgba(2,6,16,0.02)", "rgba(2,6,16,0.18)", "rgba(2,6,16,0.92)"]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={s.homeHeroCaption}>
          <Text style={[s.homeHeroEyebrow, { color: colors.primary }]}>{eyebrow}</Text>
          <Text numberOfLines={2} style={s.homeHeroImageTitle}>{item.title}</Text>
          <Text numberOfLines={1} style={s.homeHeroImageMeta}>{item.subtitle}</Text>
        </View>
      </TvFocusPressable>}
    />
    {!Platform.isTV && items.length > 1 ? <View style={s.homeHeroDots}>{items.map((item, dotIndex) => <View key={item.id} style={[s.homeHeroDot, { backgroundColor: dotIndex === index ? colors.primary : "rgba(255,255,255,0.30)" }]} />)}</View> : null}
  </View>;
}

function HomeCountCard({ icon, label, value, accent, onPress, preferredFocus = false }: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  accent: string;
  onPress: () => void;
  preferredFocus?: boolean;
}) {
  const colors = useColors();
  return <TvFocusPressable preferredFocus={preferredFocus} onPress={onPress} style={[s.homeCompactStatCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <LinearGradient colors={[`${accent}18`, "rgba(255,255,255,0.015)"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
    <View style={[s.homeCompactStatIcon, { backgroundColor: `${accent}18` }]}><Feather name={icon} size={18} color={accent} /></View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={[s.homeCompactStatLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text numberOfLines={1} style={[s.homeCompactStatValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  </TvFocusPressable>;
}

function HomeShelf({ title, seeAll, items, onSeeAll, compact = false, emptyLabel }: {
  title: string;
  seeAll: string;
  items: HomeShelfEntry[];
  onSeeAll: () => void;
  compact?: boolean;
  emptyLabel?: string;
}) {
  const colors = useColors();
  const listRef = useRef<FlatList<HomeShelfEntry>>(null);
  return <View style={s.homeShelfSection}>
    <View style={s.homeShelfHeader}>
      <Text style={[s.homeShelfTitle, { color: colors.foreground }]}>{title}</Text>
      <TvFocusPressable onPress={onSeeAll} style={s.homeSeeAllButton}>
        <Text style={[s.homeSeeAllText, { color: colors.primary }]}>{seeAll}</Text>
        <Feather name="arrow-right" size={15} color={colors.primary} />
      </TvFocusPressable>
    </View>
    {items.length ? <FlatList
      ref={listRef}
      horizontal
      data={items}
      keyExtractor={(item) => item.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.homeShelfList}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={5}
      renderItem={({ item, index }) => <TvFocusPressable
        onPress={item.onPress}
        onLongPress={Platform.isTV ? item.onRemove : undefined}
        onFocus={() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.45 })}
        style={[compact ? s.homeShelfCardCompact : s.homeShelfCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={[compact ? s.homeShelfImageCompact : s.homeShelfImage, { backgroundColor: colors.muted }]}>
          {item.image ? <Image source={{ uri: item.image }} resizeMode="cover" style={StyleSheet.absoluteFill} /> : <View style={s.homeShelfFallback}><Feather name={compact ? "radio" : "play-circle"} size={28} color={colors.primary} /></View>}
          {!Platform.isTV && item.onRemove ? <Pressable onPress={item.onRemove} hitSlop={8} style={s.homeShelfRemove}><Feather name="x" size={14} color="#fff" /></Pressable> : null}
        </View>
        <Text numberOfLines={1} style={[s.homeShelfCardTitle, { color: colors.foreground }]}>{item.title}</Text>
        {item.subtitle ? <Text numberOfLines={1} style={[s.homeShelfCardMeta, { color: colors.mutedForeground }]}>{item.subtitle}</Text> : null}
        {item.progress !== undefined ? <View style={[s.homeProgressTrack, { backgroundColor: colors.muted }]}><View style={[s.homeProgressFill, { width: `${Math.round(item.progress * 100)}%`, backgroundColor: colors.primary }]} /></View> : null}
      </TvFocusPressable>}
    /> : <TvFocusPressable onPress={onSeeAll} style={[s.homeShelfEmpty, { borderColor: colors.border }]}><Text style={{ color: colors.mutedForeground }}>{emptyLabel || "—"}</Text><Feather name="arrow-right" size={17} color={colors.primary} /></TvFocusPressable>}
  </View>;
}
'''
text = text[:start] + new_home + text[end:]

style_anchor = '  drawerBackdrop: { flex: 1, flexDirection: "row", backgroundColor: "rgba(0,0,0,0.52)" },'
new_styles = r'''  homeDiscoveryShell: { paddingTop: 4, paddingBottom: 26, gap: 4 },
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
  homeCompactStatCard: { flex: 1, minWidth: 0, minHeight: 76, borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10, overflow: "hidden" },
  homeCompactStatIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  homeCompactStatLabel: { fontSize: 11, fontWeight: "600" },
  homeCompactStatValue: { fontSize: 18, lineHeight: 23, fontWeight: "800", marginTop: 1 },
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
  homeShelfFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  homeShelfRemove: { position: "absolute", top: 6, right: 6, width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.70)" },
  homeShelfCardTitle: { fontSize: 13, lineHeight: 18, fontWeight: "700", marginTop: 7 },
  homeShelfCardMeta: { fontSize: 11, lineHeight: 15, marginTop: 1 },
  homeProgressTrack: { height: 3, borderRadius: 3, overflow: "hidden", marginTop: 7 },
  homeProgressFill: { height: "100%", borderRadius: 3 },
  homeShelfEmpty: { minHeight: 58, borderWidth: 1, borderRadius: 14, borderStyle: "dashed", paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  homeTvFocusBase: { borderWidth: 2, borderColor: "transparent" },
  homeTvFocusActive: { borderWidth: 3, shadowOpacity: 0.78, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8, transform: [{ scale: 1.025 }] },
'''
if style_anchor not in text:
    raise SystemExit("style anchor not found")
text = text.replace(style_anchor, new_styles + style_anchor, 1)
home_path.write_text(text)

context_path = Path("artifacts/legendstream-xplayer/context/PlayerContext.tsx")
context = context_path.read_text()

def context_replace(old: str, new: str, label: str):
    global context
    count = context.count(old)
    if count != 1:
        raise SystemExit(f"context {label}: expected 1 match, found {count}")
    context = context.replace(old, new, 1)

context_replace(
    '  recordWatched: (channelId: string) => Promise<void>;\n  clearError: () => void;',
    '  recordWatched: (channelId: string) => Promise<void>;\n  removeWatched: (channelId: string) => Promise<void>;\n  clearError: () => void;',
    "interface",
)
context_replace(
    '''  const recordWatched = async (channelId: string) => {
    const current = stateRef.current;
    await persist({
      ...current,
      history: [
        channelId,
        ...current.history.filter((id) => id !== channelId),
      ].slice(0, 50),
    });
  };
''',
    '''  const recordWatched = async (channelId: string) => {
    const current = stateRef.current;
    await persist({
      ...current,
      history: [
        channelId,
        ...current.history.filter((id) => id !== channelId),
      ].slice(0, 50),
    });
  };

  const removeWatched = async (channelId: string) => {
    const current = stateRef.current;
    await persist({
      ...current,
      history: current.history.filter((id) => id !== channelId),
    });
  };
''',
    "method",
)
context_replace(
    '      recordWatched,\n      clearError: () => setError(null),',
    '      recordWatched,\n      removeWatched,\n      clearError: () => setError(null),',
    "value",
)
context_path.write_text(context)
