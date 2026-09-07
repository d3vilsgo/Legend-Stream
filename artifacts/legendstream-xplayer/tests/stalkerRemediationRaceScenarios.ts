import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { enqueueCatalogDbWrite } from "../lib/catalogDbWriter";
import { resolveStalkerLiveCreateLink } from "../lib/stalkerLiveCatalog";
import { stalkerLiveStagingProviderId } from "../lib/stalkerLiveStaging";
import { createStalkerPortalSession, StalkerPortalError } from "../lib/stalkerPortal";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheSource = readFileSync(resolve(ROOT, "lib/stalkerLiveCache.ts"), "utf8");
const syncSource = readFileSync(resolve(ROOT, "lib/stalkerLiveSync.ts"), "utf8");
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
    CREATE TABLE catalog_items (
      provider_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      item_id TEXT NOT NULL,
      PRIMARY KEY (provider_id, kind, item_id)
    );
  `);
  return db;
}

function insertLive(db: DatabaseSync, providerId: string, itemId: string) {
  db.prepare("INSERT OR REPLACE INTO catalog_items (provider_id, kind, item_id) VALUES (?, 'live', ?)")
    .run(providerId, itemId);
}

function cleanupNamespace(db: DatabaseSync, stagingId: string) {
  db.prepare("DELETE FROM catalog_items WHERE provider_id = ?").run(stagingId);
}

function liveIds(db: DatabaseSync, providerId: string) {
  return db.prepare(
    "SELECT item_id FROM catalog_items WHERE provider_id = ? AND kind = 'live' ORDER BY item_id ASC",
  ).all(providerId).map((row) => String((row as { item_id: string }).item_id));
}

function publishNamespace(db: DatabaseSync, providerId: string, stagingId: string, expectedCount: number) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(
      "SELECT COUNT(*) AS count FROM catalog_items WHERE provider_id = ? AND kind = 'live'",
    ).get(stagingId) as { count: number } | undefined;
    if (Number(row?.count ?? 0) !== expectedCount) {
      throw new Error("Stalker Live staging cardinality changed before publish.");
    }
    db.prepare("DELETE FROM catalog_items WHERE provider_id = ? AND kind = 'live'").run(providerId);
    db.prepare(
      "UPDATE catalog_items SET provider_id = ? WHERE provider_id = ? AND kind = 'live'",
    ).run(providerId, stagingId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function assertProductionRunScopedWiring() {
  assert.match(cacheSource, /cleanupStalkerLiveStaging\(providerId: string, stagingId: string\)/);
  assert.match(cacheSource, /DELETE FROM catalog_items WHERE provider_id = \?"?,?\s*stagingId/s);
  assert.match(cacheSource, /upsertCatalogItems\(stagingId, "live", staged/);
  assert.match(cacheSource, /isCancelled:\s*\(\) => Boolean\(isCurrent && !isCurrent\(\)\)/);
  assert.match(cacheSource, /onBatchStarted:\s*assertCurrent/);
  assert.match(cacheSource, /onSqliteStage:\s*assertCurrent/);
  assert.match(cacheSource, /SELECT COUNT\(\*\) AS count FROM catalog_items WHERE provider_id = \? AND kind = 'live'/);
  const countCheck = cacheSource.indexOf("stagedCount !== itemCount");
  const activeDelete = cacheSource.indexOf("DELETE FROM catalog_items WHERE provider_id = ? AND kind = 'live'", countCheck);
  assert.ok(countCheck >= 0 && activeDelete > countCheck, "cardinality must be checked before active Live deletion");

  assert.match(syncSource, /const stagingId = stalkerLiveStagingProviderId\(/);
  assert.match(syncSource, /cleanupStalkerLiveStaging\(providerId, stagingId\)/);
  assert.match(syncSource, /stageStalkerLivePage\(providerId, stagingId, items, syncStartedAt, options\.isCurrent\)/);
  assert.match(syncSource, /commitStalkerLiveStaging\(\s*providerId,\s*stagingId,/s);
}

async function main() {
  await scenario("stale queued stage cannot contaminate a newer run-scoped staging namespace", async () => {
    assertProductionRunScopedWiring();
    const providerId = "provider-race-stage";
    const stagingA = stalkerLiveStagingProviderId(providerId, "run-a");
    const stagingB = stalkerLiveStagingProviderId(providerId, "run-b");
    assert.notEqual(stagingA, stagingB);

    const db = createRaceDatabase();
    insertLive(db, providerId, "old-good");
    let runACurrent = true;
    let releaseWriter!: () => void;
    const writerGate = new Promise<void>((resolveGate) => { releaseWriter = resolveGate; });

    const blocker = enqueueCatalogDbWrite(async () => writerGate);
    const delayedA = enqueueCatalogDbWrite(async () => {
      if (!runACurrent) return;
      insertLive(db, stagingA, "A-stale");
    });

    runACurrent = false;
    const cleanupB = enqueueCatalogDbWrite(async () => cleanupNamespace(db, stagingB));
    const stageB = enqueueCatalogDbWrite(async () => insertLive(db, stagingB, "B-current"));
    const publishB = enqueueCatalogDbWrite(async () => publishNamespace(db, providerId, stagingB, 1));

    releaseWriter();
    await Promise.all([blocker, delayedA, cleanupB, stageB, publishB]);

    assert.deepEqual(liveIds(db, providerId), ["B-current"]);
    assert.deepEqual(liveIds(db, stagingA), []);
    assert.deepEqual(liveIds(db, stagingB), []);
    db.close();
  });

  await scenario("stale finally cleanup cannot delete B staging after B has staged", async () => {
    assertProductionRunScopedWiring();
    const providerId = "provider-race-finally";
    const stagingA = stalkerLiveStagingProviderId(providerId, "run-a");
    const stagingB = stalkerLiveStagingProviderId(providerId, "run-b");
    const db = createRaceDatabase();
    insertLive(db, providerId, "old-good");

    await enqueueCatalogDbWrite(async () => cleanupNamespace(db, stagingB));
    await enqueueCatalogDbWrite(async () => insertLive(db, stagingB, "B-1"));
    await enqueueCatalogDbWrite(async () => insertLive(db, stagingB, "B-2"));

    // Run A is stale here. Its unconditional finally cleanup is still legal,
    // but run-scoped identity constrains it to A's physical namespace.
    await enqueueCatalogDbWrite(async () => cleanupNamespace(db, stagingA));

    assert.deepEqual(liveIds(db, providerId), ["old-good"], "stale cleanup must not touch active good catalog");
    assert.deepEqual(liveIds(db, stagingB), ["B-1", "B-2"], "stale cleanup must not touch B staging");

    await enqueueCatalogDbWrite(async () => publishNamespace(db, providerId, stagingB, 2));
    assert.deepEqual(liveIds(db, providerId), ["B-1", "B-2"]);
    assert.deepEqual(liveIds(db, stagingA), []);
    assert.deepEqual(liveIds(db, stagingB), []);
    db.close();
  });

  await scenario("A staged rows then stale cleanup cannot affect B cleanup stage and publish", async () => {
    const providerId = "provider-race-secondary";
    const stagingA = stalkerLiveStagingProviderId(providerId, "run-a");
    const stagingB = stalkerLiveStagingProviderId(providerId, "run-b");
    const db = createRaceDatabase();
    insertLive(db, providerId, "old-good-2");

    await enqueueCatalogDbWrite(async () => insertLive(db, stagingA, "A-before-loss"));
    await enqueueCatalogDbWrite(async () => cleanupNamespace(db, stagingB));
    await enqueueCatalogDbWrite(async () => insertLive(db, stagingB, "B-after-cleanup"));
    await enqueueCatalogDbWrite(async () => cleanupNamespace(db, stagingA));

    assert.deepEqual(liveIds(db, providerId), ["old-good-2"]);
    assert.deepEqual(liveIds(db, stagingA), []);
    assert.deepEqual(liveIds(db, stagingB), ["B-after-cleanup"]);

    await enqueueCatalogDbWrite(async () => publishNamespace(db, providerId, stagingB, 1));
    assert.deepEqual(liveIds(db, providerId), ["B-after-cleanup"]);
    db.close();
  });

  await scenario("zero or partial staging fails closed before destroying active good catalog", async () => {
    const providerId = "provider-cardinality";
    const stagingB = stalkerLiveStagingProviderId(providerId, "run-b");
    const db = createRaceDatabase();
    insertLive(db, providerId, "old-good-cardinality");
    insertLive(db, stagingB, "B-partial");

    await assert.rejects(
      enqueueCatalogDbWrite(async () => publishNamespace(db, providerId, stagingB, 2)),
      /staging cardinality changed before publish/i,
    );
    assert.deepEqual(liveIds(db, providerId), ["old-good-cardinality"]);
    assert.deepEqual(liveIds(db, stagingB), ["B-partial"]);
    db.close();
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
