from pathlib import Path

HOME = Path('artifacts/legendstream-xplayer/components/OptimizedHomeScreenV6.tsx')
I18N = Path('artifacts/legendstream-xplayer/context/I18nContext.tsx')

home = HOME.read_text(encoding='utf-8')

def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, got {count}')
    return text.replace(old, new, 1)

# Home: expose category counts separately from exact item counts.
home = replace_once(
    home,
    '{view === "home" ? <Home provider={shownProvider} providers={providers} live={providerChannels.length} vod={homeVodCount} series={homeSeriesCount} loading={isLoading} onRefresh={() => void refreshProvider()} onNavigate={navigate} onSwitch={(id) => void switchProvider(id)} onAdd={() => setAdding(true)} /> : null}',
    '{view === "home" ? <Home provider={shownProvider} providers={providers} live={providerChannels.length} vod={homeVodCount} series={homeSeriesCount} vodCategories={vodCats.length} seriesCategories={seriesCats.length} loading={isLoading} onRefresh={() => void refreshProvider()} onNavigate={navigate} onSwitch={(id) => void switchProvider(id)} onAdd={() => setAdding(true)} /> : null}',
    'home props',
)

home = replace_once(
    home,
    'function Home({ provider, providers, live, vod, series, loading, onRefresh, onNavigate, onSwitch, onAdd }: {\n  provider: ProviderConfig; providers: ProviderConfig[]; live: number; vod: number | null; series: number | null; loading: boolean;',
    'function Home({ provider, providers, live, vod, series, vodCategories, seriesCategories, loading, onRefresh, onNavigate, onSwitch, onAdd }: {\n  provider: ProviderConfig; providers: ProviderConfig[]; live: number; vod: number | null; series: number | null; vodCategories: number; seriesCategories: number; loading: boolean;',
    'home signature',
)

home = replace_once(
    home,
    '<Stat label={t("movies")} value={vod === null ? t("tapToLoad") : vod.toLocaleString()} onPress={() => onNavigate("movies")} />\n      <Stat label={t("series")} value={series === null ? t("tapToLoad") : series.toLocaleString()} onPress={() => onNavigate("series")} />',
    '<Stat label={t("movies")} value={vod === null ? (vodCategories > 0 ? t("categoryCount", { count: vodCategories.toLocaleString() }) : t("tapToLoad")) : vod.toLocaleString()} onPress={() => onNavigate("movies")} />\n      <Stat label={t("series")} value={series === null ? (seriesCategories > 0 ? t("categoryCount", { count: seriesCategories.toLocaleString() }) : t("tapToLoad")) : series.toLocaleString()} onPress={() => onNavigate("series")} />',
    'home category fallback labels',
)

# Movies: first real Xtream category auto-selects and lazy-loads on first entry.
movies_anchor = '''  useEffect(() => {\n    if (category !== "__all__" && cats.length > 0 && !categoryIds.includes(category)) {\n      catalogCategoryMemory.movies = "__all__";\n      setCategory("__all__");\n    }\n  }, [category, categoryIds, cats.length]);\n'''
movies_insert = movies_anchor + '''\n  useEffect(() => {\n    if (providerType !== "xtream" || category !== "__all__" || !cats.length || items.length || loading) return;\n    const first = String(cats[0].category_id);\n    catalogCategoryMemory.movies = first;\n    setCategory(first);\n    setLimit(60);\n    onCategory(first);\n  }, [providerType, category, cats, items.length, loading]);\n'''
home = replace_once(home, movies_anchor, movies_insert, 'movies first category effect')

series_anchor = '''  useEffect(() => {\n    if (category !== "__all__" && cats.length > 0 && !categoryIds.includes(category)) {\n      catalogCategoryMemory.series = "__all__";\n      setCategory("__all__");\n    }\n  }, [category, categoryIds, cats.length]);\n'''
series_insert = series_anchor + '''\n  useEffect(() => {\n    if (providerType !== "xtream" || category !== "__all__" || !cats.length || items.length || loading) return;\n    const first = String(cats[0].category_id);\n    catalogCategoryMemory.series = first;\n    setCategory(first);\n    setLimit(60);\n    onCategory(first);\n  }, [providerType, category, cats, items.length, loading]);\n'''
home = replace_once(home, series_anchor, series_insert, 'series first category effect')

# Drawer: remove close-swipe responder from the FlatList ancestor. Keep it on header only.
home = replace_once(
    home,
    '''      <Animated.View\n        {...closeSwipe.panHandlers}\n        style={[\n''',
    '''      <Animated.View\n        style={[\n''',
    'drawer ancestor pan responder',
)
home = replace_once(
    home,
    '        <View style={s.drawerHeader}>',
    '        <View style={s.drawerHeader} {...closeSwipe.panHandlers}>',
    'drawer header pan responder',
)

HOME.write_text(home, encoding='utf-8')

i18n = I18N.read_text(encoding='utf-8')
i18n = replace_once(
    i18n,
    'tapToLoad: "Yüklemek için dokun", channels:',
    'tapToLoad: "Yüklemek için dokun", categoryCount: "{count} kategori", channels:',
    'tr categoryCount',
)
i18n = replace_once(
    i18n,
    'tapToLoad: "Tap to load", channels:',
    'tapToLoad: "Tap to load", categoryCount: "{count} categories", channels:',
    'en categoryCount',
)
I18N.write_text(i18n, encoding='utf-8')

print('Applied Xtream category-count/first-category and drawer responder hotfix.')
