from pathlib import Path

path = Path("artifacts/legendstream-xplayer/components/OptimizedHomeScreenV6.tsx")
text = path.read_text()


def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    '  const [homeVodCount, setHomeVodCount] = useState<number | null>(null);\n  const [homeSeriesCount, setHomeSeriesCount] = useState<number | null>(null);',
    '  const [homeVodCount, setHomeVodCount] = useState<number | null>(null);\n  const [homeSeriesCount, setHomeSeriesCount] = useState<number | null>(null);\n  const [homeCatalogLoading, setHomeCatalogLoading] = useState(false);',
    'home loading state',
)

replace_once(
    '    setHomeVodCount(null); setHomeSeriesCount(null);\n    setProviderTypeOverride(null);',
    '    setHomeVodCount(null); setHomeSeriesCount(null); setHomeCatalogLoading(false);\n    setProviderTypeOverride(null);',
    'provider reset',
)

old_effect = '''  useEffect(() => {
    if (!effectiveProvider) return;
    if (effectiveProvider.type === "m3u") {
      const local = getM3UCatalog(effectiveProvider.id);
      setHomeVodCount(local.movieItems.length);
      setHomeSeriesCount(local.seriesGroups.length);
      return;
    }
    if (effectiveProvider.type !== "xtream" || !credentials) return;

    // A get.php/m3u_plus URL can be either a real Xtream account or a playlist
    // source that was explicitly saved as M3U. Early Home counts are read-only:
    // never probe these ambiguous legacy records in the background. The normal
    // Movies/Series path still performs its existing category request and can
    // migrate on a typed catalog-format failure.
    if (isGetPhpM3UPlusProvider(effectiveProvider)) return;

    let cancelled = false;
    void (async () => {
      const [vodResult, seriesResult] = await Promise.allSettled([
        getVodCategories(credentials),
        getSeriesCategories(credentials),
      ]);
      if (cancelled) return;

      if (vodResult.status === "fulfilled") {
        setVodCats(vodResult.value);
        setVodLoaded(true);
        setHomeVodCount(exactCategoryTotal(vodResult.value));
      }
      if (seriesResult.status === "fulfilled") {
        setSeriesCats(seriesResult.value);
        setSeriesLoaded(true);
        setHomeSeriesCount(exactCategoryTotal(seriesResult.value));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveProvider, credentials]);'''

new_effect = '''  useEffect(() => {
    if (!effectiveProvider) {
      setHomeCatalogLoading(false);
      return;
    }
    if (effectiveProvider.type === "m3u") {
      const local = getM3UCatalog(effectiveProvider.id);
      setHomeVodCount(local.movieItems.length);
      setHomeSeriesCount(local.seriesGroups.length);
      setHomeCatalogLoading(false);
      return;
    }
    if (effectiveProvider.type !== "xtream" || !credentials) {
      setHomeCatalogLoading(false);
      return;
    }

    // A get.php/m3u_plus URL can be either a real Xtream account or a playlist
    // source that was explicitly saved as M3U. Early Home counts are read-only:
    // never probe these ambiguous legacy records in the background. The normal
    // Movies/Series path still performs its existing category request and can
    // migrate on a typed catalog-format failure.
    if (isGetPhpM3UPlusProvider(effectiveProvider)) {
      setHomeCatalogLoading(false);
      return;
    }

    let cancelled = false;
    setHomeCatalogLoading(true);
    void (async () => {
      try {
        const [vodResult, seriesResult] = await Promise.allSettled([
          getVodCategories(credentials),
          getSeriesCategories(credentials),
        ]);
        if (cancelled) return;

        if (vodResult.status === "fulfilled") {
          setVodCats(vodResult.value);
          setVodLoaded(true);
          setHomeVodCount(exactCategoryTotal(vodResult.value));
        }
        if (seriesResult.status === "fulfilled") {
          setSeriesCats(seriesResult.value);
          setSeriesLoaded(true);
          setHomeSeriesCount(exactCategoryTotal(seriesResult.value));
        }
      } finally {
        if (!cancelled) setHomeCatalogLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveProvider, credentials]);'''
replace_once(old_effect, new_effect, 'home catalog effect')

replace_once(
    '        seriesCategories={seriesCats.length}\n        channels={providerChannels}',
    '        seriesCategories={seriesCats.length}\n        catalogLoading={homeCatalogLoading}\n        channels={providerChannels}',
    'home props call',
)

replace_once(
    'function Home({ provider, live, vod, series, vodCategories, seriesCategories, channels, history, movies, seriesItems, onNavigate, onOpenLive, onOpenMovie, onOpenSeries, onOpenMedia, onRemoveLive }: {\n  provider: ProviderConfig;\n  live: number;\n  vod: number | null;\n  series: number | null;\n  vodCategories: number;\n  seriesCategories: number;',
    'function Home({ provider, live, vod, series, vodCategories, seriesCategories, catalogLoading, channels, history, movies, seriesItems, onNavigate, onOpenLive, onOpenMovie, onOpenSeries, onOpenMedia, onRemoveLive }: {\n  provider: ProviderConfig;\n  live: number;\n  vod: number | null;\n  series: number | null;\n  vodCategories: number;\n  seriesCategories: number;\n  catalogLoading: boolean;',
    'home signature',
)

replace_once(
    '''  const localCatalog = useMemo(
    () => provider.type === "m3u" ? getM3UCatalog(provider.id) : null,
    [provider.id, provider.type],
  );''',
    '''  // getM3UCatalog is an in-memory provider cache that is populated by the
  // M3U loader. Read it on every Home render instead of memoising the first
  // (possibly empty) snapshot; provider/channel state changes already trigger
  // the render once parsing completes.
  const localCatalog = provider.type === "m3u" ? getM3UCatalog(provider.id) : null;''',
    'm3u catalog freshness',
)

replace_once(
    '      discoverLabel={copy.discover}\n    />',
    '      discoverLabel={copy.discover}\n      loading={catalogLoading}\n    />',
    'hero loading prop',
)

replace_once(
    '    <HomeShelf title={t("movies")} seeAll={copy.seeAll} items={movieShelf} onSeeAll={() => onNavigate("movies")} emptyLabel={copy.discover} />\n    <HomeShelf title={t("series")} seeAll={copy.seeAll} items={seriesShelf} onSeeAll={() => onNavigate("series")} emptyLabel={copy.discover} />',
    '    <HomeShelf title={t("movies")} seeAll={copy.seeAll} items={movieShelf} onSeeAll={() => onNavigate("movies")} emptyLabel={copy.discover} loading={catalogLoading} />\n    <HomeShelf title={t("series")} seeAll={copy.seeAll} items={seriesShelf} onSeeAll={() => onNavigate("series")} emptyLabel={copy.discover} loading={catalogLoading} />',
    'shelf loading props',
)

replace_once(
    'function HomeHeroCarousel({ items, eyebrow, providerName, onOpen, onDiscover, discoverLabel }: {\n  items: HomeHeroEntry[];\n  eyebrow: string;\n  providerName: string;\n  onOpen: (item: HomeHeroEntry) => void;\n  onDiscover: () => void;\n  discoverLabel: string;\n}) {',
    'function HomeHeroCarousel({ items, eyebrow, providerName, onOpen, onDiscover, discoverLabel, loading = false }: {\n  items: HomeHeroEntry[];\n  eyebrow: string;\n  providerName: string;\n  onOpen: (item: HomeHeroEntry) => void;\n  onDiscover: () => void;\n  discoverLabel: string;\n  loading?: boolean;\n}) {',
    'hero signature',
)

replace_once(
    '''  if (!items.length) {
    return <TvFocusPressable preferredFocus onPress={onDiscover} style={[s.homeHeroEmpty, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <LinearGradient colors={["rgba(0,212,255,0.12)", "rgba(5,9,20,0.02)"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Text style={[s.homeHeroEyebrow, { color: colors.primary }]}>{providerName}</Text>
        <Text style={[s.homeHeroTitle, { color: colors.foreground }]}>{discoverLabel}</Text>
        <Text style={[s.homeHeroMeta, { color: colors.mutedForeground }]}>{eyebrow}</Text>
      </View>
    </TvFocusPressable>;
  }''',
    '''  if (!items.length) {
    if (loading) {
      return <View style={[s.homeHeroEmpty, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <LinearGradient colors={["rgba(0,212,255,0.10)", "rgba(5,9,20,0.02)"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={{ flex: 1, justifyContent: "flex-end", gap: 10 }}>
          <View style={[s.homeSkeletonLine, { width: "28%", backgroundColor: colors.muted }]} />
          <View style={[s.homeSkeletonLine, { width: "68%", height: 24, backgroundColor: colors.muted }]} />
          <View style={[s.homeSkeletonLine, { width: "42%", backgroundColor: colors.muted }]} />
        </View>
      </View>;
    }
    return <TvFocusPressable preferredFocus onPress={onDiscover} style={[s.homeHeroEmpty, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <LinearGradient colors={["rgba(0,212,255,0.12)", "rgba(5,9,20,0.02)"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Text style={[s.homeHeroEyebrow, { color: colors.primary }]}>{providerName}</Text>
        <Text style={[s.homeHeroTitle, { color: colors.foreground }]}>{discoverLabel}</Text>
        <Text style={[s.homeHeroMeta, { color: colors.mutedForeground }]}>{eyebrow}</Text>
      </View>
    </TvFocusPressable>;
  }''',
    'hero skeleton',
)

replace_once(
    '<Text numberOfLines={1} style={[s.homeCompactStatValue, { color: colors.foreground }]}>{value}</Text>',
    '<Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.45} style={[s.homeCompactStatValue, { color: colors.foreground }]}>{value}</Text>',
    'counter fitting',
)

replace_once(
    'function HomeShelf({ title, seeAll, items, onSeeAll, compact = false, emptyLabel }: {\n  title: string;\n  seeAll: string;\n  items: HomeShelfEntry[];\n  onSeeAll: () => void;\n  compact?: boolean;\n  emptyLabel?: string;\n}) {',
    'function HomeShelf({ title, seeAll, items, onSeeAll, compact = false, emptyLabel, loading = false }: {\n  title: string;\n  seeAll: string;\n  items: HomeShelfEntry[];\n  onSeeAll: () => void;\n  compact?: boolean;\n  emptyLabel?: string;\n  loading?: boolean;\n}) {',
    'shelf signature',
)

replace_once(
    '    /> : <TvFocusPressable onPress={onSeeAll} style={[s.homeShelfEmpty, { borderColor: colors.border }]}><Text style={{ color: colors.mutedForeground }}>{emptyLabel || "—"}</Text><Feather name="arrow-right" size={17} color={colors.primary} /></TvFocusPressable>}\n  </View>;',
    '    /> : loading ? <View style={s.homeShelfSkeletonRow}>{[0, 1, 2].map((index) => <View key={index} style={[s.homeShelfSkeletonCard, { borderColor: colors.border, backgroundColor: colors.card }]}><View style={[s.homeShelfSkeletonImage, { backgroundColor: colors.muted }]} /><View style={[s.homeSkeletonLine, { width: "72%", backgroundColor: colors.muted }]} /></View>)}</View> : <TvFocusPressable onPress={onSeeAll} style={[s.homeShelfEmpty, { borderColor: colors.border }]}><Text style={{ color: colors.mutedForeground }}>{emptyLabel || "—"}</Text><Feather name="arrow-right" size={17} color={colors.primary} /></TvFocusPressable>}\n  </View>;',
    'shelf skeleton',
)

replace_once(
    '  homeCompactStatCard: { flex: 1, minWidth: 0, minHeight: 76, borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10, overflow: "hidden" },\n  homeCompactStatIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },\n  homeCompactStatLabel: { fontSize: 11, fontWeight: "600" },\n  homeCompactStatValue: { fontSize: 18, lineHeight: 23, fontWeight: "800", marginTop: 1 },',
    '  homeCompactStatCard: { flex: 1, minWidth: 0, minHeight: 76, borderWidth: 1, borderRadius: 16, paddingHorizontal: 9, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 7, overflow: "hidden" },\n  homeCompactStatIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },\n  homeCompactStatLabel: { fontSize: 10, lineHeight: 13, fontWeight: "600" },\n  homeCompactStatValue: { fontSize: 17, lineHeight: 21, fontWeight: "800", marginTop: 1, flexShrink: 1 },',
    'counter styles',
)

replace_once(
    '  homeShelfEmpty: { minHeight: 58, borderWidth: 1, borderRadius: 14, borderStyle: "dashed", paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },',
    '  homeShelfEmpty: { minHeight: 58, borderWidth: 1, borderRadius: 14, borderStyle: "dashed", paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },\n  homeSkeletonLine: { height: 12, borderRadius: 8, opacity: 0.72 },\n  homeShelfSkeletonRow: { flexDirection: "row", gap: 11, paddingVertical: 3 },\n  homeShelfSkeletonCard: { width: 142, borderWidth: 1, borderRadius: 16, padding: 7, gap: 9 },\n  homeShelfSkeletonImage: { width: "100%", aspectRatio: 2 / 3, borderRadius: 11, opacity: 0.72 },',
    'skeleton styles',
)

path.write_text(text)
