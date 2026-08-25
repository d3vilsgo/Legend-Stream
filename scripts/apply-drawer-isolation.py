from pathlib import Path

path = Path("artifacts/legendstream-xplayer/components/OptimizedHomeScreenV6.tsx")
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    '  const [selectedSeries, setSelectedSeries] = useState<XtreamSeriesItem | null>(null);\n  const [seriesInfo, setSeriesInfo] = useState<XtreamSeriesInfo | null>(null);',
    '  const [selectedSeries, setSelectedSeries] = useState<XtreamSeriesItem | null>(null);\n  const [seriesInfo, setSeriesInfo] = useState<XtreamSeriesInfo | null>(null);\n  const [catalogDrawerOpen, setCatalogDrawerOpen] = useState(false);',
    'parent drawer state',
)

replace_once(
    '<ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>',
    '<ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} scrollEnabled={!catalogDrawerOpen} pointerEvents={catalogDrawerOpen ? "none" : "auto"}>',
    'outer ScrollView isolation',
)

replace_once(
    'onRefresh={(category) => category === "__all__" ? void loadVod(true) : void loadVodCategory(category, true)} onOpen={openMovie} />',
    'onRefresh={(category) => category === "__all__" ? void loadVod(true) : void loadVodCategory(category, true)} onOpen={openMovie} onDrawerVisibilityChange={setCatalogDrawerOpen} />',
    'movies parent callback',
)

replace_once(
    'onBack={() => { setSelectedSeries(null); setSeriesInfo(null); }} onEpisode={playEpisode} />',
    'onBack={() => { setSelectedSeries(null); setSeriesInfo(null); }} onEpisode={playEpisode} onDrawerVisibilityChange={setCatalogDrawerOpen} />',
    'series parent callback',
)

replace_once(
    '''function useCategoryDrawerSwipe(onOpen: () => void) {
  return useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx > 18 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35,
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx > 55) onOpen();
      },
      onPanResponderTerminate: () => undefined,
    }),
    [onOpen],
  );
}''',
    '''function useCategoryDrawerSwipe(onOpen: () => void, disabled = false) {
  return useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        !disabled &&
        gesture.dx > 18 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35,
      onPanResponderRelease: (_event, gesture) => {
        if (!disabled && gesture.dx > 55) onOpen();
      },
      onPanResponderTerminate: () => undefined,
    }),
    [disabled, onOpen],
  );
}''',
    'drawer opening PanResponder guard',
)

replace_once(
    '  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true));\n\n  useEffect(() => {\n    const timer = setInterval(() => setEpgClock(Date.now()), 60_000);',
    '  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true), drawerOpen);\n\n  useEffect(() => {\n    const timer = setInterval(() => setEpgClock(Date.now()), 60_000);',
    'live PanResponder guard',
)

replace_once(
    'function Movies({ items, cats, providerType, sortMode, onSort, loading, loaded, onCategory, onRefresh, onOpen }: {',
    'function Movies({ items, cats, providerType, sortMode, onSort, loading, loaded, onCategory, onRefresh, onOpen, onDrawerVisibilityChange }: {',
    'movies signature',
)
replace_once(
    '  onOpen: (item: XtreamVodItem) => void;\n}) {',
    '  onOpen: (item: XtreamVodItem) => void;\n  onDrawerVisibilityChange: (visible: boolean) => void;\n}) {',
    'movies prop type',
)
replace_once(
    '  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true));\n  const effectiveSort = providerType === "m3u" && sortMode === "added" ? "default" : sortMode;\n\n  useEffect(() => {\n    if (category !== "__all__" && cats.length > 0 && !categoryIds.includes(category)) {',
    '  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true), drawerOpen);\n  const effectiveSort = providerType === "m3u" && sortMode === "added" ? "default" : sortMode;\n\n  useEffect(() => {\n    onDrawerVisibilityChange(drawerOpen);\n  }, [drawerOpen, onDrawerVisibilityChange]);\n\n  useEffect(() => () => onDrawerVisibilityChange(false), [onDrawerVisibilityChange]);\n\n  useEffect(() => {\n    if (category !== "__all__" && cats.length > 0 && !categoryIds.includes(category)) {',
    'movies drawer isolation effect',
)

replace_once(
    'function Series({ items, cats, providerType, sortMode, onSort, loading, loaded, selected, info, onCategory, onRefresh, onOpen, onBack, onEpisode }: {',
    'function Series({ items, cats, providerType, sortMode, onSort, loading, loaded, selected, info, onCategory, onRefresh, onOpen, onBack, onEpisode, onDrawerVisibilityChange }: {',
    'series signature',
)
replace_once(
    '  onCategory: (categoryId: string) => void; onRefresh: (categoryId: string) => void; onOpen: (item: XtreamSeriesItem) => void; onBack: () => void; onEpisode: (episode: XtreamEpisode) => void;\n}) {',
    '  onCategory: (categoryId: string) => void; onRefresh: (categoryId: string) => void; onOpen: (item: XtreamSeriesItem) => void; onBack: () => void; onEpisode: (episode: XtreamEpisode) => void; onDrawerVisibilityChange: (visible: boolean) => void;\n}) {',
    'series prop type',
)
replace_once(
    '  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true));\n  const effectiveSort = providerType === "m3u" && sortMode === "added" ? "default" : sortMode;\n\n  useEffect(() => {\n    if (category !== "__all__" && cats.length > 0 && !categoryIds.includes(category)) {',
    '  const drawerSwipe = useCategoryDrawerSwipe(() => setDrawerOpen(true), drawerOpen);\n  const effectiveSort = providerType === "m3u" && sortMode === "added" ? "default" : sortMode;\n\n  useEffect(() => {\n    onDrawerVisibilityChange(drawerOpen);\n  }, [drawerOpen, onDrawerVisibilityChange]);\n\n  useEffect(() => () => onDrawerVisibilityChange(false), [onDrawerVisibilityChange]);\n\n  useEffect(() => {\n    if (category !== "__all__" && cats.length > 0 && !categoryIds.includes(category)) {',
    'series drawer isolation effect',
)

path.write_text(text)
