import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { PersistedLiveCatalogItem } from "../lib/catalogPersistence";
import {
  cleanupStalkerLiveStaging,
  commitStalkerLiveStaging,
  stageStalkerLivePage,
  type StalkerLiveCacheDependencies,
} from "../lib/stalkerLiveCache";
import { resolveStalkerLiveCreateLink } from "../lib/stalkerLiveCatalog";
import { stalkerLiveStagingProviderId } from "../lib/stalkerLiveStaging";
import { createStalkerPortalSession, StalkerPortalError } from "../lib/stalkerPortal";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playerSource = readFileSync(resolve(ROOT, "components/CompatibilityVideoPlayerV2.tsx"), "utf8");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function expectCancelled(promise: Promise<unknown>) {
  await assert.rejects(promise, (caught: unknown) => {
    assert.ok(caught instanceof StalkerPortalError);
    assert.equal(caught.code, "CANCELLED");
    return true;
  });
}

function createRaceDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE catalog_categories (
      provider_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      category_id TEXT NOT NULL,
      category_name TEXT NOT NULL,
      parent_id INTEGER,
      PRIMARY KEY (provider_id, kind, category_id)
    );

    CREATE TABLE catalog_items (
      provider_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      item_id TEXT NOT NULL,
      category_id TEXT,
      name TEXT NOT NULL,
      image_url TEXT,
      payload TEXT NOT NULL,
      added_at INTEGER NOT NULL DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      is_new INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provider_id, kind, item_id)
    );

    CREATE TABLE catalog_sync_state (
      provider_id TEXT PRIMARY KEY NOT NULL,
      phase TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      updated_at INTEGER NOT NULL,
      last_full_sync_at INTEGER,
      last_background_sync_at INTEGER
    );
  `);
  return db;
}

function createExpoSqliteAdapter(db: DatabaseSync): NonNullable<StalkerLiveCacheDependencies["database"]> {
  const transaction = {
    async runAsync(sql: string, ...params: Array<string | number | null>) {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async getFirstAsync<T>(sql: string, ...params: Array<string | number | null>) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, ...params: Array<string | number | null>) {
      return db.prepare(sql).all(...params) as T[];
    },
    async prepareAsync(sql: string) {
      const statement = db.prepare(sql);
      return {
        async executeAsync(params: Array<string | number | null>) {
          return statement.run(...params);
        },
        async finalizeAsync() {},
      };
    },
  };

  return {
    ...transaction,
    async execAsync(sql: string) {
      db.exec(sql);
    },
    async withExclusiveTransactionAsync(task: (txn: typeof transaction) => Promise<void>) {
      db.exec("BEGIN IMMEDIATE");
      try {
        await task(transaction);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as NonNullable<StalkerLiveCacheDependencies["database"]>;
}

function liveItem(providerId: string, itemId: string, category = "news"): PersistedLiveCatalogItem {
  return {
    schemaVersion: 1,
    catalogKind: "live",
    providerId,
    id: itemId,
    name: itemId,
    category,
    categoryName: category,
    contentType: "live",
    playbackRef: { type: "stalker-live", portalId: itemId, cmd: `ffmpeg http://stream.invalid/${itemId}` },
  };
}

function seedActiveCatalog(db: DatabaseSync, providerId: string, itemId: string) {
  const item = liveItem(providerId, itemId, "old-category");
  db.prepare(`INSERT INTO catalog_items (
      provider_id, kind, item_id, category_id, name, image_url, payload,
      added_at, first_seen_at, last_seen_at, is_new
    ) VALUES (?, 'live', ?, ?, ?, NULL, ?, 0, 1, 1, 0)`)
    .run(providerId, itemId, item.category, item.name, JSON.stringify(item));
  db.prepare(`INSERT INTO catalog_categories
      (provider_id, kind, category_id, category_name, parent_id)
    VALUES (?, 'live', 'old-category', 'Old category', NULL)`)
    .run(providerId);
  db.prepare(`INSERT INTO catalog_sync_state
      (provider_id, phase, completed, total, message, updated_at, last_full_sync_at, last_background_sync_at)
    VALUES (?, 'ready', 1, 1, 'Old catalog ready', 1, 1, 1)`)
    .run(providerId);
}

function liveIds(db: DatabaseSync, providerId: string) {
  return db.prepare(
    "SELECT item_id FROM catalog_items WHERE provider_id = ? AND kind = 'live' ORDER BY item_id ASC",
  ).all(providerId).map((row) => String((row as { item_id: string }).item_id));
}

function categories(db: DatabaseSync, providerId: string) {
  return db.prepare(
    "SELECT category_id, category_name FROM catalog_categories WHERE provider_id = ? AND kind = 'live' ORDER BY category_id",
  ).all(providerId).map((row) => ({
    category_id: String((row as { category_id: string }).category_id),
    category_name: String((row as { category_name: string }).category_name),
  }));
}

function syncState(db: DatabaseSync, providerId: string) {
  return db.prepare(`SELECT phase, completed, total, message, last_full_sync_at, last_background_sync_at
    FROM catalog_sync_state WHERE provider_id = ?`).get(providerId);
}

async function main() {
  await scenario("production cleanup stage and commit preserve B across stale A cleanup", async () => {
    const providerId = "provider-race-stage";
    const stagingA = stalkerLiveStagingProviderId(providerId, "run-a");
    const stagingB = stalkerLiveStagingProviderId(providerId, "run-b");
    assert.notEqual(stagingA, stagingB);

    const db = createRaceDatabase();
    const dependencies = { database: createExpoSqliteAdapter(db) };
    try {
      seedActiveCatalog(db, providerId, "old-good");
      await stageStalkerLivePage(providerId, stagingA, [liveItem(providerId, "A-stale")], 10, () => true, dependencies);

      await cleanupStalkerLiveStaging(providerId, stagingB, dependencies);
      await stageStalkerLivePage(providerId, stagingB, [liveItem(providerId, "B-current")], 20, () => true, dependencies);
      assert.deepEqual(liveIds(db, stagingA), ["A-stale"]);
      assert.deepEqual(liveIds(db, stagingB), ["B-current"], "B staging must physically exist before commit");

      await cleanupStalkerLiveStaging(providerId, stagingA, dependencies);
      assert.deepEqual(liveIds(db, stagingA), []);
      assert.deepEqual(liveIds(db, stagingB), ["B-current"], "stale A cleanup must not delete B staging");

      await commitStalkerLiveStaging(
        providerId,
        stagingB,
        [{ id: "news", name: "News" }],
        1,
        () => true,
        dependencies,
      );
      assert.deepEqual(liveIds(db, providerId), ["B-current"]);
      assert.deepEqual(liveIds(db, stagingA), []);
      assert.deepEqual(liveIds(db, stagingB), []);
      assert.deepEqual(categories(db, providerId), [{ category_id: "news", category_name: "News" }]);
      const publishedState = syncState(db, providerId) as {
        phase: string;
        completed: number;
        total: number;
        message: string;
        last_full_sync_at: number;
        last_background_sync_at: number;
      };
      assert.deepEqual({ ...publishedState, last_background_sync_at: 0 }, {
        phase: "ready",
        completed: 1,
        total: 1,
        message: "Stalker Live catalog ready",
        last_full_sync_at: 1,
        last_background_sync_at: 0,
      });
      assert.ok(publishedState.last_background_sync_at > 1);
    } finally {
      db.close();
    }
  });

  await scenario("production run-scoped DB path isolates A stage from B cleanup stage and publish", async () => {
    const providerId = "provider-race-secondary";
    const stagingA = stalkerLiveStagingProviderId(providerId, "run-a");
    const stagingB = stalkerLiveStagingProviderId(providerId, "run-b");
    assert.notEqual(stagingA, stagingB);
    const db = createRaceDatabase();
    const dependencies = { database: createExpoSqliteAdapter(db) };
    let currentRun: "a" | "b" = "a";
    try {
      seedActiveCatalog(db, providerId, "old-good-2");
      await stageStalkerLivePage(
        providerId,
        stagingA,
        [liveItem(providerId, "A-before-loss")],
        30,
        () => currentRun === "a",
        dependencies,
      );

      currentRun = "b";
      await cleanupStalkerLiveStaging(providerId, stagingB, dependencies);
      await stageStalkerLivePage(
        providerId,
        stagingB,
        [liveItem(providerId, "B-1"), liveItem(providerId, "B-2")],
        40,
        () => currentRun === "b",
        dependencies,
      );
      await cleanupStalkerLiveStaging(providerId, stagingA, dependencies);

      assert.deepEqual(liveIds(db, providerId), ["old-good-2"]);
      assert.deepEqual(liveIds(db, stagingA), []);
      assert.deepEqual(liveIds(db, stagingB), ["B-1", "B-2"]);

      await commitStalkerLiveStaging(providerId, stagingB, [], 2, () => currentRun === "b", dependencies);
      assert.deepEqual(liveIds(db, providerId), ["B-1", "B-2"]);
      assert.deepEqual(liveIds(db, stagingA), []);
      assert.deepEqual(liveIds(db, stagingB), []);
    } finally {
      db.close();
    }
  });

  await scenario("production commit cardinality failure preserves active items categories and state", async () => {
    const providerId = "provider-cardinality";
    const stagingB = stalkerLiveStagingProviderId(providerId, "run-b");
    const db = createRaceDatabase();
    const dependencies = { database: createExpoSqliteAdapter(db) };
    try {
      seedActiveCatalog(db, providerId, "old-good-cardinality");
      await stageStalkerLivePage(providerId, stagingB, [liveItem(providerId, "B-partial")], 50, () => true, dependencies);
      const oldCategories = categories(db, providerId);
      const oldState = syncState(db, providerId);

      await assert.rejects(
        commitStalkerLiveStaging(providerId, stagingB, [{ id: "news", name: "News" }], 2, () => true, dependencies),
        /staging cardinality changed before publish/i,
      );
      assert.deepEqual(liveIds(db, providerId), ["old-good-cardinality"]);
      assert.deepEqual(liveIds(db, stagingB), ["B-partial"]);
      assert.deepEqual(categories(db, providerId), oldCategories);
      assert.deepEqual(syncState(db, providerId), oldState);
    } finally {
      db.close();
    }
  });

  await scenario("production commit ownership loss aborts before destructive mutation", async () => {
    const providerId = "provider-ownership-loss";
    const stagingB = stalkerLiveStagingProviderId(providerId, "run-b");
    const db = createRaceDatabase();
    const dependencies = { database: createExpoSqliteAdapter(db) };
    try {
      seedActiveCatalog(db, providerId, "old-good-ownership");
      await stageStalkerLivePage(providerId, stagingB, [liveItem(providerId, "B-ready")], 60, () => true, dependencies);
      const oldCategories = categories(db, providerId);
      const oldState = syncState(db, providerId);
      let ownershipChecks = 0;
      const losesOwnershipBeforeDelete = () => {
        ownershipChecks += 1;
        return ownershipChecks < 4;
      };

      await assert.rejects(
        commitStalkerLiveStaging(providerId, stagingB, [], 1, losesOwnershipBeforeDelete, dependencies),
        (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "CANCELLED",
      );
      assert.equal(ownershipChecks, 4, "ownership must be challenged after cardinality and before active delete");
      assert.deepEqual(liveIds(db, providerId), ["old-good-ownership"]);
      assert.deepEqual(liveIds(db, stagingB), ["B-ready"]);
      assert.deepEqual(categories(db, providerId), oldCategories);
      assert.deepEqual(syncState(db, providerId), oldState);
    } finally {
      db.close();
    }
  });

  await scenario("player switch aborts pending create_link without auth retry and B proceeds", async () => {
    assert.match(playerSource, /const controller = new AbortController\(\)/);
    assert.match(playerSource, /resolveCatalogRuntimeSource\(currentSource, provider, controller\.signal\)/);
    assert.match(playerSource, /cancelled = true;\s*controller\.abort\(\)/s);
    assert.match(playerSource, /if \(!cancelled\) setResolvedSource\(next\)/);

    const controllerA = new AbortController();
    let handshakesA = 0;
    let createsA = 0;
    let createStarted!: () => void;
    const createStartedPromise = new Promise<void>((resolveStarted) => { createStarted = resolveStarted; });

    const sessionA = createStalkerPortalSession({
      portalUrl: "http://portal.invalid/stalker_portal/",
      mac: "00:1A:79:12:34:56",
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.includes("action=handshake")) {
          handshakesA += 1;
          return new Response(JSON.stringify({ js: { token: "token-a" } }), { status: 200 });
        }
        createsA += 1;
        createStarted();
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    });

    const pendingA = resolveStalkerLiveCreateLink(
      sessionA,
      "ffmpeg http://canonical.invalid/a",
      controllerA.signal,
    );
    await createStartedPromise;
    controllerA.abort();
    await expectCancelled(pendingA);
    assert.equal(handshakesA, 1, "cancellation must not trigger re-handshake");
    assert.equal(createsA, 1, "cancellation must not retry create_link");

    const controllerB = new AbortController();
    const sessionB = createStalkerPortalSession({
      portalUrl: "http://portal.invalid/stalker_portal/",
      mac: "00:1A:79:12:34:56",
      fetchImpl: async (input) => String(input).includes("action=handshake")
        ? new Response(JSON.stringify({ js: { token: "token-b" } }), { status: 200 })
        : new Response(JSON.stringify({ js: { cmd: "ffmpeg https://stream.invalid/b" } }), { status: 200 }),
    });
    const resolvedB = await resolveStalkerLiveCreateLink(
      sessionB,
      "ffmpeg http://canonical.invalid/b",
      controllerB.signal,
    );
    assert.equal(resolvedB, "https://stream.invalid/b");
  });

  assert.equal(passed, 5);
  console.log("stalker remediation race scenarios: 5/5 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
