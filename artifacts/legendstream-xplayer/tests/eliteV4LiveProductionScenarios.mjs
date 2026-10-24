import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(app, "package.json"));
const { build } = createRequire(resolve(app, "../api-server/package.json"))(
  "esbuild",
);
const out = mkdtempSync(join(tmpdir(), "elite-v4-live-"));
const react = `
const frames=new Map();let frame;
export const Host={render(key,fn){if(!frames.has(key))frames.set(key,{values:[],cursor:0,effects:[],pending:[]});frame=frames.get(key);frame.cursor=0;return fn();},commit(key){const f=frames.get(key);for(const run of f.pending.splice(0))run();},cleanup(key){for(const effect of frames.get(key)?.effects??[])effect?.cleanup?.();frames.delete(key);}};
export function useState(initial){const f=frame,i=f.cursor++;if(!(i in f.values))f.values[i]=typeof initial==='function'?initial():initial;return[f.values[i],v=>{f.values[i]=typeof v==='function'?v(f.values[i]):v;}];}
export function useRef(initial){const f=frame,i=f.cursor++;if(!(i in f.values))f.values[i]={current:initial};return f.values[i];}
export function useEffect(run,deps){const f=frame,i=f.cursor++,old=f.effects[i];if(old&&deps&&old.deps&&deps.length===old.deps.length&&deps.every((v,i)=>v===old.deps[i]))return;f.effects[i]={deps,cleanup:old?.cleanup};f.pending.push(()=>{f.effects[i].cleanup?.();f.effects[i].cleanup=run();});}
export function useMemo(fn){return fn();}export function useCallback(fn){return fn;}
export function createContext(value){const c={_value:value};c.Provider={_context:c};return c;}export function useContext(c){return c._value;}
export function createElement(type,props,...children){return{type,props:{...props,children}};}
export default{createElement,useState,useRef,useEffect,useMemo,useCallback,createContext,useContext};`;
const runtime = `export const Runtime={player:null,sync:null,page:null,queries:[],categories:[],categoryReads:[],epgSeeds:[],resolves:[],watched:[],restored:[],back:null,nativeBack:null,playerOwnsBack:false,previewEnabled:true,isTV:false,width:1280,resolve:async()=>({url:'https://stream.example/live'})};`;
try {
  await build({
    stdin: {
      contents: `export {Host} from 'react';export {Runtime} from 'live-runtime';export {EliteV4LiveCatalog,EliteV4LiveView} from './components/eliteV4/EliteV4LiveCatalog';export {EliteV4TvShell} from './components/eliteV4/EliteV4TvShell';export {EliteV4Sidebar} from './components/eliteV4/EliteV4Sidebar';export {EliteV4FocusSurface,EliteV4FocusButton} from './components/eliteV4/EliteV4FocusSurface';`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "live.cjs"),
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
            "@/lib/stalkerProductSession": `import {Runtime} from "live-runtime";export const readCurrentStalkerProductSession=()=>({session:Runtime.session}),isCurrentStalkerProductSession=(_p,s)=>s===Runtime.session;`,
            "@/context/MediaLibraryContext": `export const useMediaLibrary=()=>({entries:[],historyEntries:[],loaded:true});`,
            "./EliteV4LibraryCatalog": `export const EliteV4LibraryCatalog='Library';`,
            "./EliteV4LibraryDetail": `export const EliteV4LibraryDetail='LibraryDetail';`,
            "@/lib/eliteV4Library": `export const continueWatching=()=>[],favoriteForProgress=()=>null,progressCaption=()=>'',resolveLibraryProgress=async()=>'',resolveLibraryMovie=async()=>'';`,

            "./EliteV4SeriesCatalog": `export const EliteV4SeriesCatalog='Series';`,
            "./EliteV4MoviesCatalog": `export const EliteV4MoviesCatalog='Movies';`,
            react,
            "live-runtime": runtime,
            "react-native": `import {Runtime} from 'live-runtime';export const View='View',Text='Text',Image='Image',ScrollView='ScrollView',FlatList='FlatList',TextInput='TextInput',ActivityIndicator='ActivityIndicator',Pressable='Pressable';export const Platform={get isTV(){return Runtime.isTV;}};export function useWindowDimensions(){return{width:Runtime.width,height:720,fontScale:1};}export function findNodeHandle(ref){return ref?.handle??null;}export const BackHandler={addEventListener(_,fn){Runtime.nativeBack=fn;return{remove(){Runtime.nativeBack=null;}}}};`,
            "@expo/vector-icons": `export const Feather='Icon';`,
            "@/context/PlayerContext": `import {Runtime} from 'live-runtime';export function usePlayer(){return Runtime.player;}export function selectProgramsAt(programs,clock){const i=programs?.findIndex(p=>p.start<=clock&&p.end>clock)??-1;return{now:i>=0?programs[i]:undefined,next:i>=0?programs[i+1]:programs?.find(p=>p.start>clock)};}`,
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
  const ui = req(join(out, "live.cjs"));
  const { Runtime: R, Host: H } = ui;
  globalThis.requestAnimationFrame = (fn) => {
    fn();
    return 1;
  };
  const focusElement = H.render("focus", () =>
    ui.EliteV4FocusSurface({ children: null }),
  );
  focusElement.type._context._value = focusElement.props.value;
  const focus = focusElement.props.value;
  const nodes = (node, result = []) => {
    if (Array.isArray(node)) {
      node.forEach((n) => nodes(n, result));
      return result;
    }
    if (!node || typeof node !== "object") return result;
    result.push(node);
    nodes(node.props?.children, result);
    return result;
  };
  const find = (tree, id) => nodes(tree).find((n) => n.props?.focusId === id);
  const list = (tree) => nodes(tree).find((n) => n.type === "FlatList");
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  let checks = 0;
  const check = async (name, fn) => {
    await fn();
    checks++;
    console.log(`PASS V4 Live ${checks} - ${name}`);
  };
  const channels = Array.from({ length: 125 }, (_, i) => ({
    id: `channel-${i}`,
    providerId: "p",
    name: `Kanal ${i}`,
    streamUrl: `https://stream.example/${i}`,
  }));
  R.player = {
    provider: { id: "p", type: "xtream", name: "Provider" },
    channels: [],
    favorites: [],
    epgByChannel: new Map(),
    toggleFavorite: async (id) => (R.favored = id),
    recordWatched: async (id) => R.watched.push(id),
  };
  R.sync = {
    snapshot: {
      providerId: "p",
      ready: true,
      counts: { live: 125, vod: 0, series: 0 },
      live: [],
      movies: [],
      series: [],
      newMovies: [],
    },
    lastSuccessfulAt: 123,
    hasUsableCache: true,
    isSyncing: false,
  };
  let loaded = 0,
    reloaded = 0,
    opened = [],
    favorited = [];
  R.page = {
    items: channels,
    totalCount: 125,
    countKnown: true,
    loadingInitial: false,
    loadingMore: false,
    hasMore: true,
    error: null,
    loadMore: () => loaded++,
    reload: () => reloaded++,
  };
  const props = {
    page: R.page,
    categories: [{ id: "news", name: "Haber" }],
    category: "__all__",
    onCategory: (id) => (R.chosen = id),
    search: "",
    onSearch: (value) => (R.search = value),
    epgByChannel: new Map([
      [
        channels[1].id,
        [{ title: "Gerçek program", start: 0, end: Date.now() + 3600000 }],
      ],
    ]),
    favorites: [channels[1].id],
    onFavorite: (id) => favorited.push(id),
    onOpen: (item) => opened.push(item),
    onBack: () => (R.returned = true),
  };
  const view = (p = props, key = "view") =>
    H.render(key, () => ui.EliteV4LiveView(p));
  await check(
    "Sidebar opens V4 Live and retains selected state and content entry",
    () => {
      const routes = [];
      let legacy = 0;
      const tree = H.render("sidebar", () =>
        ui.EliteV4Sidebar({
          activeId: "sidebar-live",
          contentFocusId: "v4-live-search",
          liveAvailable: true,
          onNavigate: (r) => routes.push(r),
          onReturnToV3: () => legacy++,
        }),
      );
      find(tree, "sidebar-live").props.onPress();
      find(tree, "sidebar-home").props.onPress();
      assert.deepEqual(routes, ["live", "home"]);
      assert.equal(legacy, 0);
      assert.equal(find(tree, "sidebar-live").props.selected, true);
      assert.equal(
        find(tree, "sidebar-live").props.neighbors.right,
        "v4-live-search",
      );
      find(tree, "sidebar-v3").props.onPress();
      assert.equal(legacy, 1);
    },
  );
  await check(
    "explicitly unavailable Live retains the V3 handoff contract",
    () => {
      let legacy = 0;
      const tree = H.render("sidebar-stalker", () =>
        ui.EliteV4Sidebar({
          liveAvailable: false,
          onReturnToV3: () => legacy++,
        }),
      );
      find(tree, "sidebar-live").props.onPress();
      assert.equal(legacy, 1);
    },
  );
  await check(
    "Xtream and M3U consume real paged data beyond Home sampling",
    async () => {
      R.categories = [{ category_id: "news", category_name: "Haber" }];
      for (const type of ["xtream", "m3u"]) {
        R.player.provider.type = type;
        const tree = H.render(`catalog-${type}`, () =>
          ui.EliteV4LiveCatalog({ onOpen: props.onOpen, onBack: props.onBack }),
        );
        H.commit(`catalog-${type}`);
        await flush();
        const query = R.queries.at(-1);
        assert.equal(query.kind, "live");
        assert.equal(query.enabled, true);
        assert.equal(query.providerType, type);
        assert.equal(query.catalogRevision, 123);
        assert.deepEqual(query.snapshotCount, {
          totalCount: 125,
          countKnown: true,
        });
        assert.equal(tree.props.page.items.length, 125);
        assert.deepEqual(R.categoryReads.at(-1), ["p", "live", type === "m3u"]);
        assert.equal(R.epgSeeds.at(-1).providerId, "p");
        assert.equal(R.epgSeeds.at(-1).items.length, 40);
      }
      R.player.provider.type = "xtream";
    },
  );
  await check(
    "category and search produce scoped queries and never reuse global counts",
    () => {
      let tree = H.render("catalog-query", () =>
        ui.EliteV4LiveCatalog({ onOpen: props.onOpen, onBack: props.onBack }),
      );
      tree.props.onCategory("news");
      tree = H.render("catalog-query", () =>
        ui.EliteV4LiveCatalog({ onOpen: props.onOpen, onBack: props.onBack }),
      );
      tree.props.onSearch("Haber");
      H.render("catalog-query", () =>
        ui.EliteV4LiveCatalog({ onOpen: props.onOpen, onBack: props.onBack }),
      );
      const query = R.queries.at(-1);
      assert.equal(query.categoryId, "news");
      assert.equal(query.search, "Haber");
      assert.equal(query.snapshotCount, undefined);
    },
  );
  await check(
    "real row focus reveals selection; only OK opens its exact channel",
    () => {
      let tree = view();
      const nativeList = list(tree);
      const scroll = [];
      nativeList.props.ref.current = {
        scrollToOffset: (entry) => scroll.push(entry),
      };
      const row = nativeList.props.renderItem({ item: channels[1], index: 1 });
      const button = H.render("channel-button", () =>
        ui.EliteV4FocusButton(row.props),
      );
      button.props.onFocus();
      assert.deepEqual(opened, []);
      assert.deepEqual(scroll, [{ offset: 80, animated: true }]);
      tree = view();
      assert.equal(
        list(tree).props.renderItem({ item: channels[1], index: 1 }).props
          .selected,
        true,
      );
      button.props.onPress();
      assert.equal(opened[0], channels[1]);
      assert.equal(row.props.neighbors.left, "v4-live-category:__all__");
      assert.equal(row.props.neighbors.down, "v4-live-channel:channel-2");
    },
  );
  await check(
    "selected channel shows current EPG and favorite action retains identity",
    () => {
      const tree = view();
      assert.ok(
        nodes(tree).some(
          (n) =>
            n.type === "Text" && n.props.children.includes("Gerçek program"),
        ),
      );
      find(tree, "v4-live-favorite").props.onPress();
      assert.deepEqual(favorited, [channels[1].id]);
      find(tree, "v4-live-watch").props.onPress();
      assert.equal(opened.at(-1), channels[1]);
    },
  );
  await check(
    "pagination prevents duplicate busy and failed automatic loads; explicit retry remains",
    () => {
      loaded = 0;
      list(view(props, "page-normal")).props.onEndReached();
      assert.equal(loaded, 1);
      for (const patch of [
        { loadingMore: true },
        { loadingInitial: true },
        { hasMore: false },
        { error: "safe-error" },
      ])
        list(
          view(
            { ...props, page: { ...R.page, ...patch } },
            `page-${JSON.stringify(patch)}`,
          ),
        ).props.onEndReached();
      assert.equal(loaded, 1);
      const failed = view(
        { ...props, page: { ...R.page, error: "safe-error" } },
        "retry",
      );
      find(
        list(failed).props.ListFooterComponent,
        "v4-live-status",
      ).props.onPress();
      assert.equal(reloaded, 1);
    },
  );
  await check(
    "empty and error states retain searchable and retryable focus targets",
    () => {
      const empty = view(
        {
          ...props,
          search: "unknown",
          page: { ...R.page, items: [], hasMore: false },
        },
        "empty",
      );
      const emptyList = list(empty);
      assert.ok(find(empty, "v4-live-search"));
      assert.ok(
        nodes(emptyList.props.ListEmptyComponent).some(
          (n) =>
            n.type === "Text" &&
            n.props.children.includes("Aramanıza uygun kanal bulunamadı."),
        ),
      );
      const failed = view(
        { ...props, page: { ...R.page, items: [], error: "safe-error" } },
        "failed",
      );
      assert.ok(find(list(failed).props.ListFooterComponent, "v4-live-status"));
    },
  );
  await check(
    "narrow layout keeps favorite control in the keyboard graph",
    () => {
      R.width = 640;
      let tree = view(props, "narrow");
      const row = list(tree).props.renderItem({ item: channels[1], index: 1 });
      row.props.onFocused();
      tree = view(props, "narrow");
      const favorite = find(tree, "v4-live-favorite");
      assert.ok(favorite);
      assert.equal(
        find(list(tree).props.ListFooterComponent, "v4-live-status").props
          .neighbors.down,
        "v4-live-favorite",
      );
      favorite.props.onPress();
      assert.equal(favorited.at(-1), channels[1].id);
      R.width = 1280;
    },
  );
  await check(
    "Preview and Native Back close search before returning; Player owns Back while open",
    () => {
      R.isTV = true;
      R.returned = false;
      let tree = view(props, "back");
      H.commit("back");
      find(tree, "v4-live-search").props.onPress();
      tree = view(props, "back");
      H.commit("back");
      R.back();
      assert.equal(R.returned, false);
      tree = view(props, "back");
      H.commit("back");
      R.playerOwnsBack = true;
      assert.equal(R.nativeBack(), false);
      assert.equal(R.returned, false);
      R.playerOwnsBack = false;
      assert.equal(R.nativeBack(), true);
      assert.equal(R.returned, true);
      view({ ...props, active: false }, "back");
      H.commit("back");
      assert.equal(R.back, null);
      assert.equal(R.nativeBack, null);
      H.cleanup("back");
      R.isTV = false;
    },
  );
  const shellWrapper = ui.EliteV4TvShell({
    onReturnToV3() {
      throw Error("unexpected V3 handoff");
    },
  });
  const shellElement = shellWrapper.props.children[0];
  const shell = () =>
    H.render("shell", () => shellElement.type(shellElement.props));
  await check(
    "production shell routes Home to Live and Back without leaving V4",
    () => {
      let tree = shell();
      const sidebar = nodes(tree).find((n) => n.type === ui.EliteV4Sidebar);
      sidebar.props.onNavigate("live");
      tree = shell();
      let live = nodes(tree).find((n) => n.type === ui.EliteV4LiveCatalog);
      assert.ok(live);
      assert.equal(live.props.active, true);
      live.props.onBack();
      tree = shell();
      assert.equal(
        nodes(tree).find((n) => n.type === ui.EliteV4LiveCatalog),
        undefined,
      );
    },
  );
  await check(
    "Live OK preserves resolver identity and Player exit restores the exact Live target",
    async () => {
      let tree = shell();
      nodes(tree)
        .find((n) => n.type === ui.EliteV4Sidebar)
        .props.onNavigate("live");
      tree = shell();
      focus.focusedId = "v4-live-channel:channel-1";
      nodes(tree)
        .find((n) => n.type === ui.EliteV4LiveCatalog)
        .props.onOpen(channels[1]);
      await flush();
      tree = shell();
      const player = nodes(tree).find((n) => n.type === "NativeVideoPlayer");
      assert.ok(player);
      assert.deepEqual(player.props.liveIdentity, {
        providerId: "p",
        channelId: channels[1].id,
      });
      assert.equal(R.resolves.at(-1)[0].item, channels[1]);
      assert.equal(
        nodes(tree).find((n) => n.type === ui.EliteV4LiveCatalog).props.active,
        false,
      );
      player.props.onFullscreenExit();
      tree = shell();
      assert.equal(
        nodes(tree).find((n) => n.type === "NativeVideoPlayer"),
        undefined,
      );
      assert.ok(R.restored.includes("elite-v4:v4-live-channel:channel-1"));
    },
  );
  await check(
    "late resolver cannot reopen Player after navigation or accept a foreign provider row",
    async () => {
      let resolve;
      R.resolve = () =>
        new Promise((done) => {
          resolve = done;
        });
      let tree = shell();
      let live = nodes(tree).find((n) => n.type === ui.EliteV4LiveCatalog);
      live.props.onOpen(channels[2]);
      live.props.onBack();
      resolve({ url: "https://stream.example/late" });
      await flush();
      tree = shell();
      assert.equal(
        nodes(tree).find((n) => n.type === "NativeVideoPlayer"),
        undefined,
      );
      nodes(tree)
        .find((n) => n.type === ui.EliteV4Sidebar)
        .props.onNavigate("live");
      tree = shell();
      const before = R.resolves.length;
      nodes(tree)
        .find((n) => n.type === ui.EliteV4LiveCatalog)
        .props.onOpen({ ...channels[0], providerId: "other" });
      await flush();
      assert.equal(R.resolves.length, before);
    },
  );
  await check(
    "offscreen category focus scrolls the actual category strip into view",
    () => {
      const tree = view(props, "category-reveal");
      const strip = nodes(tree).find((node) => node.type === "ScrollView");
      const scroll = [];
      strip.props.ref.current = { scrollTo: (entry) => scroll.push(entry) };
      const category = find(tree, "v4-live-category:news");
      category.props.onLayout({ nativeEvent: { layout: { x: 640, y: 640 } } });
      category.props.onFocused();
      assert.deepEqual(scroll, [{ y: 634, animated: true }]);
    },
  );

  await check(
    "P6 wide Live uses vertical categories and channel to EPG focus path",
    () => {
      R.width = 1280;
      const t = view(props, "p6-layout"),
        category = find(t, "v4-live-category:news");
      assert.equal(
        nodes(t).find((n) => n.type === "ScrollView").props.horizontal,
        false,
      );
      assert.equal(category.props.neighbors.left, "sidebar-live");
      assert.equal(category.props.neighbors.right, "v4-live-channel:channel-0");
      assert.equal(
        list(t).props.renderItem({ item: channels[0], index: 0 }).props
          .neighbors.left,
        "v4-live-category:__all__",
      );
      assert.equal(
        list(t).props.renderItem({ item: channels[0], index: 0 }).props
          .neighbors.right,
        "v4-live-watch",
      );
    },
  );
  await check(
    "P6 narrow category strip and touch row keep the same real channel",
    () => {
      R.width = 393;
      const before = opened.length;
      let t = view(props, "p6-touch");
      assert.equal(
        nodes(t).find((n) => n.type === "ScrollView").props.horizontal,
        true,
      );
      list(t).props.renderItem({ item: channels[2], index: 2 }).props.onPress();
      t = view(props, "p6-touch");
      assert.equal(opened.length, before + 1);
      assert.equal(opened.at(-1).id, channels[2].id);
      assert.ok(find(t, "v4-live-favorite"));
      R.width = 1280;
    },
  );
  await check(
    "P6 selected real EPG contains current and next program without a second Player",
    () => {
      const end = Date.now() + 100000,
        epg = new Map([
          [
            channels[0].id,
            [
              { title: "Şimdi A", start: 0, end },
              { title: "Sonra B", start: end, end: end + 100000 },
            ],
          ],
        ]);
      let t = view({ ...props, epgByChannel: epg }, "p6-epg");
      list(t)
        .props.renderItem({ item: channels[0], index: 0 })
        .props.onFocused();
      t = view({ ...props, epgByChannel: epg }, "p6-epg");
      const json = JSON.stringify(t);
      assert.match(json, /Şimdi A/);
      assert.match(json, /Sonra B/);
      assert.ok(!nodes(t).some((n) => n.type === "NativeVideoPlayer"));
    },
  );
  await check(
    "P6 retired Live rows and footer cannot play or paginate after category change",
    () => {
      let t = view(props, "p6-stale"),
        old = list(t).props.renderItem({ item: channels[0], index: 0 });
      const load = list(t).props.onEndReached,
        before = opened.length,
        loadBefore = loaded;
      view({ ...props, category: "news", active: false }, "p6-stale");
      old.props.onPress();
      old.props.onFocused();
      load();
      assert.equal(opened.length, before);
      assert.equal(loaded, loadBefore);
    },
  );
  await check(
    "P6 Native rapid focus rejects old row OK and old EPG action",
    () => {
      R.isTV = true;
      let t = view(props, "p6-native-stale"),
        first = list(t).props.renderItem({ item: channels[0], index: 0 }),
        second = list(t).props.renderItem({ item: channels[1], index: 1 });
      first.props.onFocused();
      t = view(props, "p6-native-stale");
      const oldWatch = find(t, "v4-live-watch").props.onPress;
      second.props.onFocused();
      const before = opened.length;
      first.props.onPress();
      oldWatch();
      assert.equal(opened.length, before);
      second.props.onPress();
      assert.equal(opened.at(-1).id, channels[1].id);
      R.isTV = false;
    },
  );
  await check(
    "P6 favorite action locks repeated OK until real persistence settles",
    async () => {
      let release,
        actions = 0;
      const p = {
        ...props,
        onFavorite: () => {
          actions++;
          return new Promise((r) => (release = r));
        },
      };
      let t = view(p, "p6-star");
      list(t)
        .props.renderItem({ item: channels[0], index: 0 })
        .props.onFocused();
      t = view(p, "p6-star");
      find(t, "v4-live-favorite").props.onPress();
      find(t, "v4-live-favorite").props.onPress();
      assert.equal(actions, 1);
      release();
      await new Promise((r) => setImmediate(r));
    },
  );
  const stalkerChannels = channels.map((c, i) => ({
    ...c,
    id: "s-stalker-" + i,
    providerId: "s",
    streamUrl: "legendstream-catalog://stalker/live/s/s-stalker-" + i,
  }));
  R.player = {
    ...R.player,
    provider: {
      id: "s",
      type: "stalker",
      name: "Portal",
      url: "https://portal.invalid",
      mac: "00:11:22:33:44:55",
    },
    refreshEpg: async (id) => {
      R.epgRefreshes ??= [];
      R.epgRefreshes.push(id);
    },
  };
  R.sync = {
    ...R.sync,
    snapshot: {
      ...R.sync.snapshot,
      providerId: "s",
      ready: true,
      counts: { live: 125 },
      live: stalkerChannels.slice(0, 8),
    },
    syncState: { phase: "ready" },
    refreshCatalog: async () => {
      R.portalRefreshes = (R.portalRefreshes ?? 0) + 1;
    },
  };
  R.categories = [{ category_id: "news", category_name: "Portal haber" }];
  R.page = { ...R.page, items: stalkerChannels };
  const adapter = (key = "p6-stalker") =>
    H.render(key, () =>
      ui.EliteV4LiveCatalog({ onOpen: props.onOpen, onBack: props.onBack }),
    );
  await check(
    "P6 Stalker adapter consumes canonical lazy page contracts and all real rows",
    async () => {
      let t = adapter();
      H.commit("p6-stalker");
      await flush();
      t = adapter();
      const query = R.queries.at(-1);
      assert.equal(query.providerType, null);
      assert.equal(query.provider.type, "stalker");
      assert.equal(query.categoryId, "__all__");
      assert.equal(query.enabled, true);
      assert.equal(t.props.page.items.length, 125);
      assert.equal(t.props.categories[0].name, "Portal haber");
      assert.match(t.props.capabilityNote, /önbelleğe/);
      H.cleanup("p6-stalker");
    },
  );
  await check(
    "P6 Stalker category and search use the same scoped query rather than portal-wide results",
    () => {
      let t = adapter("p6-query");
      t.props.onCategory("news");
      t = adapter("p6-query");
      t.props.onSearch("Haber");
      t = adapter("p6-query");
      const q = R.queries.at(-1);
      assert.equal(q.categoryId, "news");
      assert.equal(q.search, "Haber");
      assert.equal(q.snapshotCount, undefined);
      H.cleanup("p6-query");
    },
  );
  await check(
    "P6 Stalker refresh is single-flight and reloads actual category/page sources",
    async () => {
      let release;
      R.sync.refreshCatalog = () => new Promise((r) => (release = r));
      const before = reloaded;
      let t = adapter("p6-refresh");
      H.commit("p6-refresh");
      t.props.page.reload();
      t.props.page.reload();
      release();
      await new Promise((r) => setImmediate(r));
      assert.equal(reloaded, before + 1);
      H.cleanup("p6-refresh");
      R.sync.refreshCatalog = async () => {};
    },
  );
  await check(
    "P6 retired Stalker refresh cannot reload a different provider view",
    async () => {
      let release;
      R.sync.refreshCatalog = () => new Promise((r) => (release = r));
      let t = adapter("p6-refresh-stale");
      H.commit("p6-refresh-stale");
      t.props.page.reload();
      const before = reloaded;
      H.cleanup("p6-refresh-stale");
      release();
      await new Promise((r) => setImmediate(r));
      assert.equal(reloaded, before);
      R.sync.refreshCatalog = async () => {};
    },
  );
  await check(
    "P6 Stalker EPG registers the focused real identity with bounded seeds",
    async () => {
      let t = adapter("p6-seed");
      H.commit("p6-seed");
      t.props.onSelected(stalkerChannels[80]);
      await new Promise((r) => setTimeout(r, 220));
      assert.equal(R.epgSeeds.at(-1).providerId, "s");
      assert.equal(R.epgSeeds.at(-1).items[0].id, stalkerChannels[80].id);
      assert.ok(R.epgSeeds.at(-1).items.length <= 40);
      assert.equal(R.epgRefreshes.at(-1), "s");
      H.cleanup("p6-seed");
    },
  );
  await check(
    "P6 Stalker favorite mutation reuses provider-prefixed P4 identity",
    async () => {
      const t = adapter("p6-favorite");
      await t.props.onFavorite(stalkerChannels[0].id);
      assert.equal(R.favored, stalkerChannels[0].id);
      H.cleanup("p6-favorite");
    },
  );
  const stalkerShell = () =>
    H.render("p6-shell", () => shellElement.type(shellElement.props));
  const goLive = () => {
    let t = stalkerShell();
    nodes(t)
      .find((n) => n.type === ui.EliteV4Sidebar)
      .props.onNavigate("live");
    return stalkerShell();
  };
  R.session = {};
  R.resolve = async () => ({ url: "https://stream.invalid/resolved-stalker" });
  await check(
    "P6 Stalker Sidebar opens V4 and resolves canonical runtime source before one Player",
    async () => {
      let t = goLive();
      const side = nodes(t).find((n) => n.type === ui.EliteV4Sidebar);
      assert.equal(side.props.liveAvailable, true);
      const live = nodes(t).find((n) => n.type === ui.EliteV4LiveCatalog);
      live.props.onOpen(stalkerChannels[0]);
      await flush();
      t = stalkerShell();
      const player = nodes(t).find((n) => n.type === "NativeVideoPlayer");
      assert.ok(player);
      assert.equal(
        player.props.source,
        "https://stream.invalid/resolved-stalker",
      );
      assert.deepEqual(player.props.liveIdentity, {
        providerId: "s",
        channelId: stalkerChannels[0].id,
      });
      assert.equal(
        R.runtimeResolves.at(-1).source,
        stalkerChannels[0].streamUrl,
      );
      assert.equal(R.watched.at(-1), stalkerChannels[0].id);
      player.props.onFullscreenExit();
      stalkerShell();
    },
  );
  await check(
    "P6 Stalker repeated OK performs one resolver and cannot stack Players",
    async () => {
      let release;
      R.resolve = () => new Promise((r) => (release = r));
      let t = goLive();
      const live = nodes(t).find((n) => n.type === ui.EliteV4LiveCatalog),
        before = R.runtimeResolves.length;
      live.props.onOpen(stalkerChannels[1]);
      live.props.onOpen(stalkerChannels[1]);
      assert.equal(R.runtimeResolves.length, before + 1);
      release({ url: "https://stream.invalid/only-one" });
      await flush();
      t = stalkerShell();
      assert.equal(
        nodes(t).filter((n) => n.type === "NativeVideoPlayer").length,
        1,
      );
      nodes(t)
        .find((n) => n.type === "NativeVideoPlayer")
        .props.onFullscreenExit();
      stalkerShell();
    },
  );
  await check(
    "P6 disposed Stalker session cannot publish an old stream",
    async () => {
      let release;
      R.resolve = () => new Promise((r) => (release = r));
      let t = goLive();
      nodes(t)
        .find((n) => n.type === ui.EliteV4LiveCatalog)
        .props.onOpen(stalkerChannels[2]);
      R.session = {};
      release({ url: "https://stream.invalid/old-session" });
      await flush();
      t = stalkerShell();
      assert.equal(
        nodes(t).find((n) => n.type === "NativeVideoPlayer"),
        undefined,
      );
    },
  );
  await check(
    "P6 navigation aborts Stalker resolution and preserves the new route",
    async () => {
      let release;
      R.resolve = () => new Promise((r) => (release = r));
      let t = goLive();
      nodes(t)
        .find((n) => n.type === ui.EliteV4LiveCatalog)
        .props.onOpen(stalkerChannels[3]);
      const request = R.runtimeResolves.at(-1);
      nodes(t)
        .find((n) => n.type === ui.EliteV4Sidebar)
        .props.onNavigate("home");
      assert.equal(request.signal.aborted, true);
      release({ url: "https://stream.invalid/late" });
      await flush();
      t = stalkerShell();
      assert.equal(
        nodes(t).find((n) => n.type === "NativeVideoPlayer"),
        undefined,
      );
    },
  );
  await check(
    "P6 unresolved portal command is a visible error rather than a playable URL",
    async () => {
      R.resolve = async () => ({ url: "ffmpeg stale-command" });
      let t = goLive();
      nodes(t)
        .find((n) => n.type === ui.EliteV4LiveCatalog)
        .props.onOpen(stalkerChannels[4]);
      await flush();
      t = stalkerShell();
      assert.equal(
        nodes(t).find((n) => n.type === "NativeVideoPlayer"),
        undefined,
      );
      assert.match(JSON.stringify(t), /İçerik başlatılamadı/);
    },
  );
  await check(
    "P6 editing the same account identity rejects its earlier stream callback",
    async () => {
      let release;
      R.resolve = () => new Promise((r) => (release = r));
      let t = goLive();
      nodes(t)
        .find((n) => n.type === ui.EliteV4LiveCatalog)
        .props.onOpen(stalkerChannels[5]);
      const before = R.watched.length;
      R.player = {
        ...R.player,
        provider: { ...R.player.provider, mac: "00:11:22:33:44:66" },
      };
      stalkerShell();
      release({ url: "https://stream.invalid/retired-account" });
      await flush();
      assert.equal(
        nodes(stalkerShell()).find((n) => n.type === "NativeVideoPlayer"),
        undefined,
      );
      assert.equal(R.watched.length, before);
    },
  );
  await check(
    "P6 old Player exit callback cannot close a newly opened channel",
    async () => {
      let sequence = 0;
      R.resolve = async () => ({
        url: "https://stream.invalid/session-" + ++sequence,
      });
      let t = goLive();
      nodes(t)
        .find((n) => n.type === ui.EliteV4LiveCatalog)
        .props.onOpen(stalkerChannels[0]);
      await flush();
      t = stalkerShell();
      const old = nodes(t).find((n) => n.type === "NativeVideoPlayer");
      old.props.onFullscreenExit();
      t = stalkerShell();
      nodes(t)
        .find((n) => n.type === ui.EliteV4LiveCatalog)
        .props.onOpen(stalkerChannels[1]);
      await flush();
      t = stalkerShell();
      const current = nodes(t).find((n) => n.type === "NativeVideoPlayer");
      old.props.onFullscreenExit();
      t = stalkerShell();
      assert.equal(
        nodes(t).find((n) => n.type === "NativeVideoPlayer").props.source,
        current.props.source,
      );
      current.props.onFullscreenExit();
      stalkerShell();
    },
  );
  H.cleanup("p6-shell");
  assert.equal(checks, 33);
  console.log(
    `Elite V4 Live production host: ${checks}/33 passed; HOST_NOT_PHYSICAL`,
  );
} finally {
  delete globalThis.requestAnimationFrame;
  rmSync(out, { recursive: true, force: true });
}
