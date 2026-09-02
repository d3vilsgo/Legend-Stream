import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isCatalogSyncOwnershipCurrent,
  type CatalogSyncMode,
  type CatalogSyncOwnership,
} from "../lib/catalogAvailability";
import { enqueueCatalogDbWrite } from "../lib/catalogDbWriter";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contextSource = readFileSync(resolve(ROOT, "context/CatalogSyncContext.tsx"), "utf8");

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
  await scenario("late usable A snapshot cannot publish over empty B", () => {
    const harness = isolationHarness("A");
    const lateA = harness.capture();
    harness.switchProvider("B");
    harness.beginRun("initial");
    assert.equal(harness.publishSnapshot(lateA, true), false);
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

  await scenario("A to B to A rejects the old same-provider generation", () => {
    const harness = isolationHarness("A");
    const generationOne = harness.beginRun("initial").ownership;
    harness.switchProvider("B");
    harness.switchProvider("A");
    harness.beginRun("initial");
    assert.equal(harness.publishSnapshot(generationOne, true), false);
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

  await scenario("serialized persisted writes preserve newer ABA state", async () => {
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
  });

  assert.equal(passed, 7);
  console.log("catalog sync isolation scenarios: 7/7 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
