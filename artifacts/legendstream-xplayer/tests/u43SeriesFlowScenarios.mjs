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
const out = mkdtempSync(join(tmpdir(), "u43-series-"));
let slots = [],
  cursor = 0,
  effects = [],
  count = 0;
const same = (a, b) =>
  a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const h = (globalThis.__series = {
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
  entries: [],
  registered: [],
  native: false,
  load: async () => null,
  resolve: async () => ({ url: "https://play.invalid/episode" }),
});
const mocks = {
  "./tmdb/MovieInfoServiceProvider": `export const MovieInfoServiceProvider='Metadata';`,
  "@/components/tmdb/MovieInfoServiceProvider": `export const useMovieInfoService=()=>({});`,
  "@/lib/tmdb/movieInfoService": `export const beginMovieEnrichment=(_service,_input,apply)=>{apply({status:'not-configured'});return()=>{};};`,
  "@/lib/tmdb/metadata": `export const tmdbImageUrl=()=>null;`,
  "@/lib/tmdb/matcher": `export const inferredYear=()=>undefined;`,
  "@/components/OptimizedHomeScreenV6": `export default 'PagedHome';`,
  "@/components/StalkerMainPage": `export default 'StalkerHome';`,
  "@/components/eliteV4/EliteV4TvShell": `export const EliteV4TvShell='EliteV4';`,
  "@/components/eliteV4/EliteV4PreviewToggle": `export const EliteV4PreviewToggle='EliteV4Toggle';`,
  "@/context/PlayerContext": `export const usePlayer=()=>({provider:globalThis.__series.shellProvider});`,
  "@/context/UiPresentationContext": `export const UiPresentationProvider='Presentation',useUiPresentation=()=>({tvPreview:false});`,
  react: `export const useState=v=>globalThis.__series.state(v),useRef=v=>globalThis.__series.ref(v),useEffect=(f,d)=>globalThis.__series.effect(f,d),useMemo=(f,d)=>globalThis.__series.memo(f,d),useCallback=(f,d)=>globalThis.__series.memo(()=>f,d);export default {useState,createElement:(tag,props,...children)=>({tag,props:{...props,children}})};`,
  "react-native": `export const ActivityIndicator='Spinner',FlatList='FlatList',Image='Image',Modal='Modal',Text='Text',View='View';export const Platform={get isTV(){return globalThis.__series.native},OS:'android'};export const StyleSheet={create:s=>s};`,
  "react-native-safe-area-context": `export const useSafeAreaInsets=()=>({left:0,right:0,top:0,bottom:0});`,
  "@/context/I18nContext": `export const useI18n=()=>({t:k=>k});`,
  "@/context/MediaLibraryContext": `export const useMediaLibrary=()=>({entries:globalThis.__series.entries});`,
  "@/components/tvPreview/TVPreviewFocus": `export const useTVPreviewFocus=()=>globalThis.__series.focus;export const TVPreviewFocusProvider='FocusProvider',TVPreviewFocusRegion='Viewport',TVPreviewControls='Dock';export const TVPreviewPressable='Button';`,
  "@/components/tvPreview/TVRemoteInspector": `export const TVRemoteInspectorOverlay='Inspector',TVRemoteInspectorCollector='Collector';`,
  "@/components/catalog/PagedCatalogViews": `export const GoldenSeriesCatalog='GoldenSeriesCatalog';`,
  "@/lib/stalkerProductSession": `export const readCurrentStalkerProductSession=()=>({session:globalThis.__series.session,providerScopeId:'runtime:'+globalThis.__series.scope});export const isCurrentStalkerProductSession=(_p,s)=>s===globalThis.__series.session;`,
  "@/lib/stalkerPortalRuntime": `export const isRegisteredStalkerPortalSession=(_id,s)=>s===globalThis.__series.session;export const subscribeStalkerPortalRuntime=f=>{globalThis.__series.listeners.add(f);return()=>globalThis.__series.listeners.delete(f);};`,
  "@/lib/stalkerProductCounts": `export const writeStalkerProductCount=async()=>{};`,
  "@/lib/stalkerHomeSummary": `export const writeStalkerSeriesHomePreview=async()=>{};`,
  "@/lib/stalkerPlaybackTrace": `export const beginStalkerPlaybackTrace=()=>'',traceStalker=()=>{},classifyPlaybackSource=()=>'',classifyStalkerTraceError=()=>'',shortSafeId=()=>'';`,
  "@/lib/performanceDiagnostics": `export const beginPlaybackAttempt=()=>{};`,
  "@/lib/xtreamCatalog": `export const getSeriesInfo=(creds,id,signal)=>globalThis.__series.load(id,signal,creds);export const registerLocalEpisodeQueue=i=>globalThis.__series.registered.push(i);`,
  "@/lib/catalogPageRepository": `export const loadM3USeriesInfoFromCache=(provider,id)=>globalThis.__series.load(id,undefined,provider);`,
  "@/lib/catalogRuntime": `export const resolveCatalogPlaybackSource=(request,provider,signal)=>globalThis.__series.resolve(request,provider,signal);`,
};
const render = (fn) => {
  cursor = 0;
  effects = [];
  const tree = fn();
  effects.forEach((f) => f());
  return tree;
};
const clean = () => {
  for (const s of slots) s?.cleanup?.();
  slots = [];
  cursor = 0;
  effects = [];
};
globalThis.requestAnimationFrame = (f) => {
  f();
  return 0;
};
const tick = () => new Promise((r) => setImmediate(r));
const nodes = (t) =>
  !t || typeof t !== "object"
    ? []
    : [
        t,
        ...(t.props?.children ?? []).flat(Infinity).flatMap(nodes),
        ...nodes(t.props?.ListHeaderComponent),
        ...nodes(t.props?.ListEmptyComponent),
      ];
const test = async (name, fn) => {
  await fn();
  console.log(`ok U4.3 ${++count} - ${name}`);
};
const hierarchy = () => ({
  info: { series_id: "1", name: "Duplicate", plot: "Provider plot" },
  episodes: {
    2: [
      {
        id: "ep-20",
        episode_num: 2,
        title: "Duplicate episode",
        info: { plot: "Episode plot", duration: "00:40:00" },
      },
      { id: "ep-10", episode_num: 1, title: "Duplicate episode" },
    ],
    1: [],
  },
});
try {
  await build({
    stdin: {
      contents: `export {default as ProductShell} from './components/ProductShell';export {createPagedSeriesFlow} from './lib/pagedSeriesFlow';export {pagedSeriesDetail,stalkerSeriesDetail} from './lib/seriesInfo';export {usePagedSeriesInfo} from './hooks/usePagedSeriesInfo';export {StalkerSeriesProductSurface} from './components/stalker/StalkerSeriesProductSurface';export {SeriesInfoModal} from './components/series/SeriesInfoModal';export {createTVPreviewFocusController} from './lib/tvPreviewFocus';export {playbackRefKey,samePlaybackRef} from './lib/mediaProgress';export {orderGoldenSeriesSeasons} from './lib/goldenSeriesDetail';`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "flow.cjs"),
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
  const api = req(join(out, "flow.cjs"));
  function fixture(provider = "xtream") {
    const states = [],
      plays = [],
      loads = [],
      resolves = [],
      register = [];
    let current = true,
      load = async () => hierarchy(),
      resolve = async () => "https://play.invalid/current";
    const flow = api.createPagedSeriesFlow({
      provider,
      isCurrent: () => current,
      load: (item, signal) => {
        loads.push({ item, signal });
        return load(item, signal);
      },
      resolve: (ep, signal) => {
        resolves.push({ ep, signal });
        return resolve(ep, signal);
      },
      register: (i) => register.push(i),
      onState: (s) => states.push(s),
      onPlayable: (p) => plays.push(p),
      onPlaybackStart: () => {},
    });
    return {
      flow,
      states,
      plays,
      loads,
      resolves,
      register,
      get state() {
        return states.at(-1);
      },
      set current(v) {
        current = v;
      },
      set load(v) {
        load = v;
      },
      set resolve(v) {
        resolve = v;
      },
    };
  }
  await test("same named series are selected by exact ID and origin", async () => {
    const f = fixture();
    await f.flow.open({ series_id: "1", name: "Duplicate" }, "home");
    assert.equal(f.loads[0].item.series_id, "1");
    await f.flow.open({ series_id: "2", name: "Duplicate" }, "series");
    assert.equal(f.state.item.series_id, "2");
    assert.equal(f.state.origin, "series");
    assert.equal(f.resolves.length, 0);
  });
  await test("detail and season preparation never resolve playback", async () => {
    const f = fixture();
    await f.flow.open({ series_id: "1", name: "D" }, "home");
    const m = api.pagedSeriesDetail("a", "xtream", f.state.item, f.state.info);
    const seasons = api.orderGoldenSeriesSeasons(m.seasons);
    assert.deepEqual(
      seasons.map((s) => s.id),
      ["1", "2"],
    );
    assert.deepEqual(
      seasons[1].episodes.map((e) => e.id),
      ["ep-10", "ep-20"],
    );
    assert.equal(f.resolves.length, 0);
  });
  await test("real season and episode id reach resolver once", async () => {
    const f = fixture();
    await f.flow.open({ series_id: "s", name: "D" }, "home");
    const t = f.state.ticket;
    await Promise.all([
      f.flow.play(t, "2", "ep-10"),
      f.flow.play(t, "2", "ep-20"),
    ]);
    assert.equal(f.resolves.length, 1);
    assert.equal(f.resolves[0].ep.id, "ep-10");
    assert.equal(f.plays[0].origin, "home");
    assert.equal(f.plays[0].progressRef.episodeId, "ep-10");
    assert.equal(f.plays[0].progressRef.seriesId, "s");
  });
  await test("old selection responses cannot overwrite rapid new selection", async () => {
    const f = fixture();
    let done;
    f.load = () =>
      new Promise((r) => {
        done = r;
      });
    const first = f.flow.open({ series_id: "old", name: "D" }, "home");
    f.load = async () => hierarchy();
    await f.flow.open({ series_id: "new", name: "D" }, "home");
    assert(f.loads[0].signal.aborted);
    done(hierarchy());
    await first;
    assert.equal(f.state.item.series_id, "new");
    assert.equal(f.register.length, 1);
  });
  await test("provider change discards detail before queue or model publication", async () => {
    const f = fixture();
    let done;
    f.load = () =>
      new Promise((r) => {
        done = r;
      });
    const pending = f.flow.open({ series_id: "1", name: "D" }, "home");
    f.current = false;
    done(hierarchy());
    await pending;
    assert.equal(f.register.length, 0);
    assert.equal(f.plays.length, 0);
  });
  await test("close cancels pending playback and old callbacks", async () => {
    const f = fixture();
    await f.flow.open({ series_id: "1", name: "D" }, "home");
    const t = f.state.ticket;
    let done;
    f.resolve = () =>
      new Promise((r) => {
        done = r;
      });
    const p = f.flow.play(t, "2", "ep-20");
    f.flow.close(t);
    assert(f.resolves[0].signal.aborted);
    done("https://play.invalid/stale");
    await p;
    await f.flow.play(t, "2", "ep-10");
    assert.equal(f.plays.length, 0);
    assert.equal(f.state, null);
  });
  await test("old close and episode callbacks cannot affect a newer series", async () => {
    const f = fixture();
    await f.flow.open({ series_id: "1", name: "D" }, "home");
    const t = f.state.ticket;
    await f.flow.open({ series_id: "2", name: "D" }, "home");
    f.flow.close(t);
    await f.flow.play(t, "2", "ep-20");
    assert.equal(f.state.item.series_id, "2");
    assert.equal(f.resolves.length, 0);
  });
  await test("missing episode never falls back to first episode", async () => {
    const f = fixture();
    await f.flow.open({ series_id: "1", name: "D" }, "home");
    await f.flow.play(f.state.ticket, "1", "ep-10");
    assert.equal(f.resolves.length, 0);
    assert.match(f.state.error, /bulunmuyor/);
  });
  await test("load failure has retry and empty season remains empty", async () => {
    const f = fixture();
    f.load = async () => {
      throw Error("token=secret");
    };
    await f.flow.open({ series_id: "1", name: "D" }, "series");
    assert.equal(f.state.loading, false);
    assert.doesNotMatch(f.state.error, /secret/);
    f.load = async () => ({ episodes: { 1: [] } });
    f.flow.retry(f.state.ticket);
    await tick();
    assert.equal(f.state.error, null);
    assert.deepEqual(f.state.info.episodes["1"], []);
  });
  await test("M3U lacking real cached hierarchy is not fabricated", async () => {
    const f = fixture("m3u");
    f.load = async () => null;
    await f.flow.open({ series_id: "1", name: "D" }, "home");
    assert.equal(f.state.loading, false);
    assert(f.state.error);
    assert.equal(f.resolves.length, 0);
  });
  await test("M3U Play rereads only selected cached group and rejects removed episode", async () => {
    const f = fixture("m3u");
    await f.flow.open({ series_id: "1", name: "D" }, "home");
    f.load = async () => ({ episodes: { 2: [] } });
    await f.flow.play(f.state.ticket, "2", "ep-10");
    assert.equal(f.loads.length, 2);
    assert.equal(f.resolves.length, 0);
    assert(f.state.error);
  });
  await test("Player return retains ticket and permits next explicit selection", async () => {
    const f = fixture();
    await f.flow.open({ series_id: "1", name: "D" }, "series");
    const t = f.state.ticket;
    await f.flow.play(t, "2", "ep-10");
    f.flow.resume();
    await f.flow.play(t, "2", "ep-20");
    assert.equal(f.state.ticket, t);
    assert.deepEqual(
      f.plays.map((p) => p.progressRef.episodeId),
      ["ep-10", "ep-20"],
    );
  });
  await test("progress identities separate episodes and providers without URLs", () => {
    const m = api.pagedSeriesDetail(
      "a",
      "xtream",
      { series_id: "1", name: "D" },
      hierarchy(),
    );
    const n = api.pagedSeriesDetail(
      "b",
      "xtream",
      { series_id: "1", name: "D" },
      hierarchy(),
    );
    assert.notEqual(m.id, n.id);
    assert.notEqual(
      api.playbackRefKey(
        m.seasons.find((s) => s.id === "2").episodes[0].progressRef,
      ),
      api.playbackRefKey(
        m.seasons.find((s) => s.id === "2").episodes[1].progressRef,
      ),
    );
    assert.doesNotMatch(JSON.stringify(m), /https:\/\/play|password|token/);
  });
  await test("missing episode metadata stays absent", () => {
    const model = api.pagedSeriesDetail(
      "a",
      "xtream",
      { series_id: "s", name: "D" },
      { episodes: { 1: [{ id: "opaque" }] } },
    );
    assert.equal(
      model.seasons.find((s) => s.id === "1").episodes[0].title,
      "opaque",
    );
    assert.equal(
      model.seasons.find((s) => s.id === "1").episodes[0].duration,
      undefined,
    );
    assert.equal(model.description, undefined);
  });

  await test("provider change during pending episode resolution prevents Player", async () => {
    const f = fixture();
    await f.flow.open({ series_id: "1", name: "D" }, "home");
    let done;
    f.resolve = () =>
      new Promise((r) => {
        done = r;
      });
    const pending = f.flow.play(f.state.ticket, "2", "ep-10");
    f.current = false;
    done("https://play.invalid/stale");
    await pending;
    assert.equal(f.plays.length, 0);
  });
  await test("Stalker same episode label/id is isolated by series and season", () => {
    const item = { id: "s1", title: "D" };
    const d = api.stalkerSeriesDetail("p", "runtime", item, {
      seriesId: "s1",
      title: "D",
      seasons: [
        { id: "1", label: "One", episodes: [{ id: "e", label: "Duplicate" }] },
        { id: "2", label: "Two", episodes: [{ id: "e", label: "Duplicate" }] },
      ],
    });
    assert.notEqual(
      api.playbackRefKey(d.seasons[0].episodes[0].progressRef),
      api.playbackRefKey(d.seasons[1].episodes[0].progressRef),
    );
  });
  const played = [];
  h.focus = api.createTVPreviewFocusController();
  h.load = async () => hierarchy();
  let options = {
    provider: {
      id: "p",
      type: "xtream",
      url: "https://portal.invalid",
      playlistUrl: "",
      username: "u",
      password: "p",
    },
    enabled: true,
    playing: false,
    onPlayable: (p) => played.push(p),
  };
  const hook = (patch = {}) => {
    options = { ...options, ...patch };
    return render(() => api.usePagedSeriesInfo(options));
  };
  let info = hook();
  await test("production paged hook targets selected ID and opens local model", async () => {
    info.open({ series_id: "1", name: "D" }, "home");
    await tick();
    info = hook();
    assert.equal(info.state.item.series_id, "1");
    assert.equal(info.model.description, "Provider plot");
    assert.equal(info.state.origin, "home");
  });
  await test("paged hook stale callback cannot cross provider with same numeric ID", async () => {
    const old = info.play;
    info = hook({ provider: { ...options.provider, id: "other" } });
    old("2", "ep-10");
    await tick();
    assert.equal(played.length, 0);
    assert.equal(info.state, null);
    info.open({ series_id: "1", name: "D" }, "series");
    await tick();
    info = hook();
    info.play("2", "ep-20");
    await tick();
    assert.equal(played.length, 1);
    assert.equal(played[0].progressRef.episodeId, "ep-20");
  });
  clean();
  const portalCalls = [],
    intents = [];
  h.scope = 1;
  h.session = {
    request: async (p) => {
      portalCalls.push(p);
      if (p.action === "get_ordered_list")
        return {
          data: [
            {
              season_num: "2",
              name: "Season 2",
              series: ["opaque-2", "opaque-1"],
              cmd: "fresh-cmd",
              description: "Local series plot",
            },
          ],
        };
      if (p.action === "create_link")
        return { cmd: "https://play.invalid/current" };
      throw Error("unexpected catalog scan");
    },
  };
  let surfaceOptions = {
    provider: {
      id: "stalker-a",
      type: "stalker",
      url: "https://portal.invalid",
      mac: "opaque",
    },
    initialSeries: { id: "series:88", title: "Duplicate" },
    onPlayable: (p) => intents.push(p),
    detailSuspended: false,
  };
  const surface = (patch = {}) => {
    surfaceOptions = { ...surfaceOptions, ...patch };
    return render(() => api.StalkerSeriesProductSurface(surfaceOptions)).props;
  };
  let surfaceProps = surface();
  await tick();
  surfaceProps = surface();
  await test("Stalker Home uses targeted existing hierarchy, not categories or create_link", () => {
    assert.equal(surfaceProps.detail.title, "Duplicate");
    assert.equal(surfaceProps.detailOnly, true);
    assert.equal(portalCalls[0].movie_id, "series:88");
    assert(
      !portalCalls.some(
        (p) => p.action === "create_link" || p.action === "get_categories",
      ),
    );
  });
  await test("Stalker correct opaque episode and double tap use current command once", async () => {
    surfaceProps.onEpisode("2", "opaque-1");
    surfaceProps.onEpisode("2", "opaque-2");
    await tick();
    surfaceProps = surface();
    assert.equal(intents.length, 1);
    assert.equal(intents[0].identity.seriesId, "series:88");
    assert.equal(intents[0].identity.seasonId, "2");
    assert.equal(intents[0].identity.episodeId, "opaque-1");
    assert.equal(
      portalCalls.filter((p) => p.action === "create_link").length,
      1,
    );
  });
  await test("Stalker suspended Player keeps same detail and restores selection dataset", () => {
    const before = surfaceProps.detail.id;
    surfaceProps = surface({ detailSuspended: true });
    assert.equal(surfaceProps.detail.id, before);
    assert.equal(surfaceProps.detailSuspended, true);
    surfaceProps = surface({ detailSuspended: false });
    assert.equal(surfaceProps.detail.id, before);
  });
  await test("Stalker runtime replacement invalidates old callbacks and exposes retry", async () => {
    const old = surfaceProps.onEpisode;
    h.session = { ...h.session };
    h.scope++;
    h.listeners.forEach((f) => f("stalker-a"));
    surfaceProps = surface();
    old("2", "opaque-2");
    await tick();
    assert.equal(intents.length, 1);
    assert.match(surfaceProps.error, /oturumu/);
    surfaceProps.onRetry();
    surfaceProps = surface();
    await tick();
    surfaceProps = surface();
    assert.equal(surfaceProps.error, null);
  });
  await test("old Stalker detail callback cannot play after component closes", async () => {
    const old = surfaceProps.onEpisode;
    clean();
    old("2", "opaque-2");
    await tick();
    assert.equal(intents.length, 1);
  });

  const raceCalls = [],
    raceIntents = [];
  let releaseOld, releasePlay;
  h.session = {
    request: async (p) => {
      raceCalls.push(p);
      if (p.action === "create_link")
        return new Promise((r) => {
          releasePlay = r;
        });
      if (p.movie_id === "old")
        return new Promise((r) => {
          releaseOld = r;
        });
      return {
        data: [{ season_num: 1, series: ["e-new"], cmd: "new-command" }],
      };
    },
  };
  surfaceOptions = {
    provider: {
      id: "race",
      type: "stalker",
      url: "https://portal.invalid",
      mac: "opaque",
    },
    initialSeries: { id: "old", title: "Duplicate" },
    onPlayable: (p) => raceIntents.push(p),
    detailSuspended: false,
  };
  surfaceProps = surface();
  await test("rapid Stalker detail switch cannot publish old hierarchy or command cache", async () => {
    surfaceProps = surface({
      initialSeries: { id: "new", title: "Duplicate" },
    });
    await tick();
    surfaceProps = surface();
    releaseOld({
      data: [{ season_num: 1, series: ["e-old"], cmd: "old-command" }],
    });
    await tick();
    surfaceProps = surface();
    assert.equal(surfaceProps.detail.seasons[0].episodes[0].id, "e-new");
    assert.equal(raceCalls.filter((p) => p.movie_id === "new").length, 1);
    surfaceProps.onEpisode("1", "e-new");
    await tick();
    assert.equal(raceCalls.at(-1).cmd, "new-command");
  });
  await test("runtime change during Stalker create_link discards resolved old URL", async () => {
    h.session = { ...h.session };
    h.listeners.forEach((f) => f("race"));
    releasePlay({ cmd: "https://play.invalid/stale" });
    await tick();
    surfaceProps = surface();
    assert.equal(raceIntents.length, 0);
    assert.match(surfaceProps.error, /oturumu/);
    clean();
  });
  let focused = null,
    closed = 0,
    baseBack = 0,
    episodes = [];
  const focus = api.createTVPreviewFocusController((id) => {
    focused = id;
  });
  h.focus = { ...focus, enabled: true };
  focus.register({
    id: "home:series:card",
    scope: "content",
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    press: () => {},
    setFocused: () => {},
  });
  focus.focusFirst();
  focus.setBackAction(() => baseBack++);
  const model = api.pagedSeriesDetail(
    "a",
    "xtream",
    { series_id: "1", name: "D" },
    hierarchy(),
  );
  let modalOptions = {
    providerId: "a",
    detail: model,
    loading: false,
    visible: true,
    onClose: () => closed++,
    onRetry: () => {},
    onEpisode: (s, e) => episodes.push([s, e]),
  };
  const modal = (patch = {}) => {
    modalOptions = { ...modalOptions, ...patch };
    return render(() => api.SeriesInfoModal(modalOptions));
  };
  let tree = modal();
  tree = modal();
  const lists = () => nodes(tree).filter((n) => n.tag === "FlatList"),
    seasonList = () => lists().find((n) => n.props.horizontal),
    episodeList = () => lists().find((n) => !n.props.horizontal);
  await test("common Info exposes all ordered seasons and no episode until selected", () => {
    assert.deepEqual(
      seasonList().props.data.map((s) => s.id),
      ["1", "2"],
    );
    assert.equal(episodeList().props.data.length, 0);
    const back = nodes(tree).find((n) => n.tag === "Button");
    assert.equal(back.props.hasTVPreferredFocus, true);
    assert.match(JSON.stringify(tree), /Provider plot/);
  });
  await test("season choice changes local dataset only and separates selected from focus", () => {
    const button = seasonList().props.renderItem({
      item: seasonList().props.data[1],
    });
    button.props.onPress();
    tree = modal();
    assert.deepEqual(
      episodeList().props.data.map((e) => e.id),
      ["ep-10", "ep-20"],
    );
    assert.equal(episodes.length, 0);
    const selected = seasonList().props.renderItem({
      item: seasonList().props.data[1],
    });
    assert.equal(selected.props.accessibilityState.selected, true);
  });
  await test("episode tap preserves real season/id and selected state through Player", () => {
    episodeList()
      .props.renderItem({ item: episodeList().props.data[0] })
      .props.onPress();
    tree = modal();
    assert.deepEqual(episodes, [["2", "ep-10"]]);
    tree = modal({ visible: false });
    tree = modal({ visible: true });
    assert.deepEqual(
      episodeList().props.data.map((e) => e.id),
      ["ep-10", "ep-20"],
    );
    assert.equal(
      episodeList().props.renderItem({ item: episodeList().props.data[0] })
        .props.accessibilityState.selected,
      true,
    );
  });
  await test("selected season remains pinned and restores independently of episode scroll", () => {
    let seasonScroll, episodeScroll;
    seasonList().props.ref.current = {
      scrollToIndex: (value) => (seasonScroll = value),
    };
    episodeList().props.ref.current = {
      scrollToOffset: (value) => (episodeScroll = value),
    };
    episodeList().props.onScroll({
      nativeEvent: { contentOffset: { y: 420 } },
    });
    tree = modal({ visible: false });
    tree = modal({ visible: true });
    seasonList().props.onLayout();
    episodeList().props.onContentSizeChange();
    assert.equal(seasonScroll.index, 1);
    assert.equal(seasonScroll.viewPosition, 0.5);
    assert.equal(episodeScroll.offset, 420);
    assert.equal(seasonList().props.style.flexShrink, 0);
    assert(
      !nodes(episodeList().props.ListHeaderComponent).includes(seasonList()),
    );
  });
  await test("progress shown only for matching provider and episode identity", () => {
    h.entries = [
      {
        providerId: "b",
        playbackRef: model.seasons.find((s) => s.id === "2").episodes[0]
          .progressRef,
        position: 600,
        duration: 1200,
      },
    ];
    tree = modal();
    assert.doesNotMatch(
      JSON.stringify(
        episodeList().props.renderItem({ item: episodeList().props.data[1] }),
      ),
      /İzlenen/,
    );
    h.entries = [{ ...h.entries[0], providerId: "a" }];
    tree = modal();
    assert.match(
      JSON.stringify(
        episodeList().props.renderItem({ item: episodeList().props.data[1] }),
      ),
      /İzlenen/,
    );
  });
  await test("content resize after restoration cannot repeatedly rewind the episode list", () => {
    let scrolls = 0;
    episodeList().props.ref.current = { scrollToOffset: () => scrolls++ };
    tree = modal({ visible: false });
    tree = modal({ visible: true });
    episodeList().props.onContentSizeChange();
    episodeList().props.onContentSizeChange();
    assert.equal(scrolls, 1);
  });
  await test("dragging cancels a pending episode scroll restoration", () => {
    let scrolls = 0;
    episodeList().props.ref.current = { scrollToOffset: () => scrolls++ };
    tree = modal({ visible: false });
    tree = modal({ visible: true });
    episodeList().props.onScrollBeginDrag();
    episodeList().props.onContentSizeChange();
    assert.equal(scrolls, 0);
  });
  await test("provider switch rejects old production list restore callback", () => {
    const oldRestore = episodeList().props.onContentSizeChange;
    let scrolls = 0;
    episodeList().props.ref.current = { scrollToOffset: () => scrolls++ };
    tree = modal({ providerId: "b" });
    tree = modal();
    oldRestore();
    assert.equal(scrolls, 0);
    assert.equal(episodeList().props.data.length, 0);
    tree = modal({ providerId: "a" });
    tree = modal();
    seasonList()
      .props.renderItem({ item: seasonList().props.data[1] })
      .props.onPress();
    tree = modal();
    episodeList()
      .props.renderItem({ item: episodeList().props.data[0] })
      .props.onPress();
    tree = modal();
  });
  await test("closing modal invalidates a scheduled production Focus request", () => {
    const frames = [],
      restored = [];
    globalThis.requestAnimationFrame = (fn) => {
      frames.push(fn);
      return frames.length;
    };
    const previous = h.focus.restoreFocus;
    h.focus.restoreFocus = async (id) => {
      restored.push(id);
      return true;
    };
    tree = modal({ visible: false });
    tree = modal({ visible: true });
    episodeList().props.onContentSizeChange();
    assert.equal(frames.length, 1);
    tree = modal({ visible: false });
    frames.forEach((fn) => fn());
    assert.deepEqual(restored, []);
    h.focus.restoreFocus = previous;
    globalThis.requestAnimationFrame = (fn) => {
      fn();
      return 0;
    };
    tree = modal({ visible: true });
  });
  await test("removed episode restores safe scroll origin without requesting deleted target", () => {
    let restoredOffset = -1;
    const previous = h.focus.restoreFocus,
      restored = [];
    h.focus.restoreFocus = async (id) => {
      restored.push(id);
      return true;
    };
    episodeList().props.ref.current = {
      scrollToOffset: (value) => {
        restoredOffset = value.offset;
      },
    };
    tree = modal({ visible: false });
    tree = modal({
      visible: true,
      detail: {
        ...model,
        seasons: model.seasons.map((season) => ({
          ...season,
          episodes: season.episodes.filter((e) => e.id !== "ep-10"),
        })),
      },
    });
    episodeList().props.onContentSizeChange();
    assert.equal(restoredOffset, 0);
    assert.deepEqual(restored, []);
    h.focus.restoreFocus = previous;
    tree = modal({ detail: model });
  });
  await test("detail Back closes to source directly, does not change provider hierarchy", () => {
    focus.back();
    assert.equal(closed, 1);
    assert.equal(baseBack, 0);
    assert.equal(tree.props.onRequestClose, modalOptions.onClose);
    clean();
    assert.equal(focused, "home:series:card");
    focus.back();
    assert.equal(baseBack, 1);
  });
  await test("out-of-order Film Info teardown returns Player directly to original card", () => {
    const controller = api.createTVPreviewFocusController();
    const register = (id, scope) =>
      controller.register({
        id,
        scope,
        bounds: { x: 0, y: 0, width: 80, height: 60 },
        press() {},
        setFocused() {},
      });
    register("vod:42", "content");
    register("movie:play", "movie-info");
    register("player:exit", "player");
    const closeInfo = controller.pushFocusScope("movie-info");
    const closePlayer = controller.pushFocusScope("player");
    closeInfo();
    assert.equal(controller.getFocusedId(), "player:exit");
    closePlayer();
    assert.equal(controller.getFocusedId(), "vod:42");
  });
  await test("disposed provider rejects outstanding asynchronous Focus measurement", async () => {
    const controller = api.createTVPreviewFocusController();
    let finish;
    controller.register({
      id: "vod:42",
      bounds: { x: 0, y: 0, width: 80, height: 60 },
      measure: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      press() {},
      setFocused() {},
    });
    const pending = controller.restoreFocus("vod:42");
    controller.dispose();
    finish({ x: 0, y: 0, width: 80, height: 60 });
    assert.equal(await pending, false);
    assert.equal(controller.getFocusedId(), null);
  });
  await test("real ProductShell keys Focus lifecycle by current provider including disconnect", () => {
    for (const id of ["provider-a", "provider-b", null]) {
      h.shellProvider = id ? { id, type: "xtream" } : null;
      const shell = render(() => api.ProductShell());
      const owner = nodes(shell).find((node) => node.tag === "FocusProvider");
      assert.equal(owner.props.key, id ?? "disconnected");
    }
  });
  const source = readFileSync(
      join(app, "components/OptimizedHomeScreenPaged.tsx"),
      "utf8",
    ),
    stalker = readFileSync(join(app, "components/StalkerMainPage.tsx"), "utf8"),
    view = readFileSync(
      join(app, "components/catalog/PagedCatalogViews.tsx"),
      "utf8",
    );
  await test("production origins keep details mounted and preserve explicit episode progress", () => {
    assert.match(
      source,
      /onOpenSeries=\{item => pagedSeries.open\(item, "home"\)\}/,
    );
    assert.match(
      source,
      /onOpenLive=\{\(channel\) => openLive\(channel, "home"\)\}/,
    );
    assert.match(
      source,
      /onOpenMedia=\{\(item\) => openProgress\(item, "home"\)\}/,
    );
    assert.match(source, /onPlay: item => openMovie\(item, "home"\)/);
    assert.match(source, /progressRef=\{playable.progressRef\}/);
    assert.match(
      source,
      /if \(!Platform.isTV && view === "player" && !pagedSeries.state\)/,
    );
    assert.match(source, /detailSuspended=\{seriesDetailSuspended\}/);
    assert.match(stalker, /initialSeries=\{homeSeriesInfo.item\}/);
    assert.match(stalker, /openSeriesEpisode\(intent,"home"\)/);
    assert.match(view, /SeriesInfoModal/);
    assert.match(view, /if\(detailOnly\) return seriesModal/);
  });
  console.log(
    `U4.3 Series integration: ${count}/${count} passed; HOST_MODEL_SERVICE_NOT_PHYSICAL`,
  );
} finally {
  clean();
  delete globalThis.__series;
  rmSync(out, { recursive: true, force: true });
}
