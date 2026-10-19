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
    if (!(index in this.slots))
      this.slots[index] = typeof value === "function" ? value() : value;
    const ownerSlots = this.slots;
    return [
      ownerSlots[index],
      (next) => {
        ownerSlots[index] =
          typeof next === "function" ? next(ownerSlots[index]) : next;
      },
    ];
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
  Platform: {
    get isTV() {
      return host.isTV;
    },
    OS: "android",
  },
  useWindowDimensions: () => ({
    width: host.width,
    height: host.height,
    fontScale: host.fontScale,
    scale: 1,
  }),
  StyleSheet: { create: (style) => style, hairlineWidth: 1 },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  Animated: {
    Value: class {
      setValue() {}
    },
    View: "AnimatedView",
    timing: () => ({
      start(fn) {
        fn?.();
      },
    }),
  },
};
const focus = {
  nativeScope: "content",
  focusedId: null,
  nativeFocusedId: null,
  restoreFocus: async () => true,
};
const stalkerActions = [];
const overrides = {
  "@/lib/catalogPageRepository": { getCachedCatalogCategories: async () => [] },
  "@/context/PlayerContext": {
    usePlayer: () => ({
      provider: { id: "stalker-a", type: "stalker" },
      refreshEpg() {},
    }),
    selectProgramsAt: () => ({}),
  },
  "@/hooks/useStalkerLiveCatalogSync": {
    useStalkerLiveCatalogSync: () => ({
      categoriesReady: true,
      totalCount: 1,
      countKnown: true,
      refresh: () => stalkerActions.push("live-refresh"),
    }),
  },
  "@/lib/epgRuntime": { EPG_PAGED_SEED_LIMIT: 20, registerEpgChannels() {} },
  "@/hooks/useStalkerMoviesCatalog": {
    useStalkerMoviesCatalog: () => ({
      visibleItems: [
        {
          portalId: "opaque-7",
          title: "Very long Stalker title without a poster",
        },
      ],
      categories: [],
      selectedCategoryId: null,
      search: "",
      setSearch: (q) => stalkerActions.push(q),
      refresh: () => stalkerActions.push("refresh"),
      loadMore() {},
    }),
  },
  "@/lib/stalkerVod": { isStalkerVodGlobalCategory: () => false },
  react,
  "react-native": rn,
  "react-native-safe-area-context": {
    useSafeAreaInsets: () => ({ left: 12, right: 12, top: 8, bottom: 20 }),
  },
  "@/context/UiPresentationContext": {
    useUiPresentation: () => ({ tvPreview: host.preview }),
  },
  "@/components/tvPreview/TVPreviewFocus": {
    useOptionalTVPreviewFocus: () => focus,
    useTVPreviewFocus: () => ({ registerBackAction: () => () => {} }),
    TVPreviewPressable: "TVPreviewPressable",
  },
  "@/hooks/useColors": {
    useColors: () => ({
      foreground: "#fff",
      mutedForeground: "#999",
      primary: "#5dd",
      border: "#555",
      card: "#222",
      destructive: "#f55",
    }),
  },
  "@/context/I18nContext": { useI18n: () => ({ t: (key) => key }) },
  "@/lib/categoryPresentation": { filterCategoryOptions: (items) => items },
  "@/lib/catalogSearchPresentation": {
    shouldUseWholeCatalogLoadingSkeleton: () => false,
  },
  "@/lib/catalogCategoryMemory": {
    readCatalogCategorySelection: () => "__all__",
    validateCatalogCategorySelection: () => "__all__",
    rememberCatalogCategorySelection: (_provider, _kind, category) => category,
  },
  "@/hooks/useCatalogPage": {
    useCatalogPage: ({ search }) => ({
      items: host.movieItems.filter((item) =>
        item.name.toLowerCase().includes(search.toLowerCase()),
      ),
      loadingInitial: false,
      loadingMore: false,
      totalCount: host.movieItems.length,
      countKnown: true,
      loadMore() {},
      reload() {},
    }),
  },
  "@/lib/tmdb/movieInfoModel": {
    currentMovie: (items, id, identity) =>
      items.find((item) => identity(item) === id) ?? null,
    pagedMovieInput: (providerId, providerType, catalogRevision, item) => ({
      catalogRevision,
      identity: { providerId, providerType, catalogId: String(item.stream_id) },
    }),
    localXtreamMovie: () => ({}),
  },
  "@/components/FocusButton": { FocusButton: "FocusButton" },
  "@/components/series/SeriesInfoModal": { SeriesInfoModal: "SeriesInfoModal" },
  "@/components/tmdb/MovieInfoModal": { MovieInfoModal: "MovieInfoModal" },
  "@/components/tvPreview/TVRemoteInspector": {
    TVRemoteInspectorOverlay: "TVRemoteInspectorOverlay",
  },
  "@expo/vector-icons": { Feather: "Feather" },
};
const fallback = new Proxy(
  {},
  { get: (_obj, key) => (key === "__esModule" ? false : () => null) },
);
const traverse = (root, predicate, result = []) => {
  if (Array.isArray(root))
    root.forEach((node) => traverse(node, predicate, result));
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
      contents: `export { GoldenSeriesCatalog, PagedMoviesCatalog, PagedLiveCatalog } from ${JSON.stringify(join(app, "components/catalog/PagedCatalogViews.tsx"))}; export {StalkerGoldenMoviesCatalog} from ${JSON.stringify(join(app, "components/stalker/StalkerGoldenMoviesCatalog.tsx"))}; export {StalkerLiveCatalog} from ${JSON.stringify(join(app, "components/catalog/StalkerLiveCatalog.tsx"))};`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "cjs",
    outfile: join(directory, "catalog.cjs"),
    logLevel: "silent",
    plugins: [
      {
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
            if (!actual.has(args.path))
              return { path: args.path, external: true };
            const base = join(app, args.path.slice(2));
            const found = [base, base + ".ts", base + ".tsx"].find(existsSync);
            return found
              ? { path: found }
              : { path: args.path, external: true };
          });
        },
      },
    ],
  });
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in overrides) return overrides[request];
    if (request.startsWith("@/")) return fallback;
    return originalLoad.call(this, request, parent, isMain);
  };
  const {
    GoldenSeriesCatalog,
    PagedMoviesCatalog,
    StalkerGoldenMoviesCatalog,
    PagedLiveCatalog,
    StalkerLiveCatalog,
  } = requireApp(join(directory, "catalog.cjs"));
  let pass = 0;
  const profiles = [
    ["small phone", 320, 740, false, false, 1],
    ["phone large text", 393, 873, false, false, 2],
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
    const opened = [],
      categories = [],
      queries = [];
    const items = [
      {
        id: "series:alpha",
        title: "Birinci Dizi — Çok uzun okunabilir katalog başlığı taşmamalı",
        image: "",
      },
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
      onRefresh() {
        queries.push("refresh");
      },
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
    if (name === "small phone" || name === "phone large text")
      assert.equal(list.props.numColumns, 2, name);
    if (name === "phone portrait") assert.equal(list.props.numColumns, 3, name);
    assert.equal(list.props.data[1].id, "series:beta", name);
    assert.equal(list.props.keyExtractor(items[0]), "series:alpha", name);
    const card = list.props.renderItem({ item: items[0], index: 0 });
    const cardComponent = exactly(
      card,
      (node) => typeof node.tag === "function",
    );
    const renderedCard = host.render(cardComponent.tag, cardComponent.props);
    const actionable = exactly(
      renderedCard,
      (node) => node.props?.focusId === "series:series:alpha",
    );
    actionable.props.onPress();
    assert.deepEqual(opened, ["series:alpha"], name);
    const poster = exactly(renderedCard, (node) =>
      [node.props?.style]
        .flat(Infinity)
        .some((style) => style?.aspectRatio === 2 / 3),
    );
    assert(poster, name);
    const titleNode = exactly(
      renderedCard,
      (node) => node.tag === "Text" && node.props.numberOfLines === 2,
    );
    assert.equal(titleNode.props.numberOfLines, 2, name);
    if (!isTV && Math.min(width, height) < 600) {
      assert(titleNode.props.style.fontSize <= 14, name);
      assert(
        titleNode.props.style.minHeight >=
          titleNode.props.style.lineHeight * 2 * fontScale,
        name,
      );
      assert.equal(titleNode.props.style.padding, 4, name);
    }
    if (!isTV && list.props.onViewableItemsChanged) {
      list.props.onViewableItemsChanged({
        viewableItems: [{ index: 1, isViewable: true }],
      });
      host.width = width < 600 ? 1280 : 320;
      const resized = host.render(GoldenSeriesCatalog, props);
      const resizedList = exactly(resized, (node) => node.tag === "FlatList");
      assert(resizedList.props.numColumns >= 1, name);
      if (resizedList.props.numColumns !== list.props.numColumns) {
        const scrollCalls = [];
        resizedList.props.ref.current = {
          scrollToIndex: (request) => scrollCalls.push(request),
        };
        resizedList.props.onContentSizeChange();
        assert.equal(scrollCalls.length, 1, name);
        assert.equal(
          scrollCalls[0].index,
          Math.floor(1 / resizedList.props.numColumns),
          name,
        );
      }
      host.width = width;
    }
    const headerComponent = list.props.ListHeaderComponent;
    host.reset();
    const header = host.render(headerComponent.tag, headerComponent.props);
    const refresh = exactly(
      header,
      (node) => node.props?.icon === "refresh-cw",
    );
    refresh.props.onPress();
    assert.equal(queries.pop(), "refresh", name);
    if (!isTV && Math.min(width, height) < 600) {
      assert.equal(refresh.props.label, "", name);
      assert(refresh.props.accessibilityLabel, name);
      assert.equal(refresh.props.style.minHeight, 48, name);
      const heading = exactly(
        header,
        (node) =>
          node.tag === "Text" &&
          [node.props.style].flat().some((s) => s?.fontSize === 18),
      );
      assert.equal(heading.props.numberOfLines, 1, name);
    }
    const toggle = exactly(
      header,
      (node) => node.props?.focusId === "catalog:search-toggle",
    );
    toggle.props.onPress();
    const openedHeader = host.render(
      headerComponent.tag,
      headerComponent.props,
    );
    const input = exactly(openedHeader, (node) => node.tag === "TextInput");
    input.props.onChangeText("Birinci");
    assert.deepEqual(queries, ["Birinci"], name);
    const closeToggle = exactly(
      openedHeader,
      (node) => node.props?.focusId === "catalog:search-toggle",
    );
    closeToggle.props.onPress();
    const closedHeader = host.render(
      headerComponent.tag,
      headerComponent.props,
    );
    const sortComponent = exactly(
      closedHeader,
      (node) =>
        typeof node.tag === "function" && node.tag.name === "SortControl",
    );
    const sortChoices = [];
    host.reset();
    let sortTree = host.render(sortComponent.tag, {
      ...sortComponent.props,
      onSelect: (choice) => sortChoices.push(choice),
    });
    exactly(
      sortTree,
      (node) => node.props?.focusId === "catalog:sort",
    ).props.onPress();
    sortTree = host.render(sortComponent.tag, {
      ...sortComponent.props,
      onSelect: (choice) => sortChoices.push(choice),
    });
    const options = traverse(sortTree, (node) =>
      node.props?.focusId?.startsWith("catalog:sort:"),
    );
    assert(options.length >= 4, name);
    options[1].props.onPress();
    assert.equal(sortChoices.length, 1, name);
    assert.equal(
      traverse(closedHeader, (node) => node.tag === "TextInput").length,
      0,
      name,
    );
    host.reset();
    const filtered = host.render(GoldenSeriesCatalog, {
      ...props,
      search: "Birinci",
      items: [items[0]],
    });
    assert.equal(
      exactly(filtered, (node) => node.tag === "FlatList").props.data.length,
      1,
      name,
    );
    const drawer = exactly(
      filtered,
      (node) =>
        typeof node.tag === "function" && node.tag.name === "CategoryDrawer",
    );
    drawer.props.onSelect("news");
    assert.deepEqual(categories, ["news"], name);
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
    const movieWrapper = movieList.props.renderItem({
      item: host.movieItems[1],
      index: 1,
    });
    const movieCard = exactly(
      movieWrapper,
      (node) => typeof node.tag === "function",
    );
    const movieAction = exactly(
      host.render(movieCard.tag, movieCard.props),
      (node) => node.props?.focusId === "vod:12",
    );
    movieAction.props.onPress();
    movies = host.render(PagedMoviesCatalog, movieProps);
    const info = exactly(movies, (node) => node.tag === "MovieInfoModal");
    info.props.onPlay();
    assert.deepEqual(openedMovies, [12], name);
    // An identical stream ID at a different provider or catalog revision
    // cannot inherit the old modal's Play callback.
    const changedProvider = host.render(PagedMoviesCatalog, {
      ...movieProps,
      provider: { id: "provider-b", type: "xtream" },
    });
    assert.equal(
      traverse(changedProvider, (node) => node.tag === "MovieInfoModal").length,
      0,
      name,
    );
    const changedSession = host.render(PagedMoviesCatalog, {
      ...movieProps,
      catalogRevision: 2,
    });
    // A still-present identity must be rebound to the refreshed catalog.
    const freshInfo = exactly(
      changedSession,
      (node) => node.tag === "MovieInfoModal",
    );
    assert.equal(freshInfo.props.input.catalogRevision, "2", name);
    info.props.onPlay(); // Old async/modal action must not play another session.
    info.props.onClose(); // Nor dismiss the currently mounted modal.
    assert.deepEqual(openedMovies, [12], name);
    const stillOpen = host.render(PagedMoviesCatalog, {
      ...movieProps,
      catalogRevision: 2,
    });
    assert.equal(
      traverse(stillOpen, (node) => node.tag === "MovieInfoModal").length,
      1,
      name,
    );
    freshInfo.props.onPlay();
    assert.deepEqual(openedMovies, [12, 12], name);
    freshInfo.props.onClose();
    movies = host.render(PagedMoviesCatalog, movieProps);
    assert.equal(
      traverse(movies, (node) => node.tag === "MovieInfoModal").length,
      0,
      name,
    );
    movieList = exactly(movies, (node) => node.tag === "FlatList");
    assert.equal(movieList.props.data[1].stream_id, 12, name);
    // Movies search and category actions are real production header/drawer
    // callbacks. Isolate the header hooks while retaining the parent slots.
    const moviesSlots = host.slots;
    const movieHeaderComponent = movieList.props.ListHeaderComponent;
    host.reset();
    const movieHeader = host.render(
      movieHeaderComponent.tag,
      movieHeaderComponent.props,
    );
    exactly(
      movieHeader,
      (node) => node.props?.focusId === "catalog:search-toggle",
    ).props.onPress();
    const openMovieHeader = host.render(
      movieHeaderComponent.tag,
      movieHeaderComponent.props,
    );
    const movieSearchInput = exactly(
      openMovieHeader,
      (node) => node.tag === "TextInput",
    );
    movieSearchInput.props.onChangeText("Beta");
    host.slots = moviesSlots;
    let filteredMovies = host.render(PagedMoviesCatalog, movieProps);
    const movieResults = exactly(
      filteredMovies,
      (node) => node.tag === "FlatList",
    );
    assert.deepEqual(
      movieResults.props.data.map((item) => item.stream_id),
      [12],
      name,
    );
    const movieDrawer = exactly(
      filteredMovies,
      (node) =>
        typeof node.tag === "function" && node.tag.name === "CategoryDrawer",
    );
    movieDrawer.props.onSelect("genre-2");
    filteredMovies = host.render(PagedMoviesCatalog, movieProps);
    const chosenDrawer = exactly(
      filteredMovies,
      (node) =>
        typeof node.tag === "function" && node.tag.name === "CategoryDrawer",
    );
    assert.equal(chosenDrawer.props.selected, "genre-2", name);
    movieSearchInput.props.onChangeText("");
    movies = host.render(PagedMoviesCatalog, movieProps);
    assert.equal(
      exactly(movies, (node) => node.tag === "FlatList").props.data.length,
      2,
      name,
    );
    movieAction.props.onPress();
    host.movieItems = [];
    const removed = host.render(PagedMoviesCatalog, movieProps);
    assert.equal(
      traverse(removed, (node) => node.tag === "MovieInfoModal").length,
      0,
      name,
    );
  }
  for (const [name, width, height, isTV, preview, fontScale] of profiles) {
    Object.assign(host, { width, height, isTV, preview, fontScale });
    host.reset();
    const tree = host.render(StalkerGoldenMoviesCatalog, {
      provider: { id: "stalker-a" },
      onPlayable() {},
      onError() {},
      onDrawerVisibilityChange() {},
    });
    const list = exactly(tree, (node) => node.tag === "FlatList");
    if (name === "phone portrait") assert.equal(list.props.numColumns, 3);
    const wrapper = list.props.renderItem({
      item: list.props.data[0],
      index: 0,
    });
    const card = exactly(wrapper, (node) => typeof node.tag === "function");
    host.reset();
    const rendered = host.render(card.tag, card.props);
    const title = exactly(
      rendered,
      (node) => node.tag === "Text" && node.props.numberOfLines === 2,
    );
    if (!isTV && Math.min(width, height) < 600)
      assert.equal(title.props.style.padding, 4);
    assert.equal(
      exactly(
        rendered,
        (node) => node.props?.focusId === "stalker:vod:opaque-7",
      ).props.accessibilityLabel,
      list.props.data[0].title,
    );
    const header = list.props.ListHeaderComponent;
    host.reset();
    const renderedHeader = host.render(header.tag, header.props);
    exactly(
      renderedHeader,
      (node) => node.tag === "TextInput",
    ).props.onChangeText("query");
    exactly(
      renderedHeader,
      (node) => node.props?.icon === "refresh-cw",
    ).props.onPress();
    assert.deepEqual(stalkerActions.splice(0), ["query", "refresh"]);
  }
  for (const [width, height] of [
    [320, 740],
    [393, 873],
    [873, 393],
    [800, 1280],
  ]) {
    Object.assign(host, {
      width,
      height,
      isTV: false,
      preview: false,
      fontScale: 1,
    });
    host.reset();
    host.movieItems = [{ id: "channel-7", name: "News" }];
    const opened = [];
    const live = host.render(StalkerLiveCatalog, {
      providerId: "stalker-a",
      channels: host.movieItems,
      epgByChannel: new Map(),
      favorites: [],
      onOpen: (c) => opened.push(c.id),
      onFavorite() {},
    });
    const list = exactly(live, (node) => node.tag === "FlatList");
    const header = list.props.ListHeaderComponent;
    const title = exactly(
      header,
      (node) => node.tag === "Text" && node.props.numberOfLines === 1,
    );
    if (Math.min(width, height) < 600)
      assert([title.props.style].flat().some((s) => s?.fontSize === 18));
    const search = exactly(header, (node) => node.tag === "TextInput");
    search.props.onChangeText("News");
    const refreshed = host.render(StalkerLiveCatalog, {
      providerId: "stalker-a",
      channels: host.movieItems,
      epgByChannel: new Map(),
      favorites: [],
      onOpen: (c) => opened.push(c.id),
      onFavorite() {},
    });
    assert.equal(
      exactly(
        exactly(refreshed, (node) => node.tag === "FlatList").props
          .ListHeaderComponent,
        (node) => node.tag === "TextInput",
      ).props.value,
      "News",
    );
    exactly(
      header,
      (node) => node.props?.accessibilityLabel === "Yenile",
    ).props.onPress();
    assert.equal(stalkerActions.pop(), "live-refresh");
    assert.deepEqual(opened, []);
  }
  console.log(
    "Stalker Live mobile production header/search/refresh: 4/4 profiles PASS",
  );
  console.log(
    "Stalker Movies production density/search/refresh: 10/10 profiles PASS",
  );
  console.log(
    `P1 production GoldenSeriesCatalog render acceptance: ${pass}/${profiles.length} profiles PASS; HOST_NOT_ANDROID_PHYSICAL`,
  );
} finally {
  Module._load = originalLoad;
  rmSync(directory, { recursive: true, force: true });
}
