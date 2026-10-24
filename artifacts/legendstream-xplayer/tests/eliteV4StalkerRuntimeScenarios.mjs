import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(resolve(app, "../api-server/package.json"))(
    "esbuild",
  ),
  req = createRequire(join(app, "package.json"));
const out = mkdtempSync(join(tmpdir(), "p6-stalker-runtime-"));
const oldFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw Error("UNEXPECTED_NETWORK");
};
try {
  await build({
    stdin: {
      resolveDir: app,
      loader: "ts",
      contents: `export {resolveCatalogRuntimeSource,liveRuntimeItem} from './lib/catalogRuntime';export {normalizeStalkerLivePage,projectStalkerLiveItem} from './lib/stalkerLiveCatalog';export {getOrCreateStalkerPortalSession,releaseStalkerPortalSession,isRegisteredStalkerPortalSession} from './lib/stalkerPortalRuntime';export {readCurrentStalkerProductSession,isCurrentStalkerProductSession} from './lib/stalkerProductSession';`,
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: join(out, "runtime.cjs"),
    logLevel: "silent",
    plugins: [
      {
        name: "platform-boundaries",
        setup(b) {
          const mocks = {
            "expo-sqlite": `export function openDatabaseAsync(){throw Error("UNEXPECTED_DATABASE");}`,
            "@react-native-async-storage/async-storage": `export default{getItem:async()=>null,setItem:async()=>{}};`,
            "react-native": `export const Platform={OS:'test'};`,
          };
          b.onResolve({ filter: /.*/ }, (a) =>
            mocks[a.path] ? { path: a.path, namespace: "boundary" } : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "boundary" }, (a) => ({
            contents: mocks[a.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const ui = req(join(out, "runtime.cjs"));
  let checks = 0;
  const ids = [];
  const json = (value, status = 200) =>
    new Response(JSON.stringify({ js: value }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const fixture = (suffix, options = {}) => {
    const provider = {
        id: "p6-" + suffix,
        type: "stalker",
        url: "https://portal.invalid/c/",
        mac: "00:11:22:33:44:55",
      },
      calls = [];
    let handshakes = 0,
      links = 0;
    const session = ui.getOrCreateStalkerPortalSession({
      providerId: provider.id,
      portalUrl: provider.url,
      mac: provider.mac,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input)),
          action = url.searchParams.get("action");
        calls.push({ action, cmd: url.searchParams.get("cmd") });
        if (action === "handshake")
          return json({ token: "fixture-token-" + ++handshakes });
        if (action === "create_link") {
          links++;
          if (options.expire && links === 1)
            return json({ error: "authorization expired" }, 401);
          return json({
            cmd:
              "ffmpeg " +
              (options.url ??
                "https://stream.invalid/play/live.php?stream=real-9"),
          });
        }
        throw Error("UNEXPECTED_PORTAL_ACTION");
      },
    });
    ids.push(provider.id);
    const raw = {
      data: [
        {
          id: 9,
          name: "Provider channel",
          tv_genre_id: "7",
          cmd: "ffmpeg provider-current-command",
        },
      ],
      total_items: 1,
      max_page_items: 1,
      cur_page: 1,
    };
    const channel = ui.normalizeStalkerLivePage(raw, provider.id, 1, [
        { id: "7", name: "News" },
      ]).items[0],
      persisted = ui.projectStalkerLiveItem(provider.id, channel),
      runtime = ui.liveRuntimeItem(persisted, provider);
    const dependencies = {
      getStalkerPlaybackRef: async () => persisted.playbackRef,
      getStalkerCategoryHint: async () => null,
      acquireStalkerSession: () => session,
      discoverStalkerLive: async () => ({
        rows: [{ portalId: "9", cmd: channel.cmd }],
      }),
    };
    return {
      provider,
      session,
      calls,
      channel,
      persisted,
      runtime,
      dependencies,
      get handshakes() {
        return handshakes;
      },
    };
  };
  const check = async (name, fn) => {
    await fn();
    console.log(`PASS P6 Stalker runtime ${++checks} - ${name}`);
  };
  await check(
    "canonical projection persists provider channel identity without cmd or transport credentials",
    async () => {
      const f = fixture("projection");
      assert.equal(f.persisted.playbackRef.type, "stalker-live");
      assert.equal(f.persisted.playbackRef.portalId, "9");
      assert.match(
        f.runtime.streamUrl,
        /^legendstream-catalog:\/\/stalker\/live\//,
      );
      assert.doesNotMatch(
        JSON.stringify(f.persisted),
        /provider-current-command|fixture-token|00:11:22/,
      );
    },
  );
  await check(
    "real runtime resolver reacquires current command and uses authenticated create_link",
    async () => {
      const f = fixture("resolve");
      const url = await ui.resolveCatalogRuntimeSource(
        f.runtime.streamUrl,
        f.provider,
        undefined,
        f.dependencies,
      );
      assert.equal(url, "https://stream.invalid/play/live.php?stream=real-9");
      assert.deepEqual(
        f.calls.map((c) => c.action),
        ["handshake", "create_link"],
      );
      assert.equal(f.calls[1].cmd, f.channel.cmd);
    },
  );
  await check(
    "expired portal authorization performs one re-handshake and bounded create_link retry",
    async () => {
      const f = fixture("expiry", { expire: true });
      const url = await ui.resolveCatalogRuntimeSource(
        f.runtime.streamUrl,
        f.provider,
        undefined,
        f.dependencies,
      );
      assert.match(url, /stream=real-9/);
      assert.equal(f.handshakes, 2);
      assert.equal(f.calls.filter((c) => c.action === "create_link").length, 2);
    },
  );
  await check(
    "foreign account runtime identity is rejected before portal request",
    async () => {
      const f = fixture("foreign");
      await assert.rejects(
        ui.resolveCatalogRuntimeSource(
          f.runtime.streamUrl,
          { ...f.provider, id: "other" },
          undefined,
          f.dependencies,
        ),
      );
      assert.equal(f.calls.length, 0);
    },
  );
  await check(
    "cancelled source cannot reacquire or create a stream",
    async () => {
      const f = fixture("cancelled"),
        abort = new AbortController();
      abort.abort();
      await assert.rejects(
        ui.resolveCatalogRuntimeSource(
          f.runtime.streamUrl,
          f.provider,
          abort.signal,
          f.dependencies,
        ),
      );
      assert.equal(f.calls.length, 0);
    },
  );
  await check(
    "missing actual channel does not invent a playable URL",
    async () => {
      const f = fixture("missing");
      await assert.rejects(
        ui.resolveCatalogRuntimeSource(
          f.runtime.streamUrl,
          f.provider,
          undefined,
          {
            ...f.dependencies,
            discoverStalkerLive: async () => ({ rows: [] }),
          },
        ),
      );
      assert.equal(f.calls.length, 0);
    },
  );
  await check("ambiguous portal identity fails before playback", async () => {
    const f = fixture("ambiguous");
    await assert.rejects(
      ui.resolveCatalogRuntimeSource(
        f.runtime.streamUrl,
        f.provider,
        undefined,
        {
          ...f.dependencies,
          discoverStalkerLive: async () => ({
            rows: [
              { portalId: "9", cmd: "first" },
              { portalId: "9", cmd: "second" },
            ],
          }),
        },
      ),
    );
    assert.equal(f.calls.length, 0);
  });
  await check(
    "disposed ownership checks are read-only and do not recreate a session",
    async () => {
      const f = fixture("released");
      const before = ui.readCurrentStalkerProductSession(f.provider);
      assert.equal(before.session, f.session);
      ui.releaseStalkerPortalSession(f.provider.id);
      assert.equal(
        ui.isCurrentStalkerProductSession(f.provider, f.session),
        false,
      );
      assert.equal(
        ui.isRegisteredStalkerPortalSession(f.provider.id, f.session),
        false,
      );
      await assert.rejects(f.session.handshake());
    },
  );
  await check(
    "same provider ID with changed portal replaces and invalidates the old session",
    async () => {
      const f = fixture("rotated");
      const changed = { ...f.provider, url: "https://another.invalid/c/" };
      const fresh = ui.readCurrentStalkerProductSession(changed);
      assert.notEqual(fresh.session, f.session);
      assert.equal(
        ui.isCurrentStalkerProductSession(changed, f.session),
        false,
      );
      assert.equal(
        ui.isCurrentStalkerProductSession(changed, fresh.session),
        true,
      );
      await assert.rejects(f.session.handshake());
    },
  );
  await check(
    "existing VLC-compatible RTSP source remains supported by canonical portal resolution",
    async () => {
      const f = fixture("rtsp", { url: "rtsp://stream.invalid/real-9" });
      const url = await ui.resolveCatalogRuntimeSource(
        f.runtime.streamUrl,
        f.provider,
        undefined,
        f.dependencies,
      );
      assert.equal(url, "rtsp://stream.invalid/real-9");
    },
  );
  for (const id of ids) ui.releaseStalkerPortalSession(id);
  assert.equal(checks, 10);
  console.log(
    `Elite V4 Stalker runtime: ${checks}/10 passed; FIXTURE_PORTAL_NOT_PHYSICAL`,
  );
} finally {
  globalThis.fetch = oldFetch;
  rmSync(out, { recursive: true, force: true });
}
