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
const out = mkdtempSync(join(tmpdir(), "elite-v4-series-"));
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
try {
  await build({
    stdin: {
      contents: `export {SeriesInfoModal} from './components/series/SeriesInfoModal';export {EliteV4SeriesCatalog,EliteV4PagedSeriesDetail,EliteV4StalkerSeries,EliteV4StalkerSeriesDetail} from './components/eliteV4/EliteV4SeriesCatalog';export {v4PagedSeries,v4StalkerSeries} from './lib/eliteV4Series';export {createStalkerSeriesProductController} from './lib/stalkerSeriesProduct';export {Host} from 'react';export {Runtime} from 'live-runtime';export {EliteV4MoviesCatalog,EliteV4MoviesView,EliteV4MoviesHero,EliteV4MovieBoundary} from './components/eliteV4/EliteV4MoviesCatalog';export {v4PagedMovies,v4StalkerMovies,v4MoviesLayout} from './lib/eliteV4Movies';export {EliteV4TvShell} from './components/eliteV4/EliteV4TvShell';export {EliteV4Sidebar} from './components/eliteV4/EliteV4Sidebar';export {EliteV4FocusSurface,EliteV4FocusButton} from './components/eliteV4/EliteV4FocusSurface';`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "series.cjs"),
    logLevel: "silent",
    plugins: [
      {
        name: "live-host-boundaries",
        setup(build) {
          build.onResolve({ filter: /^\.\/EliteV4Settings$/ }, () => ({
            path: "settings",
            namespace: "p5-boundary",
          }));
          build.onLoad({ filter: /.*/, namespace: "p5-boundary" }, () => ({
            contents: "export const EliteV4Settings='Settings';",
            loader: "js",
          }));
          const mocks = {
            "./EliteV4LibraryCatalog": `export const EliteV4LibraryCatalog='Library';`,
            "./EliteV4LibraryDetail": `export const EliteV4LibraryDetail='LibraryDetail';`,
            "@/lib/eliteV4Library": `export const continueWatching=()=>[],favoriteForProgress=()=>null,progressCaption=()=>'',resolveLibraryProgress=async()=>'',resolveLibraryMovie=async()=>'';`,

            "@/lib/tmdb/directTransport": `import {Runtime} from 'live-runtime';export function fetchTmdbSeason(...args){Runtime.seasonReads.push(args);return Runtime.seasonLookup(...args);}`,

            "react-native-safe-area-context": `export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`,
            "@/context/I18nContext": `export const useI18n=()=>({t:key=>key});`,
            "@/context/MediaLibraryContext": `import {Runtime} from 'live-runtime';export const useMediaLibrary=()=>({entries:Runtime.entries});`,
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
            "@/lib/catalogPageRepository": `import {Runtime} from 'live-runtime';export async function getCachedCatalogCategories(...args){Runtime.categoryReads.push(args);return Runtime.categories;}export function loadM3USeriesInfoFromCache(p,id){Runtime.infoReads.push({p,id});return Runtime.loadInfo(id);}`,
            "@/lib/epgRuntime": `import {Runtime} from 'live-runtime';export const EPG_PAGED_SEED_LIMIT=40;export function registerEpgChannels(providerId,items){Runtime.epgSeeds.push({providerId,items});}`,
            "@/lib/playerRemoteOwnership": `import {Runtime} from 'live-runtime';export function hasPlayerBackOwner(){return Runtime.playerOwnsBack;}`,
            "@/lib/imageUrl": `export function normalizeImageUrl(value){return value||null;}`,
            "@/components/tvPreview/TVPreviewFocus": `import {Runtime} from 'live-runtime';const restoreFocus=async id=>{Runtime.restored.push(id);return true;};const registerBackAction=fn=>{Runtime.back=fn;return()=>{Runtime.back=null;};};export function useOptionalTVPreviewFocus(){return{enabled:Runtime.previewEnabled,restoreFocus,registerBackAction};}export const TVPreviewPressable='PreviewPressable',TVPreviewFocusRegion='Region',TVPreviewControls='Controls';const pushFocusScope=id=>{Runtime.scopes.push(id);return()=>Runtime.scopes.pop();};export function useTVPreviewFocus(){return{enabled:true,nativeScope:'series-info',pushFocusScope,registerBackAction,restoreFocus,getFocusedEntry:()=>Runtime.focused?{id:Runtime.focused}:null,modalShown:async id=>Runtime.shown.push(id)};}`,
            "@react-native-async-storage/async-storage": `export default{getItem:async()=>null};`,
            "@/components/NativeVideoPlayer": `export const NativeVideoPlayer='NativeVideoPlayer';`,
            "@/lib/catalogRuntime": `import {Runtime} from 'live-runtime';export function resolveCatalogPlaybackSource(...args){Runtime.resolves.push(args);return Runtime.resolve(...args);}`,
          };
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
  const ui = req(join(out, "series.cjs"));
  const { Runtime: R, Host: H } = ui;
  Object.assign(R, {
    enrich: [],
    entries: [],
    scopes: [],
    shown: [],
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
    nodes(n.props?.ListEmptyComponent, result);
    nodes(n.props?.ListFooterComponent, result);
    return result;
  };
  const find = (n, id) => nodes(n).find((v) => v.props?.focusId === id);
  const flats = (n) => nodes(n).filter((v) => v.type === "FlatList");
  const flush = () => new Promise((r) => setImmediate(r));
  const settle = async () => {
    await flush();
    await flush();
  };
  const render = (key, fn) => {
    const value = H.render(key, fn);
    H.commit(key);
    return value;
  };
  const defer = () => {
    let resolve, reject;
    const promise = new Promise((r, j) => {
      resolve = r;
      reject = j;
    });
    return { promise, resolve, reject };
  };
  let checks = 0;
  const check = async (name, fn) => {
    await fn();
    console.log(`PASS V4 Series ${++checks} - ${name}`);
  };
  const root = render("focus", () =>
    ui.EliteV4FocusSurface({ children: null }),
  );
  root.type._context._value = root.props.value;
  const provider = {
    id: "p",
    type: "xtream",
    url: "https://provider.invalid",
    username: "user",
    password: "pass",
  };
  const raw = Array.from({ length: 123 }, (_, i) => ({
    series_id: String(i + 1),
    name: `Provider series ${i + 1}`,
    cover: "https://image.invalid/poster",
    releaseDate: "2024",
    genre: "Drama",
  }));
  const hierarchy = {
    info: { name: "Provider series" },
    seasons: [
      { season_number: 1, name: "Bir" },
      { season_number: 2, name: "İki" },
    ],
    episodes: {
      1: [
        {
          id: "ep-1",
          title: "Pilot",
          episode_num: 1,
          container_extension: "mkv",
          info: {
            plot: "Provider episode",
            duration: "45:00",
            movie_image: "https://image.invalid/episode",
          },
        },
      ],
      2: [
        {
          id: "ep-2",
          title: "Return",
          episode_num: 1,
          container_extension: "mp4",
        },
      ],
    },
  };
  R.player = { provider, channels: [], recordWatched: async () => {} };
  R.sync = {
    snapshot: {
      providerId: "p",
      ready: true,
      counts: { series: 123 },
      movies: [],
      series: raw.slice(0, 24),
      live: [],
      newMovies: [],
    },
    lastSuccessfulAt: 71,
    hasUsableCache: true,
    isSyncing: false,
  };
  R.page = {
    items: raw,
    countKnown: true,
    totalCount: 123,
    hasMore: true,
    loadingInitial: false,
    loadingMore: false,
    error: null,
    loadMore: () => (R.more = (R.more ?? 0) + 1),
    reload: () => (R.reload = (R.reload ?? 0) + 1),
  };
  R.categories = [{ category_id: "drama", category_name: "Dram" }];
  R.loadInfo = async () => hierarchy;
  R.resolve = async () => ({ url: "https://play.invalid/exact-episode" });
  const played = [];
  const props = {
    onBack: () => (R.home = (R.home ?? 0) + 1),
    onPlayable: (value) => played.push(value),
    active: true,
  };
  function adapter(key = "adapter") {
    const boundary = render("catalog-" + key, () =>
      ui.EliteV4SeriesCatalog(props),
    );
    const child = boundary.props.children[0];
    return render(key, () => child.type(child.props));
  }
  await check(
    "Xtream and M3U use real full catalog identities and cached provider categories",
    async () => {
      for (const type of ["xtream", "m3u"]) {
        R.player.provider = { ...provider, type };
        adapter(type);
        await settle();
        const v = adapter(type);
        assert.equal(v.props.items.length, 123);
        assert.equal(v.props.items[122].source.item, raw[122]);
        assert.equal(v.props.items[0].input.identity.kind, "series");
        assert.equal(v.props.items[0].input.identity.provider, type);
        assert.deepEqual(R.categoryReads.at(-1), [
          "p",
          "series",
          type === "m3u",
        ]);
        assert.equal(R.queries.at(-1).kind, "series");
        assert.equal(v.props.supportsAdded, type === "xtream");
        assert.equal(v.props.categories[1].id, "drama");
      }
      R.player.provider = provider;
    },
  );
  await check(
    "category search sort are scoped provider queries, counts never leak across filters",
    () => {
      let v = adapter();
      v.props.onCategory("drama");
      v = adapter();
      v.props.onSearch("Pilot");
      v = adapter();
      v.props.onSort("alphaDesc");
      adapter();
      const q = R.queries.at(-1);
      assert.equal(q.categoryId, "drama");
      assert.equal(q.search, "Pilot");
      assert.equal(q.sort, "alphaDesc");
      assert.equal(q.snapshotCount, undefined);
    },
  );
  const cards = ui.v4PagedSeries("p", "xtream", "71", raw);
  const viewProps = {
    ...props,
    items: cards,
    categories: [{ id: "drama", name: "Dram" }],
    category: "drama",
    onCategory: (id) => (R.category = id),
    search: "",
    onSearch: (v) => (R.search = v),
    sort: "default",
    onSort: (v) => (R.sort = v),
    loading: false,
    loadingMore: false,
    hasMore: true,
    error: false,
    count: 123,
    scope: "scope-a",
    onMore: R.page.loadMore,
    onReload: R.page.reload,
    onPlay: () => assert.fail("Series hero must open detail"),
    series: true,
    renderInfo: (item, origin, close) => ({
      type: "DetailContract",
      props: { item, origin, close },
    }),
  };
  const view = () => render("view", () => ui.EliteV4MoviesView(viewProps));
  await check(
    "production virtualized grid links Sidebar Hero rows and reveals focused poster",
    () => {
      const v = view(),
        list = flats(v)[0];
      const row = list.props.renderItem({ item: list.props.data[1], index: 1 });
      const card = find(row, "v4-series-card:" + list.props.data[1][0].id);
      assert.equal(card.props.neighbors.left, "sidebar-series");
      assert.equal(card.props.neighbors.up, "v4-series-card:1");
      const scroll = [];
      list.props.ref.current = { scrollToOffset: (v) => scroll.push(v) };
      card.props.onFocused();
      assert.ok(scroll[0].offset > 0);
      assert.equal(list.props.initialNumToRender, 4);
      assert.ok(list.props.data.length < cards.length);
      for (const width of [320, 768, 1920]) {
        const l = ui.v4MoviesLayout(width, 540, 1.4, width > 1000);
        assert.ok(l.cardWidth > 100);
        assert.ok(l.heroHeight <= 280);
      }
    },
  );
  await check(
    "Hero opens seasons; grid selection closes back to exact card and rejects stale scope callbacks",
    () => {
      let v = view(),
        list = flats(v)[0],
        row = list.props.renderItem({ item: list.props.data[0], index: 0 });
      find(row, "v4-series-card:2").props.onPress();
      v = view();
      const detail = nodes(v).find((n) => n.type === "DetailContract");
      assert.equal(detail.props.item.source.item, raw[1]);
      root.props.value.register(
        { id: "v4-series-card:2", region: "content" },
        { focus: () => (R.nativeRestored = "v4-series-card:2") },
      );
      detail.props.close();
      assert.equal(R.nativeRestored, "v4-series-card:2");
      const stale = find(row, "v4-series-card:2");
      viewProps.scope = "scope-b";
      view();
      stale.props.onPress();
      v = view();
      assert.equal(
        nodes(v).some((n) => n.type === "DetailContract"),
        false,
      );
      const hero = nodes(flats(v)[0].props.ListHeaderComponent).find(
        (n) => n.type === ui.EliteV4MoviesHero,
      );
      hero.props.onPlay();
      v = view();
      assert.equal(
        nodes(v).find((n) => n.type === "DetailContract").props.item.id,
        "1",
      );
      nodes(v)
        .find((n) => n.type === "DetailContract")
        .props.close();
      view();
    },
  );
  await check(
    "TMDB series enrichment is keyed, fails safely and never inserts catalog rows",
    () => {
      const hp = {
        movie: cards[0],
        height: 200,
        nextFocusId: "v4-series-card:1",
        onInfo: () => {},
        onPlay: () => {},
        onFocused: () => {},
        disabled: false,
        series: true,
      };
      let h = render("hero", () => ui.EliteV4MoviesHero(hp));
      const first = R.enrich.at(-1);
      assert.equal(first.input.identity.kind, "series");
      first.callback({
        status: "enriched",
        metadata: {
          kind: "series",
          id: 999,
          title: "Foreign title",
          backdropPath: "/cinema.jpg",
          overview: "Turkish summary",
          genres: [{ name: "Dram" }],
          voteAverage: 8.4,
          year: 2024,
        },
      });
      h = render("hero", () => ui.EliteV4MoviesHero(hp));
      assert.ok(JSON.stringify(h).includes("cinema.jpg"));
      assert.ok(JSON.stringify(h).includes("Turkish summary"));
      assert.ok(JSON.stringify(h).includes("Provider series 1"));
      assert.equal(cards.length, 123);
      hp.movie = cards[1];
      h = render("hero", () => ui.EliteV4MoviesHero(hp));
      first.callback({
        status: "enriched",
        metadata: { kind: "series", backdropPath: "/stale.jpg" },
      });
      h = render("hero", () => ui.EliteV4MoviesHero(hp));
      assert.equal(JSON.stringify(h).includes("stale.jpg"), false);
      R.enrich.at(-1).callback({ status: "failed" });
      h = render("hero", () => ui.EliteV4MoviesHero(hp));
      assert.ok(JSON.stringify(h).includes("Provider series 2"));
    },
  );
  const detailProps = {
    ...props,
    provider,
    item: cards[0],
    close: () => (R.closed = (R.closed ?? 0) + 1),
  };
  const paged = () =>
    render("paged-detail", () => ui.EliteV4PagedSeriesDetail(detailProps));
  await check(
    "production paged detail preserves real seasons episodes artwork and metadata identity",
    async () => {
      let v = paged();
      assert.equal(v.props.loading, true);
      await settle();
      v = paged();
      assert.deepEqual(
        v.props.detail.seasons.map((s) => s.id),
        ["1", "2"],
      );
      assert.equal(v.props.detail.seasons[0].episodes[0].id, "ep-1");
      assert.equal(
        v.props.detail.seasons[0].episodes[0].image,
        "https://image.invalid/episode",
      );
      assert.equal(v.props.metadataInput.identity.catalogId, "1");
      assert.equal(v.props.variant, "eliteV4");
      assert.equal(R.infoReads.at(-1).id, "1");
    },
  );
  await check(
    "episode OK resolves exact provider DTO, locks double OK and passes resume identity to Player",
    async () => {
      const v = paged(),
        before = played.length;
      v.props.onEpisode("2", "ep-2");
      v.props.onEpisode("1", "ep-1");
      await settle();
      assert.equal(played.length, before + 1);
      assert.equal(R.resolves.at(-1)[0].kind, "episode");
      assert.equal(R.resolves.at(-1)[0].item.id, "ep-2");
      assert.deepEqual(played.at(-1).progressRef, {
        type: "xtream-episode",
        seriesId: "1",
        episodeId: "ep-2",
        containerExtension: "mp4",
        sourceMode: "canonical",
      });
      detailProps.active = false;
      paged();
      detailProps.active = true;
      paged();
      const beforeReturn = played.length;
      paged().props.onEpisode("1", "ep-1");
      await settle();
      assert.equal(played.length, beforeReturn + 1);
    },
  );
  await check(
    "close invalidates in-flight playback and previous detail callbacks",
    async () => {
      const pending = defer();
      R.resolve = () => pending.promise;
      detailProps.active = false;
      paged();
      detailProps.active = true;
      paged();
      const v = paged(),
        before = played.length;
      v.props.onEpisode("1", "ep-1");
      paged().props.onClose();
      pending.resolve({ url: "https://play.invalid/stale" });
      await settle();
      assert.equal(played.length, before);
      v.props.onEpisode("2", "ep-2");
      await settle();
      assert.equal(played.length, before);
      H.cleanup("paged-detail");
      R.resolve = async () => ({ url: "https://play.invalid/current" });
    },
  );
  await check(
    "M3U hierarchy is cache only, reloads selected episode at play time and missing hierarchy fails closed",
    async () => {
      const p = {
        ...detailProps,
        provider: { ...provider, type: "m3u" },
        item: ui.v4PagedSeries("p", "m3u", "71", raw)[0],
        active: true,
      };
      const run = () =>
        render("m3u-detail", () => ui.EliteV4PagedSeriesDetail(p));
      run();
      await settle();
      let v = run();
      assert.equal(R.registered.at(-1), hierarchy);
      const before = R.infoReads.length;
      v.props.onEpisode("1", "ep-1");
      await settle();
      assert.equal(R.infoReads.length, before + 1);
      assert.deepEqual(played.at(-1).progressRef, {
        type: "m3u-episode",
        itemId: "ep-1",
      });
      H.cleanup("m3u-detail");
      R.loadInfo = async () => null;
      run();
      await settle();
      v = run();
      assert.ok(v.props.error);
      assert.equal(v.props.detail.seasons.length, 0);
      H.cleanup("m3u-detail");
      R.loadInfo = async () => hierarchy;
    },
  );
  const golden = {
    id: "detail-p",
    title: "Provider title",
    seasons: [
      {
        id: "1",
        label: "Bir",
        episodes: [
          {
            id: "ep-1",
            seasonId: "1",
            title: "Pilot",
            episodeNumber: 1,
            progressRef: { type: "m3u-episode", itemId: "ep-1" },
          },
        ],
      },
      {
        id: "2",
        label: "İki",
        episodes: [{ id: "ep-2", seasonId: "2", title: "Return" }],
      },
    ],
  };
  const episodeCalls = [];
  const modalProps = {
    providerId: "p",
    detail: golden,
    loading: false,
    visible: true,
    variant: "eliteV4",
    metadataInput: cards[0].input,
    onClose: () => (R.modalClosed = (R.modalClosed ?? 0) + 1),
    onEpisode: (s, e) => episodeCalls.push([s, e]),
  };
  const modal = () => render("modal", () => ui.SeriesInfoModal(modalProps));
  await check(
    "actual Series Info scopes Focus, uses thin turquoise, season strip selects real episode list",
    () => {
      let m = modal();
      m = modal();
      assert.ok(R.scopes.includes("series-info"));
      const strips = flats(m);
      const season = strips[0].props.renderItem({
        item: golden.seasons[0],
        index: 0,
      });
      assert.equal(season.props.focusVisualStyle.borderWidth, 1);
      assert.equal(season.props.focusVisualStyle.borderColor, "#82E2DA");
      season.props.onPress();
      m = modal();
      assert.deepEqual(
        flats(m)[1].props.data.map((e) => e.id),
        ["ep-1"],
      );
      R.back();
      assert.equal(R.modalClosed, 1);
    },
  );
  await check(
    "season changes reject old queued OK; fast repeated OK fires once and hidden modal cannot play",
    () => {
      let m = modal(),
        old = flats(m)[1].props.renderItem({
          item: golden.seasons[0].episodes[0],
          index: 0,
        });
      const season = flats(m)[0].props.renderItem({
        item: golden.seasons[1],
        index: 1,
      });
      season.props.onPress();
      old.props.onPress();
      assert.equal(episodeCalls.length, 0);
      m = modal();
      const ep = flats(m)[1].props.renderItem({
        item: golden.seasons[1].episodes[0],
        index: 0,
      });
      ep.props.onPress();
      ep.props.onPress();
      assert.deepEqual(episodeCalls, [["2", "ep-2"]]);
      modalProps.visible = false;
      modal();
      ep.props.onPress();
      assert.equal(episodeCalls.length, 1);
    },
  );
  await check(
    "Player return restores selected episode after scrolling, native modal keeps its own scope",
    () => {
      modalProps.visible = true;
      let m = modal();
      m = modal();
      const list = flats(m)[1];
      const scroll = [];
      list.props.ref.current = {
        scrollToOffset: (v) => scroll.push(v),
        scrollToIndex: (v) => scroll.push(v),
      };
      m.props.onShow();
      list.props.onContentSizeChange();
      assert.ok(scroll.length > 0);
      assert.equal(R.restored.at(-1), "series-info:detail-p:episode:2:ep-2");
      const ep = list.props.renderItem({
        item: golden.seasons[1].episodes[0],
        index: 0,
      });
      ep.props.onFocus();
      assert.equal(scroll.at(-1).index, 0);
      assert.ok(R.shown.includes("series-info"));
      H.cleanup("modal");
    },
  );
  await check(
    "actual detail progress is provider-scoped and missing/loading/error states retain retry",
    () => {
      R.entries = [
        {
          providerId: "foreign",
          playbackRef: { type: "m3u-episode", itemId: "ep-1" },
          position: 200,
          duration: 500,
        },
        {
          providerId: "p",
          playbackRef: { type: "m3u-episode", itemId: "ep-1" },
          position: 120,
          duration: 500,
        },
      ];
      modalProps.visible = true;
      modalProps.detail = {
        ...golden,
        id: "single",
        seasons: [golden.seasons[0]],
      };
      modalProps.error = "Portal hata";
      modalProps.onRetry = () => (R.retried = true);
      let m = modal();
      m = modal();
      const ep = flats(m)[1].props.renderItem({
        item: golden.seasons[0].episodes[0],
        index: 0,
      });
      assert.ok(JSON.stringify(ep).includes("Devam et"));
      const retry = find(m, "series-info:single:retry");
      assert.ok(retry);
      retry.props.onPress();
      assert.equal(R.retried, true);
      modalProps.loading = true;
      m = modal();
      assert.ok(nodes(m).some((n) => n.type === "ActivityIndicator"));
      H.cleanup("modal");
    },
  );
  const stalkerProvider = { ...provider, type: "stalker", mac: "private-mac" };
  const portalCalls = [];
  R.session = {
    request: async (params) => {
      portalCalls.push(params);
      if (params.action === "get_categories")
        return { js: [{ id: "cat", title: "Portal dizileri" }] };
      return {
        js: {
          data: [{ id: "show", name: "Portal show" }],
          cur_page: 1,
          total_items: 1,
          max_page_items: 20,
        },
      };
    },
  };
  const stalkerProps = { ...props, provider: stalkerProvider };
  const stalker = () =>
    render("stalker", () => ui.EliteV4StalkerSeries(stalkerProps));
  await check(
    "Stalker uses real session categories pages and explicitly loaded-subset sort",
    async () => {
      stalker();
      await settle();
      stalker();
      await new Promise((r) => setTimeout(r, 10));
      await settle();
      let v = stalker();
      assert.equal(v.props.items[0].id, "show");
      assert.equal(v.props.items[0].input.identity.provider, "stalker");
      assert.equal(v.props.categories[0].id, "cat");
      assert.equal(v.props.hasMore, false);
      assert.equal(v.props.partialSort, true);
      assert.equal(portalCalls[1].type, "series");
      assert.equal(portalCalls[1].category, "cat");
      v.props.onSort("alphaAsc");
      v = stalker();
      assert.equal(v.props.sort, "alphaAsc");
    },
  );
  await check(
    "Stalker refresh cannot race an old category page; unsupported hierarchy remains empty",
    async () => {
      stalker().props.onReload();
      stalker();
      await settle();
      stalker();
      await new Promise((r) => setTimeout(r, 10));
      await settle();
      assert.equal(stalker().props.items[0].id, "show");
      const item = ui.v4StalkerSeries("p", "safe", [
        { id: "show", title: "Portal show" },
      ])[0];
      const controller = ui.createStalkerSeriesProductController(
        R.session,
        "p",
      );
      const dp = { ...stalkerProps, item, controller, close: () => {} };
      const run = () =>
        render("stalker-empty", () => ui.EliteV4StalkerSeriesDetail(dp));
      run();
      await settle();
      const d = run();
      assert.equal(d.props.detail.seasons.length, 0);
      const before = played.length;
      d.props.onEpisode("1", "fake");
      await settle();
      assert.equal(played.length, before);
      H.cleanup("stalker-empty");
    },
  );
  await check(
    "Stalker exact season episode reaches existing create_link and rejects stale resolver after close",
    async () => {
      const item = ui.v4StalkerSeries("p", "safe", [
        { id: "show", title: "Portal show" },
      ])[0];
      const calls = [];
      const controller = {
        loadDetail: async () => ({
          seriesId: "show",
          title: "Portal show",
          seasons: [
            {
              id: "s-2",
              label: "İki",
              episodes: [{ id: "e-9", label: "Dokuz" }],
            },
          ],
        }),
        resolveEpisode: async (...args) => {
          calls.push(args);
          return "https://play.invalid/portal";
        },
        clear: () => {},
      };
      const dp = {
        ...stalkerProps,
        item,
        controller,
        close: () => (R.stalkerClosed = true),
      };
      const run = () =>
        render("stalker-detail", () => ui.EliteV4StalkerSeriesDetail(dp));
      run();
      await settle();
      let v = run();
      const before = played.length;
      v.props.onEpisode("s-2", "e-9");
      v.props.onEpisode("s-2", "e-9");
      await settle();
      assert.equal(played.length, before + 1);
      assert.deepEqual(calls[0].slice(0, 3), ["show", "s-2", "e-9"]);
      assert.deepEqual(played.at(-1).progressRef, {
        type: "stalker-episode",
        seriesId: "show",
        seasonId: "s-2",
        episodeId: "e-9",
      });
      dp.active = false;
      run();
      dp.active = true;
      run();
      const pending = defer();
      controller.resolveEpisode = () => pending.promise;
      v = run();
      v.props.onEpisode("s-2", "e-9");
      v.props.onClose();
      pending.resolve("https://play.invalid/late");
      await settle();
      assert.equal(played.length, before + 1);
      H.cleanup("stalker-detail");
    },
  );
  await check(
    "Sidebar and actual Shell route Series, use episode progress and return without focusing behind modal",
    () => {
      R.player.provider = provider;
      let shell = render("shell", () =>
        ui.EliteV4TvShell({ onReturnToV3: () => assert.fail("V3") }),
      );
      const child = shell.props.children[0];
      const run = () => render("shell-content", () => child.type(child.props));
      let tree = run();
      const sidebar = nodes(tree).find((n) => n.type === ui.EliteV4Sidebar);
      sidebar.props.onNavigate("series");
      tree = run();
      let series = nodes(tree).find((n) => n.type === ui.EliteV4SeriesCatalog);
      assert.ok(series);
      const value = {
        providerId: "p",
        url: "https://play.invalid/series",
        title: "Pilot",
        subtitle: "Show",
        progressRef: { type: "m3u-episode", itemId: "ep-1" },
      };
      series.props.onPlayable(value);
      tree = run();
      const player = nodes(tree).find((n) => n.type === "NativeVideoPlayer");
      assert.equal(player.props.mediaKind, "episode");
      assert.equal(player.props.progressRef, value.progressRef);
      const restored = R.restored.length;
      player.props.onFullscreenExit();
      run();
      assert.equal(R.restored.length, restored);
      series.props.onBack();
      run();
      series.props.onPlayable(value);
      tree = run();
      assert.equal(
        nodes(tree).some((n) => n.type === "NativeVideoPlayer"),
        false,
      );
      const nav = [];
      const side = render("sidebar", () =>
        ui.EliteV4Sidebar({
          onReturnToV3: () => assert.fail("V3"),
          onNavigate: (v) => nav.push(v),
          activeId: "sidebar-series",
          contentFocusId: "v4-series-hero",
        }),
      );
      find(side, "sidebar-series").props.onPress();
      assert.deepEqual(nav, ["series"]);
      assert.equal(
        find(side, "sidebar-series").props.neighbors.right,
        "v4-series-hero",
      );
    },
  );
  await check(
    "production BACK closes search before Home; modal and Player retain ownership; loading/error/empty are reachable",
    () => {
      viewProps.scope = "final";
      let v = view();
      find(v, "v4-series-search").props.onPress();
      v = view();
      R.back();
      v = view();
      R.back();
      assert.ok(R.home > 0);
      viewProps.items = [];
      viewProps.loading = true;
      v = view();
      assert.ok(nodes(v).some((n) => n.type === "ActivityIndicator"));
      viewProps.loading = false;
      viewProps.error = true;
      v = view();
      find(v, "v4-series-status").props.onPress();
      assert.ok(R.reload > 0);
      viewProps.error = false;
      v = view();
      assert.ok(JSON.stringify(v).includes("Bu kategoride dizi bulunmuyor"));
      viewProps.active = false;
      view();
      assert.equal(R.back, null);
    },
  );
  await check(
    "existing Stalker controller carries opaque command and exact episode ID into create_link",
    async () => {
      const calls = [];
      const previous = R.session;
      R.session = {
        request: async (params) => {
          calls.push(params);
          if (params.action === "create_link")
            return { js: { cmd: "ffmpeg https://play.invalid/actual-portal" } };
          return {
            js: {
              data: [
                {
                  season_id: "02",
                  name: "Sezon 2",
                  cmd: "opaque-provider-cmd",
                  series: [
                    {
                      episode_id: "009",
                      name: "Provider episode",
                      episode_num: 9,
                    },
                  ],
                },
              ],
            },
          };
        },
      };
      const item = ui.v4StalkerSeries("p", "session-safe-1", [
        { id: "series-A", title: "Real portal DTO" },
      ])[0];
      const controller = ui.createStalkerSeriesProductController(
        R.session,
        "p",
      );
      const dp = { ...stalkerProps, item, controller, close: () => {} };
      const run = () =>
        render("actual-stalker-detail", () =>
          ui.EliteV4StalkerSeriesDetail(dp),
        );
      run();
      await settle();
      let v = run();
      assert.equal(v.props.detail.seasons[0].id, "02");
      v.props.onEpisode("02", "009");
      await settle();
      assert.deepEqual(calls.at(-1), {
        type: "vod",
        action: "create_link",
        cmd: "opaque-provider-cmd",
        series: "009",
      });
      assert.equal(played.at(-1).url, "https://play.invalid/actual-portal");
      assert.equal(played.at(-1).progressRef.episodeId, "009");
      H.cleanup("actual-stalker-detail");
      R.session = previous;
    },
  );
  await check(
    "TMDB season metadata fills explicit provider ordinals only and suppresses old season response",
    async () => {
      const previous = process.env.EXPO_PUBLIC_TMDB_API_TOKEN;
      process.env.EXPO_PUBLIC_TMDB_API_TOKEN = "test-public-token";
      R.seasonReads = [];
      const first = defer(),
        second = defer();
      R.seasonLookup = (_token, _id, number) =>
        number === 1 ? first.promise : second.promise;
      const gp = {
        id: "metadata-detail",
        title: "Provider show",
        seasons: [
          {
            id: "1",
            label: "Bir",
            seasonNumber: 1,
            episodes: [
              {
                id: "provider-1",
                seasonId: "1",
                episodeNumber: 1,
                title: "Provider title",
              },
            ],
          },
          {
            id: "2",
            label: "İki",
            seasonNumber: 2,
            episodes: [
              {
                id: "provider-2",
                seasonId: "2",
                episodeNumber: 2,
                title: "Provider second",
              },
            ],
          },
        ],
      };
      const mp = {
        ...modalProps,
        detail: gp,
        loading: false,
        error: null,
        metadataInput: cards[0].input,
      };
      const run = () => render("season-metadata", () => ui.SeriesInfoModal(mp));
      run();
      R.enrich.at(-1).callback({
        status: "enriched",
        metadata: {
          kind: "series",
          id: 88,
          genres: [],
          cast: [],
          directors: [],
          seasons: [],
        },
      });
      let m = run();
      flats(m)[0]
        .props.renderItem({ item: gp.seasons[0], index: 0 })
        .props.onPress();
      m = run();
      assert.deepEqual(R.seasonReads.at(-1).slice(1), [88, 1, "tr-TR"]);
      flats(m)[0]
        .props.renderItem({ item: gp.seasons[1], index: 1 })
        .props.onPress();
      m = run();
      second.resolve({
        season: 2,
        episodes: [
          {
            id: 99,
            number: 2,
            title: "TMDB title",
            overview: "Correct metadata",
            stillPath: "/still.jpg",
          },
          { id: 100, number: 3, title: "Unowned episode" },
        ],
      });
      await settle();
      m = run();
      assert.equal(flats(m)[1].props.data.length, 1);
      assert.equal(flats(m)[1].props.data[0].id, "provider-2");
      assert.equal(flats(m)[1].props.data[0].title, "Provider second");
      assert.equal(flats(m)[1].props.data[0], gp.seasons[1].episodes[0]);
      assert.ok(
        JSON.stringify(
          flats(m)[1].props.renderItem({
            item: flats(m)[1].props.data[0],
            index: 0,
          }),
        ).includes("Correct metadata"),
      );
      first.resolve({
        season: 1,
        episodes: [
          { number: 1, title: "Stale", overview: "Wrong old description" },
        ],
      });
      await settle();
      m = run();
      assert.equal(flats(m)[1].props.data[0], gp.seasons[1].episodes[0]);
      assert.ok(
        JSON.stringify(
          flats(m)[1].props.renderItem({
            item: flats(m)[1].props.data[0],
            index: 0,
          }),
        ).includes("Correct metadata"),
      );
      H.cleanup("season-metadata");
      if (previous === undefined) delete process.env.EXPO_PUBLIC_TMDB_API_TOKEN;
      else process.env.EXPO_PUBLIC_TMDB_API_TOKEN = previous;
    },
  );
  await check(
    "V4 modal reopening preserves actual season and episode while V3 keeps legacy focus styling",
    () => {
      const mp = { ...modalProps, loading: false, error: null, detail: golden };
      const run = () =>
        render("remembered-detail", () => ui.SeriesInfoModal(mp));
      let m = run();
      m = run();
      flats(m)[0]
        .props.renderItem({ item: golden.seasons[1], index: 1 })
        .props.onPress();
      m = run();
      flats(m)[1]
        .props.renderItem({ item: golden.seasons[1].episodes[0], index: 0 })
        .props.onPress();
      run();
      H.cleanup("remembered-detail");
      run();
      m = run();
      assert.equal(flats(m)[1].props.data[0].id, "ep-2");
      assert.equal(
        flats(m)[1].props.renderItem({
          item: golden.seasons[1].episodes[0],
          index: 0,
        }).props.hasTVPreferredFocus,
        true,
      );
      H.cleanup("remembered-detail");
      const legacy = render("legacy-detail", () =>
        ui.SeriesInfoModal({ ...mp, variant: undefined }),
      );
      const back = find(legacy, "series-info:detail-p:back");
      assert.equal(back.props.focusVisualStyle, undefined);
      assert.equal(back.props.style.borderWidth, 4);
      H.cleanup("legacy-detail");
    },
  );
  await check(
    "changing selected series discards old asynchronous hierarchy and only current series can play",
    async () => {
      const old = defer();
      R.loadInfo = (id) =>
        id === "1" ? old.promise : Promise.resolve(hierarchy);
      const dp = { ...detailProps, active: true, item: cards[0] };
      const run = () =>
        render("race-detail", () => ui.EliteV4PagedSeriesDetail(dp));
      run();
      dp.item = cards[1];
      run();
      await settle();
      let d = run();
      old.resolve({
        episodes: { 9: [{ id: "stale-episode", title: "Stale" }] },
      });
      await settle();
      d = run();
      assert.equal(d.props.detail.id, JSON.stringify(["p", "2"]));
      assert.equal(
        d.props.detail.seasons.some((s) => s.id === "9"),
        false,
      );
      H.cleanup("race-detail");
      R.loadInfo = async () => hierarchy;
    },
  );
  assert.equal(checks, 22);
  console.log(
    `Elite V4 Series production host: ${checks}/22 passed; HOST_NOT_PHYSICAL`,
  );
} finally {
  rmSync(out, { recursive: true, force: true });
}
