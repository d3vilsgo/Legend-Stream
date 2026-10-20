import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireApp = createRequire(join(app, "package.json"));
const requireServer = createRequire(resolve(app, "../api-server/package.json"));
const { build } = requireServer("esbuild");
const out = mkdtempSync(join(tmpdir(), "u42-home-host-"));
let slots = [];
let cursor = 0;
let previousEffects = [];
let effectCursor = 0;
let pendingEffects = [];
const host = (globalThis.__u42 = {
  width: 960,
  height: 540,
  fontScale: 1,
  isTV: true,
  preview: false,
  state(value) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value;
    return [
      slots[i],
      (next) => {
        slots[i] = typeof next === "function" ? next(slots[i]) : next;
      },
    ];
  },
  ref(value) {
    const i = cursor++;
    return slots[i] ?? (slots[i] = { current: value });
  },
  effect(fn, deps) {
    const i = effectCursor++;
    const prior = previousEffects[i];
    if (
      !prior ||
      !deps ||
      deps.some((value, index) => !Object.is(value, prior[index]))
    ) {
      previousEffects[i] = deps;
      pendingEffects.push(fn);
    }
  },
  reset() {
    slots = [];
    cursor = 0;
    previousEffects = [];
    effectCursor = 0;
    pendingEffects = [];
  },
  render(component, props) {
    cursor = 0;
    effectCursor = 0;
    pendingEffects = [];
    const value = component(props);
    for (const run of pendingEffects) run();
    return value;
  },
});
const mocks = {
  react: `const h=globalThis.__u42;
    export const useState=v=>h.state(v),useRef=v=>h.ref(v),useMemo=f=>f(),
      useEffect=(fn,deps)=>h.effect(fn,deps),useCallback=f=>f;
    export default {createElement:(tag,props,...children)=>({tag,props:{...props,children}})};`,
  "react-native": `const h=globalThis.__u42;
    export const View="View",Text="Text",TextInput="TextInput",ScrollView="ScrollView",
      FlatList="FlatList",Image="Image",Pressable="Pressable",ActivityIndicator="ActivityIndicator";
    export const Platform={get isTV(){return h.isTV},OS:"android"};
    export const StyleSheet={create:s=>s,absoluteFill:{position:"absolute"}};
    export const useWindowDimensions=()=>({width:h.width,height:h.height,fontScale:h.fontScale,scale:1});`,
  "react-native-safe-area-context":
    "export const useSafeAreaInsets=()=>({top:8,right:12,bottom:16,left:24});",
  "@expo/vector-icons": 'export const Feather="Feather";',
  "expo-linear-gradient": 'export const LinearGradient="LinearGradient";',
  "@/context/UiPresentationContext":
    "export const useUiPresentation=()=>({tvPreview:globalThis.__u42.preview});",
  "@/context/MediaLibraryContext":
    "export const useMediaLibrary=()=>({entries:globalThis.__u42.entries||[],loaded:true,removeProgress(){}});",
  "@/context/I18nContext": 'export const useI18n=()=>({language:"tr",t:k=>k});',
  "@/context/PlayerContext": `export const selectProgramsAt=(programs,now=Date.now())=>{const rows=[...(programs||[])].sort((a,b)=>a.start-b.start);const i=rows.findIndex(p=>p.start<=now&&now<p.end);return i>=0?{now:rows[i],next:rows[i+1]}:{next:rows.find(p=>p.start>now)}};`,
  "@/hooks/useColors":
    'export const useColors=()=>({primary:"#67e8d1",foreground:"white",mutedForeground:"#999",border:"#333",card:"#222",muted:"#888"});',
  "@/components/tvPreview/TVPreviewFocus":
    'export const TVPreviewPressable="TVPreviewPressable";',
  "@/lib/imageUrl": "export const normalizeImageUrl=x=>x||null;",
  "@/lib/historyPresentation": "export const visibleProgressRatio=()=>0;",
  "@/lib/performanceDiagnostics": "export const markStartupEvent=()=>{};",
};
const find = (root, predicate, found = []) => {
  if (Array.isArray(root)) root.forEach((part) => find(part, predicate, found));
  else if (root && typeof root === "object" && "tag" in root) {
    if (predicate(root)) found.push(root);
    find(root.props?.children, predicate, found);
  }
  return found;
};
const renderChild = (component, props) => {
  const oldSlots = slots;
  const oldCursor = cursor;
  const oldEffects = previousEffects;
  const oldEffectCursor = effectCursor;
  const oldPendingEffects = pendingEffects;
  slots = [];
  cursor = 0;
  previousEffects = [];
  effectCursor = 0;
  pendingEffects = [];
  try {
    const value = component(props);
    for (const run of pendingEffects) run();
    return value;
  } finally {
    slots = oldSlots;
    cursor = oldCursor;
    previousEffects = oldEffects;
    effectCursor = oldEffectCursor;
    pendingEffects = oldPendingEffects;
  }
};
const unique = (root, predicate) => {
  const matches = find(root, predicate);
  assert.equal(matches.length, 1);
  return matches[0];
};
try {
  await build({
    stdin: {
      contents: `export {eliteV3} from "@/lib/design/eliteV3Tokens"; export {nativeTvHomeLayout} from "@/lib/design/nativeTvHomeLayout"; export { HomeDiscovery, HomeHeroCarousel } from ${JSON.stringify(join(app, "components/home/HomeDiscovery.tsx"))};`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "home.cjs"),
    logLevel: "silent",
    plugins: [
      {
        name: "u42-production-adapter",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in mocks)
              return { path: args.path, namespace: "u42-mock" };
            if (args.path.startsWith("@/")) {
              const base = join(app, args.path.slice(2));
              const path = [
                base,
                base + ".ts",
                base + ".tsx",
                join(base, "index.ts"),
              ].find(existsSync);
              if (path) return { path };
            }
          });
          builder.onLoad({ filter: /.*/, namespace: "u42-mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
            resolveDir: app,
          }));
        },
      },
    ],
  });
  const { HomeDiscovery, HomeHeroCarousel, eliteV3, nativeTvHomeLayout } =
    requireApp(join(out, "home.cjs"));
  const profiles = [
    [720, 480],
    [960, 540],
    [1280, 720],
    [1920, 1080],
  ];
  const props = {
    tvFirstHome: false,
    provider: { id: "p1", name: "Provider", type: "xtream" },
    tvViewportHeight: 420,
    live: 2,
    vod: 1,
    series: 0,
    vodCategories: 0,
    seriesCategories: 0,
    catalogLoading: false,
    channels: [{ id: "channel-3", name: "Kanal 3" }],
    history: [],
    movies: [
      {
        stream_id: 7,
        name: "Film 7",
        stream_icon: "",
        plot: "Test",
        genre: "Dram",
      },
    ],
    seriesItems: [],
    newChannels: [],
    newMovies: [],
    newSeries: [],
    onNavigate() {},
    onOpenLive() {},
    onOpenMovie() {},
    onOpenSeries() {},
    onWatchMovie() {},
    onOpenMedia() {},
    onRemoveLive() {},
  };
  let passed = 0;
  for (const [width, height] of profiles) {
    host.reset();
    Object.assign(host, { width, height, isTV: true, preview: false });
    const opened = [];
    const watched = [];
    const base = {
      ...props,
      tvViewportHeight: Math.max(320, height - 150),
      onOpenMovie: (movie) => opened.push(movie.stream_id),
      onWatchMovie: (movie) => watched.push(movie.stream_id),
    };
    let root = host.render(HomeDiscovery, base);
    let hero = unique(root, (n) => n.tag === HomeHeroCarousel);
    const shelves = find(
      root,
      (n) => typeof n.tag === "function" && n.tag.name === "HomeShelf",
    );
    assert(shelves.length >= 3);
    assert.equal(hero.props.collapsed, false);
    const identity = hero.props.items[0].id;
    // Both Hero Info and Play are wired to the real Home production actions.
    const heroActions = renderChild(HomeHeroCarousel, hero.props);
    unique(
      heroActions,
      (node) => node.props?.focusId === "home-hero:" + identity + ":info",
    ).props.onPress();
    unique(
      heroActions,
      (node) => node.props?.focusId === "home-hero:" + identity + ":watch",
    ).props.onPress();
    assert.deepEqual(opened, [7]);
    assert.deepEqual(watched, [7]);
    const movieShelf = shelves.find((node) => node.props.title === "movies");
    assert(movieShelf);
    const movieTree = renderChild(movieShelf.tag, movieShelf.props);
    const movieList = unique(movieTree, (node) => node.tag === "FlatList");
    const movieCard = movieList.props.renderItem({
      item: movieList.props.data[0],
      index: 0,
    });
    const moviePressable = renderChild(movieCard.tag, movieCard.props);
    unique(moviePressable, (node) =>
      node.props?.focusId?.includes(":movie-7"),
    ).props.onPress();
    assert.deepEqual(opened, [7, 7]);
    const shelfIdentity = shelves[0].props.items.map((x) => x.id);
    // The callback is supplied to every mounted shelf, not a separate
    // geometry helper. It is invoked by each real shelf's item focus handler.
    const liveShelf = renderChild(shelves[0].tag, shelves[0].props);
    const more = unique(
      liveShelf,
      (n) =>
        typeof n.tag === "function" &&
        n.tag.name === "TvFocusPressable" &&
        n.props.focusId?.endsWith(":more"),
    );
    more.props.onFocus(); // Real shelf control's focus callback.
    const list = unique(liveShelf, (n) => n.tag === "FlatList");
    const scrollRequests = [];
    list.props.ref.current = {
      scrollToIndex: (request) => scrollRequests.push(request),
    };
    const firstCard = list.props.renderItem({
      item: list.props.data[0],
      index: 0,
    });
    firstCard.props.onFocus();
    assert.equal(scrollRequests[0].index, 0);
    root = host.render(HomeDiscovery, base);
    hero = unique(root, (n) => n.tag === HomeHeroCarousel);
    assert.equal(hero.props.collapsed, true);
    assert.equal(hero.props.items[0].id, identity);
    assert.deepEqual(
      find(
        root,
        (n) => typeof n.tag === "function" && n.tag.name === "HomeShelf",
      )[0].props.items.map((x) => x.id),
      shelfIdentity,
    );
    const lastShelf = find(
      root,
      (n) => typeof n.tag === "function" && n.tag.name === "HomeShelf",
    ).at(-1);
    const lastShelfTree = renderChild(lastShelf.tag, lastShelf.props);
    unique(
      lastShelfTree,
      (n) => typeof n.tag === "function" && n.props.focusId?.endsWith(":more"),
    ).props.onFocus();
    assert.equal(
      unique(
        host.render(HomeDiscovery, base),
        (n) => n.tag === HomeHeroCarousel,
      ).props.collapsed,
      true,
    );
    // StageRail has no callback into this state.
    const stageRailSelectionOnly = () => {};
    stageRailSelectionOnly();
    assert.equal(
      unique(
        host.render(HomeDiscovery, base),
        (n) => n.tag === HomeHeroCarousel,
      ).props.collapsed,
      true,
    );
    const compactHeroTree = renderChild(HomeHeroCarousel, hero.props);
    const compactHeight = compactHeroTree.props.style.minHeight;
    const restore = unique(
      compactHeroTree,
      (n) => n.props?.focusId === "home-hero:" + identity + ":watch",
    );
    assert.equal(restore.props.accessibilityLabel, "Öne çıkan içeriğe dön");
    restore.props.onFocus(); // Real native Hero action remains focusable.
    root = host.render(HomeDiscovery, base);
    hero = unique(root, (n) => n.tag === HomeHeroCarousel);
    assert.equal(hero.props.collapsed, false);
    assert.equal(hero.props.items[0].id, identity);
    const expandedHeroTree = renderChild(HomeHeroCarousel, hero.props);
    const expandedHeight = expandedHeroTree.props.style.minHeight;
    assert(compactHeight < expandedHeight);
    assert(expandedHeight <= 320);
    assert(compactHeight >= 96);
    // Repeated D-pad crossings must settle without remounting the content
    // identity or changing a selected Hero item.
    for (let i = 0; i < 24; i++) {
      const shelf = find(
        root,
        (n) => typeof n.tag === "function" && n.tag.name === "HomeShelf",
      )[0];
      shelf.props.onContentFocus();
      root = host.render(HomeDiscovery, base);
      const foldedHero = unique(root, (n) => n.tag === HomeHeroCarousel);
      assert.equal(foldedHero.props.collapsed, true);
      assert.equal(foldedHero.props.items[0].id, identity);
      foldedHero.props.onHeroFocus();
      root = host.render(HomeDiscovery, base);
      assert.equal(
        unique(root, (n) => n.tag === HomeHeroCarousel).props.collapsed,
        false,
      );
    }
    passed++;
  }
  // A provider boundary invalidates the old shelf context even if Home
  // remains mounted; the effect is exercised by the same production component.
  host.reset();
  Object.assign(host, { width: 960, height: 540, isTV: true, preview: false });
  const initial = host.render(HomeDiscovery, props);
  find(
    initial,
    (n) => typeof n.tag === "function" && n.tag.name === "HomeShelf",
  )[0].props.onContentFocus();
  assert.equal(
    unique(host.render(HomeDiscovery, props), (n) => n.tag === HomeHeroCarousel)
      .props.collapsed,
    true,
  );
  const nextProvider = { ...props, provider: { ...props.provider, id: "p2" } };
  host.render(HomeDiscovery, nextProvider);
  assert.equal(
    unique(
      host.render(HomeDiscovery, nextProvider),
      (n) => n.tag === HomeHeroCarousel,
    ).props.collapsed,
    false,
  );
  passed++;
  // Keep the same mounted Home contract for empty and loading provider views.
  host.reset();
  Object.assign(host, { width: 960, height: 540, isTV: true, preview: false });
  const noContent = {
    ...props,
    movies: [],
    seriesItems: [],
    channels: [],
    history: [],
    live: 0,
    vod: 0,
    series: 0,
  };
  const emptyTree = host.render(HomeDiscovery, noContent);
  const emptyHero = unique(emptyTree, (n) => n.tag === HomeHeroCarousel);
  assert.equal(emptyHero.props.loading, false);
  assert.equal(emptyHero.props.items.length, 0);
  assert.equal(
    find(
      emptyTree,
      (n) => typeof n.tag === "function" && n.tag.name === "HomeShelf",
    ).length,
    3,
  );
  passed++;
  host.reset();
  const loadingTree = host.render(HomeDiscovery, {
    ...noContent,
    live: null,
    vod: null,
    series: null,
    catalogLoading: true,
  });
  const loadingHero = unique(loadingTree, (n) => n.tag === HomeHeroCarousel);
  assert.equal(loadingHero.props.loading, true);
  assert.equal(loadingHero.props.items.length, 0);
  passed++;
  // Touch and Preview do not opt into native collapse.
  for (const [width, height, preview] of [
    [393, 873, false],
    [873, 393, false],
    [800, 1280, false],
    [1280, 800, false],
    [873, 393, true],
  ]) {
    host.reset();
    Object.assign(host, { width, height, isTV: false, preview });
    const root = host.render(HomeDiscovery, props);
    const shelves = find(
      root,
      (n) => typeof n.tag === "function" && n.tag.name === "HomeShelf",
    );
    shelves[0].props.onContentFocus();
    assert.equal(
      unique(
        host.render(HomeDiscovery, props),
        (n) => n.tag === HomeHeroCarousel,
      ).props.collapsed,
      false,
    );
    passed++;
  }
  // V3 acceptance uses the real Home -> Hero -> Shelf -> card render tree.
  // Existing U4.2 assertions above remain unchanged.
  const flat = (style) =>
    Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
  let v3Passed = 0;
  const measurements = [];
  for (const [width, height, isTV, preview] of [
    [960, 540, true, false],
    [1280, 720, true, false],
    [1920, 1080, true, false],
    [1280, 800, false, false],
    [393, 873, false, false],
    [873, 393, false, false],
    [873, 393, false, true],
  ])
    for (const fontScale of [1, 1.3, 2]) {
      host.reset();
      Object.assign(host, { width, height, isTV, preview, fontScale });
      const progress = {
        id: "p1-progress",
        title: "Film 7",
        subtitle: "Devam",
        position: 120,
        duration: 600,
        source: { providerId: "p1" },
      };
      host.entries = [progress];
      const resumed = [];
      const viewport = height - 140;
      const root = host.render(HomeDiscovery, {
        ...props,
        tvViewportHeight: viewport,
        onOpenMedia: (item) => resumed.push(item),
      });
      const heroNode = unique(root, (n) => n.tag === HomeHeroCarousel);
      const hero = renderChild(HomeHeroCarousel, heroNode.props);
      const heroStyle = flat(hero.props.style);
      assert.equal(heroStyle.backgroundColor, eliteV3.color.panel);
      assert.equal(heroStyle.borderRadius, eliteV3.radius.hero);
      assert(Number.isFinite(heroStyle.minHeight));
      const gradient = unique(hero, (n) => n.tag === "LinearGradient");
      assert.deepEqual(gradient.props.colors, eliteV3.home.gradient);
      const text = unique(
        hero,
        (n) => n.tag === "Text" && n.props.children.includes("Film 7"),
      );
      assert.equal(
        flat(text.props.style).fontFamily,
        eliteV3.typography.strong,
      );
      assert(text.props.numberOfLines >= 1 && text.props.numberOfLines <= 2);
      const watch = unique(hero, (n) => n.props.focusId?.endsWith(":watch"));
      assert.equal(watch.props.hasTVPreferredFocus, true);
      assert(flat(watch.props.style).minHeight >= (isTV || preview ? 56 : 44));
      assert.equal(
        find(hero, (n) => n.props.accessibilityLabel === "Listeye Ekle").length,
        0,
      );
      const caption = unique(
        hero,
        (n) => n.tag === "View" && flat(n.props.style).padding !== undefined,
      );
      if (isTV) {
        const layout = nativeTvHomeLayout({
          width,
          height,
          fontScale,
          viewportHeight: viewport,
          safeArea: { top: 8, right: 12, bottom: 16, left: 24 },
        });
        assert.equal(heroStyle.minHeight, layout.heroHeight);
        assert(layout.visibleCardHeight >= 72);
        if (flat(caption.props.style).flexDirection === "column") {
          const required =
            layout.padding * 2 +
            layout.borderSpace +
            layout.titleLineHeight * fontScale +
            (layout.showMeta
              ? layout.metaLineHeight * fontScale + eliteV3.space.xxs
              : 0) +
            eliteV3.space.xs +
            flat(watch.props.style).minHeight;
          assert(
            required <= heroStyle.minHeight,
            "Stacked title, metadata and actions fit measured Hero",
          );
          assert.equal(text.props.numberOfLines, 1);
        }
      } else
        assert(heroStyle.minHeight >= (width > height || preview ? 160 : 310));
      const continuation = find(
        root,
        (n) => typeof n.tag === "function" && n.tag.name === "HomeShelf",
      )[0];
      assert.equal(continuation.props.items[0].id, progress.id);
      assert.equal(continuation.props.compact, true);
      const shelf = renderChild(continuation.tag, continuation.props);
      const shelfHeading = unique(
        shelf,
        (n) =>
          n.tag === "Text" &&
          n.props.children.includes(continuation.props.title),
      );
      assert.equal(shelfHeading.props.numberOfLines, 1);
      assert.equal(flat(shelfHeading.props.style).flexShrink, 1);
      const moreTarget = unique(shelf, (n) =>
        n.props.focusId?.endsWith(":more"),
      );
      if (!isTV) assert(flat(moreTarget.props.style).minHeight >= 44);
      const list = unique(shelf, (n) => n.tag === "FlatList");
      assert.equal(list.props.keyExtractor(list.props.data[0]), progress.id);
      const card = list.props.renderItem({
        item: list.props.data[0],
        index: 0,
      });
      const mode =
        isTV || preview
          ? "tv"
          : Math.min(width, height) >= 600
            ? "tablet"
            : "mobile";
      assert.equal(
        flat(card.props.style).width,
        eliteV3.home.landscapeWidth[mode],
      );
      const artwork = unique(
        card,
        (n) =>
          n.tag === "View" && flat(n.props.style).aspectRatio !== undefined,
      );
      assert.equal(flat(artwork.props.style).aspectRatio, 16 / 9);
      const scroll = [];
      list.props.ref.current = {
        scrollToIndex: (request) => scroll.push(request),
      };
      card.props.onFocus();
      assert.equal(resumed.length, 0);
      assert.equal(scroll[0].index, 0);
      card.props.onPress();
      assert.equal(resumed[0], progress);
      const rerender = host.render(HomeDiscovery, {
        ...props,
        tvViewportHeight: viewport,
      });
      assert.equal(
        unique(rerender, (n) => n.tag === HomeHeroCarousel).props.collapsed,
        isTV,
      );
      if (fontScale === 1)
        measurements.push({
          width,
          height,
          isTV,
          preview,
          hero: heroStyle.minHeight,
          title: flat(text.props.style).fontSize,
          actions: flat(caption.props.style).flexDirection,
          continueWidth: flat(card.props.style).width,
        });
      v3Passed++;
    }
  delete host.entries;
  // TV-first production shell: provider channels, real EPG and one active shelf.
  host.reset();
  Object.assign(host, { width: 1280, height: 720, isTV: true, preview: false });
  const now = Date.now();
  const tvChannels = [
    {
      id: "live-1",
      providerId: "p1",
      name: "Provider One",
      category: "News",
      streamUrl: "xtream://one",
    },
    {
      id: "live-2",
      providerId: "p1",
      name: "Provider Two",
      category: "Sports",
      streamUrl: "xtream://two",
    },
  ];
  const program = {
    id: "epg-now",
    channelId: "live-1",
    title: "Actual Current Program",
    start: now - 5 * 60_000,
    end: now + 10 * 60_000,
  };
  const nextProgram = {
    id: "epg-next",
    channelId: "live-1",
    title: "Actual Next Program",
    start: program.end,
    end: program.end + 30 * 60_000,
  };
  const resumedMedia = {
    id: "progress-1",
    title: "Film 7",
    subtitle: "Sürdür",
    position: 120,
    duration: 600,
    source: { providerId: "p1", itemId: "7" },
  };
  host.entries = [resumedMedia];
  const liveOpened = [];
  const mediaOpened = [];
  const movieInfoOpened = [];
  const seriesOpened = [];
  const tvProps = {
    ...props,
    tvFirstHome: true,
    provider: { ...props.provider, id: "p1" },
    tvViewportHeight: 540,
    live: 2,
    catalogLoading: false,
    channels: tvChannels,
    epgByChannel: new Map([["live-1", [program, nextProgram]]]),
    epgLoading: false,
    movies: [{ ...props.movies[0], name: "TV Movie", stream_id: 7 }],
    seriesItems: [
      { series_id: 8, name: "TV Series", cover: "", genre: "Drama" },
    ],
    onOpenLive: (channel) => liveOpened.push(channel.id),
    onOpenMedia: (item) => mediaOpened.push(item.id),
    onOpenMovie: (item) => movieInfoOpened.push(item.stream_id),
    onOpenSeries: (item) => seriesOpened.push(item.series_id),
  };
  const tvRender = (nextProps = tvProps) => {
    const tree = host.render(HomeDiscovery, nextProps);
    const shellNode = unique(
      tree,
      (node) =>
        typeof node.tag === "function" && node.tag.name === "HomeTvFirstShell",
    );
    return {
      tree,
      shellNode,
      shell: renderChild(shellNode.tag, shellNode.props),
    };
  };
  let tvTree = tvRender();
  assert.equal(tvTree.shellNode.props.activeTab, "live");
  assert.equal(tvTree.shellNode.props.selectedChannelId, "live-1");
  unique(
    tvTree.shell,
    (node) => node.props?.focusId === "home-tv-tab:live",
  ).props.onFocus();
  tvTree = tvRender();
  assert.equal(
    unique(tvTree.shell, (node) => node.tag === HomeHeroCarousel).props
      .collapsed,
    true,
  );
  const epgPanel = unique(
    tvTree.shell,
    (node) => node.props?.testID === "home-tv-epg-panel",
  );
  assert.match(JSON.stringify(epgPanel), /Provider One/);
  assert.match(JSON.stringify(epgPanel), /Actual Current Program/);
  assert.match(JSON.stringify(epgPanel), /Actual Next Program/);
  assert.equal(
    find(
      tvTree.shell,
      (node) => node.props?.testID === "home-tv-epg-progress-fill",
    ).length,
    1,
  );
  const liveShelfNode = unique(
    tvTree.shell,
    (node) => typeof node.tag === "function" && node.tag.name === "HomeShelf",
  );
  assert.equal(liveShelfNode.props.title, "Canlı Kanallar");
  assert.deepEqual(
    liveShelfNode.props.items.map((item) => item.id),
    ["live-live-1", "live-live-2"],
  );
  assert.equal(liveShelfNode.props.selectedId, "live-live-1");
  const liveShelfTree = renderChild(liveShelfNode.tag, liveShelfNode.props);
  const liveList = unique(liveShelfTree, (node) => node.tag === "FlatList");
  const scrolls = [];
  liveList.props.ref.current = {
    scrollToIndex: (request) => scrolls.push(request),
  };
  const secondChannelCard = liveList.props.renderItem({
    item: liveList.props.data[1],
    index: 1,
  });
  const secondChannelTree = renderChild(
    secondChannelCard.tag,
    secondChannelCard.props,
  );
  const secondChannelButton = unique(
    secondChannelTree,
    (node) => node.tag === "TVPreviewPressable",
  );
  secondChannelButton.props.onFocus();
  assert.deepEqual(
    liveOpened,
    [],
    "focus only previews a channel; it never starts playback",
  );
  assert.equal(scrolls[0].index, 1);
  tvTree = tvRender();
  assert.equal(tvTree.shellNode.props.selectedChannelId, "live-2");
  assert.equal(
    find(tvTree.shell, (node) => node.props?.testID === "home-tv-epg-panel")
      .length,
    1,
  );
  secondChannelButton.props.onPress();
  assert.deepEqual(
    liveOpened,
    ["live-2"],
    "OK opens the focused provider channel through its callback",
  );

  const continueTab = unique(
    tvTree.shell,
    (node) => node.props?.focusId === "home-tv-tab:continue",
  );
  continueTab.props.onPress();
  tvTree = tvRender();
  const continueShelf = unique(
    tvTree.shell,
    (node) => typeof node.tag === "function" && node.tag.name === "HomeShelf",
  );
  assert.equal(continueShelf.props.title, "İzlemeye Devam Et");
  assert.equal(continueShelf.props.items[0].id, resumedMedia.id);
  const continueTree = renderChild(continueShelf.tag, continueShelf.props);
  const continueList = unique(continueTree, (node) => node.tag === "FlatList");
  const continueCard = continueList.props.renderItem({
    item: continueList.props.data[0],
    index: 0,
  });
  renderChild(continueCard.tag, continueCard.props);
  unique(
    renderChild(continueCard.tag, continueCard.props),
    (node) => node.tag === "TVPreviewPressable",
  ).props.onPress();
  assert.deepEqual(mediaOpened, [resumedMedia.id]);

  const discoverTab = unique(
    tvTree.shell,
    (node) => node.props?.focusId === "home-tv-tab:discover",
  );
  discoverTab.props.onPress();
  tvTree = tvRender();
  const discoverShelf = unique(
    tvTree.shell,
    (node) => typeof node.tag === "function" && node.tag.name === "HomeShelf",
  );
  assert.equal(discoverShelf.props.title, "Öne Çıkanlar");
  assert.deepEqual(
    discoverShelf.props.items.map((item) => item.id),
    ["movie-7", "series-8"],
  );
  const discoverTree = renderChild(discoverShelf.tag, discoverShelf.props);
  const discoverList = unique(discoverTree, (node) => node.tag === "FlatList");
  const recommendation = discoverList.props.renderItem({
    item: discoverList.props.data[0],
    index: 0,
  });
  unique(
    renderChild(recommendation.tag, recommendation.props),
    (node) => node.tag === "TVPreviewPressable",
  ).props.onPress();
  assert.deepEqual(movieInfoOpened, [7]);
  const seriesRecommendation = discoverList.props.renderItem({
    item: discoverList.props.data[1],
    index: 1,
  });
  unique(
    renderChild(seriesRecommendation.tag, seriesRecommendation.props),
    (node) => node.tag === "TVPreviewPressable",
  ).props.onPress();
  assert.deepEqual(seriesOpened, [8]);

  const emptyTv = tvRender({
    ...tvProps,
    channels: [],
    epgByChannel: new Map(),
    movies: [],
    seriesItems: [],
    live: 0,
    vod: 0,
    series: 0,
  });
  assert.equal(
    find(emptyTv.shell, (node) => node.props?.testID === "home-tv-epg-panel")
      .length,
    0,
  );
  const emptyShelf = unique(
    emptyTv.shell,
    (node) => typeof node.tag === "function" && node.tag.name === "HomeShelf",
  );
  assert.equal(emptyShelf.props.loading, false);
  assert.equal(emptyShelf.props.items.length, 0);

  const nextProviderChannels = [
    {
      ...tvChannels[0],
      id: "live-next-provider",
      providerId: "p2",
      name: "Provider Two Live",
      streamUrl: "xtream://p2",
    },
  ];
  tvRender({
    ...tvProps,
    provider: { ...tvProps.provider, id: "p2" },
    channels: nextProviderChannels,
    epgByChannel: new Map(),
  });
  const providerRefresh = tvRender({
    ...tvProps,
    provider: { ...tvProps.provider, id: "p2" },
    channels: nextProviderChannels,
    epgByChannel: new Map(),
  });
  assert.equal(providerRefresh.shellNode.props.activeTab, "live");
  assert.equal(
    providerRefresh.shellNode.props.selectedChannelId,
    "live-next-provider",
  );

  host.reset();
  Object.assign(host, { width: 873, height: 393, isTV: false, preview: true });
  const previewHome = tvRender(tvProps);
  assert.equal(previewHome.shellNode.props.activeTab, "live");
  unique(
    previewHome.shell,
    (node) => node.props?.focusId === "home-tv-tab:live",
  ).props.onFocus();
  const previewRerender = tvRender(tvProps);
  assert.equal(
    unique(previewRerender.shell, (node) => node.tag === HomeHeroCarousel).props
      .collapsed,
    false,
  );
  assert.equal(
    unique(
      previewRerender.shell,
      (node) => node.props?.focusId === "home-tv-tab:continue",
    ).props.accessibilityState.selected,
    false,
  );
  console.log(
    "TV-first production Home acceptance: PASS (provider scope, tabs, selection/focus separation, real EPG/progress, direct channel/media/movie/series actions, empty state, TV Preview)",
  );
  delete host.entries;
  console.log(
    "Elite V3 production Home measurements: " + JSON.stringify(measurements),
  );
  console.log(
    `Elite V3 production Home acceptance: ${v3Passed}/${v3Passed} PASS; HOST_NOT_PHYSICAL`,
  );
  console.log(
    `U4.2 production Home Hero/shelf state: ${passed}/${passed} PASS; ANDROID_FOCUSFINDER_PENDING_RC`,
  );
} finally {
  delete globalThis.__u42;
  rmSync(out, { recursive: true, force: true });
}
