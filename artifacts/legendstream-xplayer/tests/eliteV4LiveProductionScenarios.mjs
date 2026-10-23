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
          const mocks = {
            "./EliteV4SeriesCatalog": `export const EliteV4SeriesCatalog='Series';`,
            "./EliteV4MoviesCatalog": `export const EliteV4MoviesCatalog='Movies';`,
            react,
            "live-runtime": runtime,
            "react-native": `import {Runtime} from 'live-runtime';export const View='View',Text='Text',Image='Image',ScrollView='ScrollView',FlatList='FlatList',TextInput='TextInput',ActivityIndicator='ActivityIndicator',Pressable='Pressable';export const Platform={get isTV(){return Runtime.isTV;}};export function useWindowDimensions(){return{width:Runtime.width,height:720,fontScale:1};}export function findNodeHandle(ref){return ref?.handle??null;}export const BackHandler={addEventListener(_,fn){Runtime.nativeBack=fn;return{remove(){Runtime.nativeBack=null;}}}};`,
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
  await check("unsupported Stalker retains explicit V3 handoff", () => {
    let legacy = 0;
    const tree = H.render("sidebar-stalker", () =>
      ui.EliteV4Sidebar({ liveAvailable: false, onReturnToV3: () => legacy++ }),
    );
    find(tree, "sidebar-live").props.onPress();
    assert.equal(legacy, 1);
  });
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
      assert.equal(row.props.neighbors.left, "sidebar-live");
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
      category.props.onLayout({ nativeEvent: { layout: { x: 640 } } });
      category.props.onFocused();
      assert.deepEqual(scroll, [{ x: 634, animated: true }]);
    },
  );
  assert.equal(checks, 14);
  console.log(
    `Elite V4 Live production host: ${checks}/14 passed; HOST_NOT_PHYSICAL`,
  );
} finally {
  delete globalThis.requestAnimationFrame;
  rmSync(out, { recursive: true, force: true });
}
