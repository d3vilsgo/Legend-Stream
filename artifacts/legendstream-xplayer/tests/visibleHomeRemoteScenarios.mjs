import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const app = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  req = createRequire(join(app, "package.json"));
const { build } = createRequire(req.resolve("tsx/package.json"))("esbuild");
const out = mkdtempSync(join(tmpdir(), "visible-home-"));
let slots = [],
  cursor = 0,
  effects = [],
  count = 0;
const same = (a, b) =>
  a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const h = (globalThis.__visible = {
  native: false,
  preview: false,
  width: 393,
  height: 873,
  fontScale: 1,
  listeners: {},
  state(v) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof v === "function" ? v() : v;
    return [
      slots[i],
      (v) => {
        slots[i] = typeof v === "function" ? v(slots[i]) : v;
      },
    ];
  },
  ref(v) {
    const i = cursor++;
    return slots[i] ?? (slots[i] = { current: v });
  },
  memo(f, d) {
    const i = cursor++;
    if (!same(slots[i]?.deps, d)) slots[i] = { deps: d, value: f() };
    return slots[i].value;
  },
  effect(f, d) {
    const i = cursor++;
    if (!same(slots[i]?.deps, d))
      effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps: d, cleanup: f() };
      });
  },
});
const mocks = {
  "@/components/player/PlayerChrome":
    "export const PlayerChrome='PlayerChrome';",
  "@/components/player/VlcPlaybackSurface":
    "export const VlcPlaybackSurface='VLC';",
  "@react-native-async-storage/async-storage":
    "export default {getItem:async()=>null,setItem:async()=>{}};",
  "@/lib/tvRemoteInspector": "export const inspectorAction=()=>{},inspectorRail=()=>{};",
  "@/modules/legendstream-tv-remote":
    "export const configureTvRemote=()=>{},subscribeTvRemote=()=>({remove(){}}),subscribeNativeTvFocus=()=>({remove(){}});",
  "@/hooks/usePlayerOrientation":
    "export const usePlayerOrientation=()=>({ready:true,exiting:false,beginExit(){},restore:async()=>{},releaseWhenLayoutReady(){},rotate(){}});",
  "@/modules/legendstream-pip":
    "export const getMediaVolume=()=>1,isPipSupported=()=>false,isInPipMode=()=>false,enterPictureInPicture=async()=>false,setMediaVolume=()=>{};",
  "@/lib/downloads": "export const downloadMedia=async()=>{};",
  "@/lib/playerPreferences":
    "export const DEFAULT_PLAYER_CHROME_TIMEOUT_SECONDS=5,getPlayerChromeTimeoutSeconds=async()=>5;",
  "@/lib/xtreamCatalog":
    "export const buildVodStreamUrl=()=>'',getEpisodePlaybackQueue=()=>[],getVodPlaybackQueue=()=>[];",
  "@/lib/catalogPersistence": "export const isCatalogRuntimeSource=()=>false;",
  "@/lib/catalogRuntime":
    "export const resolveCatalogRuntimeSource=async()=>'';",
  "@/lib/catalogPageRepository":
    "export const getCachedLivePlaybackWindow=async()=>[],getCachedVodPlaybackWindow=async()=>[];",
  "@/lib/epgRuntime": "export const registerEpgChannels=()=>{},selectProgramsAt=()=>({});",
  "@/lib/m3uInAppDiagnostics":
    "export const describeM3UPlaybackUri=()=>({}),recordM3UCompatPlayerMount=()=>{},recordM3ULiveQueueBegin=()=>{},recordM3ULiveQueueEnd=()=>{};",
  "@/lib/stalkerPlaybackTrace":
    "export const classifyPlaybackSource=()=>'',classifyStalkerTraceError=()=>'',describePlaybackSourceSafely=()=>({}),fingerprintPlaybackSource=()=>'',getActiveStalkerTraceId=()=>null,traceStalker=()=>{};",
  "@/lib/performanceDiagnostics":
    "export const beginPlaybackAttempt=()=>{},getActivePlaybackAttemptId=()=>null,markPlaybackEvent=()=>{},markStartupEvent=()=>{};",

  react: `const h=globalThis.__visible;export const useState=v=>h.state(v),useRef=v=>h.ref(v),useMemo=(f,d)=>h.memo(f,d),useCallback=(f,d)=>h.memo(()=>f,d),useReducer=(reduce,v)=>{const [state,set]=h.state(v);return [state,event=>set(now=>reduce(now,event))]},useEffect=(f,d)=>h.effect(f,d);export const useSyncExternalStore=(s,g)=>g();export const memo=f=>f,createContext=v=>({value:v,Provider:'Provider'}),useContext=c=>c.value;export default {createElement:(tag,props,...children)=>({tag,props:{...props,children}})};`,
  "react-native": `export const View='View',Text='Text',Pressable='Button',Image='Image',FlatList='FlatList',ScrollView='ScrollView',Modal='Modal',KeyboardAvoidingView='KeyboardAvoidingView',TextInput='TextInput',ActivityIndicator='ActivityIndicator';export const Animated={Value:class{},View:'AnimatedView',timing:()=>({start(){}})};export const Platform={get isTV(){return globalThis.__visible.native},OS:'android'};export const StyleSheet={create:s=>s,absoluteFill:{},absoluteFillObject:{}};export const useWindowDimensions=()=>globalThis.__visible;export const Keyboard={addListener:(name,f)=>{globalThis.__visible.listeners[name]=f;return {remove(){delete globalThis.__visible.listeners[name]}}}};export const AppState={addEventListener:()=>({remove(){}})};export const BackHandler={addEventListener:(name,f)=>{globalThis.__visible.hardwareBack=f;return {remove(){}}}};`,
  "react-native-safe-area-context": `export const useSafeAreaInsets=()=>({top:0,bottom:20,left:0,right:0});`,
  "@expo/vector-icons": `export const Feather='Icon',MaterialIcons='Icon';`,
  "expo-linear-gradient": `export const LinearGradient='Gradient';`,
  "@/context/UiPresentationContext": `export const useUiPresentation=()=>({tvPreview:globalThis.__visible.preview});`,
  "@/hooks/useColors": `export const useColors=()=>({primary:'#67e8d1',foreground:'white',mutedForeground:'#aaa',border:'#333',card:'#111'});`,
  "@/context/PlayerContext": `export const selectProgramsAt=()=>({}),selectChannelEpg=()=>({});export const usePlayer=()=>({provider:null,channels:[],epg:[],isEpgLoading:false,recordWatched(){}});`,
  "@/context/I18nContext": `export const useI18n=()=>({language:'tr',t:k=>k});`,
  "@/context/MediaLibraryContext": `export const useMediaLibrary=()=>({entries:[],loaded:true,removeProgress(){},getProgress(){},saveProgress:async()=>{}});`,
  "@/components/tvPreview/TVPreviewFocus": `export const TVPreviewPressable='Button',TVPreviewFocusRegion='Region',TVPreviewControls='Controls';export const useOptionalTVPreviewFocus=()=>null;export const useTVPreviewFocus=()=>({nativeScope:'category-picker',pushFocusScope:()=>{globalThis.__visible.scope=true;return ()=>{globalThis.__visible.scope=false}},registerBackAction:f=>{globalThis.__visible.back=f;return ()=>{globalThis.__visible.back=null}},modalShown:()=>{globalThis.__visible.shown=true}});`,
  "@/components/FocusButton": `export const FocusButton='Button';`,
  "@/components/player/PlayerRemotePressable": `export const PlayerRemotePressable='Button',PlayerRemoteFocusBoundary='Boundary';`,
  "./PlayerRemotePressable": `export const PlayerRemotePressable='Button',PlayerRemoteFocusBoundary='Boundary';`,
  "./PlayerGestureLayer": `export const PlayerGestureLayer='Gesture';`,
};
const render = (f) => {
  cursor = 0;
  effects = [];
  const tree = f();
  effects.forEach((f) => f());
  return tree;
};
const clean = () => {
  for (const s of slots) s?.cleanup?.();
  h.opened = null;
  h.watched = null;
  slots = [];
  cursor = 0;
  effects = [];
};
const nodes = (t) =>
  !t || typeof t !== "object"
    ? []
    : [t, ...(t.props?.children ?? []).flat(Infinity).flatMap(nodes)];
const text = (t) =>
  typeof t === "string"
    ? t
    : !t || typeof t !== "object"
      ? ""
      : (t.props?.children ?? []).flat(Infinity).map(text).join(" ");
const testAsync = async (name, f) => {
  clean();
  await f();
  count++;
  console.log("ok visible Home " + count + " - " + name);
};
const test = (name, f) => {
  clean();
  f();
  count++;
  console.log("ok visible Home " + count + " - " + name);
};
try {
  await build({
    stdin: {
      contents: `export {CompatibilityVideoPlayer} from './components/CompatibilityVideoPlayerV2';export {EliteLiveCatalog} from './components/elite/EliteLiveCatalog';export {CategoryPicker} from './components/navigation/CategoryPicker';export {useHomeMovieInfo} from './hooks/useHomeMovieInfo';export {HomeHeroCarousel} from './components/home/HomeDiscovery';export {ResponsiveContentNav} from './components/navigation/ResponsiveContentNav';export {PlayerChrome,PanelContent} from './components/player/PlayerChromeV2';export {PlayerChrome as ProductionPlayerChrome} from './components/player/PlayerChrome';`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "tests.cjs"),
    logLevel: "silent",
    plugins: [
      {
        name: "host",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in mocks)
              return { path: args.path, namespace: "host" };
            if (args.path.startsWith("@/")) {
              const base = join(app, args.path.slice(2)),
                p = [
                  base,
                  base + ".tsx",
                  base + ".ts",
                  join(base, "index.ts"),
                ].find(existsSync);
              if (p) return { path: p };
            }
          });
          b.onLoad({ filter: /.*/, namespace: "host" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
            resolveDir: app,
          }));
        },
      },
    ],
  });
  const {
    HomeHeroCarousel,
    ResponsiveContentNav,
    PlayerChrome,
    ProductionPlayerChrome,
    PanelContent,
    CompatibilityVideoPlayer,
    EliteLiveCatalog,
    CategoryPicker,
    useHomeMovieInfo,
  } = req(join(out, "tests.cjs"));
  const movie = {
      id: "provider-a:movie:7",
      title: "Aynı başlık",
      subtitle: "Drama",
      image: "",
      movie: { stream_id: 7 },
    },
    series = {
      id: "provider-a:series:8",
      title: "Aynı başlık",
      subtitle: "Dizi",
      image: "",
      series: { series_id: 8 },
    };
  const heroProps = {
    items: [movie, series],
    eyebrow: "Öne çıkan",
    providerName: "Yerel",
    discoverLabel: "Keşfet",
    onDiscover() {},
    onWatch(item) {
      h.watched = item;
    },
    onOpen(item) {
      h.opened = item;
    },
  };
  for (const [width, height, preview, native] of [
    [393, 873, false, false],
    [873, 393, true, false],
    [960, 540, false, true],
    [1280, 800, false, false],
  ])
    test(`readable hero and identity actions ${width}/${height}/${preview}/${native}`, () => {
      Object.assign(h, { width, height, preview, native });
      const tree = render(() => HomeHeroCarousel(heroProps));
      assert(
        tree.props.style.minHeight >=
          (native ? 1 : width > height || preview ? 160 : 310),
      );
      assert.match(text(tree), /Aynı başlık/);
      assert.match(text(tree), /İzle/);
      assert.match(text(tree), /Detay \/ Bilgi/);
      const watch = nodes(tree).find((n) =>
        n.props?.focusId?.endsWith(":watch"),
      );
      watch.props.onPress();
      assert.equal(h.watched, movie);
      assert.notEqual(h.opened, movie);
      const info = nodes(tree).find((n) => n.props?.focusId?.endsWith(":info"));
      info.props.onPress();
      assert.equal(h.opened, movie);
      nodes(tree)
        .find((n) => n.props?.focusId === "home-hero:next")
        .props.onPress();
      const next = render(() => HomeHeroCarousel(heroProps));
      assert.match(text(next), /Bölümleri Gör/);
      nodes(next)
        .find((n) => n.props?.focusId?.endsWith(":watch"))
        .props.onPress();
      assert.equal(h.opened, series);
    });
  test("large text Hero actions can wrap inside a bounded caption beside the title", () => {
    for (const [width, height, native] of [
      [320, 568, false],
      [873, 393, false],
      [960, 540, true],
    ]) {
      Object.assign(h, { width, height, native, fontScale: 3, preview: false });
      const tree = render(() => HomeHeroCarousel(heroProps));
      const group = nodes(tree).find(
        (n) => n.props?.style?.flexWrap === "wrap",
      );
      assert(group);
      assert.equal(group.props.style.maxWidth, width > height ? "55%" : "100%");
      const watch = nodes(tree).find((n) =>
        n.props?.focusId?.endsWith(":watch"),
      );
      assert.equal(watch.props.style.maxWidth, "100%");
      assert.equal(watch.props.style.flexShrink, 1);
      watch.props.onPress();
      assert.equal(h.watched, movie);
    }
    h.fontScale = 1;
  });
  test("loading and no artwork have explicit readable copy", () => {
    Object.assign(h, {
      width: 393,
      height: 873,
      native: false,
      preview: false,
    });
    const a = render(() =>
      HomeHeroCarousel({ ...heroProps, loading: true, items: [] }),
    );
    assert.match(text(a), /hazırlanıyor/);
    assert(!nodes(a).some((n) => n.props?.focusId?.endsWith(":watch")));
    const b = render(() => HomeHeroCarousel({ ...heroProps, items: [] }));
    assert.match(text(b), /keşfedin/);
  });
  const items = [
    "home",
    "live",
    "movies",
    "series",
    "history",
    "downloads",
    "settings",
  ].map((key) => ({ key, label: key, icon: "home" }));
  let selected;
  const navProps = {
    items,
    activeKey: "home",
    placement: "bottom",
    onSelect: (key) => (selected = key),
  };
  test("five mobile tabs and library use existing history/download routes", () => {
    const tree = render(() => ResponsiveContentNav(navProps));
    assert.equal(
      nodes(tree).filter((n) => n.props?.accessibilityRole === "tab").length,
      5,
    );
    nodes(tree)
      .find((n) => n.props?.accessibilityLabel === "Kitaplık")
      .props.onPress();
    const next = render(() => ResponsiveContentNav(navProps));
    assert.equal(
      nodes(next).find((n) => n.tag === "Modal").props.visible,
      true,
    );
    nodes(next)
      .find(
        (n) =>
          n.tag === "Button" && text(n) === "Favoriler · Geçmiş · Devam Et",
      )
      .props.onPress();
    assert.equal(selected, "history");
  });
  test("keyboard hides in-flow bottom navigation", () => {
    render(() => ResponsiveContentNav(navProps));
    h.listeners.keyboardDidShow();
    assert.equal(
      render(() => ResponsiveContentNav(navProps)),
      null,
    );
    h.listeners.keyboardDidHide();
    assert(render(() => ResponsiveContentNav(navProps)));
  });
  test("Native TV and Preview do not receive the mobile bottom bar", () => {
    for (const [native, preview] of [
      [true, false],
      [false, true],
    ]) {
      Object.assign(h, { native, preview });
      assert.equal(
        render(() => ResponsiveContentNav(navProps)),
        null,
      );
    }
  });
  test("error recovery has persistent focusable retry and exit without hidden controls", () => {
    h.native = true;
    let retry = 0,
      exit = 0;
    const tree = render(() =>
      PlayerChrome({
        errorText: "Bağlantı kurulamadı",
        controlsVisible: false,
        infoVisible: false,
        mediaKind: "live",
        selectableItems: [],
        onRetry: () => retry++,
        onExit: () => exit++,
      }),
    );
    const ns = nodes(tree),
      back = ns.find((n) => n.props?.nativeID === "player:error-exit"),
      again = ns.find((n) => n.props?.nativeID === "player:error-retry");
    assert(back && again);
    assert.equal(again.props.hasTVPreferredFocus, true);
    back.props.onPress();
    again.props.onPress();
    assert.equal(exit, 1);
    assert.equal(retry, 1);
    assert(
      !ns.some(
        (n) =>
          n.props?.pointerEvents === "none" && n.props?.style?.zIndex === 15,
      ),
    );
  });
  test("production Player seek capability and remote/touch parity", () => {
    for (const native of [false, true]) {
      h.native = native;
      const seeks = [],
        ratios = [];
      const props = {
        controlsVisible: true,
        mediaKind: "movie",
        duration: 120,
        position: 20,
        selectableItems: [],
        audioTracks: [],
        textTracks: [],
        onSeekBy: (n) => seeks.push(n),
        onSeekRatio: (n) => ratios.push(n),
      };
      let tree = render(() => PlayerChrome(props));
      const actions = nodes(tree).filter(
        (n) => typeof n.tag === "function" && n.tag.name === "RoundAction",
      );
      assert.equal(actions.length, 2);
      for (const a of actions) {
        const button = a.tag(a.props);
        assert.equal(button.props.disabled, false);
        assert.match(button.props.accessibilityLabel, /saniye/);
        button.props.onPress();
      }
      assert.deepEqual(seeks, [-10, 15]);
      let timeline = nodes(tree).find(
        (n) => n.props?.accessibilityLabel === "Oynatma konumu",
      );
      assert.equal(timeline.props.focusable, false);
      assert.equal(timeline.props.disabled, native);
      timeline.props.onLayout({ nativeEvent: { layout: { width: 200 } } });
      tree = render(() => PlayerChrome(props));
      timeline = nodes(tree).find(
        (n) => n.props?.accessibilityLabel === "Oynatma konumu",
      );
      timeline.props.onPress({ nativeEvent: { locationX: 50 } });
      timeline.props.onPress({ nativeEvent: {} });
      assert.deepEqual(ratios, native ? [] : [0.25]);
      assert(
        nodes(tree).some((n) => n.props?.accessibilityLabel === "Duraklat"),
      );
      for (const duration of [0, NaN, Infinity]) {
        tree = render(() => PlayerChrome({ ...props, duration }));
        for (const a of nodes(tree).filter(
          (n) => typeof n.tag === "function" && n.tag.name === "RoundAction",
        )) {
          assert.equal(a.props.disabled, true);
          a.props.onPress();
        }
        assert.deepEqual(seeks, [-10, 15]);
        assert.equal(
          nodes(tree).find((n) => n.tag === "Gesture").props.seekEnabled,
          false,
        );
      }
      tree = render(() => PlayerChrome({ ...props, mediaKind: "live" }));
      assert(
        !nodes(tree).some(
          (n) => n.props?.accessibilityLabel === "Oynatma konumu",
        ),
      );
      assert(
        !nodes(tree).some(
          (n) => typeof n.tag === "function" && n.tag.name === "RoundAction",
        ),
      );
    }
  });
  test("active production PlayerChrome capability gate and panel callbacks", () => {
    for (const native of [false, true]) {
      h.native = native;
      const seeks = [],
        panels = [];
      const props = {
        controlsVisible: true,
        mediaKind: "movie",
        duration: 120,
        position: 10,
        selectableItems: [],
        onSeekBy: (n) => seeks.push(n),
        onTogglePanel: (p) => panels.push(p),
      };
      let tree = render(() => ProductionPlayerChrome(props));
      const buttons = nodes(tree).filter(
        (n) => typeof n.tag === "function" && n.tag.name === "RoundButton",
      );
      assert.equal(buttons.length, 2);
      buttons.forEach((n) => {
        assert.equal(n.props.disabled, false);
        n.props.onPress();
      });
      assert.deepEqual(seeks, [-10, 15]);
      const actions = nodes(tree).filter(
        (n) =>
          typeof n.tag === "function" && n.tag.name === "AdaptiveDockButton",
      );
      for (const key of ["cc", "audio", "codec"])
        actions.find((n) => n.props.action.key === key).props.action.onPress();
      assert.deepEqual(panels, ["subtitles", "audio", "codec"]);
      for (const duration of [0, NaN, Infinity]) {
        tree = render(() => ProductionPlayerChrome({ ...props, duration }));
        const disabled = nodes(tree).filter(
          (n) => typeof n.tag === "function" && n.tag.name === "RoundButton",
        );
        assert.equal(disabled.length, 2);
        disabled.forEach((n) => {
          assert.equal(n.props.disabled, true);
          n.props.onPress();
        });
        assert.deepEqual(seeks, [-10, 15]);
        assert.equal(
          nodes(tree).find((n) =>
            n.props?.accessibilityLabel?.startsWith("İlerleme;"),
          ).props.disabled,
          true,
        );
      }
    }
  });
  test("TV channel row offsets exclude variable panel header", () => {
    h.native = true;
    const tree = render(() =>
      PanelContent({
        panel: "content",
        mediaKind: "live",
        currentIndex: 17,
        selectableItems: Array.from({ length: 40 }, (_, id) => ({
          id: String(id),
          title: "Channel",
        })),
      }),
    );
    const list = nodes(tree).find((n) => n.tag === "FlatList");
    assert.equal(list.props.ListHeaderComponent, undefined);
    assert.deepEqual(list.props.getItemLayout(null, 17), {
      length: 72,
      offset: 1224,
      index: 17,
    });
    assert.equal(list.props.initialScrollIndex, 17);
    assert.equal(list.props.removeClippedSubviews, false);
    const row = list.props.renderItem({
      item: { id: "17", title: "Selected" },
      index: 17,
    });
    assert.equal(row.props.nativeID, "player:content:17");
    assert.equal(row.props.hasTVPreferredFocus, true);
  });
  test("Home watch validates current identity, rejects repeated and stale provider callbacks", () => {
    let plays = [];
    const a = {
      providerId: "a",
      providerType: "xtream",
      revision: "1",
      enabled: true,
      items: [{ stream_id: 7, name: "Current" }],
      onPlay: (item) => plays.push(item),
    };
    const hook = render(() => useHomeMovieInfo(a));
    hook.watch({ stream_id: 999 });
    assert.equal(plays.length, 0);
    hook.watch({ stream_id: 7, name: "Stale DTO" });
    hook.watch({ stream_id: 7 });
    assert.equal(plays.length, 1);
    assert.equal(plays[0], a.items[0]);
    render(() => useHomeMovieInfo({ ...a, providerId: "b" }));
    hook.watch({ stream_id: 7 });
    assert.equal(plays.length, 1);
  });
  test("main Live OK opens the actual channel; focus only scrolls and preserves selection", () => {
    h.native = true;
    let opened = [];
    const channels = [
      { id: "one", name: "Bir" },
      { id: "two", name: "İki" },
    ];
    const props = {
      categories: [],
      category: "all",
      channels,
      epgByChannel: new Map(),
      clock: 0,
      favorites: [],
      onOpen: (c) => opened.push(c),
    };
    let tree = render(() => EliteLiveCatalog(props));
    let list = nodes(tree).find((n) => n.tag === "FlatList");
    let scroll;
    list.props.ref.current = {
      scrollToIndex: (v) => (scroll = v),
      scrollToOffset() {},
    };
    let row = list.props.renderItem({ item: channels[1], index: 1 });
    row.props.onFocus();
    assert.equal(scroll.index, 1);
    assert.equal(opened.length, 0);
    row.props.onPress();
    assert.equal(opened[0], channels[1]);
    tree = render(() => EliteLiveCatalog(props));
    list = nodes(tree).find((n) => n.tag === "FlatList");
    row = list.props.renderItem({ item: channels[1], index: 1 });
    assert.equal(row.props.accessibilityState.selected, true);
    list.props.renderItem({ item: channels[0], index: 0 }).props.onFocus();
    tree = render(() => EliteLiveCatalog(props));
    list = nodes(tree).find((n) => n.tag === "FlatList");
    assert.equal(
      list.props.renderItem({ item: channels[1], index: 1 }).props
        .accessibilityState.selected,
      true,
    );
    assert.equal(list.props.removeClippedSubviews, false);
  });
  test("Live loading, empty and safe failure copy are distinct", () => {
    const props = {
      categories: [],
      category: "all",
      channels: [],
      epgByChannel: new Map(),
      clock: 0,
      favorites: [],
    };
    for (const [loading, error, expected] of [
      [true, null, "yükleniyor"],
      [false, null, "bulunamadı"],
      [false, "Katalog yüklenemedi", "yüklenemedi"],
    ]) {
      const tree = render(() => EliteLiveCatalog({ ...props, loading, error }));
      const list = nodes(tree).find((n) => n.tag === "FlatList");
      assert.match(
        text(tree) + text(list.props.ListEmptyComponent),
        new RegExp(expected),
      );
    }
  });
  test("category search preserves ID, closes on selection and releases input scope", () => {
    let selected;
    const props = {
      items: [
        { id: "real:1", title: "Çocuk kanalları" },
        { id: "real:2", title: "Haber" },
      ],
      selected: "real:2",
      onSelect: (id) => (selected = id),
    };
    let tree = render(() => CategoryPicker(props));
    nodes(tree)
      .find((n) => n.props?.accessibilityLabel === "Kategori seç")
      .props.onPress();
    tree = render(() => CategoryPicker(props));
    assert.equal(h.scope, true);
    nodes(tree)
      .find((n) => n.tag === "TextInput")
      .props.onChangeText("çocuk");
    tree = render(() => CategoryPicker(props));
    let list = nodes(tree).find((n) => n.tag === "FlatList");
    assert.equal(list.props.data.length, 1);
    list.props.renderItem({ item: list.props.data[0] }).props.onPress();
    tree = render(() => CategoryPicker(props));
    assert.equal(selected, "real:1");
    assert.equal(h.scope, false);
    assert.equal(
      nodes(tree).find((n) => n.tag === "Modal").props.visible,
      false,
    );
  });
  await testAsync(
    "production Player retry drops old VLC events and repeated activation; error Back exits",
    async () => {
      h.native = true;
      let exits = 0;
      const props = {
        source: "https://example.invalid/live.ts",
        title: "Live",
        mediaKind: "live",
        onFullscreenExit: () => exits++,
      };
      let tree = render(() => CompatibilityVideoPlayer(props));
      tree = render(() => CompatibilityVideoPlayer(props));
      const old = nodes(tree).find((n) => n.tag === "VLC");
      assert(old);
      old.props.onError();
      tree = render(() => CompatibilityVideoPlayer(props));
      let chrome = nodes(tree).find((n) => n.tag === "PlayerChrome");
      assert(chrome.props.errorText);
      chrome.props.onRetry();
      chrome.props.onRetry();
      // Events retained by the old native surface are rejected before React commits the retry.
      old.props.onProgress({ currentTime: 900, duration: 1000 });
      old.props.onError();
      old.props.onPlaying();
      tree = render(() => CompatibilityVideoPlayer(props));
      tree = render(() => CompatibilityVideoPlayer(props));
      const fresh = nodes(tree).find((n) => n.tag === "VLC");
      assert.equal(fresh.props.key, 2);
      old.props.onError();
      old.props.onProgress({ currentTime: 900, duration: 1000 });
      tree = render(() => CompatibilityVideoPlayer(props));
      chrome = nodes(tree).find((n) => n.tag === "PlayerChrome");
      assert.equal(chrome.props.errorText, null);
      assert.equal(chrome.props.position, 0);
      fresh.props.onError();
      tree = render(() => CompatibilityVideoPlayer(props));
      assert(nodes(tree).find((n) => n.tag === "PlayerChrome").props.errorText);
      assert.equal(h.hardwareBack(), true);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(exits, 1);
      assert.equal(h.hardwareBack(), true);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(exits, 1);
    },
  );
  console.log(
    `Visible Home and remote host: ${count}/${count} passed; HOST_NOT_ANDROID_WINDOW_OR_PHYSICAL`,
  );
} finally {
  clean();
  delete globalThis.__visible;
  rmSync(out, { recursive: true, force: true });
}
