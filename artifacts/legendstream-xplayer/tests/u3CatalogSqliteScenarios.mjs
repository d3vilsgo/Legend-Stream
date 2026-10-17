import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(app, "package.json"));
const { build } = createRequire(resolve(app, "../api-server/package.json"))(
  "esbuild",
);
const out = mkdtempSync(join(tmpdir(), "u3-sqlite-"));
const db = new DatabaseSync(":memory:");
const bind = (args) =>
  args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
const handle = {
  execAsync: async (sql) => db.exec(sql),
  runAsync: async (sql, ...args) => db.prepare(sql).run(...bind(args)),
  getFirstAsync: async (sql, ...args) => db.prepare(sql).get(...bind(args)),
  getAllAsync: async (sql, ...args) => db.prepare(sql).all(...bind(args)),
  prepareAsync: async (sql) => ({
    executeAsync: async (args) => db.prepare(sql).run(...args),
    finalizeAsync: async () => {},
  }),
  withExclusiveTransactionAsync: async (fn) => {
    db.exec("BEGIN");
    try {
      await fn(handle);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  },
};
globalThis.__catalogSqlite = handle;
try {
  await build({
    stdin: {
      contents: `export * from ${JSON.stringify(join(app, "lib/catalogCache.ts"))};export {projectCatalogItems} from ${JSON.stringify(join(app, "lib/catalogPersistence.ts"))};`,
      resolveDir: app,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "cache.cjs"),
    logLevel: "silent",
    plugins: [
      {
        name: "sqlite-host",
        setup(b) {
          b.onResolve(
            { filter: /^(expo-sqlite|react-native)$|performanceDiagnostics$/ },
            (args) => ({ path: args.path, namespace: "mock" }),
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents:
              args.path === "expo-sqlite"
                ? `export const openDatabaseAsync=async()=>globalThis.__catalogSqlite;`
                : args.path === "react-native"
                  ? `export const InteractionManager=undefined;`
                  : `export const markStartupEvent=()=>{};`,
            loader: "js",
          }));
        },
      },
    ],
  });
  const c = req(join(out, "cache.cjs"));
  await c.initCatalogCache();
  assert.deepEqual(await c.getCatalogCounts("p"), {
    live: 0,
    vod: 0,
    series: 0,
  });
  const row = (id, providerId = "p") =>
    c.projectCatalogItems(providerId, "vod", [
      {
        stream_id: id,
        name: "Movie " + id,
        direct_source: "https://secret.invalid/?token=private",
      },
    ]);
  await c.upsertCatalogItems("p", "vod", row(1));
  await c.setCatalogSyncState("p", "ready", 1, 1, "legacy");
  const legacy = await c.getCatalogSyncState("p");
  assert.equal(legacy.lastFullSyncAt, null);
  assert.equal(legacy.lastBackgroundSyncAt, null);
  await c.upsertCatalogItems(
    c.stagingProviderId("p"),
    "vod",
    row(2, c.stagingProviderId("p")),
  );
  let checks = 0;
  const options = {
    providerId: "p",
    vodCategories: [],
    seriesCategories: [],
    readyMessage: "ready",
    readyStamp: "background",
    syncTotal: 1,
    committedCounts: { live: 0, vod: 1, series: 0 },
  };
  await assert.rejects(
    c.swapStagingToProvider({
      ...options,
      assertStillOwned: () => {
        if (++checks === 4) throw new Error("ownership cancelled");
      },
    }),
    /ownership/,
  );
  assert.equal(
    db.prepare("SELECT item_id FROM catalog_items WHERE provider_id='p'").get()
      .item_id,
    "1",
  );
  assert.equal((await c.getCatalogSyncState("p")).lastBackgroundSyncAt, null);
  await c.swapStagingToProvider({ ...options, assertStillOwned: () => {} });
  assert.equal(
    db.prepare("SELECT item_id FROM catalog_items WHERE provider_id='p'").get()
      .item_id,
    "2",
  );
  assert((await c.getCatalogSyncState("p")).lastBackgroundSyncAt > 0);
  await c.setCatalogSyncState("p", "error", 0, 1, "offline");
  assert.equal((await c.getCatalogCounts("p")).vod, 1);
  assert((await c.getCatalogSyncState("p")).lastBackgroundSyncAt > 0);
  assert(
    !db
      .prepare("SELECT payload FROM catalog_items WHERE provider_id='p'")
      .get()
      .payload.includes("private"),
  );
  assert.deepEqual(await c.getCatalogCounts("other"), {
    live: 0,
    vod: 0,
    series: 0,
  });
  console.log(
    "U3 production SQLite cache retention/rollback/legacy read: 6/6 passed; HOST_SQLITE_NOT_ANDROID",
  );
} finally {
  db.close();
  delete globalThis.__catalogSqlite;
  rmSync(out, { recursive: true, force: true });
}
