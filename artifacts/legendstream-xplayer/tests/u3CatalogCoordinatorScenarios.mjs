import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(app, "package.json"));
const { build } = createRequire(resolve(app, "../api-server/package.json"))(
  "esbuild",
);
const ts = req("typescript");
const file = join(app, "context/CatalogSyncContext.tsx");
const source = ts.createSourceFile(
  file,
  readFileSync(file, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const mocks = {};
for (const node of source.statements) {
  if (!ts.isImportDeclaration(node)) continue;
  const path = node.moduleSpecifier.text;
  const exports =
    node.importClause?.namedBindings?.elements?.map(
      (e) => e.propertyName?.text ?? e.name.text,
    ) ?? [];
  mocks[path] =
    (mocks[path] ?? "\n") +
    exports
      .map(
        (name) =>
          `export const ${name}=(...args)=>globalThis.__catalog.call(${JSON.stringify(name)},args);`,
      )
      .join("\n");
}
mocks.react = `export const useRef=v=>globalThis.__catalog.ref(v),useState=v=>globalThis.__catalog.state(v),useMemo=(f,d)=>globalThis.__catalog.memo(f,d),useCallback=(f,d)=>globalThis.__catalog.memo(()=>f,d),useEffect=(f,d)=>globalThis.__catalog.effect(f,d),useLayoutEffect=useEffect;export const useContext=()=>globalThis.__catalog.value;export const createContext=()=>({Provider:'provider'});export default {createElement:(tag,p)=>{if(tag==='provider')globalThis.__catalog.value=p.value;return null;}};`;
mocks["react-native"] =
  `export const Platform={OS:'android'},StyleSheet={create:s=>s,hairlineWidth:1},ActivityIndicator='a',Modal='m',Pressable='p',Text='t',View='v';`;
mocks["@react-native-async-storage/async-storage"] =
  `export default {getItem:async()=>JSON.stringify(globalThis.__catalog.policy),setItem:async()=>{}};`;
const real = new Set([
  "@/lib/catalogAvailability",
  "@/lib/catalogRefreshPolicy",
  "@/lib/m3uTransportRouting",
]);
const out = mkdtempSync(join(tmpdir(), "u3-coordinator-"));
const originalTimeout = globalThis.setTimeout,
  originalClear = globalThis.clearTimeout;
let slots = [],
  cursor = 0,
  effects = [],
  dirty = false;
const same = (a, b) =>
  a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const fixture = (id) => ({
  counts: { live: 0, vod: 3, series: 0 },
  state: {
    providerId: id,
    phase: "ready",
    updatedAt: 900000,
    lastBackgroundSyncAt: Date.now() - 1000,
  },
  movies: [{ stream_id: id + "-1" }],
});
const data = new Map([
  ["a", fixture("a")],
  ["b", fixture("b")],
]);
let blockState = null,
  refresh = null,
  calls = 0;
const timers = new Map();
let timerId = 0;
const h = (globalThis.__catalog = {
  provider: { id: "a", type: "m3u" },
  policy: {
    version: 1,
    automaticRefreshEnabled: true,
    refreshIntervalHours: 24,
  },
  value: null,
  ref(v) {
    const i = cursor++;
    return slots[i] ?? (slots[i] = { current: v });
  },
  state(v) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof v === "function" ? v() : v;
    return [
      slots[i],
      (next) => {
        const value = typeof next === "function" ? next(slots[i]) : next;
        if (!Object.is(slots[i], value)) {
          slots[i] = value;
          dirty = true;
        }
      },
    ];
  },
  memo(f, d) {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].deps, d))
      slots[i] = { deps: d, value: f() };
    return slots[i].value;
  },
  effect(f, d) {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].deps, d)) {
      const old = slots[i];
      slots[i] = { deps: d, cleanup: old?.cleanup };
      effects.push(() => {
        old?.cleanup?.();
        slots[i].cleanup = f();
      });
    }
  },
  call(name, args) {
    if (name === "usePlayer")
      return {
        provider: h.provider,
        isHydrating: false,
        m3uCatalogCommit: null,
        refreshProvider: run,
        refreshProviderInBackground: run,
      };
    if (name === "useColors") return {};
    if (name === "useI18n") return { language: "tr" };
    if (name === "initCatalogCache") return Promise.resolve();
    if (name === "getCatalogCounts")
      return Promise.resolve(data.get(args[0]).counts);
    if (name === "getCatalogSyncState")
      return blockState && args[0] === "a"
        ? blockState.promise
        : Promise.resolve(data.get(args[0]).state);
    if (name === "getCachedVodItems")
      return Promise.resolve(data.get(args[0].id).movies);
    if (
      [
        "getCachedLiveItems",
        "getCachedSeriesItems",
        "getNewCachedLiveItems",
        "getNewCachedVodItems",
        "getNewCachedSeriesItems",
      ].includes(name)
    )
      return Promise.resolve([]);
    if (name === "observeStartupPromise") return args[2];
    if (name === "getPerformanceDiagnosticsSnapshot") return { gauges: {} };
    return undefined;
  },
});
function run() {
  calls++;
  return refresh?.promise ?? Promise.resolve(false);
}
const deferred = () => {
  let resolve;
  return {
    promise: new Promise((r) => {
      resolve = r;
    }),
    resolve: (v) => resolve(v),
  };
};
try {
  await build({
    entryPoints: [file],
    outfile: join(out, "coordinator.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "transform",
    logLevel: "silent",
    plugins: [
      {
        name: "coordinator-host",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            if (real.has(args.path))
              return { path: join(app, args.path.slice(2) + ".ts") };
            if (args.path in mocks)
              return { path: args.path, namespace: "mock" };
          });
          b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
            resolveDir: app,
          }));
        },
      },
    ],
  });
  const { CatalogSyncProvider } = req(join(out, "coordinator.cjs"));
  globalThis.setTimeout = (fn, delay) => {
    const id = ++timerId;
    timers.set(id, { fn, delay });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  const render = () => {
    dirty = false;
    cursor = 0;
    CatalogSyncProvider({ children: null });
    const q = effects;
    effects = [];
    q.forEach((f) => f());
  };
  const settle = async () => {
    for (let i = 0; i < 45; i++) {
      await Promise.resolve();
      if (dirty) render();
    }
  };
  render();
  await settle();
  assert.equal(h.value.snapshot.providerId, "a");
  assert.equal(h.value.snapshot.movies[0].stream_id, "a-1");
  assert(h.value.hasUsableCache);
  assert(timers.size > 0);
  assert([...timers.values()].every((t) => t.delay > 1250));
  refresh = deferred();
  const first = h.value.refreshCatalog();
  const second = h.value.refreshCatalog();
  await settle();
  assert.equal(calls, 1);
  assert.equal(h.value.snapshot.movies[0].stream_id, "a-1");
  refresh.resolve(false);
  await Promise.all([first, second]);
  await settle();
  assert.equal(h.value.syncState.phase, "error");
  assert(h.value.hasUsableCache);
  assert.equal(h.value.snapshot.movies[0].stream_id, "a-1");
  refresh = deferred();
  const success = h.value.refreshCatalog();
  data.get("a").movies = [{ stream_id: "a-new" }];
  data.get("a").state.lastBackgroundSyncAt = Date.now();
  refresh.resolve(true);
  await success;
  await settle();
  assert.equal(h.value.snapshot.movies[0].stream_id, "a-new");
  assert.equal(h.value.syncState.phase, "ready");
  refresh = deferred();
  const stale = h.value.refreshCatalog();
  h.provider = { id: "b", type: "m3u" };
  render();
  await settle();
  assert.equal(h.value.snapshot.providerId, "b");
  refresh.resolve(false);
  await stale;
  await settle();
  assert.equal(h.value.snapshot.providerId, "b");
  assert.equal(h.value.syncState.phase, "ready");
  h.provider = { id: "a", type: "m3u" };
  render();
  await settle();
  blockState = deferred();
  const late = h.value.refreshSnapshot();
  await Promise.resolve();
  h.provider = { id: "b", type: "m3u" };
  render();
  await settle();
  const bStamp = h.value.lastSuccessfulAt;
  blockState.resolve({ ...data.get("a").state, lastBackgroundSyncAt: 123 });
  await late;
  await settle();
  assert.equal(h.value.lastSuccessfulAt, bStamp);
  assert.equal(h.value.snapshot.providerId, "b");
  // The real scheduler callback is ownership-gated even if invoked after cleanup.
  const captured = [...timers.values()][0];
  const before = calls;
  h.provider = { id: "a", type: "m3u" };
  blockState = null;
  render();
  await settle();
  captured?.fn();
  await settle();
  assert.equal(calls, before);
  data.set("expired", fixture("expired"));
  data.get("expired").state.lastBackgroundSyncAt =
    Date.now() - 25 * 60 * 60 * 1000;
  h.provider = { id: "expired", type: "m3u" };
  render();
  await settle();
  const automatic = [...timers.values()].find((t) => t.delay === 0);
  assert(automatic);
  refresh = deferred();
  const countBefore = calls;
  automatic.fn();
  automatic.fn();
  await settle();
  assert.equal(calls, countBefore + 1);
  refresh.resolve(false);
  await settle();
  assert(h.value.hasUsableCache);
  assert.equal(h.value.syncState.phase, "error");
  await h.value.setRefreshPolicy({
    version: 1,
    automaticRefreshEnabled: false,
    refreshIntervalHours: 24,
  });
  await settle();
  assert.equal(timers.size, 0);
  console.log(
    "U3 production CatalogSync coordinator: 9/9 passed; HOST_EFFECTS_NOT_ANDROID",
  );
} finally {
  for (const s of slots) s?.cleanup?.();
  globalThis.setTimeout = originalTimeout;
  globalThis.clearTimeout = originalClear;
  delete globalThis.__catalog;
  rmSync(out, { recursive: true, force: true });
}
