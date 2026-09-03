import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isCatalogSyncOwnershipCurrent,
  ProviderLoadRequestGate,
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

function deferredValue<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function providerLoadHarness(initialProviderId = "A", initialData = "cached") {
  const gate = new ProviderLoadRequestGate();
  let currentProviderId = initialProviderId;
  let data = initialData;
  let error: string | null = null;
  let busy = false;
  let busyOwner: number | null = null;
  const persisted: string[] = [];
  const commits: string[] = [];

  const run = async (
    providerId: string,
    mode: "foreground" | "background",
    network: Promise<string>,
  ) => {
    const ownership = mode === "foreground"
      ? gate.beginForeground(providerId)
      : gate.beginBackground(providerId);
    if (!ownership) return "skipped" as const;
    if (mode === "foreground") {
      busy = true;
      busyOwner = ownership.generation;
    }
    try {
      const result = await network;
      if (currentProviderId !== providerId || !gate.isCurrent(ownership)) {
        return "stale" as const;
      }
      data = result;
      persisted.push(result);
      commits.push(result);
      error = null;
      return "applied" as const;
    } catch (caught) {
      if (currentProviderId !== providerId || !gate.isCurrent(ownership)) {
        return "stale" as const;
      }
      error = caught instanceof Error ? caught.message : "failed";
      return "failed" as const;
    } finally {
      if (busyOwner === ownership.generation) {
        busyOwner = null;
        busy = false;
      }
      gate.finish(ownership);
    }
  };

  return {
    gate,
    run,
    switchProvider(providerId: string) {
      currentProviderId = providerId;
      gate.invalidateAll();
    },
    state: () => ({ currentProviderId, data, error, busy, persisted: [...persisted], commits: [...commits] }),
  };
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

    // Case 1: a newer foreground result commits first; the late background result is discarded.
    const case1 = providerLoadHarness();
    const case1Background = deferredValue<string>();
    const case1Manual = deferredValue<string>();
    const case1Old = case1.run("A", "background", case1Background.promise);
    const case1New = case1.run("A", "foreground", case1Manual.promise);
    case1Manual.resolve("manual-new");
    assert.equal(await case1New, "applied");
    case1Background.resolve("background-old");
    assert.equal(await case1Old, "stale");
    assert.deepEqual(case1.state(), {
      currentProviderId: "A", data: "manual-new", error: null, busy: false,
      persisted: ["manual-new"], commits: ["manual-new"],
    });

    // Case 2: even if the old background resolves first, it is stale once foreground has begun.
    const case2 = providerLoadHarness();
    const case2Background = deferredValue<string>();
    const case2Manual = deferredValue<string>();
    const case2Old = case2.run("A", "background", case2Background.promise);
    const case2New = case2.run("A", "foreground", case2Manual.promise);
    case2Background.resolve("background-old");
    assert.equal(await case2Old, "stale");
    case2Manual.resolve("manual-new");
    assert.equal(await case2New, "applied");
    assert.deepEqual(case2.state().persisted, ["manual-new"]);

    // Cases 3 and 4: background cannot supersede foreground, but a lone background is valid.
    const case3 = providerLoadHarness();
    const case3Manual = deferredValue<string>();
    const case3ManualRun = case3.run("A", "foreground", case3Manual.promise);
    assert.equal(await case3.run("A", "background", Promise.resolve("background")), "skipped");
    case3Manual.resolve("manual");
    assert.equal(await case3ManualRun, "applied");
    const case4 = providerLoadHarness();
    assert.equal(await case4.run("A", "background", Promise.resolve("background-only")), "applied");
    assert.deepEqual(case4.state().persisted, ["background-only"]);

    // Case 5: the latest of two foreground requests owns data, error and persistence publication.
    const case5 = providerLoadHarness();
    const case5OldNetwork = deferredValue<string>();
    const case5NewNetwork = deferredValue<string>();
    const case5Old = case5.run("A", "foreground", case5OldNetwork.promise);
    const case5New = case5.run("A", "foreground", case5NewNetwork.promise);
    case5NewNetwork.resolve("manual-latest");
    assert.equal(await case5New, "applied");
    case5OldNetwork.reject(new Error("stale failure"));
    assert.equal(await case5Old, "stale");
    assert.equal(case5.state().error, null);
    assert.deepEqual(case5.state().persisted, ["manual-latest"]);

    // Case 6: A -> B -> A invalidation rejects the old A token despite matching provider ID.
    const case6 = providerLoadHarness();
    const case6OldNetwork = deferredValue<string>();
    const case6Old = case6.run("A", "foreground", case6OldNetwork.promise);
    case6.switchProvider("B");
    case6.switchProvider("A");
    case6OldNetwork.resolve("old-A");
    assert.equal(await case6Old, "stale");
    assert.deepEqual(case6.state().persisted, []);

    // Case 7: a failed newer manual request never revives the stale background result.
    const case7 = providerLoadHarness("A", "usable-cache");
    const case7BackgroundNetwork = deferredValue<string>();
    const case7ManualNetwork = deferredValue<string>();
    const case7Old = case7.run("A", "background", case7BackgroundNetwork.promise);
    const case7New = case7.run("A", "foreground", case7ManualNetwork.promise);
    case7ManualNetwork.reject(new Error("manual failed"));
    assert.equal(await case7New, "failed");
    case7BackgroundNetwork.resolve("stale-background-success");
    assert.equal(await case7Old, "stale");
    assert.equal(case7.state().data, "usable-cache");
    assert.deepEqual(case7.state().persisted, []);

    // Case 8: an old finalizer cannot clear the newer foreground busy owner.
    const case8 = providerLoadHarness();
    const case8OldNetwork = deferredValue<string>();
    const case8NewNetwork = deferredValue<string>();
    const case8Old = case8.run("A", "foreground", case8OldNetwork.promise);
    const case8New = case8.run("A", "foreground", case8NewNetwork.promise);
    case8OldNetwork.resolve("old");
    assert.equal(await case8Old, "stale");
    assert.equal(case8.state().busy, true);
    case8NewNetwork.resolve("new");
    assert.equal(await case8New, "applied");
    assert.equal(case8.state().busy, false);

    const refreshStart = playerSource.indexOf("const refreshProvider = async");
    const fallbackStart = playerSource.indexOf("const recoverLegacyCatalogFallback", refreshStart);
    const backgroundStart = playerSource.indexOf("const refreshProviderInBackground", fallbackStart);
    const activationStart = playerSource.indexOf("useEffect(() =>", backgroundStart);
    const refreshSource = playerSource.slice(refreshStart, fallbackStart);
    const fallbackSource = playerSource.slice(fallbackStart, backgroundStart);
    const backgroundSource = playerSource.slice(backgroundStart, activationStart);
    assert.match(refreshSource, /beginForegroundProviderLoad\(providerId\)/);
    assert.match(refreshSource, /loadProviderSmart\(fromProvider\(existing\), \{ persistM3U: false \}\)/);
    assert.match(refreshSource, /if \(!isCurrentProviderLoad\(ownership\)\) return;[\s\S]*persistM3ULoadInBackground\(smart\.provider, smart\.loaded\)/);
    assert.match(refreshSource, /catch \(caught\) \{\s*if \(!isCurrentProviderLoad\(ownership\)\) return;[\s\S]*setError\(message\)/);
    assert.match(refreshSource, /finishProviderLoad\(ownership, persistenceOwnsRequest, busyId\)/);
    assert.match(backgroundSource, /playerBusyOwnerRef\.current !== null[\s\S]*beginBackground\(providerId\)/);
    assert.match(backgroundSource, /loadProviderSmart\(fromProvider\(existing\), \{ persistM3U: false \}\)/);
    assert.match(backgroundSource, /if \(!isCurrentProviderLoad\(ownership\)\) return;[\s\S]*persistM3ULoadInBackground\(smart\.provider, smart\.loaded\)/);
    assert.match(fallbackSource, /beginBackground\(providerId\)/);
    assert.match(playerSource, /requestOwnership && !isCurrentProviderLoad\(requestOwnership\)/);
    assert.match(playerSource, /providerLoadGateRef\.current\.invalidateAll\(\)/);
    assert.match(playerSource, /if \(playerBusyOwnerRef\.current !== busyId\) return;[\s\S]*setIsLoading\(false\)/);
  });

  assert.equal(passed, 7);
  console.log("catalog sync isolation scenarios: 7/7 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
