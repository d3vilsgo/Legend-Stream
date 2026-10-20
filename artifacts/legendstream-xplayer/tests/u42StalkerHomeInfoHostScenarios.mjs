import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(app, "package.json"));
const { build } = createRequire(resolve(app, "../api-server/package.json"))(
  "esbuild",
);
const out = mkdtempSync(join(tmpdir(), "u42-info-host-"));
let slots = [],
  cursor = 0,
  effects = [],
  count = 0;
const same = (a, b) =>
  a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const h = (globalThis.__stalkerHome = {
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
    if (!same(slots[i]?.deps, d)) {
      effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps: d, cleanup: f() };
      });
    }
  },
  listeners: new Set(),
  scope: 1,
  failRead: false,
  window: { width: 393, height: 873, fontScale: 1 },
  native: false,
  service: {
    enrich: async () => {
      throw Error("metadata offline");
    },
  },
});
const mocks = {
  react: `export const useState=v=>globalThis.__stalkerHome.state(v),useRef=v=>globalThis.__stalkerHome.ref(v),useEffect=(f,d)=>globalThis.__stalkerHome.effect(f,d),useMemo=(f,d)=>globalThis.__stalkerHome.memo(f,d);export default {createElement:(tag,props,...children)=>({tag,props:{...props,children}})};`,
  "react-native": `export const Image='Image',Modal='Modal',ScrollView='ScrollView',Text='Text',View='View';export const Linking={openURL:async()=>{}};export const Platform={get isTV(){return globalThis.__stalkerHome.native}};export const useWindowDimensions=()=>globalThis.__stalkerHome.window;export const StyleSheet={create:s=>s,absoluteFillObject:{}};`,
  "react-native-safe-area-context": `export const useSafeAreaInsets=()=>({left:0,right:0,top:0,bottom:0});`,
  "@/lib/stalkerProductSession": `export const readCurrentStalkerProductSession=()=>{if(globalThis.__stalkerHome.failRead)throw Error('invalid');return {session:globalThis.__stalkerHome.session,providerScopeId:'scope:'+globalThis.__stalkerHome.scope}};`,
  "@/lib/stalkerPortalRuntime": `export const isRegisteredStalkerPortalSession=(id,s)=>globalThis.__stalkerHome.session===s;export const subscribeStalkerPortalRuntime=f=>{globalThis.__stalkerHome.listeners.add(f);return()=>globalThis.__stalkerHome.listeners.delete(f);};`,
  "@/lib/stalkerPlaybackTrace": `export const beginStalkerPlaybackTrace=()=>{};`,
  "@/components/tvPreview/TVPreviewFocus": `export const useTVPreviewFocus=()=>globalThis.__stalkerHome.focus;export const TVPreviewFocusRegion='Viewport',TVPreviewControls='Dock';export const TVPreviewPressable='FocusButton';`,
  "@/components/tvPreview/TVRemoteInspector": `export const TVRemoteInspectorOverlay='Inspector';`,
  "./MovieInfoServiceProvider": `export const useMovieInfoService=()=>globalThis.__stalkerHome.service;`,
};
const render = (fn) => {
  cursor = 0;
  effects = [];
  const result = fn();
  effects.forEach((f) => f());
  return result;
};
const clean = () => {
  for (const s of slots) s?.cleanup?.();
  slots = [];
  cursor = 0;
  effects = [];
};
const nodes = (tree) =>
  !tree || typeof tree !== "object"
    ? []
    : [tree, ...(tree.props?.children ?? []).flat(Infinity).flatMap(nodes)];
const tick = () => new Promise((r) => setImmediate(r));
try {
  await build({
    stdin: {
      contents: `export {useStalkerHomeMovieInfo} from './hooks/useStalkerHomeMovieInfo';export {MovieInfoModal} from './components/tmdb/MovieInfoModal';export {createTVPreviewFocusController} from './lib/tvPreviewFocus';`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "host.cjs"),
    logLevel: "silent",
    plugins: [
      {
        name: "host",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => {
            if (a.path in mocks) return { path: a.path, namespace: "host" };
            if (a.path.startsWith("@/")) {
              const p = join(app, a.path.slice(2));
              return { path: [p, p + ".ts", p + ".tsx"].find(existsSync) };
            }
          });
          b.onLoad({ filter: /.*/, namespace: "host" }, (a) => ({
            contents: mocks[a.path],
            loader: "js",
            resolveDir: app,
          }));
        },
      },
    ],
  });
  const {
    useStalkerHomeMovieInfo,
    MovieInfoModal,
    createTVPreviewFocusController,
  } = req(join(out, "host.cjs"));
  const calls = [],
    played = [],
    errors = [];
  const preview = {
    id: "movie:b",
    title: "Duplicate",
    lookupCategoryId: "*",
    lookupPage: 1,
  };
  const session = {
    request: async (p) => {
      calls.push(p);
      return p.action === "create_link"
        ? { cmd: "https://stream.invalid/current" }
        : {
            data: [
              { id: "movie:a", name: "Duplicate", cmd: "wrong" },
              { id: preview.id, name: "Duplicate", cmd: "current" },
            ],
          };
    },
  };
  h.session = session;
  let options = {
    provider: {
      id: "p",
      type: "stalker",
      url: "https://portal.invalid",
      mac: "opaque",
    },
    previews: [preview],
    enabled: true,
    onPlayable: (p) => played.push(p),
    onError: (e) => errors.push(e),
  };
  const hook = (patch = {}) => {
    options = { ...options, ...patch };
    return render(() => useStalkerHomeMovieInfo(options));
  };
  const test = async (name, f) => {
    await f();
    console.log(`ok U4.2 host ${++count} - ${name}`);
  };
  let info = hook();
  await test("production hook selects exact portal identity with no network", () => {
    info.select(preview.id);
    info = hook();
    assert.equal(info.input.identity.catalogId, preview.id);
    assert.equal(info.input.identity.provider, "stalker");
    assert.equal(info.local.title, "Duplicate");
    assert.equal(calls.length, 0);
  });
  await test("retained callbacks cannot affect a replacement modal", () => {
    const oldClose = info.close,
      oldPlay = info.play;
    info.close();
    info = hook();
    info.select(preview.id);
    info = hook();
    oldClose();
    oldPlay();
    info = hook();
    assert(info.state);
    assert.equal(calls.length, 0);
  });
  await test("runtime session replacement immediately aborts and closes Info", () => {
    const oldPlay = info.play,
      oldSelect = info.select;
    h.session = { ...session };
    h.scope++;
    h.listeners.forEach((f) => f("p"));
    info = hook();
    oldPlay();
    oldSelect(preview.id);
    info = hook();
    assert.equal(info.state, null);
    assert.equal(calls.length, 0);
  });
  await test("provider identity change invalidates old selection before effects", () => {
    info.select(preview.id);
    info = hook();
    const oldPlay = info.play,
      oldSelect = info.select;
    info = hook({ provider: { ...options.provider, id: "other" } });
    oldPlay();
    oldSelect(preview.id);
    info = hook();
    assert.equal(info.state, null);
    assert.equal(calls.length, 0);
  });
  await test("Play hands the exact current movie to the existing player callback once", async () => {
    info.select(preview.id);
    info = hook();
    info.play();
    info.play();
    await tick();
    info = hook();
    assert.equal(played.length, 1);
    assert.equal(played[0].itemId, preview.id);
    assert.equal(calls.find((p) => p.action === "create_link").cmd, "current");
    assert.equal(info.state, null);
  });
  await test("unknown selection and invalid session produce no accidental playback", () => {
    info.select("unknown");
    info = hook();
    assert.equal(info.state, null);
    h.failRead = true;
    info.select(preview.id);
    h.failRead = false;
    assert.equal(errors.length, 1);
    assert.match(errors[0], /oturumu/);
    assert.equal(played.length, 1);
  });
  clean();
  let focused = null,
    baseBack = 0,
    closed = 0,
    playTaps = 0;
  const focus = createTVPreviewFocusController((id) => {
    focused = id;
  });
  h.focus = focus;
  const modalReady = [];
  focus.modalShown = (scope) => modalReady.push(scope);
  focus.register({
    id: "home-shelf:Films:movie-b",
    scope: "content",
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    press: () => {},
    setFocused: () => {},
  });
  focus.focusFirst();
  focus.setBackAction(() => {
    baseBack++;
  });
  const props = {
    input: {
      identity: {
        providerId: "p",
        provider: "stalker",
        catalogId: preview.id,
        kind: "movie",
      },
      catalogRevision: "s1",
      title: "Local movie",
    },
    local: { title: "Local movie", overview: "Provider information" },
    onClose: () => {
      closed++;
    },
    onPlay: () => {
      playTaps++;
    },
    closeOnPlay: false,
    playback: { busy: false, error: null },
  };
  let tree = render(() => MovieInfoModal(props));
  const buttons = () => nodes(tree).filter((n) => n.tag === "FocusButton");
  await test("shared modal starts with Back focus and owns Preview input scope", () => {
    assert.equal(buttons()[0].props.focusId, "movie-info:back");
    assert.equal(buttons()[0].props.hasTVPreferredFocus, true);
    for (const b of buttons())
      focus.register({
        id: b.props.focusId,
        scope: b.props.focusScope,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        press: b.props.onPress,
        setFocused: () => {},
      });
    assert.equal(focused, "movie-info:back");
    focus.back();
    assert.equal(closed, 1);
    assert.equal(baseBack, 0);
  });
  await test("failed metadata keeps local details and does not invoke playback", async () => {
    await tick();
    tree = render(() => MovieInfoModal(props));
    const all = JSON.stringify(tree);
    assert.match(all, /Local movie/);
    assert.match(all, /Provider information/);
    assert.match(all, /IPTV bilgileri gösteriliyor/);
    assert.equal(playTaps, 0);
  });
  await test("Play stays in shared modal for async resolution; error exposes retry", () => {
    buttons()
      .find((b) => b.props.focusId === "movie-info:play")
      .props.onPress();
    assert.equal(playTaps, 1);
    buttons()
      .find((b) => b.props.focusId === "movie-info:play")
      .props.onPress();
    assert.equal(playTaps, 1, "double OK before busy render must not replay");
    assert.equal(closed, 1);
    props.playback = {
      busy: false,
      error: "Film bulunamadı. Yeniden deneyin.",
    };
    tree = render(() => MovieInfoModal(props));
    assert.match(JSON.stringify(tree), /Tekrar dene/);
    assert(nodes(tree).some((n) => n.props?.accessibilityRole === "alert"));
    props.playback = { busy: true, error: null };
    tree = render(() => MovieInfoModal(props));
    assert.equal(
      buttons().find((b) => b.props.focusId === "movie-info:play").props
        .disabled,
      true,
    );
  });
  await test("touch, tablet, Native and Preview share local Info and native Back callback", () => {
    for (const native of [false, true])
      for (const width of [393, 873, 1280]) {
        h.native = native;
        h.window = { width, height: 800, fontScale: 1 };
        tree = render(() => MovieInfoModal(props));
        assert.equal(tree.tag, "Modal");
        assert.equal(tree.props.onRequestClose, props.onClose);
        tree.props.onShow();
        if (native) assert.equal(modalReady.at(-1), "movie-info");
        assert.match(JSON.stringify(tree), /Local movie/);
      }
  });
  await test("modal cleanup restores selected Home focus and base Back ownership", () => {
    const oldPlay = buttons().find((b) => b.props.focusId === "movie-info:play")
      .props.onPress;
    clean();
    oldPlay();
    assert.equal(playTaps, 1, "unmounted callback must not play");
    assert.equal(focused, "home-shelf:Films:movie-b");
    focus.back();
    assert.equal(baseBack, 1);
  });
  const main = readFileSync(
      join(app, "components/StalkerMainPage.tsx"),
      "utf8",
    ),
    home = readFileSync(join(app, "components/home/HomeDiscovery.tsx"), "utf8");
  await test("all Home movie entries use one handler and preserve origin-specific return", () => {
    assert.match(
      main,
      /onOpenMovie=\{\s*(?:\(\s*item\s*\)|item)\s*=>\s*homeMovieInfo.select\(String\(item.stream_id\)\)\s*\}/,
    );
    assert.match(
      main,
      /onOpenLive=\{\s*(?:\(\s*channel\s*\)|channel)\s*=> openLive\(channel, "home"\)\}/,
    );
    assert.match(
      main,
      /onOpenMedia=\{\s*(?:\(\s*item\s*\)|item)\s*=> openProgress\(item, "home"\)\}/,
    );
    assert.match(main, /onPlayable: movie => openMovie\(movie, "home"\)/);
    assert.match(main, /returnTo: StalkerContentView = "movies"/);
    assert.match(main, /kind: "movie",\s*returnTo,/);
    assert.match(main, /onPlayable=\{openMovie\}/);
    assert.match(main, /newMovies=\{\[\]\}/);
    assert.match(home, /item.movie\s*\? onOpenMovie\(item.movie\)/);
    assert.match(home, /onPress: \(\) => onOpenMovie\(item\)/);
  });
  await test("Home stays mounted behind player; scroll and Hero timer pause", () => {
    assert.match(
      main,
      /const presentedView = view === "player" \? playable\?\.returnTo/,
    );
    assert.match(
      main,
      /scrollEnabled=\{!catalogDrawerOpen && !homeMovieInfo.state && !homeSeriesInfo && view !== "player"\}/,
    );
    assert.match(
      main,
      /interactionBlocked=\{Boolean\(homeMovieInfo.state\) \|\| Boolean\(homeSeriesInfo\) \|\| view === "player"\}/,
    );
    assert.match(home, /paused=\{interactionBlocked\}/);
    assert.doesNotMatch(home, /setInterval\(/);
    assert.match(home, /disabled=\{paused/);
  });
  console.log(
    `U4.2 Stalker Home Info host: ${count}/${count} passed; HOST_HOOK_MODAL_AND_PREVIEW_NOT_ANDROID`,
  );
} finally {
  clean();
  delete globalThis.__stalkerHome;
  rmSync(out, { recursive: true, force: true });
}
