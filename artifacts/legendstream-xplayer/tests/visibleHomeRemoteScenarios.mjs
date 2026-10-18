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
  react: `const h=globalThis.__visible;export const useState=v=>h.state(v),useRef=v=>h.ref(v),useMemo=(f,d)=>h.memo(f,d),useEffect=(f,d)=>h.effect(f,d);export const memo=f=>f,createContext=v=>({value:v,Provider:'Provider'}),useContext=c=>c.value;export default {createElement:(tag,props,...children)=>({tag,props:{...props,children}})};`,
  "react-native": `export const View='View',Text='Text',Pressable='Button',Image='Image',FlatList='FlatList',ScrollView='ScrollView',Modal='Modal';export const Platform={get isTV(){return globalThis.__visible.native},OS:'android'};export const StyleSheet={create:s=>s,absoluteFill:{},absoluteFillObject:{}};export const useWindowDimensions=()=>globalThis.__visible;export const Keyboard={addListener:(name,f)=>{globalThis.__visible.listeners[name]=f;return {remove(){delete globalThis.__visible.listeners[name]}}}};export const BackHandler={addEventListener:()=>({remove(){}})};`,
  "react-native-safe-area-context": `export const useSafeAreaInsets=()=>({top:0,bottom:20,left:0,right:0});`,
  "@expo/vector-icons": `export const Feather='Icon';`,
  "expo-linear-gradient": `export const LinearGradient='Gradient';`,
  "@/context/UiPresentationContext": `export const useUiPresentation=()=>({tvPreview:globalThis.__visible.preview});`,
  "@/hooks/useColors": `export const useColors=()=>({primary:'#67e8d1',foreground:'white',mutedForeground:'#aaa',border:'#333',card:'#111'});`,
  "@/context/I18nContext": `export const useI18n=()=>({language:'tr',t:k=>k});`,
  "@/context/MediaLibraryContext": `export const useMediaLibrary=()=>({entries:[],loaded:true,removeProgress(){}});`,
  "@/components/tvPreview/TVPreviewFocus": `export const TVPreviewPressable='Button';export const useTVPreviewFocus=()=>({pushFocusScope:()=>()=>{},registerBackAction:()=>()=>{}});`,
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
const test = (name, f) => {
  clean();
  f();
  count++;
  console.log("ok visible Home " + count + " - " + name);
};
try {
  await build({
    stdin: {
      contents: `export {HomeHeroCarousel} from './components/home/HomeDiscovery';export {ResponsiveContentNav} from './components/navigation/ResponsiveContentNav';export {PlayerChrome,PanelContent} from './components/player/PlayerChromeV2';`,
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
  const { HomeHeroCarousel, ResponsiveContentNav, PlayerChrome, PanelContent } =
    req(join(out, "tests.cjs"));
  const movie = {
      id: "provider-a:movie:7",
      title: "Aynı başlık",
      subtitle: "Drama",
      image: "",
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
        tree.props.style.height >=
          (native ? 1 : width > height || preview ? 160 : 310),
      );
      assert.match(text(tree), /Aynı başlık/);
      assert.match(text(tree), /İzle/);
      assert.match(text(tree), /Detay \/ Bilgi/);
      const watch = nodes(tree).find((n) =>
        n.props?.focusId?.endsWith(":watch"),
      );
      watch.props.onPress();
      assert.equal(h.opened, movie);
      const info = nodes(tree).find((n) => n.props?.focusId?.endsWith(":info"));
      info.props.onPress();
      assert.equal(h.opened, movie);
      nodes(tree)
        .find((n) => n.props?.focusId === "home-hero:next")
        .props.onPress();
      const next = render(() => HomeHeroCarousel(heroProps));
      assert.match(text(next), /Sezon ve bölümler/);
      nodes(next)
        .find((n) => n.props?.focusId?.endsWith(":watch"))
        .props.onPress();
      assert.equal(h.opened, series);
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
  console.log(
    `Visible Home and remote host: ${count}/${count} passed; HOST_NOT_ANDROID_WINDOW_OR_PHYSICAL`,
  );
} finally {
  clean();
  delete globalThis.__visible;
  rmSync(out, { recursive: true, force: true });
}
