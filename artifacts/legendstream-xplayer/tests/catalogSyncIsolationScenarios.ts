import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isCatalogSyncOwnershipCurrent,
  publishSuccessfulCatalogCommitIfCurrent,
  type CatalogSyncMode,
  type CatalogSyncOwnership,
} from "../lib/catalogAvailability";
import { enqueueCatalogDbWrite } from "../lib/catalogDbWriter";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contextSource = readFileSync(resolve(ROOT, "context/CatalogSyncContext.tsx"), "utf8");
const playerSource = readFileSync(resolve(ROOT, "context/PlayerContext.tsx"), "utf8");
const writeRunnerSource = readFileSync(resolve(ROOT, "lib/m3uCacheWriteRunner.ts"), "utf8");

let passed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function deferredBoolean() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => { resolve = done; });
  return { promise, resolve };
}

function isolationHarness(providerId: string) {
  let currentProviderId: string | null = providerId;
  let generation = 0;
  let hasUsableCache = false;
  let isInitialSyncRunning = false;
  let isRefreshing = false;
  let localSyncState: string | null = null;
  let persistedSyncState: string | null = null;
  let runningTask: object | null = null;

  const capture = (): CatalogSyncOwnership => ({ providerId: currentProviderId, generation });
  const owns = (target: CatalogSyncOwnership) =>
    isCatalogSyncOwnershipCurrent(currentProviderId, generation, target);
  const switchProvider = (nextProviderId: string) => {
    currentProviderId = nextProviderId;
    generation += 1;
    hasUsableCache = false;
    isInitialSyncRunning = false;
    isRefreshing = false;
    localSyncState = null;
    runningTask = null;
    return capture();
  };
  const beginRun = (mode: CatalogSyncMode) => {
    generation += 1;
    const ownership = capture();
    const task = {};
    runningTask = task;
    if (mode === "initial") isInitialSyncRunning = true;
    else isRefreshing = true;
    return { ownership, task };
  };

  return {
    capture,
    switchProvider,
    beginRun,
    beginSnapshotRefresh() {
      generation += 1;
      return capture();
    },
    publishSnapshot(target: CatalogSyncOwnership, usable: boolean) {
      if (!owns(target)) return false;
      hasUsableCache = usable;
      return true;
    },
    publishState(target: CatalogSyncOwnership, value: string) {
      if (!owns(target)) return false;
      localSyncState = value;
      persistedSyncState = value;
      return true;
    },
    finalize(target: CatalogSyncOwnership, mode: CatalogSyncMode) {
      if (!owns(target)) return false;
      if (mode === "initial") isInitialSyncRunning = false;
      else isRefreshing = false;
      return true;
    },
    releaseTask(task: object) {
      if (runningTask === task) runningTask = null;
    },
    state: () => ({
      hasUsableCache,
      isInitialSyncRunning,
      isRefreshing,
      localSyncState,
      persistedSyncState,
      runningTask,
    }),
  };
}

async function main() {
  await scenario("late usable A snapshot or M3U commit cannot publish over empty B", async () => {
    const harness = isolationHarness("A");
    const lateA = harness.capture();
    const lateCommit = deferredBoolean();
    let homeCount = 801;
    harness.switchProvider("B");
    harness.beginRun("initial");
    assert.equal(harness.publishSnapshot(lateA, true), false);
    const published = publishSuccessfulCatalogCommitIfCurrent(
      lateCommit.promise,
      lateA,
      () => harness.capture(),
      () => { homeCount = 1_602; },
    );
    lateCommit.resolve(true);
    assert.equal(await published, false);
    assert.equal(homeCount, 801);
    assert.equal(harness.state().hasUsableCache, false);
    assert.match(
      contextSource,
      /if \(!isCatalogSyncOwnershipCurrent\([\s\S]*?\)\) return;\s*setSnapshot\(\{/,
    );
  });

  await scenario("old A initial finally cannot clear B initial state", () => {
    const harness = isolationHarness("A");
    const oldA = harness.beginRun("initial");
    harness.switchProvider("B");
    harness.beginRun("initial");
    assert.equal(harness.finalize(oldA.ownership, "initial"), false);
    assert.equal(harness.state().isInitialSyncRunning, true);
    assert.match(
      contextSource,
      /activeRunIdRef\.current === generation &&[\s\S]*?isCatalogSyncOwnershipCurrent\([\s\S]*?setIsInitialSyncRunning\(false\)/,
    );
  });

  await scenario("old background finally cannot clear a new provider refresh", () => {
    const harness = isolationHarness("A");
    const oldA = harness.beginRun("background");
    harness.switchProvider("B");
    harness.beginRun("manual");
    assert.equal(harness.finalize(oldA.ownership, "background"), false);
    assert.equal(harness.state().isRefreshing, true);
    assert.match(
      contextSource,
      /activeRunIdRef\.current === generation &&[\s\S]*?isCatalogSyncOwnershipCurrent\([\s\S]*?setIsRefreshing\(false\)/,
    );
  });

  await scenario("A to B to A rejects old snapshot and M3U completion generations", async () => {
    const harness = isolationHarness("A");
    const generationOne = harness.beginRun("initial").ownership;
    const oldCommit = deferredBoolean();
    let refreshes = 0;
    harness.switchProvider("B");
    harness.switchProvider("A");
    harness.beginRun("initial");
    assert.equal(harness.publishSnapshot(generationOne, true), false);
    const published = publishSuccessfulCatalogCommitIfCurrent(
      oldCommit.promise,
      generationOne,
      () => harness.capture(),
      () => { refreshes += 1; },
    );
    oldCommit.resolve(true);
    assert.equal(await published, false);
    assert.equal(refreshes, 0);
    assert.equal(harness.state().hasUsableCache, false);
    assert.match(
      contextSource,
      /useLayoutEffect\(\(\) => \{[\s\S]*?latestProviderIdRef\.current = committedProviderId;[\s\S]*?generationRef\.current \+= 1;/,
    );
  });

  await scenario("stale run cannot publish local or persisted sync state", () => {
    const harness = isolationHarness("A");
    const oldA = harness.beginRun("background").ownership;
    harness.switchProvider("B");
    const currentB = harness.beginRun("initial").ownership;
    assert.equal(harness.publishState(currentB, "B preparing"), true);
    assert.equal(harness.publishState(oldA, "A cancelled"), false);
    assert.deepEqual(
      [harness.state().localSyncState, harness.state().persistedSyncState],
      ["B preparing", "B preparing"],
    );
  });

  await scenario("old task completion cannot release the current task lock", () => {
    const harness = isolationHarness("A");
    const oldA = harness.beginRun("background");
    harness.switchProvider("B");
    const currentB = harness.beginRun("manual");
    harness.releaseTask(oldA.task);
    assert.equal(harness.state().runningTask, currentB.task);
    assert.match(contextSource, /if \(runningRef\.current\?\.task === task\) runningRef\.current = null/);
  });

  await scenario("serialized writes and successful current M3U commits refresh counts without changing Xtream semantics", async () => {
    const firstWrite = deferred();
    const order: string[] = [];
    const oldAWrite = enqueueCatalogDbWrite(async () => {
      await firstWrite.promise;
      order.push("A1");
    });
    const newAWrite = enqueueCatalogDbWrite(async () => { order.push("A3"); });
    firstWrite.resolve();
    await Promise.all([oldAWrite, newAWrite]);
    assert.deepEqual(order, ["A1", "A3"]);
    assert.match(contextSource, /isCatalogSyncOwnershipCurrent\([\s\S]*setCatalogSyncState\(providerId/);

    const harness = isolationHarness("A");
    const current = harness.capture();
    const successfulCommit = deferredBoolean();
    let homeCount = 801;
    const published = publishSuccessfulCatalogCommitIfCurrent(
      successfulCommit.promise,
      current,
      () => harness.capture(),
      () => { homeCount = 1_602; },
    );
    successfulCommit.resolve(true);
    assert.equal(await published, true);
    assert.equal(homeCount, 1_602);

    const firstSnapshotRead = harness.beginSnapshotRefresh();
    const secondSnapshotRead = harness.beginSnapshotRefresh();
    assert.equal(harness.publishSnapshot(secondSnapshotRead, true), true);
    assert.equal(harness.publishSnapshot(firstSnapshotRead, false), false);
    assert.equal(harness.state().hasUsableCache, true);

    const currentAfterReads = harness.capture();
    const rejectedCommit = deferredBoolean();
    let rejectedRefreshes = 0;
    const rejected = publishSuccessfulCatalogCommitIfCurrent(
      rejectedCommit.promise,
      currentAfterReads,
      () => harness.capture(),
      () => { rejectedRefreshes += 1; },
    );
    rejectedCommit.resolve(false);
    assert.equal(await rejected, false);
    assert.equal(rejectedRefreshes, 0);

    const failed = await publishSuccessfulCatalogCommitIfCurrent(
      Promise.reject(new Error("cache write failed")),
      currentAfterReads,
      () => harness.capture(),
      () => { rejectedRefreshes += 1; },
    );
    assert.equal(failed, false);
    assert.equal(rejectedRefreshes, 0);
    assert.match(writeRunnerSource, /return enqueueM3UCacheWrite/);
    assert.match(playerSource, /m3uCatalogCommit/);
    assert.match(playerSource, /publishSuccessfulCatalogCommitIfCurrent/);
    assert.match(contextSource, /m3uCatalogCommit[\s\S]*generation = \+\+generationRef\.current[\s\S]*refreshSnapshotFor\(active, ownership\)/);
    assert.match(contextSource, /await refreshSnapshotFor\(provider, ownership\)/);
  });

  assert.equal(passed, 7);
  console.log("catalog sync isolation scenarios: 7/7 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
