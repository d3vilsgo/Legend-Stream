import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(app, "package.json"));
const { build } = createRequire(req.resolve("tsx/package.json"))("esbuild");
const out = mkdtempSync(join(tmpdir(), "u41-rail-host-"));
let slots = [];
let cursor = 0;
const host = (globalThis.__u41 = {
  width: 720,
  height: 480,
  fontScale: 1,
  tv: true,
  preview: false,
  listeners: new Set(),
  transitions: [],
  effects: [],
  cleanups: [],
  reset() {
    this.cleanups.forEach((f) => f?.());
    this.cleanups = [];
    this.effects = [];
    this.transitions = [];
    slots = [];
    cursor = 0;
  },
  state(initial) {
    const index = cursor++;
    if (!(index in slots))
      slots[index] = typeof initial === "function" ? initial() : initial;
    return [
      slots[index],
      (next) => {
        slots[index] = typeof next === "function" ? next(slots[index]) : next;
      },
    ];
  },
  focus(id) {
    this.listeners.forEach((f) => f({ id }));
  },
  effect(fn, deps) {
    const i = cursor++;
    const old = slots[i];
    if (!old || deps.some((d, j) => d !== old[j])) {
      slots[i] = deps;
      this.effects.push(fn);
    }
  },
  ref(initial) {
    const index = cursor++;
    return slots[index] ?? (slots[index] = { current: initial });
  },
  render(fn, props) {
    cursor = 0;
    const result = fn(props);
    this.effects.splice(0).forEach((f) => this.cleanups.push(f()));
    return result;
  },
});
const mocks = {
  "@/modules/legendstream-tv-remote": `const h=globalThis.__u41; export const subscribeNativeTvFocus=f=>{h.listeners.add(f);return {remove(){h.listeners.delete(f)}}};`,
  "@/lib/tvRemoteInspector": `export const inspectorRail=v=>globalThis.__u41.transitions.push(v);`,
  react: `const h=globalThis.__u41;
    export const useState=x=>h.state(x),useRef=x=>h.ref(x),
      useReducer=(fn,v)=>{const [value,set]=h.state(v);return [value,event=>set(old=>fn(old,event))]},
      useMemo=f=>f(),useEffect=(f,d)=>h.effect(f,d),useCallback=f=>f;
    export default {createElement:(tag,props,...children)=>({tag,props:{...props,children}})};`,
  "react-native": `const h=globalThis.__u41;
    export const View="View",Text="Text",TextInput="TextInput",
      ScrollView="ScrollView",FlatList="FlatList",Image="Image",
      Modal="Modal",Pressable="Pressable",ActivityIndicator="ActivityIndicator";
    export const BackHandler={addEventListener:()=>({remove(){}})};
    export const Keyboard={addListener:()=>({remove(){}})};
    export const Platform={get isTV(){return h.tv},OS:"android"};
    export const StyleSheet={create:x=>x};
    export const useWindowDimensions=()=>({width:h.width,height:h.height,fontScale:h.fontScale,scale:1});`,
  "react-native-safe-area-context":
    "export const useSafeAreaInsets=()=>({top:8,left:12,right:12,bottom:8});",
  "@expo/vector-icons": 'export const Feather="Feather";',
  "@/components/FocusButton": 'export const FocusButton="FocusButton";',
  "@/components/navigation/CompactLandscapeNavButton":
    'export const CompactLandscapeNavButton="CompactLandscapeNavButton";',
  "@/components/tvPreview/TVPreviewFocus":
    'export const TVPreviewPressable="TVPreviewPressable";',
  "@/context/UiPresentationContext":
    "export const useUiPresentation=()=>({tvPreview:globalThis.__u41.preview});",
  "@/context/PlayerContext": "export const selectProgramsAt=()=>({});",
  "@/hooks/useColors":
    'export const useColors=()=>({foreground:"#fff",mutedForeground:"#aaa",border:"#333"});',
  "@/lib/adaptiveNavigation":
    'export const resolveAdaptiveNavigationModel=()=>({nativeTv:globalThis.__u41.tv,backTarget:"home"});',
  "@/lib/design/screenProfiles":
    "export const resolvePremiumCatalogProfile=()=>({horizontalPadding:12});",
  "@/lib/playerRemoteOwnership": "export const hasPlayerBackOwner=()=>false;",
};
try {
  await build({
    stdin: {
      contents: `export { ResponsiveContentNav } from ${JSON.stringify(join(app, "components/navigation/ResponsiveContentNav.tsx"))};export { EliteLiveCatalog } from ${JSON.stringify(join(app, "components/elite/EliteLiveCatalog.tsx"))};export { eliteLiveLayout } from ${JSON.stringify(join(app, "lib/design/eliteLiveLayout.ts"))};`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "production.cjs"),
    logLevel: "silent",
    plugins: [
      {
        name: "u41-production-adapter",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in mocks)
              return { path: args.path, namespace: "host-mock" };
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
          builder.onLoad({ filter: /.*/, namespace: "host-mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
            resolveDir: app,
          }));
        },
      },
    ],
  });
  const { ResponsiveContentNav, EliteLiveCatalog, eliteLiveLayout } = req(
    join(out, "production.cjs"),
  );
  const all = (root, predicate, found = []) => {
    if (Array.isArray(root)) root.forEach((x) => all(x, predicate, found));
    else if (root && typeof root === "object" && "tag" in root) {
      if (predicate(root)) found.push(root);
      all(root.props?.children, predicate, found);
    }
    return found;
  };
  const only = (root, predicate) => {
    const result = all(root, predicate);
    assert.equal(result.length, 1);
    return result[0];
  };
  execFileSync("java", [
    "com.sun.tools.javac.Main",
    "-d",
    out,
    join(
      app,
      "modules/legendstream-tv-remote/android/src/main/java/expo/modules/legendstreamtvremote/TvFocusPolicy.java",
    ),
    join(app, "tests/nativeTv/TvVerticalRailHost.java"),
  ]);
  const items = ["home", "live", "movies", "series"].map((key) => ({
    key,
    label: key,
    icon: "tv",
  }));
  const chosen = [];
  const props = {
    items,
    activeKey: "home",
    onSelect: (key) => chosen.push(key),
  };
  let passed = 0;
  for (const [width, height] of [
    [720, 480],
    [1920, 1080],
  ]) {
    host.reset();
    Object.assign(host, { width, height, tv: true, preview: false });
    let tree = host.render(ResponsiveContentNav, props);
    const root = only(
      tree,
      (node) =>
        node.tag === "View" && node.props.accessibilityLabel === "Ana gezinme",
    );
    assert.equal(root.props.style[1].flexDirection, "column");
    assert.equal(root.props.style[1].position, "absolute");
    assert.equal(all(tree, (node) => node.tag === "ScrollView").length, 0);
    for (const item of items) {
      const button = only(
        tree,
        (node) => node.props?.focusId === "nav:" + item.key,
      );
      assert.equal(button.tag, "FocusButton");
      assert.equal(button.props.label, "");
      assert.equal(button.props.accessibilityLabel, item.label);
    }
    assert.equal(host.listeners.size, 1);
    host.focus("nav:movies");
    tree = host.render(ResponsiveContentNav, props);
    assert.equal(
      all(tree, (n) => n.tag === "Text" && n.props.children.includes("movies"))
        .length,
      1,
    );
    assert.equal(
      only(tree, (n) => n.props.accessibilityLabel === "Ana gezinme").props
        .style[1].width,
      root.props.style[1].width,
    );
    for (const item of items)
      only(
        tree,
        (node) => node.props?.focusId === "nav:" + item.key,
      ).props.onPress();
    assert.deepEqual(
      chosen.splice(0),
      items.map((x) => x.key),
    );
    host.focus("home-hero:watch");
    tree = host.render(ResponsiveContentNav, props);
    assert.equal(
      only(tree, (node) => node.props?.focusId === "nav:movies").props.label,
      "",
    );
    // Drive the actual production policy from the rendered vertical rail.
    const buttons = all(tree, (node) => node.tag === "FocusButton");
    const heightOf = (button) => button.props.style[1].minHeight;
    const targets = buttons.map((button, index) =>
      [
        button.props.focusId,
        "navigation",
        root.props.style[1].left,
        root.props.style[1].top + index * (heightOf(button) + 10),
        root.props.style[1].width,
        heightOf(button),
      ].join(","),
    );
    targets.push("home-hero:watch,home,260,80,180,60");
    targets.push("home-shelf:Films:movie-7,home,260,230,120,180");
    const step = (id, direction) =>
      execFileSync(
        "java",
        ["-cp", out, "TvVerticalRailHost", id, direction, ...targets],
        { encoding: "utf8" },
      );
    targets.push("home-shelf:Films:movie-8,home,400,230,120,180");
    assert.equal(
      step("home-shelf:Films:movie-8", "left"),
      "home-shelf:Films:movie-7",
    );
    console.log(
      `${width}dp ${step("nav:home", "benchmark")} (not Android dispatch latency)`,
    );
    assert.equal(step("nav:home", "down"), "nav:live");
    assert.equal(step("nav:live", "down"), "nav:movies");
    assert.equal(step("nav:movies", "down"), "nav:series");
    assert.equal(step("nav:series", "up"), "nav:movies");
    assert.equal(step("nav:home", "up"), "nav:home");
    assert.equal(step("nav:series", "down"), "nav:series");
    assert.equal(step("nav:home", "right"), "home-hero:watch");
    assert(step("home-hero:watch", "left").startsWith("nav:"));
    assert.equal(step("home-hero:watch", "down"), "home-shelf:Films:movie-7");
    host.transitions = [];
    host.focus("nav:live");
    for (const id of ["nav:home", "nav:movies", "nav:series", "nav:series", ""])
      host.focus(id);
    tree = host.render(ResponsiveContentNav, props);
    const before = all(tree, (n) => n.tag === "FocusButton").map(
      (n) => n.props.style,
    );
    tree = host.render(ResponsiveContentNav, { ...props, activeKey: "movies" });
    assert.deepEqual(
      all(tree, (n) => n.tag === "FocusButton").map(
        (n) => n.props.style[1].width,
      ),
      before.map((x) => x[1].width),
    );
    assert.deepEqual(
      chosen,
      [],
      "direction and screen notifications cannot select a route",
    );
    assert.deepEqual(
      host.transitions,
      [true],
      "one boundary entry; no conflicting item transitions",
    );
    assert.equal(
      all(tree, (n) => n.tag === "Text" && n.props.children.includes("home"))
        .length,
      1,
    );
    for (let i = 0; i < 8; i++) {
      host.focus("home-hero:watch");
      host.focus("nav:home");
    }
    host.focus("modal:close");
    tree = host.render(ResponsiveContentNav, props);
    assert.equal(host.transitions.length, 18);
    assert.equal(
      all(tree, (n) => n.tag === "Text" && n.props.children.includes("home"))
        .length,
      0,
    );
    const stale = [...host.listeners][0];
    host.reset();
    stale({ id: "nav:home" });
    assert.deepEqual(
      host.transitions,
      [],
      "unmounted provider owner rejects queued callback",
    );
    passed++;
  }
  host.reset();
  Object.assign(host, { tv: false, preview: true, width: 873, height: 393 });
  const preview = host.render(ResponsiveContentNav, props);
  assert.equal(
    all(preview, (node) => node.tag === "CompactLandscapeNavButton").length,
    4,
  );
  passed++;
  host.reset();
  Object.assign(host, { tv: false, preview: false, width: 393, height: 873 });
  const mobile = host.render(ResponsiveContentNav, props);
  assert.equal(all(mobile, (node) => node.tag === "FocusButton").length, 0);
  passed++;
  for (const [width, height] of [
    [720, 480],
    [1920, 1080],
  ]) {
    host.reset();
    Object.assign(host, { tv: true, preview: false, width, height });
    const channels = [
      { id: "channel-7", name: "News" },
      { id: "channel-11", name: "Movies" },
    ];
    const opened = [],
      categories = [],
      queries = [];
    const liveProps = {
      categories: [{ id: "general", name: "General" }],
      category: "general",
      onCategory: (id) => categories.push(id),
      channels,
      epgByChannel: new Map(),
      clock: 0,
      favorites: [],
      loading: false,
      loadingMore: false,
      search: "",
      onSearch: (value) => queries.push(value),
      onRefresh() {},
      onLoadMore() {},
      onOpen: (channel) => opened.push(channel.id),
      onFavorite() {},
      idPrefix: "u41",
    };
    let live = host.render(EliteLiveCatalog, liveProps);
    const onLayout = only(
      live,
      (node) =>
        node.tag === "View" && typeof node.props.onLayout === "function",
    );
    onLayout.props.onLayout({ nativeEvent: { layout: { width, height } } });
    live = host.render(EliteLiveCatalog, liveProps);
    const list = only(live, (node) => node.tag === "FlatList");
    assert.equal(list.props.data.length, 2);
    // The category column and channel list remain mounted at both widths.
    const category = only(
      live,
      (node) => node.props?.focusId === "u41:category:general",
    );
    assert.equal(category.props.accessibilityState.selected, true);
    category.props.onPress();
    assert.deepEqual(categories, ["general"]);
    // Real Live toolbar owns search input state, not the selected channel.
    only(
      live,
      (node) => node.props?.focusId === "u41:search-toggle",
    ).props.onPress();
    let searching = host.render(EliteLiveCatalog, liveProps);
    const searchInput = only(searching, (node) => node.tag === "TextInput");
    searchInput.props.onChangeText("Movies");
    assert.deepEqual(queries, ["Movies"]);
    only(
      searching,
      (node) => node.props?.focusId === "u41:search-toggle",
    ).props.onPress();
    live = host.render(EliteLiveCatalog, liveProps);
    assert.equal(all(live, (node) => node.tag === "TextInput").length, 0);
    const scrollviews = all(live, (node) => node.tag === "ScrollView");
    assert.equal(scrollviews.length, width < 1050 ? 1 : 2);
    const categoryWidth = scrollviews[0].props.style.width;
    assert(categoryWidth >= 96 && categoryWidth < width * 0.4);
    if (width >= 1050) {
      const detailWidth = scrollviews[1].props.style
        .flat()
        .find((style) => typeof style?.width === "number").width;
      const measured = eliteLiveLayout({
        width,
        height,
        fontScale: 1,
        safeArea: { top: 8, left: 12, right: 12, bottom: 8 },
      });
      assert.equal(detailWidth, measured.detailWidth);
      assert.equal(categoryWidth, measured.categoryWidth);
      const browseWidth = measured.categoryWidth + measured.channelWidth + 12;
      const deviation = Math.abs(browseWidth / measured.usableWidth - 0.32);
      assert(deviation < 0.025, "V3 Live 32% budget");
      assert(detailWidth / measured.usableWidth > 0.60);
    }
    const scrollRequests = [];
    list.props.ref.current = {
      scrollToIndex: (request) => scrollRequests.push(request),
    };
    const channel = list.props.renderItem({ item: channels[1], index: 1 });
    const focusable = only(
      channel,
      (node) => node.props?.focusId === "u41:channel:channel-11",
    );
    focusable.props.onFocus();
    assert.equal(scrollRequests.at(-1).index, 1);
    assert.deepEqual(opened, []); // Browsing is never an implicit tune.
    focusable.props.onPress();
    assert.deepEqual(opened, ["channel-11"]);
    // A recycled index or changed session must invalidate old asynchronous
    // Focus and OK events without suppressing a fresh, valid channel press.
    const updatedChannels = [
      { id: "channel-22", name: "Other" },
      { id: "channel-11", name: "Movies" },
    ];
    const refreshed = host.render(EliteLiveCatalog, {
      ...liveProps,
      channels: updatedChannels,
      catalogRevision: 99,
    });
    const countBefore = scrollRequests.length;
    focusable.props.onFocus();
    focusable.props.onPress();
    assert.equal(scrollRequests.length, countBefore);
    assert.deepEqual(opened, ["channel-11"]);
    const refreshedList = only(refreshed, (node) => node.tag === "FlatList");
    const refreshedRow = refreshedList.props.renderItem({
      item: updatedChannels[1],
      index: 1,
    });
    only(
      refreshedRow,
      (node) => node.props?.focusId === "u41:channel:channel-11",
    ).props.onPress();
    assert.deepEqual(opened, ["channel-11", "channel-11"]);
    const deleted = host.render(EliteLiveCatalog, {
      ...liveProps,
      channels: [updatedChannels[0]],
      catalogRevision: 100,
    });
    const fallbackList = only(deleted, (node) => node.tag === "FlatList");
    const fallbackRow = fallbackList.props.renderItem({
      item: updatedChannels[0],
      index: 0,
    });
    const fallback = only(
      fallbackRow,
      (node) => node.props?.focusId === "u41:channel:channel-22",
    );
    assert.equal(fallback.props.hasTVPreferredFocus, true);
    assert.deepEqual(opened, ["channel-11", "channel-11"]); // Focus fallback never auto-plays.
    passed++;
  }
  console.log(
    `U4.1 production StageRail/Live host: ${passed}/${passed} PASS; ANDROID_FOCUSFINDER_PENDING_RC`,
  );
} finally {
  delete globalThis.__u41;
  rmSync(out, { recursive: true, force: true });
}
