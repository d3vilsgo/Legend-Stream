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
const out = mkdtempSync(join(tmpdir(), "u4-home-info-"));
let slots = [],
  cursor = 0,
  effects = [],
  count = 0;
const h = (globalThis.__homeInfo = {
  state(v) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = v;
    return [
      slots[i],
      (next) => {
        slots[i] = next;
      },
    ];
  },
  ref(v) {
    const i = cursor++;
    return slots[i] ?? (slots[i] = { current: v });
  },
});
try {
  await build({
    entryPoints: [join(app, "hooks/useHomeMovieInfo.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "hook.cjs"),
    logLevel: "silent",
    plugins: [
      {
        name: "host",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === "react")
              return { path: "react", namespace: "host" };
            if (args.path.startsWith("@/")) {
              const base = join(app, args.path.slice(2));
              return {
                path: [base, base + ".ts", base + ".tsx"].find(existsSync),
              };
            }
          });
          b.onLoad({ filter: /.*/, namespace: "host" }, () => ({
            contents: `export const useState=v=>globalThis.__homeInfo.state(v),useRef=v=>globalThis.__homeInfo.ref(v),useCallback=f=>f,useEffect=f=>globalThis.__homeInfo.effects.push(f);`,
            loader: "js",
          }));
        },
      },
    ],
  });
  const { useHomeMovieInfo } = req(join(out, "hook.cjs"));
  const first = {
    stream_id: "portal-or-m3u:77",
    name: "Original",
    plot: "Local plot",
  };
  const played = [];
  let options = {
    providerId: "a",
    providerType: "xtream",
    revision: "r1",
    items: [first],
    enabled: true,
    onPlay: (item) => played.push(item),
  };
  const render = (patch = {}) => {
    options = { ...options, ...patch };
    cursor = 0;
    effects = [];
    h.effects = effects;
    const value = useHomeMovieInfo(options);
    effects.forEach((f) => f());
    return value;
  };
  const test = (name, fn) => {
    fn();
    console.log(`ok U4 Home Film Info ${++count} - ${name}`);
  };
  let info = render();
  test("selection has no playback side effect", () => {
    info.select(first);
    info = render();
    assert.equal(info.movie, first);
    assert.equal(played.length, 0);
    assert.equal(info.input.identity.catalogId, first.stream_id);
    assert.equal(info.local.overview, "Local plot");
  });
  test("metadata identity remains provider scoped", () => {
    assert.equal(info.input.identity.provider, "xtream");
    assert.equal(info.input.identity.providerId, "a");
    assert(!("url" in info.input));
  });
  test("refresh keeps selected identity and updates current source", () => {
    info = render({
      items: [
        {
          ...first,
          name: "Refreshed",
          direct_source: "https://example.invalid/new",
        },
      ],
      revision: "r2",
    });
    assert.equal(info.local.title, "Refreshed");
    assert.equal(info.input.catalogRevision, "r2");
  });
  test("Play resolves current provider object once", () => {
    info.close();
    info.play();
    info.play();
    assert.equal(played.length, 1);
    assert.equal(played[0], options.items[0]);
    info = render();
    assert.equal(info.movie, null);
  });
  test("close does not start playback", () => {
    info.select(first);
    info = render();
    info.close();
    info = render();
    assert.equal(info.movie, null);
    assert.equal(played.length, 1);
  });
  test("removed item closes and does not resurrect", () => {
    info.select(first);
    info = render();
    const old = info.play;
    info = render({ items: [] });
    old();
    assert.equal(played.length, 1);
    info = render({ items: [first] });
    assert.equal(info.movie, null);
  });
  test("provider switch blocks old modal even with same catalog id", () => {
    info.select(first);
    info = render();
    const old = info.play;
    info = render({ providerId: "b" });
    old();
    assert.equal(info.movie, null);
    assert.equal(played.length, 1);
    info = render();
  });
  test("M3U uses original string identity", () => {
    info = render({ providerType: "m3u" });
    info.select(first);
    info = render();
    assert.equal(info.input.identity.provider, "m3u");
    assert.equal(info.input.identity.catalogId, first.stream_id);
  });
  test("old callback cannot play replacement selection", () => {
    const old = info.play;
    const second = { stream_id: "next", name: "Next" };
    info = render({ items: [first, second] });
    info.select(second);
    info = render();
    old();
    assert.equal(played.length, 1);
    assert.equal(info.movie, second);
  });
  test("leaving Home invalidates selection and stale Play", () => {
    const old = info.play;
    info = render({ enabled: false });
    old();
    assert.equal(played.length, 1);
    info = render({ enabled: true });
    assert.equal(info.movie, null);
  });
  test("missing and unsupported providers cannot select", () => {
    info = render({ providerType: "stalker" });
    info.select(first);
    info = render();
    assert.equal(info.movie, null);
    info = render({ providerId: undefined, providerType: undefined });
    info.select(first);
    info = render();
    assert.equal(info.movie, null);
  });
  test("unknown Home item cannot open Info", () => {
    info = render({ providerId: "a", providerType: "xtream" });
    info.select({ stream_id: "absent", name: "Missing" });
    info = render();
    assert.equal(info.movie, null);
  });
  const shell = readFileSync(
    join(app, "components/OptimizedHomeScreenPaged.tsx"),
    "utf8",
  );
  const modal = readFileSync(
    join(app, "components/tmdb/MovieInfoModal.tsx"),
    "utf8",
  );
  test("production Home uses Info while catalog retains playback callback", () => {
    assert.match(shell, /onOpenMovie=\{homeMovieInfo.select\}/);
    assert.match(shell, /onOpen=\{openMovie\}/);
    assert.match(shell, /onPlay: item => openMovie\(item, "home"\)/);
    assert.match(shell, /onPlay=\{homeMovieInfo.play\}/);
    assert.match(shell, /returnTo: ContentView = "movies"/);
    assert.match(shell, /kind: "movie", returnTo, vodIdentity:/);
  });
  test("new movies shelf participates in the same current snapshot identity set", () => {
    assert.match(
      shell,
      /items: \[\.\.\.homeMovies, \.\.\.\(activeSnapshot\?\.newMovies \?\? \[\]\)\]/,
    );
  });
  test("modal and Home retain shared scope, Back and scroll ownership", () => {
    assert.match(modal, /pushFocusScope\("movie-info"\)/);
    assert.match(modal, /registerBackAction\(onClose\)/);
    assert.match(modal, /onRequestClose=\{onClose\}/);
    assert.match(
      shell,
      /scrollEnabled=\{!catalogDrawerOpen && !homeMovieInfo.movie && !pagedSeries.state\}/,
    );
  });
  console.log(
    `U4 Home Film Info: ${count}/${count} passed; HOST_HOOK_AND_SOURCE_CONTRACT_NOT_PHYSICAL`,
  );
} finally {
  delete globalThis.__homeInfo;
  rmSync(out, { recursive: true, force: true });
}
