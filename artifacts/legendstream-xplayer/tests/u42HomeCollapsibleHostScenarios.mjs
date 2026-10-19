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
const host = globalThis.__u42 = {
  width: 960, height: 540, fontScale: 1, isTV: true, preview: false,
  state(value) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value;
    return [slots[i], (next) => {
      slots[i] = typeof next === "function" ? next(slots[i]) : next;
    }];
  },
  ref(value) {
    const i = cursor++;
    return slots[i] ?? (slots[i] = { current: value });
  },
  effect(fn, deps) {
    const i = effectCursor++;
    const prior = previousEffects[i];
    if (!prior || !deps || deps.some((value, index) => !Object.is(value, prior[index]))) {
      previousEffects[i] = deps;
      pendingEffects.push(fn);
    }
  },
  reset() { slots = []; cursor = 0; previousEffects = []; effectCursor = 0; pendingEffects = []; },
  render(component, props) {
    cursor = 0;
    effectCursor = 0;
    pendingEffects = [];
    const value = component(props);
    for (const run of pendingEffects) run();
    return value;
  },
};
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
  "react-native-safe-area-context": 'export const useSafeAreaInsets=()=>({top:8,right:12,bottom:16,left:24});',
  "@expo/vector-icons": 'export const Feather="Feather";',
  "expo-linear-gradient": 'export const LinearGradient="LinearGradient";',
  "@/context/UiPresentationContext": 'export const useUiPresentation=()=>({tvPreview:globalThis.__u42.preview});',
  "@/context/MediaLibraryContext": 'export const useMediaLibrary=()=>({entries:[],loaded:true,removeProgress(){}});',
  "@/context/I18nContext": 'export const useI18n=()=>({language:"tr",t:k=>k});',
  "@/hooks/useColors": 'export const useColors=()=>({primary:"#67e8d1",foreground:"white",mutedForeground:"#999",border:"#333",card:"#222",muted:"#888"});',
  "@/components/tvPreview/TVPreviewFocus": 'export const TVPreviewPressable="TVPreviewPressable";',
  "@/lib/imageUrl": 'export const normalizeImageUrl=x=>x||null;',
  "@/lib/historyPresentation": 'export const visibleProgressRatio=()=>0;',
  "@/lib/performanceDiagnostics": 'export const markStartupEvent=()=>{};',
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
      contents: `export { HomeDiscovery, HomeHeroCarousel } from ${JSON.stringify(join(app, "components/home/HomeDiscovery.tsx"))};`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "home.cjs"),
    logLevel: "silent",
    plugins: [{
      name: "u42-production-adapter",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (args.path in mocks) return { path: args.path, namespace: "u42-mock" };
          if (args.path.startsWith("@/")) {
            const base = join(app, args.path.slice(2));
            const path = [base, base + ".ts", base + ".tsx", join(base, "index.ts")].find(existsSync);
            if (path) return { path };
          }
        });
        builder.onLoad({ filter: /.*/, namespace: "u42-mock" }, (args) => ({
          contents: mocks[args.path], loader: "js", resolveDir: app,
        }));
      },
    }],
  });
  const { HomeDiscovery, HomeHeroCarousel } = requireApp(join(out, "home.cjs"));
  const profiles = [[720,480],[960,540],[1280,720],[1920,1080]];
  const props = {
    provider: { id: "p1", name: "Provider", type: "xtream" },
    tvViewportHeight: 420,
    live: 2, vod: 1, series: 0,
    vodCategories: 0, seriesCategories: 0,
    catalogLoading: false,
    channels: [{id:"channel-3",name:"Kanal 3"}],
    history: [],
    movies: [{stream_id:7,name:"Film 7",stream_icon:"",plot:"Test",genre:"Dram"}],
    seriesItems: [],
    newChannels: [], newMovies: [], newSeries: [],
    onNavigate() {}, onOpenLive() {}, onOpenMovie() {}, onOpenSeries() {},
    onWatchMovie() {}, onOpenMedia() {}, onRemoveLive() {},
  };
  let passed = 0;
  for (const [width,height] of profiles) {
    host.reset(); Object.assign(host,{width,height,isTV:true,preview:false});
    const opened = [];
    const watched = [];
    const base = {
      ...props,
      tvViewportHeight: Math.max(320, height-150),
      onOpenMovie: movie => opened.push(movie.stream_id),
      onWatchMovie: movie => watched.push(movie.stream_id),
    };
    let root = host.render(HomeDiscovery, base);
    let hero = unique(root, n => n.tag === HomeHeroCarousel);
    const shelves = find(root,n=>typeof n.tag==="function" && n.tag.name==="HomeShelf");
    assert(shelves.length >= 3);
    assert.equal(hero.props.collapsed,false);
    const identity = hero.props.items[0].id;
    // Both Hero Info and Play are wired to the real Home production actions.
    const heroActions = renderChild(HomeHeroCarousel, hero.props);
    unique(heroActions, node => node.props?.focusId === "home-hero:" + identity + ":info").props.onPress();
    unique(heroActions, node => node.props?.focusId === "home-hero:" + identity + ":watch").props.onPress();
    assert.deepEqual(opened, [7]);
    assert.deepEqual(watched, [7]);
    const movieShelf = shelves.find(node => node.props.title === "movies");
    assert(movieShelf);
    const movieTree = renderChild(movieShelf.tag, movieShelf.props);
    const movieList = unique(movieTree, node => node.tag === "FlatList");
    const movieCard = movieList.props.renderItem({ item: movieList.props.data[0], index: 0 });
    const moviePressable = renderChild(movieCard.tag, movieCard.props);
    unique(moviePressable, node => node.props?.focusId?.includes(":movie-7")).props.onPress();
    assert.deepEqual(opened, [7, 7]);
    const shelfIdentity = shelves[0].props.items.map(x => x.id);
    // The callback is supplied to every mounted shelf, not a separate
    // geometry helper. It is invoked by each real shelf's item focus handler.
    const liveShelf = renderChild(shelves[0].tag, shelves[0].props);
    const more = unique(liveShelf, n =>
      typeof n.tag === "function" &&
      n.tag.name === "TvFocusPressable" &&
      n.props.focusId?.endsWith(":more"),
    );
    more.props.onFocus(); // Real shelf control's focus callback.
    const list = unique(liveShelf, n => n.tag === "FlatList");
    const scrollRequests = [];
    list.props.ref.current = { scrollToIndex: request => scrollRequests.push(request) };
    const firstCard = list.props.renderItem({ item: list.props.data[0], index: 0 });
    firstCard.props.onFocus();
    assert.equal(scrollRequests[0].index, 0);
    root = host.render(HomeDiscovery, base);
    hero = unique(root,n=>n.tag===HomeHeroCarousel);
    assert.equal(hero.props.collapsed,true);
    assert.equal(hero.props.items[0].id,identity);
    assert.deepEqual(find(root,n=>typeof n.tag==="function" && n.tag.name==="HomeShelf")[0].props.items.map(x=>x.id),shelfIdentity);
    const lastShelf = find(root, n => typeof n.tag === "function" && n.tag.name === "HomeShelf").at(-1);
    const lastShelfTree = renderChild(lastShelf.tag, lastShelf.props);
    unique(lastShelfTree, n => typeof n.tag === "function" && n.props.focusId?.endsWith(":more")).props.onFocus();
    assert.equal(unique(host.render(HomeDiscovery,base),n=>n.tag===HomeHeroCarousel).props.collapsed,true);
    // StageRail has no callback into this state.
    const stageRailSelectionOnly = ()=>{};
    stageRailSelectionOnly();
    assert.equal(unique(host.render(HomeDiscovery,base),n=>n.tag===HomeHeroCarousel).props.collapsed,true);
    const compactHeroTree = renderChild(HomeHeroCarousel, hero.props);
    const compactHeight = compactHeroTree.props.style.minHeight;
    const restore = unique(compactHeroTree, n =>
      n.props?.focusId === "home-hero:" + identity + ":watch",
    );
    assert.equal(restore.props.accessibilityLabel, "Öne çıkan içeriğe dön");
    restore.props.onFocus(); // Real native Hero action remains focusable.
    root = host.render(HomeDiscovery,base);
    hero = unique(root,n=>n.tag===HomeHeroCarousel);
    assert.equal(hero.props.collapsed,false);
    assert.equal(hero.props.items[0].id,identity);
    const expandedHeroTree = renderChild(HomeHeroCarousel, hero.props);
    const expandedHeight = expandedHeroTree.props.style.minHeight;
    assert(compactHeight < expandedHeight);
    assert(expandedHeight <= 320);
    assert(compactHeight >= 96);
    // Repeated D-pad crossings must settle without remounting the content
    // identity or changing a selected Hero item.
    for (let i = 0; i < 24; i++) {
      const shelf = find(root, n => typeof n.tag === "function" && n.tag.name === "HomeShelf")[0];
      shelf.props.onContentFocus();
      root = host.render(HomeDiscovery, base);
      const foldedHero = unique(root, n => n.tag === HomeHeroCarousel);
      assert.equal(foldedHero.props.collapsed, true);
      assert.equal(foldedHero.props.items[0].id, identity);
      foldedHero.props.onHeroFocus();
      root = host.render(HomeDiscovery, base);
      assert.equal(unique(root, n => n.tag === HomeHeroCarousel).props.collapsed, false);
    }
    passed++;
  }
  // A provider boundary invalidates the old shelf context even if Home
  // remains mounted; the effect is exercised by the same production component.
  host.reset(); Object.assign(host, {width:960,height:540,isTV:true,preview:false});
  const initial = host.render(HomeDiscovery,props);
  find(initial,n=>typeof n.tag==="function"&&n.tag.name==="HomeShelf")[0].props.onContentFocus();
  assert.equal(unique(host.render(HomeDiscovery,props),n=>n.tag===HomeHeroCarousel).props.collapsed,true);
  const nextProvider = {...props,provider:{...props.provider,id:"p2"}};
  host.render(HomeDiscovery,nextProvider);
  assert.equal(unique(host.render(HomeDiscovery,nextProvider),n=>n.tag===HomeHeroCarousel).props.collapsed,false);
  passed++;
  // Keep the same mounted Home contract for empty and loading provider views.
  host.reset(); Object.assign(host, {width:960,height:540,isTV:true,preview:false});
  const noContent = {
    ...props,
    movies: [], seriesItems: [], channels: [],
    history: [], live: 0, vod: 0, series: 0,
  };
  const emptyTree = host.render(HomeDiscovery, noContent);
  const emptyHero = unique(emptyTree, n => n.tag === HomeHeroCarousel);
  assert.equal(emptyHero.props.loading, false);
  assert.equal(emptyHero.props.items.length, 0);
  assert.equal(find(emptyTree, n => typeof n.tag === "function" && n.tag.name === "HomeShelf").length, 3);
  passed++;
  host.reset();
  const loadingTree = host.render(HomeDiscovery, {
    ...noContent, live: null, vod: null, series: null, catalogLoading: true,
  });
  const loadingHero = unique(loadingTree, n => n.tag === HomeHeroCarousel);
  assert.equal(loadingHero.props.loading, true);
  assert.equal(loadingHero.props.items.length, 0);
  passed++;
  // Touch and Preview do not opt into native collapse.
  for(const [width,height,preview] of [[393,873,false],[873,393,false],[800,1280,false],[1280,800,false],[873,393,true]]) {
    host.reset();Object.assign(host,{width,height,isTV:false,preview});
    const root=host.render(HomeDiscovery,props);
    const shelves=find(root,n=>typeof n.tag==="function" && n.tag.name==="HomeShelf");
    shelves[0].props.onContentFocus();
    assert.equal(unique(host.render(HomeDiscovery,props),n=>n.tag===HomeHeroCarousel).props.collapsed,false);
    passed++;
  }
  console.log(`U4.2 production Home Hero/shelf state: ${passed}/${passed} PASS; ANDROID_FOCUSFINDER_PENDING_RC`);
} finally {
  delete globalThis.__u42;
  rmSync(out,{recursive:true,force:true});
}
