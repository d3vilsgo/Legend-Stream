import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireApp = createRequire(join(app, "package.json"));
const requireServer = createRequire(resolve(app, "../api-server/package.json"));
const { build } = requireServer("esbuild");
const directory = mkdtempSync(join(tmpdir(), "p1-catalog-host-"));
const originalLoad = Module._load;
const host = {
  width: 393,
  height: 873,
  fontScale: 1,
  isTV: false,
  preview: false,
  slots: [],
  cursor: 0,
  useState(value) {
    const index = this.cursor++;
    if (!(index in this.slots)) this.slots[index] = typeof value === "function" ? value() : value;
    return [this.slots[index], (next) => {
      this.slots[index] = typeof next === "function" ? next(this.slots[index]) : next;
    }];
  },
  useRef(value) {
    const index = this.cursor++;
    return this.slots[index] ?? (this.slots[index] = { current: value });
  },
  render(fn, props) {
    this.cursor = 0;
    return fn(props);
  },
  reset() {
    this.cursor = 0;
    this.slots = [];
  },
};
const element = (tag, props, ...children) => ({
  tag,
  props: { ...props, children },
});
const react = {
  createElement: element,
  useState: (value) => host.useState(value),
  useRef: (value) => host.useRef(value),
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useEffect() {},
  useReducer: (fn, initial) => host.useState(initial),
};
const rn = {
  View: "View",
  Text: "Text",
  TextInput: "TextInput",
  Image: "Image",
  FlatList: "FlatList",
  Pressable: "Pressable",
  Modal: "Modal",
  ScrollView: "ScrollView",
  ActivityIndicator: "ActivityIndicator",
  Platform: { get isTV() { return host.isTV; }, OS: "android" },
  useWindowDimensions: () => ({ width: host.width, height: host.height, fontScale: host.fontScale, scale: 1 }),
  StyleSheet: { create: (style) => style, hairlineWidth: 1 },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  Animated: {
    Value: class { setValue() {} },
    View: "AnimatedView",
    timing: () => ({ start(fn) { fn?.(); } }),
  },
};
const focus = { nativeScope: "content", focusedId: null, nativeFocusedId: null, restoreFocus: async () => true };
const overrides = {
  react,
  "react-native": rn,
  "react-native-safe-area-context": { useSafeAreaInsets: () => ({ left: 12, right: 12, top: 8, bottom: 20 }) },
  "@/context/UiPresentationContext": { useUiPresentation: () => ({ tvPreview: host.preview }) },
  "@/components/tvPreview/TVPreviewFocus": { useOptionalTVPreviewFocus: () => focus, useTVPreviewFocus: () => ({ registerBackAction: () => () => {} }), TVPreviewPressable: "TVPreviewPressable" },
  "@/hooks/useColors": { useColors: () => ({ foreground: "#fff", mutedForeground: "#999", primary: "#5dd", border: "#555", card: "#222", destructive: "#f55" }) },
  "@/context/I18nContext": { useI18n: () => ({ t: (key) => key }) },
  "@/lib/categoryPresentation": { filterCategoryOptions: (items) => items },
  "@/lib/catalogSearchPresentation": { shouldUseWholeCatalogLoadingSkeleton: () => false },
  "@/lib/catalogCategoryMemory": {
    readCatalogCategorySelection: () => "__all__",
    validateCatalogCategorySelection: () => "__all__",
    rememberCatalogCategorySelection: (_provider, _kind, category) => category,
  },
  "@/hooks/useCatalogPage": { useCatalogPage: ({ search }) => ({
    items: host.movieItems.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())),
    loadingInitial: false, loadingMore: false, totalCount: host.movieItems.length,
    countKnown: true, loadMore() {}, reload() {},
  }) },
  "@/lib/tmdb/movieInfoModel": {
    currentMovie: (items, id, identity) => items.find((item) => identity(item) === id) ?? null,
    pagedMovieInput: () => ({}), localXtreamMovie: () => ({}),
  },
  "@/components/FocusButton": { FocusButton: "FocusButton" },
  "@/components/series/SeriesInfoModal": { SeriesInfoModal: "SeriesInfoModal" },
  "@/components/tmdb/MovieInfoModal": { MovieInfoModal: "MovieInfoModal" },
  "@/components/tvPreview/TVRemoteInspector": { TVRemoteInspectorOverlay: "TVRemoteInspectorOverlay" },
  "@expo/vector-icons": { Feather: "Feather" },
};
const fallback = new Proxy({}, { get: (_obj, key) => key === "__esModule" ? false : () => null });
const traverse = (root, predicate, result = []) => {
  if (Array.isArray(root)) root.forEach((node) => traverse(node, predicate, result));
  else if (root && typeof root === "object" && "tag" in root) {
    if (predicate(root)) result.push(root);
    traverse(root.props?.children, predicate, result);
  }
  return result;
};
const exactly = (tree, predicate) => {
  const matches = traverse(tree, predicate);
  assert.equal(matches.length, 1);
  return matches[0];
};
try {
  await build({
    stdin: {
      contents: `export { GoldenSeriesCatalog, PagedMoviesCatalog } from ${JSON.stringify(join(app, "components/catalog/PagedCatalogViews.tsx"))};`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(directory, "catalog.cjs"),
    logLevel: "silent",
    plugins: [{
      name: "production-grid-only",
      setup(builder) {
        builder.onResolve({ filter: /^@\// }, (args) => {
          const actual = new Set([
            "@/hooks/useResponsiveCatalogGrid",
            "@/hooks/useNativeTvCatalogGrid",
            "@/lib/catalogGridLayout",
            "@/lib/nativeTvResponsive",
            "@/lib/design/layoutMetrics",
            "@/lib/design/screenProfiles",
            "@/lib/design/tokens",
          ]);
          if (!actual.has(args.path)) return { path: args.path, external: true };
          const base = join(app, args.path.slice(2));
          const found = [base, base + ".ts", base + ".tsx"].find(existsSync);
          return found ? { path: found } : { path: args.path, external: true };
        });
      },
    }],
  });
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in overrides) return overrides[request];
    if (request.startsWith("@/")) return fallback;
    return originalLoad.call(this, request, parent, isMain);
  };
  const { GoldenSeriesCatalog, PagedMoviesCatalog } = requireApp(join(directory, "catalog.cjs"));
  let pass = 0;
  const profiles = [
    ["phone portrait", 393, 873, false, false, 1],
    ["phone landscape", 873, 393, false, false, 1],
    ["tablet portrait", 800, 1280, false, false, 1],
    ["tablet landscape", 1280, 800, false, false, 1],
    ["small TV", 720, 480, true, false, 1],
    ["large TV", 1920, 1080, true, false, 1],
    ["TV Preview", 873, 393, false, true, 1],
    ["large text", 800, 1280, false, false, 2],
  ];
  for (const [name, width, height, isTV, preview, fontScale] of profiles) {
    Object.assign(host, { width, height, isTV, preview, fontScale });
    host.reset();
    const opened = [], categories = [], queries = [];
    const items = [
      { id: "series:alpha", title: "Birinci Dizi", image: "" },
      { id: "series:beta", title: "İkinci Dizi", image: "" },
    ];
    const props = {
      providerId: "provider-a",
      categories: [{ id: "news", name: "Kategori" }],
      selectedCategory: "news",
      onSelectCategory: (id) => categories.push(id),
      search: "",
      onSearch: (query) => queries.push(query),
      sortMode: "default",
      supportsAdded: false,
      onSort() {},
      refreshing: false,
      onRefresh() {},
      items,
      totalCount: 2,
      countKnown: true,
      loadingInitial: false,
      loadingMore: false,
      onLoadMore() {},
      detail: null,
      detailLoading: false,
      onOpen: (id) => opened.push(id),
      onBack() {},
      onEpisode() {},
      onDrawerVisibilityChange() {},
    };
    let tree = host.render(GoldenSeriesCatalog, props);
    const list = exactly(tree, (node) => node.tag === "FlatList");
    assert(list.props.numColumns >= 1, name);
    assert(list.props.numColumns <= 12, name);
    assert.equal(list.props.data[1].id, "series:beta", name);
    assert.equal(list.props.keyExtractor(items[0]), "series:alpha", name);
    const card = list.props.renderItem({ item: items[0], index: 0 });
    const cardComponent = exactly(card, (node) => typeof node.tag === "function");
    const renderedCard = host.render(cardComponent.tag, cardComponent.props);
    const actionable = exactly(renderedCard, (node) => node.props?.focusId === "series:series:alpha");
    actionable.props.onPress();
    assert.deepEqual(opened, ["series:alpha"], name);
    const poster = exactly(renderedCard, (node) => [node.props?.style].flat(Infinity).some((style) => style?.aspectRatio === 2 / 3));
    assert(poster, name);
    const headerComponent = list.props.ListHeaderComponent;
    host.reset();
    const header = host.render(headerComponent.tag, headerComponent.props);
    const toggle = exactly(header, (node) => node.props?.focusId === "catalog:search-toggle");
    toggle.props.onPress();
    const openedHeader = host.render(headerComponent.tag, headerComponent.props);
    const input = exactly(openedHeader, (node) => node.tag === "TextInput");
    input.props.onChangeText("Birinci");
    assert.deepEqual(queries, ["Birinci"], name);
    const closeToggle = exactly(openedHeader, (node) => node.props?.focusId === "catalog:search-toggle");
    closeToggle.props.onPress();
    const closedHeader = host.render(headerComponent.tag, headerComponent.props);
    assert.equal(traverse(closedHeader, (node) => node.tag === "TextInput").length, 0, name);
    pass++;
    // Production movie catalog: an exact provider media ID survives the info
    // transition and the Play callback never substitutes a filtered index.
    host.reset();
    const openedMovies = [];
    host.movieItems = [
      { stream_id: 7, name: "Film Alfa", stream_icon: "" },
      { stream_id: 12, name: "Film Beta", stream_icon: "" },
    ];
    const movieProps = {
      provider: { id: "provider-a", type: "xtream" },
      snapshotCount: { totalCount: 2, countKnown: true },
      sortMode: "default",
      onSort() {},
      refreshing: false,
      onRefresh() {},
      onOpen: (item) => openedMovies.push(item.stream_id),
      onDrawerVisibilityChange() {},
    };
    let movies = host.render(PagedMoviesCatalog, movieProps);
    let movieList = exactly(movies, (node) => node.tag === "FlatList");
    assert(movieList.props.numColumns >= 1, name);
    assert.equal(movieList.props.keyExtractor(host.movieItems[1]), "12", name);
    const movieWrapper = movieList.props.renderItem({ item: host.movieItems[1], index: 1 });
    const movieCard = exactly(movieWrapper, (node) => typeof node.tag === "function");
    const movieAction = exactly(host.render(movieCard.tag, movieCard.props), (node) => node.props?.focusId === "vod:12");
    movieAction.props.onPress();
    movies = host.render(PagedMoviesCatalog, movieProps);
    const info = exactly(movies, (node) => node.tag === "MovieInfoModal");
    info.props.onPlay();
    assert.deepEqual(openedMovies, [12], name);
    info.props.onClose();
    movies = host.render(PagedMoviesCatalog, movieProps);
    assert.equal(traverse(movies, (node) => node.tag === "MovieInfoModal").length, 0, name);
    movieList = exactly(movies, (node) => node.tag === "FlatList");
    assert.equal(movieList.props.data[1].stream_id, 12, name);
  }
  console.log(`P1 production GoldenSeriesCatalog render acceptance: ${pass}/${profiles.length} profiles PASS; HOST_NOT_ANDROID_PHYSICAL`);
} finally {
  Module._load = originalLoad;
  rmSync(directory, { recursive: true, force: true });
}
