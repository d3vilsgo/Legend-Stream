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
const out = mkdtempSync(join(tmpdir(), "v4-persistence-"));
const react = `
const frames=new Map();let frame;
export const Host={render(key,fn){if(!frames.has(key))frames.set(key,{values:[],cursor:0,effects:[],pending:[]});frame=frames.get(key);frame.cursor=0;return fn();},commit(key){const f=frames.get(key);for(const run of f.pending.splice(0))run();},cleanup(key){for(const effect of frames.get(key)?.effects??[])effect?.cleanup?.();frames.delete(key);}};
export function useState(initial){const f=frame,i=f.cursor++;if(!(i in f.values))f.values[i]=typeof initial==='function'?initial():initial;return[f.values[i],v=>{f.values[i]=typeof v==='function'?v(f.values[i]):v;}];}
export function useRef(initial){const f=frame,i=f.cursor++;if(!(i in f.values))f.values[i]={current:initial};return f.values[i];}
export function useEffect(run,deps){const f=frame,i=f.cursor++,old=f.effects[i];if(old&&deps&&old.deps&&deps.length===old.deps.length&&deps.every((v,i)=>v===old.deps[i]))return;f.effects[i]={deps,cleanup:old?.cleanup};f.pending.push(()=>{f.effects[i].cleanup?.();f.effects[i].cleanup=run();});}
export function useMemo(fn,deps){const f=frame,i=f.cursor++,old=f.values[i];if(!old||!deps||deps.some((v,i)=>v!==old.deps[i]))f.values[i]={deps,value:fn()};return f.values[i].value;}export function useCallback(fn,deps){return useMemo(()=>fn,deps);}
export function createContext(value){const c={_value:value};c.Provider={_context:c};return c;}export function useContext(c){return c._value;}
export function createElement(type,props,...children){return{type,props:{...props,children}};}
export class Component{constructor(props){this.props=props;}setState(value){this.state={...this.state,...value};}}
export default{Component,createElement,useState,useRef,useEffect,useMemo,useCallback,createContext,useContext};`;

const runtime = `export const R={storage:new Map(),player:null,failKey:null,readOverride:null,beforeSet:null,writes:[],secrets:{url:'https://provider.invalid',username:'fixture-user',password:'fixture-password',mac:'fixture-mac'}};`;
const mocks = {
  react,
  "p4-runtime": runtime,
  "react-native": `export const Platform={OS:'android',isTV:true};`,
  "@react-native-async-storage/async-storage": `import {R} from 'p4-runtime';export default {getItem:async key=>R.readOverride?R.readOverride(key):R.storage.get(key)??null,setItem:async(key,value)=>{if(R.beforeSet)await R.beforeSet(key,value);if(R.failKey===key)throw new Error('storage unavailable');R.writes.push({key,value});R.storage.set(key,value);},removeItem:async key=>R.storage.delete(key)};`,
  "@/context/PlayerContext": `import {R} from 'p4-runtime';export const usePlayer=()=>R.player;`,
  "@/lib/secureCredentials": `import {R} from 'p4-runtime';export const readCredentials=async()=>({status:'found',secrets:R.secrets}),saveCredentials=async()=>{},deleteCredentials=async()=>{};`,
  "@/lib/iptv": `export class ProviderLoadError extends Error{}export class EpgPhaseFailure extends Error{}export const getM3UCatalog=()=>({movieItems:[],seriesGroups:[]}),normalizeXtreamBaseUrl=v=>v,loadEpg=async()=>[],loadProvider=async()=>({channels:[]});`,
  "@/lib/xtreamCatalog": `export const getEpisodePlaybackQueue=()=>undefined,getVodPlaybackQueue=()=>undefined;`,
};
// Only transport/catalog/EPG boundaries are doubled. PlayerState, favorites, progress, migration and queues are production code.
const source = readFileSync(join(app, "context/PlayerContext.tsx"), "utf8");
const real = new Set([
  "@/lib/contentFavorites",
  "@/lib/liveHistory",
  "@/lib/providerCredentialState",
]);
for (const match of source.matchAll(
  /import\s*\{([\s\S]*?)\}\s*from\s*["'](@\/lib\/[^"']+)["']/g,
)) {
  const path = match[2];
  if (real.has(path) || mocks[path]) continue;
  const names = match[1]
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v && !v.startsWith("type "))
    .map((v) => v.split(/\s+as\s+/)[0]);
  if (names.some((name) => !/^[A-Za-z_$][\w$]*$/.test(name))) continue;
  mocks[path] = names
    .map(
      (name) =>
        `export function ${name}(...args){if(new.target)return new Proxy({},{get:()=>()=>undefined});return undefined;}`,
    )
    .join("\n");
}
mocks["@/lib/performanceDiagnostics"] =
  `export const markStartupEvent=()=>{},beginPerformanceMeasurement=()=>({}),finishPerformanceMeasurement=()=>{},observePerformanceTask=async(...args)=>args.at(-1)();`;
mocks["@/lib/safeLog"] = `export const safeLog={info(){},error(){},warn(){}};`;
mocks["@/lib/stalkerLiveCatalogRouting"] =
  `export const removeLegacyStalkerCatalogChannels=(channels)=>channels,syncStalkerCatalogForLifecycle=async()=>{};`;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("UNEXPECTED_NETWORK_IN_HOST_TEST");
};
try {
  await build({
    stdin: {
      contents: `export {Host} from 'react';export {R} from 'p4-runtime';export {PlayerProvider} from './context/PlayerContext';export {MediaLibraryProvider} from './context/MediaLibraryContext';export {MEDIA_PROGRESS_V2_STORAGE_KEY,MEDIA_PROGRESS_V1_STORAGE_KEY,parseMediaProgressV2Payload} from './lib/mediaProgress';export {contentFavoriteKey} from './lib/contentFavorites';export {LIVE_HISTORY_V2_STORAGE_KEY,parseLiveHistoryV2Payload} from './lib/liveHistory';`,
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
        name: "production-persistence-boundaries",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) =>
            Object.hasOwn(mocks, a.path)
              ? { path: a.path, namespace: "p4" }
              : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "p4" }, (a) => ({
            contents: mocks[a.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const api = req(join(out, "host.cjs")),
    { R, Host: H } = api;
  const flush = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  };
  const render = (key, fn) => {
    const value = H.render(key, fn);
    H.commit(key);
    return value.props.value;
  };
  const provider = {
    id: "A",
    type: "xtream",
    url: "https://provider.invalid",
    playlistUrl: "https://provider.invalid",
    username: "fixture-user",
    password: "fixture-password",
    needsCredentials: false,
  };
  const other = { ...provider, id: "B", type: "stalker", mac: "fixture-mac" };
  R.player = { provider, providers: [provider, other], isHydrating: false };
  const media = () =>
    render("media", () => api.MediaLibraryProvider({ children: null }));
  const key = api.MEDIA_PROGRESS_V2_STORAGE_KEY,
    stateKey = "@legendstream/player-state-v3";
  const ref = {
    type: "xtream-vod",
    streamId: "7",
    containerExtension: "mp4",
    sourceMode: "canonical",
  };
  const input = {
    kind: "movie",
    title: "Provider film",
    source:
      "https://provider.invalid/movie/fixture-user/fixture-password/7.mp4",
    position: 120,
    duration: 1000,
    playbackRef: ref,
  };
  const defer = () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  };
  let checks = 0;
  const check = async (name, fn) => {
    await fn();
    console.log(`PASS V4 persistence ${++checks} - ${name}`);
  };
  await check(
    "production MediaLibrary hydrates existing V2 and preserves legacy account isolation",
    async () => {
      R.storage.set(
        key,
        JSON.stringify([
          {
            schemaVersion: 2,
            id: "old-B",
            providerId: "B",
            kind: "movie",
            title: "Other",
            playbackRef: {
              type: "stalker-vod",
              itemId: "7",
              categoryId: "cat",
            },
            position: 100,
            duration: 1000,
            updatedAt: 1,
          },
        ]),
      );
      media();
      await flush();
      assert.equal(media().loaded, true);
      assert.equal(media().historyEntries.length, 0);
    },
  );
  await check(
    "real progress save persists only provider identity and restores after provider remount",
    async () => {
      let m = media();
      const session = m.beginProgressSession(input.source, ref);
      await m.saveProgress({ ...input, session });
      m = media();
      assert.equal(m.historyEntries[0].providerId, "A");
      assert.equal(m.historyEntries[0].position, 120);
      const raw = R.storage.get(key);
      assert.equal(raw.includes("fixture-password"), false);
      assert.equal(raw.includes("https://"), false);
      H.cleanup("media");
      media();
      await flush();
      m = media();
      assert.equal(m.getProgress(input.source, ref).position, 120);
    },
  );
  await check(
    "completed history remains durable while legacy Continue entries and resume exclude it",
    async () => {
      let m = media();
      await m.saveProgress({ ...input, position: 995 });
      m = media();
      assert.equal(m.historyEntries[0].position, 995);
      assert.equal(m.entries.length, 0);
      assert.equal(m.getProgress(input.source, ref), undefined);
      H.cleanup("media");
      media();
      await flush();
      assert.equal(media().historyEntries[0].position, 995);
    },
  );
  await check(
    "zero invalid duration and accidental short plays cannot erase a valid record",
    async () => {
      let m = media();
      await m.saveProgress({ ...input, position: 130 });
      m = media();
      for (const value of [
        { position: 0, duration: 1000 },
        { position: 2, duration: 1000 },
        { position: 130, duration: 0 },
        { position: NaN, duration: 1000 },
        { position: 9999, duration: 1000 },
      ])
        await m.saveProgress({ ...input, ...value });
      assert.equal(media().historyEntries[0].position, 130);
    },
  );
  await check(
    "old account callback cannot write into new account with the same content ID",
    async () => {
      const old = media();
      R.player = { ...R.player, provider: other };
      media();
      await old.saveProgress({ ...input, position: 200 });
      assert.equal(media().historyEntries[0].title, "Other");
      assert.equal(
        api
          .parseMediaProgressV2Payload(R.storage.get(key))
          .find((e) => e.providerId === "A").position,
        130,
      );
      R.player = { ...R.player, provider };
      media();
    },
  );
  await check(
    "remove invalidates a live playback session; late callbacks cannot resurrect history",
    async () => {
      let m = media();
      const session = m.beginProgressSession(input.source, ref);
      await m.saveProgress({ ...input, position: 140, session });
      m = media();
      await m.removeProgressEntries([m.historyEntries[0].id]);
      await m.saveProgress({ ...input, position: 150, session });
      assert.equal(media().historyEntries.length, 0);
      const fresh = media().beginProgressSession(input.source, ref);
      await media().saveProgress({ ...input, position: 160, session: fresh });
      assert.equal(media().historyEntries[0].position, 160);
    },
  );
  await check(
    "overlapping writes read latest committed snapshot without losing distinct content",
    async () => {
      const m = media();
      await Promise.all([
        m.saveProgress({ ...input, position: 170 }),
        m.saveProgress({
          ...input,
          title: "Second film",
          position: 80,
          playbackRef: { ...ref, streamId: "8" },
          source: input.source.replace("7.mp4", "8.mp4"),
        }),
      ]);
      const items = media().historyEntries;
      assert.equal(items.length, 2);
      assert.ok(items.some((e) => e.playbackRef.streamId === "8"));
    },
  );
  await check(
    "write failures are visible and retain the verified snapshot; queue recovers",
    async () => {
      let m = media();
      R.failKey = key;
      await m.saveProgress({ ...input, position: 300 });
      m = media();
      assert.ok(m.storageError);
      assert.equal(
        m.historyEntries.find((e) => e.playbackRef.streamId === "7").position,
        170,
      );
      R.failKey = null;
      await m.saveProgress({ ...input, position: 310 });
      assert.equal(media().storageError, null);
      assert.equal(
        media().historyEntries.find((e) => e.playbackRef.streamId === "7")
          .position,
        310,
      );
    },
  );
  await check(
    "Stalker episode resume matches explicit progress identity without URL classification",
    async () => {
      R.player = { ...R.player, provider: other };
      let m = media();
      const er = {
          type: "stalker-episode",
          seriesId: "s",
          seasonId: "02",
          episodeId: "009",
        },
        episode = {
          kind: "episode",
          title: "Bölüm 9",
          subtitle: "Portal show",
          source: "https://cdn.invalid/opaque",
          position: 120,
          duration: 2000,
          playbackRef: er,
          episodeContext: { seriesId: "s", seasonId: "02", episodeNumber: 9 },
        };
      const session = m.beginProgressSession(episode.source, er);
      assert.ok(session);
      await m.saveProgress({ ...episode, session });
      m = media();
      assert.equal(m.getProgress(episode.source, er).position, 120);
      assert.equal(
        m.historyEntries.find((e) => e.kind === "episode").episodeContext
          .seasonId,
        "02",
      );
      H.cleanup("media");
      media();
      await flush();
      assert.equal(media().getProgress(episode.source, er).position, 120);
      R.player = { ...R.player, provider };
      media();
    },
  );
  await check(
    "clear affects only the active provider and stops older Player session writes",
    async () => {
      let m = media();
      const session = m.beginProgressSession(input.source, ref);
      await m.clearProgress();
      await m.saveProgress({ ...input, position: 400, session });
      assert.equal(media().historyEntries.length, 0);
      assert.ok(
        api
          .parseMediaProgressV2Payload(R.storage.get(key))
          .some((e) => e.providerId === "B"),
      );
    },
  );
  await check(
    "failed hydration never enables writes over unreadable existing history",
    async () => {
      H.cleanup("media");
      const saved = R.storage.get(key);
      R.storage.set(key, "{invalid");
      media();
      await flush();
      let m = media();
      assert.equal(m.loaded, false);
      assert.ok(m.storageError);
      await m.saveProgress(input);
      assert.equal(R.storage.get(key), "{invalid");
      R.storage.set(key, saved);
      m.retryStorage();
      media();
      await flush();
      assert.equal(media().loaded, true);
    },
  );
  const seedPlayer = () =>
    R.storage.set(
      stateKey,
      JSON.stringify({
        providers: [
          { id: "A", type: "xtream", name: "A" },
          { id: "B", type: "stalker", name: "B" },
        ],
        provider: { id: "A", type: "xtream" },
        activeProviderId: "A",
        favorites: ["A:xtream-live:1"],
      }),
    );
  seedPlayer();
  const player = () =>
    render("player", () => api.PlayerProvider({ children: null }));
  player();
  await flush();
  await check(
    "production PlayerProvider extends existing state key with film and series favorites",
    async () => {
      let p = player();
      assert.equal(p.provider.id, "A");
      await p.setMediaFavorite(
        {
          providerId: "A",
          kind: "movie",
          catalogId: "7",
          title: "Provider film",
        },
        true,
      );
      p = player();
      assert.equal(p.mediaFavorites.length, 1);
      assert.deepEqual(p.favorites, ["A:xtream-live:1"]);
      const raw = JSON.parse(R.storage.get(stateKey));
      assert.equal(raw.mediaFavorites[0].catalogId, "7");
      assert.equal(JSON.stringify(raw).includes("fixture-password"), false);
    },
  );
  await check(
    "rapid idempotent add and different content kinds never produce duplicate favorites",
    async () => {
      const p = player(),
        value = {
          providerId: "A",
          kind: "movie",
          catalogId: "7",
          title: "Provider film",
        };
      await Promise.all([
        p.setMediaFavorite(value, true),
        p.setMediaFavorite(value, true),
        p.setMediaFavorite({ ...value, kind: "series" }, true),
      ]);
      assert.equal(player().mediaFavorites.length, 2);
      await player().setMediaFavorite(value, false);
      assert.equal(player().mediaFavorites.length, 1);
    },
  );
  await check(
    "favorites survive context restart without changing legacy live IDs",
    async () => {
      H.cleanup("player");
      player();
      await flush();
      let p = player();
      assert.equal(p.mediaFavorites[0].kind, "series");
      assert.deepEqual(p.favorites, ["A:xtream-live:1"]);
    },
  );
  await check(
    "account switch during pending favorite write never restores the former active account",
    async () => {
      let pending = defer(),
        entered = defer();
      R.beforeSet = async (key) => {
        if (key === stateKey) {
          entered.resolve();
          await pending.promise;
        }
      };
      const p = player(),
        write = p.setMediaFavorite(
          {
            providerId: "A",
            kind: "movie",
            catalogId: "9",
            title: "Pending film",
          },
          true,
        );
      await entered.promise;
      const disconnect = player().disconnectProvider();
      R.beforeSet = null;
      pending.resolve();
      await Promise.all([write, disconnect]);
      assert.equal(player().provider, null);
      assert.equal(JSON.parse(R.storage.get(stateKey)).provider, null);
    },
  );
  await check(
    "different accounts may favorite identical IDs without sharing records",
    async () => {
      await player().setActiveProvider("B");
      let p = player();
      assert.equal(p.provider.id, "B");
      await p.setMediaFavorite(
        { providerId: "B", kind: "series", catalogId: "7", title: "B series" },
        true,
      );
      p = player();
      assert.equal(
        p.mediaFavorites.filter((e) => e.catalogId === "7").length,
        2,
      );
      assert.ok(
        p.mediaFavorites.every(
          (e) => e.providerId === "A" || e.providerId === "B",
        ),
      );
    },
  );
  await check(
    "failed favorite writes expose error and retain last verified records",
    async () => {
      let p = player(),
        before = p.mediaFavorites.length;
      R.failKey = stateKey;
      await p.setMediaFavorite(
        {
          providerId: "B",
          kind: "movie",
          catalogId: "missing",
          title: "Not committed",
        },
        true,
      );
      p = player();
      assert.equal(p.mediaFavorites.length, before);
      assert.ok(p.favoriteError);
      R.failKey = null;
      await p.setMediaFavorite(
        { providerId: "B", kind: "movie", catalogId: "ok", title: "Committed" },
        true,
      );
      assert.equal(player().favoriteError, null);
    },
  );
  await check(
    "provider removal follows existing policy and removes only its favorites",
    async () => {
      await player().removeProvider("B");
      const p = player();
      assert.equal(
        p.mediaFavorites.some((e) => e.providerId === "B"),
        false,
      );
      assert.ok(p.mediaFavorites.some((e) => e.providerId === "A"));
      assert.equal(p.provider.id, "A");
    },
  );
  await check(
    "real live history records persist timestamps without inventing legacy times",
    async () => {
      let p = player();
      await p.recordWatched("A:xtream-live:42");
      p = player();
      assert.equal(p.history[0], "A:xtream-live:42");
      assert.ok(p.historyTimes["A:xtream-live:42"] > 0);
      const parsed = api.parseLiveHistoryV2Payload(
        R.storage.get(api.LIVE_HISTORY_V2_STORAGE_KEY),
      );
      assert.equal(
        parsed.watchedAt["A:xtream-live:42"],
        p.historyTimes["A:xtream-live:42"],
      );
      await p.removeWatched("A:xtream-live:42");
      assert.equal(player().history.includes("A:xtream-live:42"), false);
    },
  );
  assert.equal(checks, 19);
  console.log(
    `Elite V4 persistence production host: ${checks}/19 passed; HOST_NOT_PHYSICAL`,
  );
  H.cleanup("media");
  H.cleanup("player");
} finally {
  globalThis.fetch = originalFetch;
  rmSync(out, { recursive: true, force: true });
}
