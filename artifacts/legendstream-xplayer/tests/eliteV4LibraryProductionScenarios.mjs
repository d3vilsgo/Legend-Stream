import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(app, "package.json"));
const { build } = createRequire(resolve(app, "../api-server/package.json"))(
  "esbuild",
);
const out = mkdtempSync(join(tmpdir(), "elite-v4-library-"));
const react = `
const frames=new Map();let frame;
export const Host={render(key,fn){if(!frames.has(key))frames.set(key,{values:[],cursor:0,effects:[],pending:[]});frame=frames.get(key);frame.cursor=0;return fn();},commit(key){const f=frames.get(key);for(const run of f.pending.splice(0))run();},cleanup(key){for(const effect of frames.get(key)?.effects??[])effect?.cleanup?.();frames.delete(key);}};
export function useState(initial){const f=frame,i=f.cursor++;if(!(i in f.values))f.values[i]=typeof initial==='function'?initial():initial;return[f.values[i],v=>{f.values[i]=typeof v==='function'?v(f.values[i]):v;}];}
export function useRef(initial){const f=frame,i=f.cursor++;if(!(i in f.values))f.values[i]={current:initial};return f.values[i];}
export function useEffect(run,deps){const f=frame,i=f.cursor++,old=f.effects[i];if(old&&deps&&old.deps&&deps.length===old.deps.length&&deps.every((v,i)=>v===old.deps[i]))return;f.effects[i]={deps,cleanup:old?.cleanup};f.pending.push(()=>{f.effects[i].cleanup?.();f.effects[i].cleanup=run();});}
export function useMemo(fn,deps){const f=frame,i=f.cursor++,old=f.values[i];if(!old||!deps||deps.some((v,i)=>v!==old.deps[i]))f.values[i]={deps,value:fn()};return f.values[i].value;}export function useCallback(fn){return fn;}
export function createContext(value){const c={_value:value};c.Provider={_context:c};return c;}export function useContext(c){return c._value;}
export function createElement(type,props,...children){return{type,props:{...props,children}};}
export class Component{constructor(props){this.props=props;}setState(value){this.state={...this.state,...value};}}
export default{Component,createElement,useState,useRef,useEffect,useMemo,useCallback,createContext,useContext};`;
const runtime = `export const Runtime={player:null,sync:null,page:null,queries:[],categories:[],categoryReads:[],epgSeeds:[],resolves:[],watched:[],restored:[],back:null,nativeBack:null,playerOwnsBack:false,previewEnabled:true,isTV:false,width:1280,resolve:async()=>({url:'https://stream.example/live'})};`;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("UNEXPECTED_NETWORK_IN_HOST_TEST");
};
try {
  await build({
    stdin: {
      contents: `export {EliteV4LibraryCatalog,historyRows} from './components/eliteV4/EliteV4LibraryCatalog';export {EliteV4LibraryDetail,LibraryDetailPending} from './components/eliteV4/EliteV4LibraryDetail';export {EliteV4FavoriteAction} from './components/eliteV4/EliteV4FavoriteAction';export {EliteV4Home} from './components/eliteV4/EliteV4Home';export {EliteV4ContentRail} from './components/eliteV4/EliteV4ContentRail';export {continueWatching,favoriteForProgress,progressCaption,resolveLibraryProgress,loadLibraryDetail} from './lib/eliteV4Library';export {SeriesInfoModal} from './components/series/SeriesInfoModal';export {EliteV4SeriesCatalog,EliteV4PagedSeriesDetail,EliteV4StalkerSeries,EliteV4StalkerSeriesDetail} from './components/eliteV4/EliteV4SeriesCatalog';export {v4PagedSeries,v4StalkerSeries} from './lib/eliteV4Series';export {createStalkerSeriesProductController} from './lib/stalkerSeriesProduct';export {Host} from 'react';export {Runtime} from 'live-runtime';export {EliteV4MoviesCatalog,EliteV4MoviesView,EliteV4MoviesHero,EliteV4MovieBoundary} from './components/eliteV4/EliteV4MoviesCatalog';export {v4PagedMovies,v4StalkerMovies,v4MoviesLayout} from './lib/eliteV4Movies';export {EliteV4TvShell} from './components/eliteV4/EliteV4TvShell';export {EliteV4Sidebar} from './components/eliteV4/EliteV4Sidebar';export {EliteV4FocusSurface,EliteV4FocusButton} from './components/eliteV4/EliteV4FocusSurface';`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "library.cjs"),
    logLevel: "silent",
    plugins: [
      {
        name: "live-host-boundaries",
        setup(build) {
          const mocks = {
            "@/hooks/useResolvedLiveIdentityChannels": `import {Runtime} from 'live-runtime';export const useResolvedLiveIdentityChannels=()=>Runtime.player.channels;`,

            "@/lib/tmdb/directTransport": `import {Runtime} from 'live-runtime';export function fetchTmdbSeason(...args){Runtime.seasonReads.push(args);return Runtime.seasonLookup(...args);}`,

            "react-native-safe-area-context": `export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`,
            "@/context/I18nContext": `export const useI18n=()=>({t:key=>key});`,
            "@/context/MediaLibraryContext": `import {Runtime} from 'live-runtime';export const useMediaLibrary=()=>Runtime.library;`,
            "@/components/tvPreview/TVRemoteInspector": `export const TVRemoteInspectorOverlay='Inspector';`,
            "@/lib/stalkerPortalRuntime": `import {Runtime} from 'live-runtime';export function subscribeStalkerPortalRuntime(fn){Runtime.sessionListeners.add(fn);return()=>Runtime.sessionListeners.delete(fn);}`,
            "@/lib/performanceDiagnostics": `export const beginPlaybackAttempt=()=>{};`,
            "@/lib/xtreamCatalog": `import {Runtime} from 'live-runtime';export function getSeriesInfo(c,id,signal){Runtime.infoReads.push({c,id,signal});return Runtime.loadInfo(id,signal);}export function registerLocalEpisodeQueue(info){Runtime.registered.push(info);}`,

            "./EliteV4LiveCatalog": `export const EliteV4LiveCatalog='Live';`,
            "expo-linear-gradient": `export const LinearGradient='Gradient';`,
            "@/components/tmdb/MovieInfoModal": `export const MovieInfoModal='MovieInfoModal';`,
            "@/components/tmdb/MovieInfoServiceProvider": `const service={};export function useMovieInfoService(){return service;}`,
            "@/lib/tmdb/movieInfoService": `import {Runtime} from 'live-runtime';export function beginMovieEnrichment(service,input,callback){const entry={input,callback,cancelled:false};Runtime.enrich.push(entry);return()=>{entry.cancelled=true;};}`,
            "@/hooks/useStalkerMoviesCatalog": `import {Runtime} from 'live-runtime';export function useStalkerMoviesCatalog(options){Runtime.stalkerOptions=options;return Runtime.stalker;}`,
            "@/lib/stalkerProductSession": `import {Runtime} from 'live-runtime';export function readCurrentStalkerProductSession(){return{session:Runtime.session,providerScopeId:Runtime.sessionScope??'session-safe-1'};}export function isCurrentStalkerProductSession(p,s){return s===Runtime.session;}`,
            react,
            "live-runtime": runtime,
            "react-native": `import {Runtime} from 'live-runtime';export const Modal='Modal';export const StyleSheet={create:x=>x};export const View='View',Text='Text',Image='Image',ImageBackground='ImageBackground',ScrollView='ScrollView',FlatList='FlatList',TextInput='TextInput',ActivityIndicator='ActivityIndicator',Pressable='Pressable';export const Platform={get isTV(){return Runtime.isTV;}};export function useWindowDimensions(){return{width:Runtime.width,height:Runtime.height??720,fontScale:Runtime.fontScale??1};}export function findNodeHandle(ref){return ref?.handle??null;}export const BackHandler={addEventListener(_,fn){Runtime.nativeBack=fn;return{remove(){Runtime.nativeBack=null;}}}};`,
            "@expo/vector-icons": `export const Feather='Icon';`,
            "@/context/PlayerContext": `import {Runtime} from 'live-runtime';export function usePlayer(){return Runtime.player;}export function selectProgramsAt(programs,clock){return{now:programs?.find(p=>p.start<=clock&&p.end>clock)};}`,
            "@/context/CatalogSyncContext": `import {Runtime} from 'live-runtime';export function useCatalogSync(){return Runtime.sync;}`,
            "@/hooks/useCatalogPage": `import {Runtime} from 'live-runtime';export function useCatalogPage(query){Runtime.queries.push(query);return Runtime.page;}`,
            "@/lib/catalogPageRepository": `import {Runtime} from 'live-runtime';export async function getCachedLibraryItem(p,k,id){Runtime.lookups.push({p,k,id});return Runtime.lookup(p,k,id);}export async function getCachedM3UEpisodeParent(p,id){return Runtime.parent;}export async function getCachedCatalogCategories(...args){Runtime.categoryReads.push(args);return Runtime.categories;}export function loadM3USeriesInfoFromCache(p,id){Runtime.infoReads.push({p,id});return Runtime.loadInfo(id);}`,
            "@/lib/epgRuntime": `import {Runtime} from 'live-runtime';export const EPG_PAGED_SEED_LIMIT=40;export function registerEpgChannels(providerId,items){Runtime.epgSeeds.push({providerId,items});}`,
            "@/lib/playerRemoteOwnership": `import {Runtime} from 'live-runtime';export function hasPlayerBackOwner(){return Runtime.playerOwnsBack;}`,
            "@/lib/imageUrl": `export function normalizeImageUrl(value){return value||null;}`,
            "@/components/tvPreview/TVPreviewFocus": `import {Runtime} from 'live-runtime';const restoreFocus=async id=>{Runtime.restored.push(id);return true;};const registerBackAction=fn=>{Runtime.back=fn;return()=>{Runtime.back=null;};};export function useOptionalTVPreviewFocus(){return{enabled:Runtime.previewEnabled,restoreFocus,registerBackAction};}export const TVPreviewPressable='PreviewPressable',TVPreviewFocusRegion='Region',TVPreviewControls='Controls';const pushFocusScope=id=>{Runtime.scopes.push(id);return()=>Runtime.scopes.pop();};export function useTVPreviewFocus(){return{enabled:true,nativeScope:'series-info',pushFocusScope,registerBackAction,restoreFocus,getFocusedEntry:()=>Runtime.focused?{id:Runtime.focused}:null,modalShown:async id=>Runtime.shown.push(id)};}`,
            "@react-native-async-storage/async-storage": `export default{getItem:async()=>null};`,
            "@/components/NativeVideoPlayer": `export const NativeVideoPlayer='NativeVideoPlayer';`,
            "@/lib/catalogRuntime": `import {Runtime} from 'live-runtime';export function resolveCatalogPlaybackSource(...args){Runtime.resolves.push(args);return Runtime.resolve(...args);}`,
          };
          for (const path of [
            "catalogPageRepository",
            "catalogRuntime",
            "xtreamCatalog",
            "stalkerProductSession",
          ])
            mocks["./" + path] = mocks["@/lib/" + path];
          build.onResolve({ filter: /.*/ }, (args) =>
            Object.hasOwn(mocks, args.path)
              ? { path: args.path, namespace: "live-host" }
              : args.path === "./EliteV4Home"
                ? { path: "home", namespace: "live-host" }
                : undefined,
          );
          build.onLoad(
            { filter: /.*/, namespace: "live-host" },
            ({ path }) => ({
              contents:
                path === "home"
                  ? `export const EliteV4Home='Home';`
                  : mocks[path],
              loader: "js",
            }),
          );
        },
      },
    ],
  });

  const ui = req(join(out, "library.cjs")),
    { Runtime: R, Host: H } = ui;
  Object.assign(R, {
    enrich: [],
    scopes: [],
    shown: [],
    lookups: [],
    infoReads: [],
    registered: [],
    sessionListeners: new Set(),
    isTV: true,
  });
  globalThis.requestAnimationFrame = (fn) => {
    fn();
    return 1;
  };
  const nodes = (n, result = []) => {
    if (Array.isArray(n)) {
      n.forEach((v) => nodes(v, result));
      return result;
    }
    if (!n || typeof n !== "object") return result;
    result.push(n);
    nodes(n.props?.children, result);
    nodes(n.props?.ListHeaderComponent, result);
    nodes(n.props?.ListFooterComponent, result);
    nodes(n.props?.ListEmptyComponent, result);
    return result;
  };
  const find = (n, id) => nodes(n).find((v) => v.props?.focusId === id),
    flat = (n) => nodes(n).find((v) => v.type === "FlatList");
  const flush = async () => {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  };
  const render = (key, fn) => {
    const n = H.render(key, fn);
    H.commit(key);
    return n;
  };
  const defer = () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  };
  let checks = 0;
  const check = async (name, fn) => {
    await fn();
    console.log(`PASS V4 library ${++checks} - ${name}`);
  };
  const focusRoot = render("focus", () =>
    ui.EliteV4FocusSurface({ children: null }),
  );
  focusRoot.type._context._value = focusRoot.props.value;
  const provider = {
    id: "p",
    type: "xtream",
    url: "https://provider.invalid",
    username: "fixture",
    password: "fixture",
  };
  const channel = {
    id: "p:xtream-live:1",
    providerId: "p",
    name: "Provider TV",
    logoUrl: "https://image.invalid/logo",
    streamUrl: "https://play.invalid/live",
  };
  const movie = {
    schemaVersion: 2,
    id: "progress-film",
    providerId: "p",
    kind: "movie",
    title: "Provider film",
    source: "https://unused.invalid/runtime",
    playbackRef: {
      type: "xtream-vod",
      streamId: "7",
      containerExtension: "mp4",
      sourceMode: "canonical",
    },
    position: 120,
    duration: 2000,
    updatedAt: 300,
  };
  const episode = {
    ...movie,
    id: "progress-episode",
    kind: "episode",
    title: "Episode nine",
    subtitle: "Provider show",
    playbackRef: {
      type: "xtream-episode",
      seriesId: "s",
      episodeId: "e9",
      containerExtension: "mkv",
      sourceMode: "direct",
    },
    episodeContext: { seriesId: "s", seasonId: "02", episodeNumber: 9 },
    updatedAt: 400,
  };
  const olderEpisode = {
    ...episode,
    id: "progress-older",
    title: "Episode eight",
    playbackRef: { ...episode.playbackRef, episodeId: "e8" },
    updatedAt: 200,
  };
  const favorite = {
    providerId: "p",
    kind: "movie",
    catalogId: "7",
    title: "Provider film",
    addedAt: 1,
  };
  const favorites = [];
  let removed = [];
  const calls = [];
  R.library = {
    entries: [movie, episode, olderEpisode],
    historyEntries: [movie, episode, olderEpisode],
    loaded: true,
    removeProgressEntries: async (ids) => {
      removed.push(...ids);
      R.library.historyEntries = R.library.historyEntries.filter(
        (e) => !ids.includes(e.id),
      );
      R.library.entries = R.library.historyEntries;
    },
    retryStorage: () => (R.retried = true),
  };
  R.player = {
    provider,
    providers: [provider],
    channels: [channel],
    favorites: [channel.id],
    history: [channel.id],
    historyTimes: { [channel.id]: 500 },
    mediaFavorites: [
      favorite,
      { ...favorite, providerId: "foreign", catalogId: "7", title: "Foreign" },
    ],
    epgByChannel: new Map([
      [
        channel.id,
        [{ title: "Actual EPG", start: 0, end: Date.now() + 10000 }],
      ],
    ]),
    recordWatched: async (id) => calls.push(["watched", id]),
    removeWatched: async (id) => {
      R.player.history = R.player.history.filter((v) => v !== id);
    },
    clearHistory: async () => {
      R.player.history = [];
    },
    toggleFavorite: async (id) => {
      R.player.favorites = R.player.favorites.filter((v) => v !== id);
    },
    setMediaFavorite: async (value, selected) => {
      calls.push(["favorite", value, selected]);
      R.player.mediaFavorites = R.player.mediaFavorites.filter(
        (v) =>
          JSON.stringify([v.providerId, v.kind, v.catalogId]) !==
          JSON.stringify([value.providerId, value.kind, value.catalogId]),
      );
      if (selected)
        R.player.mediaFavorites.push({ ...value, addedAt: Date.now() });
    },
  };
  R.sync = {
    snapshot: {
      providerId: "p",
      ready: true,
      counts: { series: 0, vod: 0 },
      movies: [],
      series: [],
      live: [channel],
      newMovies: [],
    },
    hasUsableCache: true,
    isSyncing: false,
  };
  R.lookup = async (_p, kind, id) =>
    kind === "movie"
      ? {
          stream_id: id,
          name: "Provider film",
          stream_icon: "https://image.invalid/poster",
          container_extension: "mkv",
        }
      : { series_id: id, name: "Provider show" };
  R.loadInfo = async () => ({
    episodes: {
      "02": [
        {
          id: "e9",
          title: "Episode nine",
          episode_num: 9,
          container_extension: "mkv",
          direct_source: "https://play.invalid/exact-episode",
        },
      ],
    },
  });
  R.resolve = async (request) => ({
    url: request.item.direct_source || "https://play.invalid/exact-film",
  });
  const props = {
    mode: "history",
    active: true,
    onBack: () => calls.push(["back"]),
    onResume: (e, o) => calls.push(["resume", e, o]),
    onDetail: (t, o) => calls.push(["detail", t, o]),
    onLive: (c, o) => calls.push(["live", c, o]),
  };
  const screen = () => render("screen", () => ui.EliteV4LibraryCatalog(props));
  await check(
    "real history separates live film and grouped series with current account only",
    () => {
      const rows = ui.historyRows(
        "p",
        [channel],
        R.player.history,
        [
          movie,
          episode,
          olderEpisode,
          { ...movie, providerId: "foreign", id: "foreign" },
        ],
        R.player.historyTimes,
      );
      assert.deepEqual(
        rows.map((r) => r.kind),
        ["live", "series", "movie"],
      );
      assert.deepEqual(rows[1].removeIds, [
        "progress-episode",
        "progress-older",
      ]);
      assert.equal(rows[0].progress, undefined);
      assert.equal(rows[1].progress.playbackRef.episodeId, "e9");
    },
  );
  await check(
    "Continue uses meaningful unfinished progress sorted by time, never foreign or completed media",
    () => {
      const rows = ui.continueWatching(
        [
          movie,
          episode,
          olderEpisode,
          { ...movie, id: "done", position: 1995 },
          { ...movie, id: "invalid", duration: 0 },
          { ...movie, id: "foreign", providerId: "foreign" },
        ],
        "p",
      );
      assert.deepEqual(
        rows.map((e) => e.id),
        ["progress-episode", "progress-film"],
      );
      assert.match(ui.progressCaption(episode), /S02.*B9/);
      const unknown = {
        ...episode,
        episodeContext: undefined,
        playbackRef: {
          type: "xtream-episode",
          episodeId: "old",
          containerExtension: "mp4",
          sourceMode: "canonical",
        },
      };
      assert.equal(ui.continueWatching([unknown], "p").length, 0);
    },
  );
  await check(
    "History filters and actual card OK preserve exact episode and live identities",
    () => {
      let s = screen();
      find(s, "v4-history-filter-series").props.onPress();
      s = screen();
      let l = flat(s);
      assert.equal(l.props.data.flat().length, 1);
      let row = l.props.renderItem({ item: l.props.data[0], index: 0 });
      const main = nodes(row).find(
        (n) =>
          n.props?.focusId?.startsWith("v4-history-") &&
          !n.props.focusId.endsWith(":detail") &&
          !n.props.focusId.endsWith(":remove"),
      );
      main.props.onPress();
      assert.equal(calls.at(-1)[0], "resume");
      assert.equal(calls.at(-1)[1].playbackRef.episodeId, "e9");
      find(s, "v4-history-filter-live").props.onPress();
      s = screen();
      l = flat(s);
      row = l.props.renderItem({ item: l.props.data[0], index: 0 });
      const live = nodes(row).find(
        (n) => n.props?.focusId && !n.props.focusId.endsWith(":remove"),
      );
      live.props.onPress();
      assert.equal(calls.at(-1)[1].id, channel.id);
      assert.ok(JSON.stringify(row).includes("Actual EPG"));
    },
  );
  await check(
    "Favorite filters include live film and series while excluding another account",
    () => {
      props.mode = "favorites";
      H.cleanup("screen");
      let s = screen(),
        l = flat(s);
      assert.equal(l.props.data.flat().length, 2);
      find(s, "v4-favorites-filter-movie").props.onPress();
      s = screen();
      l = flat(s);
      assert.equal(l.props.data.flat()[0].target.catalogId, "7");
      assert.equal(JSON.stringify(s).includes("Foreign"), false);
    },
  );
  await check(
    "favorite action locks duplicate OK without disabling the focused TV target",
    async () => {
      const pending = defer(),
        saved = R.player.setMediaFavorite;
      R.player.setMediaFavorite = async (...args) => {
        favorites.push(args);
        await pending.promise;
      };
      const p = {
        target: {
          providerId: "p",
          kind: "series",
          catalogId: "s",
          title: "Provider show",
        },
        focusId: "favorite-control",
      };
      let action = render("favorite-action", () => ui.EliteV4FavoriteAction(p));
      action.props.onPress();
      action.props.onPress();
      action = render("favorite-action", () => ui.EliteV4FavoriteAction(p));
      assert.equal(action.props.disabled, false);
      assert.equal(favorites.length, 1);
      pending.resolve();
      await flush();
      R.player.setMediaFavorite = saved;
      H.cleanup("favorite-action");
    },
  );
  await check(
    "favorite removal and history removal use real persistence actions and restore a valid target",
    async () => {
      let s = screen(),
        l = flat(s),
        row = l.props.renderItem({ item: l.props.data[0], index: 0 });
      const remove = nodes(row).find((n) =>
        n.props?.focusId?.endsWith(":remove"),
      );
      remove.props.onPress();
      await flush();
      assert.equal(
        R.player.mediaFavorites.some(
          (e) => e.providerId === "p" && e.catalogId === "7",
        ),
        false,
      );
      props.mode = "history";
      H.cleanup("screen");
      s = screen();
      find(s, "v4-history-filter-series").props.onPress();
      s = screen();
      l = flat(s);
      row = l.props.renderItem({ item: l.props.data[0], index: 0 });
      nodes(row)
        .find((n) => n.props?.focusId?.endsWith(":remove"))
        .props.onPress();
      await flush();
      assert.deepEqual(removed, ["progress-episode", "progress-older"]);
      s = screen();
      assert.equal(flat(s).props.data.length, 0);
      R.library.historyEntries = [movie, episode, olderEpisode];
      R.library.entries = R.library.historyEntries;
    },
  );
  await check(
    "empty filters retain Back and Sidebar graph with no percent for live channels",
    () => {
      let s = screen();
      assert.ok(find(s, "v4-history-filter-series"));
      R.back();
      assert.equal(calls.at(-1)[0], "back");
      find(s, "v4-history-filter-live").props.onPress();
      s = screen();
      const l = flat(s),
        row = l.props.renderItem({ item: l.props.data[0], index: 0 });
      assert.equal(JSON.stringify(row).includes(" / "), false);
      assert.equal(
        nodes(row).find(
          (n) => n.props?.focusId && !n.props.focusId.endsWith(":remove"),
        ).props.neighbors.left,
        "sidebar-history",
      );
    },
  );
  await check(
    "actual Sidebar has separate History and Favorites routes and content entry targets",
    () => {
      const nav = [];
      const s = render("sidebar", () =>
        ui.EliteV4Sidebar({
          onReturnToV3: () => assert.fail("V3"),
          onNavigate: (r) => nav.push(r),
          activeId: "sidebar-favorites",
          contentFocusId: "v4-favorites-filter-all",
        }),
      );
      find(s, "sidebar-history").props.onPress();
      find(s, "sidebar-favorites").props.onPress();
      assert.deepEqual(nav, ["history", "favorites"]);
      assert.equal(
        find(s, "sidebar-favorites").props.neighbors.right,
        "v4-favorites-filter-all",
      );
    },
  );
  let shellRoot = render("shell", () =>
    ui.EliteV4TvShell({ onReturnToV3: () => assert.fail("V3") }),
  );
  const shellChild = shellRoot.props.children[0],
    shell = () =>
      render("shell-content", () => shellChild.type(shellChild.props));
  await check(
    "Home Continue is driven by live MediaLibrary records beyond the sampled movie catalog",
    () => {
      let s = shell();
      s = shell();
      const home = nodes(s).find((n) => n.type === "Home");
      assert.equal(home.props.sections.continueWatching.length, 2);
      assert.equal(home.props.sections.continueWatching[0].progress, episode);
      assert.equal(home.props.sections.movies.length, 0);
      const actual = render("home", () => ui.EliteV4Home(home.props));
      const rail = nodes(actual).find((n) => n.props?.railId === "continue");
      assert.equal(rail.props.onProgressInfo, home.props.onProgressInfo);
      assert.equal(rail.props.onProgressRemove, home.props.onProgressRemove);
    },
  );
  await check(
    "actual Continue rail has compact cards and explicit Info/Remove D-pad actions",
    () => {
      const s = shell(),
        home = nodes(s).find((n) => n.type === "Home");
      const p = {
        items: home.props.sections.continueWatching,
        title: "Continue",
        railId: "continue",
        cardWidth: 180,
        onOpen: home.props.onOpen,
        onProgressInfo: home.props.onProgressInfo,
        onProgressRemove: () => (R.removedFromRail = true),
      };
      const rail = render("rail", () => ui.EliteV4ContentRail(p));
      assert.equal(
        find(rail, "continue-0").props.neighbors.down,
        "continue-0:info",
      );
      assert.ok(
        nodes(rail).some(
          (n) => n.type === "View" && n.props?.style?.height === 101,
        ),
      );
      find(rail, "continue-0:remove").props.onPress();
      assert.equal(R.removedFromRail, true);
    },
  );
  await check(
    "Shell resumes the exact provider episode and returns Player to its original History focus",
    async () => {
      let s = shell();
      nodes(s)
        .find((n) => n.type === ui.EliteV4Sidebar)
        .props.onNavigate("history");
      s = shell();
      const library = nodes(s).find((n) => n.type === ui.EliteV4LibraryCatalog);
      let restored = false;
      focusRoot.props.value.register(
        { id: "history-origin", region: "content" },
        { focus: () => (restored = true) },
      );
      library.props.onResume(episode, "history-origin");
      await flush();
      s = shell();
      const player = nodes(s).find((n) => n.type === "NativeVideoPlayer");
      assert.ok(player);
      assert.equal(player.props.progressRef, episode.playbackRef);
      assert.equal(player.props.episodeContext, episode.episodeContext);
      assert.equal(R.resolves.at(-1)[0].item.id, "e9");
      player.props.onFullscreenExit();
      shell();
      assert.equal(restored, true);
    },
  );
  await check(
    "removed record or changed route rejects a delayed resume resolution",
    async () => {
      let s = shell(),
        library = nodes(s).find((n) => n.type === ui.EliteV4LibraryCatalog);
      const old = R.resolve,
        pending = defer();
      R.resolve = () => pending.promise;
      library.props.onResume(movie, "origin");
      await flush();
      R.library.historyEntries = [episode];
      shell();
      pending.resolve({ url: "https://play.invalid/stale" });
      await flush();
      assert.equal(
        nodes(shell()).some((n) => n.type === "NativeVideoPlayer"),
        false,
      );
      R.library.historyEntries = [movie, episode];
      R.resolve = old;
    },
  );
  await check(
    "library details use exact cached provider item and the existing Movie Info contract",
    async () => {
      const target = {
          providerId: "p",
          kind: "movie",
          catalogId: "7",
          title: "Provider film",
        },
        p = {
          target,
          active: true,
          onClose: () => (R.detailClosed = true),
          onMovie: async () => {},
          onSeries: () => {},
        };
      let d = render("library-detail", () => ui.EliteV4LibraryDetail(p));
      assert.equal(d.type, ui.LibraryDetailPending);
      await flush();
      d = render("library-detail", () => ui.EliteV4LibraryDetail(p));
      assert.equal(d.type, "MovieInfoModal");
      assert.equal(d.props.input.identity.catalogId, "7");
      assert.equal(d.props.favoriteAction.type, ui.EliteV4FavoriteAction);
      assert.equal(R.lookups.at(-1).id, "7");
      H.cleanup("library-detail");
    },
  );
  await check(
    "Xtream and M3U resume resolve freshly loaded provider episodes, never saved credential URLs",
    async () => {
      const abort = new AbortController();
      await ui.resolveLibraryProgress(provider, episode, abort.signal);
      assert.equal(
        R.resolves.at(-1)[0].item.direct_source,
        "https://play.invalid/exact-episode",
      );
      const m3u = { ...provider, type: "m3u" },
        mep = {
          ...episode,
          playbackRef: { type: "m3u-episode", itemId: "e9" },
        };
      await ui.resolveLibraryProgress(m3u, mep, abort.signal);
      assert.equal(R.resolves.at(-1)[1].type, "m3u");
      assert.equal(R.resolves.at(-1)[0].item.id, "e9");
    },
  );
  await check(
    "Stalker movie replay locates its real category row before resolving current opaque command",
    async () => {
      const requests = [];
      R.session = {
        request: async (params) => {
          requests.push(params);
          return params.action === "create_link"
            ? { cmd: "ffmpeg https://play.invalid/current-stalker" }
            : {
                data: [
                  { id: "7", name: "Portal film", cmd: "opaque-real-command" },
                ],
                cur_page: 1,
                total_items: 1,
                max_page_items: 20,
              };
        },
      };
      const p = { ...provider, type: "stalker", mac: "fixture" },
        entry = {
          ...movie,
          playbackRef: {
            type: "stalker-vod",
            itemId: "7",
            categoryId: "real-category",
          },
        };
      const url = await ui.resolveLibraryProgress(
        p,
        entry,
        new AbortController().signal,
      );
      assert.equal(url, "https://play.invalid/current-stalker");
      assert.equal(requests[0].category, "real-category");
      assert.equal(requests.at(-1).cmd, "opaque-real-command");
    },
  );
  await check(
    "Stalker episode replay keeps series season and zero-prefixed episode identity",
    async () => {
      const requests = [];
      R.session = {
        request: async (params) => {
          requests.push(params);
          return params.action === "create_link"
            ? { js: { cmd: "ffmpeg https://play.invalid/current-episode" } }
            : {
                js: {
                  data: [
                    {
                      season_id: "02",
                      cmd: "season-command",
                      series: [{ episode_id: "009", name: "Episode" }],
                    },
                  ],
                },
              };
        },
      };
      const p = { ...provider, type: "stalker", mac: "fixture" },
        entry = {
          ...episode,
          playbackRef: {
            type: "stalker-episode",
            seriesId: "s",
            seasonId: "02",
            episodeId: "009",
          },
        };
      const url = await ui.resolveLibraryProgress(
        p,
        entry,
        new AbortController().signal,
      );
      assert.equal(url, "https://play.invalid/current-episode");
      assert.equal(requests[0].movie_id, "s");
      assert.equal(requests.at(-1).series, "009");
    },
  );
  await check(
    "pending/error detail is a real modal Focus scope with reachable close and retry",
    () => {
      const p = render("pending", () =>
        ui.LibraryDetailPending({
          error: true,
          onClose: () => (R.pendingClosed = true),
          onRetry: () => (R.pendingRetry = true),
        }),
      );
      assert.equal(p.type, "Modal");
      assert.ok(R.scopes.includes("library-info"));
      find(p, "v4-library-detail-retry").props.onPress();
      R.back();
      assert.equal(R.pendingRetry, true);
      assert.equal(R.pendingClosed, true);
      H.cleanup("pending");
    },
  );
  await check(
    "storage errors remain visible; old filtered card callbacks cannot act on changed content",
    () => {
      H.cleanup("screen");
      props.mode = "history";
      let s = screen(),
        l = flat(s),
        row = l.props.renderItem({ item: l.props.data[0], index: 0 });
      const old = nodes(row).find(
        (n) =>
          n.props?.focusId &&
          !n.props.focusId.endsWith(":detail") &&
          !n.props.focusId.endsWith(":remove"),
      );
      const before = calls.length;
      find(s, "v4-history-filter-movie").props.onPress();
      s = screen();
      old.props.onPress();
      assert.equal(calls.length, before);
      R.library.storageError = "Kayıt kaydedilemedi";
      s = screen();
      assert.ok(JSON.stringify(s).includes("Kayıt kaydedilemedi"));
      find(s, "v4-history-retry").props.onPress();
      assert.equal(R.retried, true);
      R.library.storageError = null;
    },
  );
  await check(
    "actual Movies poster graph reaches persistent favorite action and retains the next row",
    () => {
      const cards = ui.v4PagedMovies("p", "xtream", "r", [
        { stream_id: 7, name: "Provider film" },
        { stream_id: 8, name: "Second" },
      ]);
      const p = {
        items: cards,
        categories: [],
        category: null,
        onCategory: () => {},
        search: "",
        onSearch: () => {},
        sort: "default",
        onSort: () => {},
        loading: false,
        loadingMore: false,
        hasMore: false,
        error: false,
        count: 2,
        scope: "movie-favorites",
        onMore: () => {},
        onReload: () => {},
        onPlay: () => {},
        onBack: () => {},
        favoritesEnabled: true,
      };
      const view = render("movie-view", () => ui.EliteV4MoviesView(p)),
        list = flat(view),
        row = list.props.renderItem({ item: list.props.data[0], index: 0 });
      assert.equal(
        find(row, "v4-movies-card:7").props.neighbors.down,
        "v4-movies-card:7:favorite",
      );
      const action = nodes(row).find(
        (n) => n.type === ui.EliteV4FavoriteAction,
      );
      assert.equal(action.props.target.catalogId, "7");
      assert.equal(action.props.neighbors.up, "v4-movies-card:7");
    },
  );
  await check(
    "inactive screens cannot consume BACK or launch stale actions behind a modal or Player",
    () => {
      props.active = false;
      const s = screen(),
        before = calls.length;
      assert.equal(R.back, null);
      const row = flat(s).props.data[0];
      if (row) {
        const rendered = flat(s).props.renderItem({ item: row, index: 0 });
        const button = nodes(rendered).find((n) => n.props?.focusId);
        assert.equal(button.props.disabled, true);
        button.props.onPress();
        assert.equal(calls.length, before);
      }
      props.active = true;
    },
  );
  assert.equal(checks, 20);
  console.log(
    `Elite V4 library production host: ${checks}/20 passed; HOST_NOT_PHYSICAL`,
  );
} finally {
  globalThis.fetch = originalFetch;
  rmSync(out, { recursive: true, force: true });
}
