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
const out = mkdtempSync(join(tmpdir(), "elite-v4-movies-"));
const react = `
const frames=new Map();let frame;
export const Host={render(key,fn){if(!frames.has(key))frames.set(key,{values:[],cursor:0,effects:[],pending:[]});frame=frames.get(key);frame.cursor=0;return fn();},commit(key){const f=frames.get(key);for(const run of f.pending.splice(0))run();},cleanup(key){for(const effect of frames.get(key)?.effects??[])effect?.cleanup?.();frames.delete(key);}};
export function useState(initial){const f=frame,i=f.cursor++;if(!(i in f.values))f.values[i]=typeof initial==='function'?initial():initial;return[f.values[i],v=>{f.values[i]=typeof v==='function'?v(f.values[i]):v;}];}
export function useRef(initial){const f=frame,i=f.cursor++;if(!(i in f.values))f.values[i]={current:initial};return f.values[i];}
export function useEffect(run,deps){const f=frame,i=f.cursor++,old=f.effects[i];if(old&&deps&&old.deps&&deps.length===old.deps.length&&deps.every((v,i)=>v===old.deps[i]))return;f.effects[i]={deps,cleanup:old?.cleanup};f.pending.push(()=>{f.effects[i].cleanup?.();f.effects[i].cleanup=run();});}
export function useMemo(fn){return fn();}export function useCallback(fn){return fn;}
export function createContext(value){const c={_value:value};c.Provider={_context:c};return c;}export function useContext(c){return c._value;}
export function createElement(type,props,...children){return{type,props:{...props,children}};}
export class Component{constructor(props){this.props=props;}setState(value){this.state={...this.state,...value};}}
export default{Component,createElement,useState,useRef,useEffect,useMemo,useCallback,createContext,useContext};`;
const runtime = `export const Runtime={player:null,sync:null,page:null,queries:[],categories:[],categoryReads:[],epgSeeds:[],resolves:[],watched:[],restored:[],back:null,nativeBack:null,playerOwnsBack:false,previewEnabled:true,isTV:false,width:1280,resolve:async()=>({url:'https://stream.example/live'})};`;
try {
  await build({
    stdin: {
      contents: `export {Host} from 'react';export {Runtime} from 'live-runtime';export {EliteV4MoviesCatalog,EliteV4MoviesView,EliteV4MoviesHero,EliteV4MovieBoundary} from './components/eliteV4/EliteV4MoviesCatalog';export {v4PagedMovies,v4StalkerMovies,v4MoviesLayout} from './lib/eliteV4Movies';export {EliteV4TvShell} from './components/eliteV4/EliteV4TvShell';export {EliteV4Sidebar} from './components/eliteV4/EliteV4Sidebar';export {EliteV4FocusSurface,EliteV4FocusButton} from './components/eliteV4/EliteV4FocusSurface';`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "movies.cjs"),
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
            "@/context/MediaLibraryContext": `export const useMediaLibrary=()=>({entries:[],historyEntries:[],loaded:true});`,
            "./EliteV4LibraryCatalog": `export const EliteV4LibraryCatalog='Library';`,
            "./EliteV4LibraryDetail": `export const EliteV4LibraryDetail='LibraryDetail';`,
            "@/lib/eliteV4Library": `export const continueWatching=()=>[],favoriteForProgress=()=>null,progressCaption=()=>'',resolveLibraryProgress=async()=>'',resolveLibraryMovie=async()=>'';`,

            "./EliteV4SeriesCatalog": `export const EliteV4SeriesCatalog='Series';`,
            "./EliteV4LiveCatalog": `export const EliteV4LiveCatalog='Live';`,
            "expo-linear-gradient": `export const LinearGradient='Gradient';`,
            "@/components/tmdb/MovieInfoModal": `export const MovieInfoModal='MovieInfoModal';`,
            "@/components/tmdb/MovieInfoServiceProvider": `export function useMovieInfoService(){return {};}`,
            "@/lib/tmdb/movieInfoService": `import {Runtime} from 'live-runtime';export function beginMovieEnrichment(service,input,callback){const entry={input,callback,cancelled:false};Runtime.enrich.push(entry);return()=>{entry.cancelled=true;};}`,
            "@/hooks/useStalkerMoviesCatalog": `import {Runtime} from 'live-runtime';export function useStalkerMoviesCatalog(options){Runtime.stalkerOptions=options;return Runtime.stalker;}`,
            "@/lib/stalkerProductSession": `import {Runtime} from 'live-runtime';export function readCurrentStalkerProductSession(){return{providerScopeId:Runtime.sessionScope??'session-safe-1'};}export function isCurrentStalkerProductSession(){return true;}`,
            react,
            "live-runtime": runtime,
            "react-native": `import {Runtime} from 'live-runtime';export const View='View',Text='Text',Image='Image',ImageBackground='ImageBackground',ScrollView='ScrollView',FlatList='FlatList',TextInput='TextInput',ActivityIndicator='ActivityIndicator',Pressable='Pressable';export const Platform={get isTV(){return Runtime.isTV;}};export function useWindowDimensions(){return{width:Runtime.width,height:Runtime.height??720,fontScale:Runtime.fontScale??1};}export function findNodeHandle(ref){return ref?.handle??null;}export const BackHandler={addEventListener(_,fn){Runtime.nativeBack=fn;return{remove(){Runtime.nativeBack=null;}}}};`,
            "@expo/vector-icons": `export const Feather='Icon';`,
            "@/context/PlayerContext": `import {Runtime} from 'live-runtime';export function usePlayer(){return Runtime.player;}export function selectProgramsAt(programs,clock){return{now:programs?.find(p=>p.start<=clock&&p.end>clock)};}`,
            "@/context/CatalogSyncContext": `import {Runtime} from 'live-runtime';export function useCatalogSync(){return Runtime.sync;}`,
            "@/hooks/useCatalogPage": `import {Runtime} from 'live-runtime';export function useCatalogPage(query){Runtime.queries.push(query);return Runtime.page;}`,
            "@/lib/catalogPageRepository": `import {Runtime} from 'live-runtime';export async function getCachedCatalogCategories(...args){Runtime.categoryReads.push(args);return Runtime.categories;}`,
            "@/lib/epgRuntime": `import {Runtime} from 'live-runtime';export const EPG_PAGED_SEED_LIMIT=40;export function registerEpgChannels(providerId,items){Runtime.epgSeeds.push({providerId,items});}`,
            "@/lib/playerRemoteOwnership": `import {Runtime} from 'live-runtime';export function hasPlayerBackOwner(){return Runtime.playerOwnsBack;}`,
            "@/lib/imageUrl": `export function normalizeImageUrl(value){return value||null;}`,
            "@/components/tvPreview/TVPreviewFocus": `import {Runtime} from 'live-runtime';const restoreFocus=async id=>{Runtime.restored.push(id);return true;};const registerBackAction=fn=>{Runtime.back=fn;return()=>{Runtime.back=null;};};export function useOptionalTVPreviewFocus(){return{enabled:Runtime.previewEnabled,restoreFocus,registerBackAction};}export const TVPreviewPressable='PreviewPressable';`,
            "@react-native-async-storage/async-storage": `export default{getItem:async()=>null};`,
            "@/components/NativeVideoPlayer": `export const NativeVideoPlayer='NativeVideoPlayer';`,
            "@/lib/catalogRuntime": `import {Runtime} from 'live-runtime';export function resolveCatalogPlaybackSource(...args){Runtime.resolves.push(args);return Runtime.resolve(...args);}export async function resolveCatalogRuntimeSource(source,provider,signal){Runtime.runtimeResolves??=[];Runtime.runtimeResolves.push({source,provider,signal});return (await Runtime.resolve({kind:"live",item:{streamUrl:source}},provider,signal)).url;}`,
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
  const ui = req(join(out, "movies.cjs"));
  const { Runtime: R, Host: H } = ui;
  globalThis.requestAnimationFrame = (fn) => {
    fn();
    return 1;
  };
  R.enrich = [];
  R.isTV = true;
  const focusElement = H.render("focus", () =>
    ui.EliteV4FocusSurface({ children: null }),
  );
  focusElement.type._context._value = focusElement.props.value;
  const focus = focusElement.props.value;
  const nodes = (n, result = []) => {
    if (Array.isArray(n)) {
      n.forEach((v) => nodes(v, result));
      return result;
    }
    if (!n || typeof n !== "object") return result;
    result.push(n);
    nodes(n.props?.children, result);
    return result;
  };
  const find = (n, id) => nodes(n).find((v) => v.props?.focusId === id);
  const flat = (n) => nodes(n).find((v) => v.type === "FlatList");
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  let checks = 0;
  const check = async (name, fn) => {
    await fn();
    checks++;
    console.log(`PASS V4 Movies ${checks} - ${name}`);
  };
  const raw = Array.from({ length: 123 }, (_, i) => ({
    stream_id: i + 1,
    name: `Sağlayıcı Film ${i + 1}`,
    stream_icon: `https://img.example/${i}.jpg`,
    releaseDate: "2025",
    container_extension: "mp4",
  }));
  const provider = {
    id: "p",
    type: "xtream",
    url: "https://provider.example",
    name: "Provider",
  };
  R.player = { provider, channels: [], recordWatched: async () => {} };
  R.sync = {
    snapshot: {
      providerId: "p",
      ready: true,
      counts: { vod: 123 },
      live: [],
      movies: raw.slice(0, 24),
      series: [],
      newMovies: [],
    },
    lastSuccessfulAt: 77,
    hasUsableCache: true,
    isSyncing: false,
  };
  let more = 0,
    reload = 0,
    played = [],
    back = 0;
  R.page = {
    items: raw,
    totalCount: 123,
    countKnown: true,
    loadingInitial: false,
    loadingMore: false,
    hasMore: true,
    error: null,
    loadMore: () => more++,
    reload: () => reload++,
  };
  R.categories = [{ category_id: "action", category_name: "Aksiyon" }];
  const catalogProps = {
    onPlay: (movie, origin) => played.push({ movie, origin }),
    onStalkerPlayable: (movie, origin) => played.push({ movie, origin }),
    onBack: () => back++,
  };
  const adapter = (key = "paged") => {
    const element = H.render(`catalog-${key}`, () =>
      ui.EliteV4MoviesCatalog(catalogProps),
    );
    const child =
      element.type === ui.EliteV4MovieBoundary
        ? element.props.children[0]
        : element;
    return H.render(key, () => child.type(child.props));
  };
  let movieRows = ui.v4PagedMovies("p", "xtream", "77", raw);
  const props = {
    items: movieRows,
    categories: [
      { id: "__all__", name: "Tümü" },
      { id: "action", name: "Aksiyon" },
    ],
    category: "__all__",
    onCategory: (id) => (R.chosen = id),
    search: "",
    onSearch: (value) => (R.search = value),
    sort: "default",
    onSort: (value) => (R.sort = value),
    supportsAdded: true,
    loading: false,
    loadingMore: false,
    hasMore: true,
    error: false,
    count: 123,
    scope: "query-1",
    onMore: () => more++,
    onReload: () => reload++,
    onPlay: catalogProps.onPlay,
    onBack: () => back++,
    active: true,
  };
  const view = (next = props, key = "view") =>
    H.render(key, () => ui.EliteV4MoviesView(next));
  await check(
    "Xtream and M3U render full paged provider DTOs with correct identity",
    async () => {
      for (const type of ["xtream", "m3u"]) {
        R.player.provider = { ...provider, type };
        let tree = adapter(type);
        H.commit(type);
        await flush();
        tree = adapter(type);
        assert.equal(tree.props.items.length, 123);
        assert.equal(tree.props.items[122].source.item, raw[122]);
        assert.equal(tree.props.items[0].input.identity.provider, type);
        assert.equal(R.queries.at(-1).kind, "vod");
        assert.deepEqual(R.categoryReads.at(-1), ["p", "vod", type === "m3u"]);
        assert.ok(tree.props.categories.some((c) => c.id === "action"));
        assert.equal(tree.props.supportsAdded, type === "xtream");
      }
      R.player.provider = provider;
    },
  );
  await check(
    "category search and sort remain provider queries rather than local Home filtering",
    () => {
      let tree = adapter();
      tree.props.onCategory("action");
      tree = adapter();
      tree.props.onSearch("Film");
      tree = adapter();
      tree.props.onSort("alphaDesc");
      adapter();
      const q = R.queries.at(-1);
      assert.equal(q.categoryId, "action");
      assert.equal(q.search, "Film");
      assert.equal(q.sort, "alphaDesc");
      assert.equal(q.snapshotCount, undefined);
    },
  );
  await check(
    "Stalker consumes the existing session hook, real categories and loaded-subset sorting",
    () => {
      const items = [
        {
          portalId: "9",
          title: "Zeta",
          cmd: "secret cmd",
          categoryId: "actual",
        },
        {
          portalId: "2",
          title: "Alfa",
          cmd: "other cmd",
          categoryId: "actual",
        },
      ];
      R.stalker = {
        categories: [{ id: "actual", title: "Gerçek kategori" }],
        selectedCategoryId: "actual",
        visibleItems: items,
        totalItems: 2,
        search: "",
        loadingInitial: false,
        loadingMore: false,
        searching: false,
        error: null,
        resolvingItemId: null,
        selectCategory: (id) => (R.chosen = id),
        setSearch: (value) => (R.search = value),
        refresh: async () => {},
        loadMore: () => more++,
        openMovie: async (item) => (R.stalkerOpened = item),
      };
      R.player.provider = {
        ...provider,
        type: "stalker",
        mac: "sensitive-mac",
      };
      let tree = adapter("stalker");
      tree.props.onSort("alphaAsc");
      tree = adapter("stalker");
      assert.equal(tree.props.items[0].title, "Alfa");
      assert.equal(tree.props.items[0].source.item, items[1]);
      assert.equal(tree.props.categories[0].id, "actual");
      assert.equal(tree.props.partialSort, true);
      assert.equal(tree.props.hasMore, false);
      assert.ok(!tree.props.scope.includes("sensitive-mac"));
      assert.ok(!tree.props.scope.includes(provider.url));
      tree.props.onPlay(tree.props.items[0], "v4-movies-card:2");
      assert.equal(R.stalkerOpened, items[1]);
      R.stalkerOptions.onPlayable({
        itemId: "2",
        url: "https://stream.example/stalker",
        title: "Alfa",
      });
      assert.equal(played.at(-1).origin, "v4-movies-card:2");
      const stale = R.stalkerOptions.onPlayable;
      R.stalker = { ...R.stalker, search: "changed" };
      adapter("stalker");
      const before = played.length;
      stale({ itemId: "2", url: "https://stream.example/stale" });
      assert.equal(played.length, before);
      R.player.provider = provider;
    },
  );
  await check(
    "invalid provider credentials and session failures show safe V4 states",
    () => {
      for (const p of [
        { id: "x", type: "unknown" },
        { ...provider, type: "stalker", mac: "" },
      ]) {
        R.player.provider = p;
        const tree = H.render("unsupported", () =>
          ui.EliteV4MoviesCatalog(catalogProps),
        );
        const notice = H.render("unsupported-notice", () =>
          tree.type(tree.props),
        );
        assert.ok(find(notice, "v4-movies-hero"));
        assert.ok(
          nodes(notice).some(
            (n) =>
              n.type === "Text" &&
              String(n.props.children).includes("kullanılamıyor"),
          ),
        );
      }
      const boundary = new ui.EliteV4MovieBoundary({ onBack: () => back++ });
      boundary.state = ui.EliteV4MovieBoundary.getDerivedStateFromError(
        Error("secret"),
      );
      const fallback = boundary.render();
      const failed = H.render("session-error", () =>
        fallback.type(fallback.props),
      );
      H.commit("session-error");
      const beforeBack = back;
      R.nativeBack();
      assert.equal(back, beforeBack + 1);
      H.cleanup("session-error");
      assert.ok(find(failed, "v4-movies-hero"));
      assert.ok(!JSON.stringify(failed).includes("secret"));
      R.player.provider = provider;
    },
  );
  await check(
    "responsive production grid prioritizes readable cards and font scaling",
    () => {
      for (const [width, height, scale, tv] of [
        [1920, 1080, 1, true],
        [960, 540, 1, true],
        [800, 480, 2, true],
        [393, 873, 1, false],
      ]) {
        const g = ui.v4MoviesLayout(width, height, scale, tv);
        assert.ok(g.columns >= 1 && g.columns <= 6);
        assert.ok(
          g.cardWidth >= Math.min(width - 2 * g.padding, tv ? 176 : 132),
        );
        assert.ok(
          g.columns * g.cardWidth + (g.columns - 1) * g.gap <=
            width - 2 * g.padding,
        );
        assert.ok(g.heroHeight <= 280);
        assert.ok(g.captionHeight >= 42 * scale + 20);
      }
    },
  );
  await check(
    "real Grid focus graph links Sidebar Hero and neighboring rows",
    () => {
      const tree = view();
      const list = flat(tree);
      const row0 = list.props.renderItem({
        item: list.props.data[0],
        index: 0,
      });
      const row1 = list.props.renderItem({
        item: list.props.data[1],
        index: 1,
      });
      const first = find(row0, "v4-movies-card:1");
      const caption = nodes(first).find((n) => n.type === "Text");
      assert.equal(caption.props.style.fontSize, 18);
      assert.equal(caption.props.style.lineHeight, 24);
      assert.equal(first.props.neighbors.left, "sidebar-movies");
      assert.equal(first.props.neighbors.up, "v4-movies-hero");
      assert.equal(first.props.neighbors.right, "v4-movies-card:2");
      assert.equal(first.props.neighbors.down, "v4-movies-card:7");
      assert.equal(
        find(row1, "v4-movies-card:7").props.neighbors.up,
        "v4-movies-card:1",
      );
      const scroll = [];
      list.props.ref.current = {
        scrollToOffset: (entry) => scroll.push(entry),
      };
      list.props.ListHeaderComponent.props.onLayout({
        nativeEvent: { layout: { height: 400 } },
      });
      find(row1, "v4-movies-card:7").props.onFocused();
      assert.deepEqual(scroll, [{ offset: 736, animated: true }]);
    },
  );
  await check(
    "poster OK opens actual Movie Info contract; close restores the same card",
    () => {
      let tree = view();
      let list = flat(tree);
      const row = list.props.renderItem({ item: list.props.data[0], index: 0 });
      find(row, "v4-movies-card:2").props.onPress();
      tree = view();
      const modal = nodes(tree).find((n) => n.type === "MovieInfoModal");
      assert.equal(modal.props.input.identity.catalogId, "2");
      assert.equal(modal.props.input.identity.provider, "xtream");
      assert.equal(modal.props.local.title, raw[1].name);
      assert.equal(modal.props.focusVisualStyle.borderWidth, 1);
      const before = played.length;
      assert.equal(played.length, before);
      R.previewEnabled = true;
      const previewFocus = H.render("preview-focus", () =>
        ui.EliteV4FocusSurface({ children: null }),
      );
      previewFocus.type._context._value = previewFocus.props.value;
      R.isTV = false;
      modal.props.onClose();
      assert.ok(R.restored.includes("elite-v4:v4-movies-card:2"));
      R.isTV = true;
      focusElement.type._context._value = focus;
    },
  );
  await check(
    "Info Play uses refreshed provider DTO and rejects stale query callbacks",
    () => {
      let tree = view(props, "info-play");
      let list = flat(tree);
      find(
        list.props.renderItem({ item: list.props.data[0], index: 0 }),
        "v4-movies-card:1",
      ).props.onPress();
      tree = view(props, "info-play");
      const modal = nodes(tree).find((n) => n.type === "MovieInfoModal");
      const before = played.length;
      view({ ...props, scope: "query-2" }, "info-play");
      modal.props.onPlay();
      assert.equal(played.length, before);
      tree = view(props, "info-fresh");
      list = flat(tree);
      find(
        list.props.renderItem({ item: list.props.data[0], index: 0 }),
        "v4-movies-card:1",
      ).props.onPress();
      const refreshed = {
        ...movieRows[0],
        title: "Updated",
        source: { kind: "paged", item: { ...raw[0], name: "Updated" } },
      };
      tree = view(
        { ...props, items: [refreshed, ...movieRows.slice(1)] },
        "info-fresh",
      );
      nodes(tree)
        .find((n) => n.type === "MovieInfoModal")
        .props.onPlay();
      assert.equal(played.at(-1).movie, refreshed);
    },
  );
  await check(
    "Hero enrichment is metadata only, keyed and cannot inject playable TMDB titles",
    () => {
      const h = {
        movie: movieRows[0],
        height: 216,
        nextFocusId: "v4-movies-card:1",
        onInfo: () => {},
        onPlay: () => {},
        onFocused: () => {},
        disabled: false,
      };
      H.render("hero", () => ui.EliteV4MoviesHero(h));
      H.commit("hero");
      const request = R.enrich.at(-1);
      request.callback({
        status: "enriched",
        metadata: {
          kind: "movie",
          title: "Unowned TMDB title",
          backdropPath: "/backdrop.jpg",
          overview: "Zengin özet",
          voteAverage: 8,
          genres: [],
          cast: [],
          directors: [],
          similar: [{ id: 999, kind: "movie" }],
        },
      });
      let tree = H.render("hero", () => ui.EliteV4MoviesHero(h));
      assert.ok(
        nodes(tree).some(
          (n) => n.type === "Text" && n.props.children.includes(raw[0].name),
        ),
      );
      assert.ok(
        nodes(tree).some(
          (n) => n.type === "Text" && n.props.children.includes("Zengin özet"),
        ),
      );
      assert.ok(
        nodes(tree).some(
          (n) =>
            n.type === "ImageBackground" &&
            n.props.source.uri.includes("/backdrop.jpg"),
        ),
      );
      tree = H.render("hero", () =>
        ui.EliteV4MoviesHero({ ...h, movie: movieRows[1] }),
      );
      assert.ok(!JSON.stringify(tree).includes("Zengin özet"));
      assert.equal(props.items.length, 123);
    },
  );
  await check(
    "category reveal, search and sort callbacks come from production controls",
    () => {
      let tree = view(props, "controls");
      const header = flat(tree).props.ListHeaderComponent;
      const strip = nodes(header).find((n) => n.type === "ScrollView");
      const scroll = [];
      strip.props.ref.current = { scrollTo: (entry) => scroll.push(entry) };
      const chip = find(header, "v4-movies-category:action");
      chip.props.onLayout({ nativeEvent: { layout: { x: 700 } } });
      chip.props.onFocused();
      chip.props.onPress();
      assert.deepEqual(scroll, [{ x: 694, animated: true }]);
      assert.equal(R.chosen, "action");
      find(header, "v4-movies-sort").props.onPress();
      assert.equal(R.sort, "alphaAsc");
      find(header, "v4-movies-search").props.onPress();
      tree = view(props, "controls");
      nodes(flat(tree).props.ListHeaderComponent)
        .find((n) => n.type === "TextInput")
        .props.onChangeText("Test");
      assert.equal(R.search, "Test");
    },
  );
  await check(
    "loading pagination error and empty results retain bounded recovery actions",
    () => {
      more = 0;
      flat(view(props, "more")).props.onEndReached();
      assert.equal(more, 1);
      for (const patch of [
        { loading: true },
        { loadingMore: true },
        { hasMore: false },
        { error: true },
        { active: false },
      ])
        flat(
          view({ ...props, ...patch }, `guard-${JSON.stringify(patch)}`),
        ).props.onEndReached();
      assert.equal(more, 1);
      const failed = flat(view({ ...props, items: [], error: true }, "error"));
      find(
        failed.props.ListFooterComponent,
        "v4-movies-status",
      ).props.onPress();
      assert.equal(reload, 1);
      const empty = flat(
        view({ ...props, items: [], search: "missing" }, "empty"),
      );
      assert.ok(
        JSON.stringify(empty.props.ListEmptyComponent).includes(
          "Aramanıza uygun film bulunamadı.",
        ),
      );
      assert.ok(
        nodes(empty.props.ListHeaderComponent).some(
          (n) => n.type === ui.EliteV4MoviesHero,
        ),
      );
    },
  );
  await check(
    "BACK closes search, then returns Home; modal and Player retain ownership",
    () => {
      back = 0;
      let tree = view(props, "back");
      H.commit("back");
      find(
        flat(tree).props.ListHeaderComponent,
        "v4-movies-search",
      ).props.onPress();
      tree = view(props, "back");
      H.commit("back");
      R.nativeBack();
      assert.equal(back, 0);
      view(props, "back");
      H.commit("back");
      R.playerOwnsBack = true;
      assert.equal(R.nativeBack(), false);
      R.playerOwnsBack = false;
      R.nativeBack();
      assert.equal(back, 1);
      tree = view(props, "back");
      const list = flat(tree);
      find(
        list.props.renderItem({ item: list.props.data[0], index: 0 }),
        "v4-movies-card:1",
      ).props.onPress();
      view(props, "back");
      H.commit("back");
      assert.equal(R.nativeBack, null);
      assert.equal(R.back, null);
      H.cleanup("back");
    },
  );
  await check(
    "actual shell Movies navigation, playback identities and route guards are preserved",
    async () => {
      R.player.provider = provider;
      const wrapper = ui.EliteV4TvShell({
        onReturnToV3() {
          throw Error("unexpected V3");
        },
      });
      const element = wrapper.props.children[0];
      const shell = () => H.render("shell", () => element.type(element.props));
      let tree = shell();
      const sidebar = nodes(tree).find((n) => n.type === ui.EliteV4Sidebar);
      const sidebarTree = H.render("sidebar-to-movies", () =>
        sidebar.type(sidebar.props),
      );
      find(sidebarTree, "sidebar-movies").props.onPress();
      tree = shell();
      let movies = nodes(tree).find((n) => n.type === ui.EliteV4MoviesCatalog);
      assert.ok(movies);
      assert.equal(
        nodes(tree).find((n) => n.type === ui.EliteV4Sidebar).props
          .contentFocusId,
        "v4-movies-hero",
      );
      movies.props.onPlay(movieRows[0], "v4-movies-card:1");
      await flush();
      tree = shell();
      let player = nodes(tree).find((n) => n.type === "NativeVideoPlayer");
      assert.ok(player);
      assert.deepEqual(player.props.vodIdentity, {
        providerId: "p",
        itemId: "1",
      });
      assert.equal(R.resolves.at(-1)[0].item, raw[0]);
      player.props.onFullscreenExit();
      tree = shell();
      movies = nodes(tree).find((n) => n.type === ui.EliteV4MoviesCatalog);
      R.player.provider = { ...provider, type: "stalker", mac: "mac" };
      tree = shell();
      movies = nodes(tree).find((n) => n.type === ui.EliteV4MoviesCatalog);
      movies.props.onStalkerPlayable(
        {
          url: "https://stream.example/resolved",
          title: "Stalker film",
          itemId: "s1",
        },
        "v4-movies-card:s1",
      );
      tree = shell();
      player = nodes(tree).find((n) => n.type === "NativeVideoPlayer");
      assert.equal(player.props.source, "https://stream.example/resolved");
      player.props.onFullscreenExit();
      tree = shell();
      movies = nodes(tree).find((n) => n.type === ui.EliteV4MoviesCatalog);
      movies.props.onBack();
      movies.props.onStalkerPlayable(
        { url: "https://stream.example/late", itemId: "late" },
        "old",
      );
      assert.equal(
        nodes(shell()).find((n) => n.type === "NativeVideoPlayer"),
        undefined,
      );
    },
  );
  await check(
    "APK build is suppressed only for marked branch pushes, not Quality or manual/tag delivery",
    () => {
      const workflow = readFileSync(
        resolve(app, "../../.github/workflows/android-apk.yml"),
        "utf8",
      );
      assert.match(
        workflow,
        /if: github.event_name != 'push' \|\| startsWith\(github.ref, 'refs\/tags\/'\) \|\| !contains\(github.event.head_commit.message, '\[skip apk\]'\)/,
      );
      const quality = readFileSync(
        resolve(app, "../../.github/workflows/quality.yml"),
        "utf8",
      );
      assert.ok(!quality.includes("[skip apk]"));
    },
  );
  assert.equal(checks, 14);
  console.log(
    `Elite V4 Movies production host: ${checks}/14 passed; HOST_NOT_PHYSICAL`,
  );
} finally {
  delete globalThis.requestAnimationFrame;
  rmSync(out, { recursive: true, force: true });
}
