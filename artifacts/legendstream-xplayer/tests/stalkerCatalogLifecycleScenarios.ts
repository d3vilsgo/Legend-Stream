import assert from "node:assert/strict";
import { StalkerPortalError } from "../lib/stalkerPortal";
import {
  executeStalkerCatalogLifecycleSync,
  isStalkerCatalogLifecycleProvider,
  runStalkerActivationLifecycle,
  type StalkerCatalogLifecycleState,
} from "../lib/stalkerCatalogLifecycle";
import { StalkerLiveSyncSingleFlight } from "../lib/stalkerLiveSyncSingleFlight";

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const readyProvider = {
  id: "provider-a",
  type: "stalker",
  needsCredentials: false,
  url: "http://portal.invalid/stalker_portal/",
  playlistUrl: "http://portal.invalid/stalker_portal/",
  mac: "00:1A:79:12:34:56",
};

async function main() {
  await scenario("hydrated Stalker with complete credentials and empty cache starts one full sync", async () => {
    let syncCalls = 0;
    const states: StalkerCatalogLifecycleState[] = [];
    const result = await runStalkerActivationLifecycle({
      provider: readyProvider,
      isCurrent: () => true,
      readLiveCount: async () => 0,
      refreshSnapshot: async () => {},
      runInitialSync: async () => { syncCalls += 1; },
      onState: (state) => states.push(state),
    });
    assert.equal(result.decision, "INITIAL_SYNC");
    assert.equal(syncCalls, 1);
    assert.equal(states.some((state) => state.phase === "credentials-required"), false);
  });

  await scenario("hydrated Stalker with missing MAC exposes credentials-required without sync", async () => {
    let syncCalls = 0;
    const states: StalkerCatalogLifecycleState[] = [];
    const result = await runStalkerActivationLifecycle({
      provider: { ...readyProvider, mac: "" },
      isCurrent: () => true,
      readLiveCount: async () => { throw new Error("cache should not be read"); },
      refreshSnapshot: async () => {},
      runInitialSync: async () => { syncCalls += 1; },
      onState: (state) => states.push(state),
    });
    assert.equal(result.decision, "CREDENTIALS_REQUIRED");
    assert.equal(syncCalls, 0);
    assert.equal(states.at(-1)?.phase, "credentials-required");
  });

  await scenario("hydrated Stalker with missing URL exposes credentials-required without sync", async () => {
    let syncCalls = 0;
    const states: StalkerCatalogLifecycleState[] = [];
    const result = await runStalkerActivationLifecycle({
      provider: { ...readyProvider, url: "", playlistUrl: "" },
      isCurrent: () => true,
      readLiveCount: async () => { throw new Error("cache should not be read"); },
      refreshSnapshot: async () => {},
      runInitialSync: async () => { syncCalls += 1; },
      onState: (state) => states.push(state),
    });
    assert.equal(result.decision, "CREDENTIALS_REQUIRED");
    assert.equal(syncCalls, 0);
    assert.equal(states.at(-1)?.phase, "credentials-required");
  });

  await scenario("usable Stalker cache refreshes snapshot before any network sync", async () => {
    const events: string[] = [];
    const states: StalkerCatalogLifecycleState[] = [];
    const result = await runStalkerActivationLifecycle({
      provider: readyProvider,
      isCurrent: () => true,
      readLiveCount: async () => { events.push("cache"); return 41; },
      refreshSnapshot: async () => { events.push("snapshot"); },
      runInitialSync: async () => { events.push("network"); },
      onState: (state) => states.push(state),
    });
    assert.equal(result.decision, "USE_CACHE");
    assert.deepEqual(events, ["cache", "snapshot"]);
    assert.equal(states.at(-1)?.phase, "cache-ready");
  });

  await scenario("successful canonical sync publishes refreshed count and ready state", async () => {
    const states: StalkerCatalogLifecycleState[] = [];
    let snapshotCount = 0;
    const controller = new AbortController();
    const result = await executeStalkerCatalogLifecycleSync({
      provider: readyProvider,
      mode: "initial",
      signal: controller.signal,
      isCurrent: () => true,
      sync: async () => { snapshotCount = 12; return { persisted: 12 }; },
      refreshSnapshot: async () => { assert.equal(snapshotCount, 12); },
      onState: (state) => states.push(state),
    });
    assert.equal(result.result, "SUCCESS");
    assert.equal(result.persisted, 12);
    assert.equal(states.at(-1)?.phase, "ready");
  });

  await scenario("sync error becomes visible safe error with retry", async () => {
    const states: StalkerCatalogLifecycleState[] = [];
    const controller = new AbortController();
    const result = await executeStalkerCatalogLifecycleSync({
      provider: readyProvider,
      mode: "initial",
      signal: controller.signal,
      isCurrent: () => true,
      sync: async () => { throw new StalkerPortalError("NETWORK_ERROR", "secret raw network detail"); },
      refreshSnapshot: async () => {},
      onState: (state) => states.push(state),
    });
    assert.equal(result.result, "ERROR");
    assert.equal(states.at(-1)?.phase, "error");
    assert.equal(states.at(-1)?.message, "Stalker portalına ulaşılamadı.");
    assert.equal(states.at(-1)?.retryAvailable, true);
  });

  await scenario("retry creates a new canonical sync attempt and can recover", async () => {
    let attempts = 0;
    const states: StalkerCatalogLifecycleState[] = [];
    const run = async () => executeStalkerCatalogLifecycleSync({
      provider: readyProvider,
      mode: "manual",
      signal: new AbortController().signal,
      isCurrent: () => true,
      sync: async () => {
        attempts += 1;
        if (attempts === 1) throw new StalkerPortalError("TIMEOUT", "raw timeout");
        return { persisted: 5 };
      },
      refreshSnapshot: async () => {},
      onState: (state) => states.push(state),
    });
    assert.equal((await run()).result, "ERROR");
    assert.equal((await run()).result, "SUCCESS");
    assert.equal(attempts, 2);
    assert.equal(states.at(-1)?.phase, "ready");
  });

  await scenario("provider switch aborts A and rejects stale A publication", async () => {
    let resolveSync!: (value: { persisted: number }) => void;
    const deferred = new Promise<{ persisted: number }>((resolve) => { resolveSync = resolve; });
    const states: StalkerCatalogLifecycleState[] = [];
    const controller = new AbortController();
    let current = true;
    const task = executeStalkerCatalogLifecycleSync({
      provider: readyProvider,
      mode: "initial",
      signal: controller.signal,
      isCurrent: () => current,
      sync: async () => deferred,
      refreshSnapshot: async () => { throw new Error("stale snapshot must not publish"); },
      onState: (state) => states.push(state),
    });
    current = false;
    controller.abort();
    resolveSync({ persisted: 7 });
    const result = await task;
    assert.equal(result.result, "CANCELLED");
    assert.equal(states.some((state) => state.phase === "ready"), false);
  });

  await scenario("restart-equivalent lifecycle auto-syncs without Live screen mount", async () => {
    let fullSync = 0;
    await runStalkerActivationLifecycle({
      provider: readyProvider,
      isCurrent: () => true,
      readLiveCount: async () => 0,
      refreshSnapshot: async () => {},
      runInitialSync: async () => { fullSync += 1; },
      onState: () => {},
    });
    assert.equal(fullSync, 1);
  });

  await scenario("manual refresh executes the full canonical sync dependency", async () => {
    let syncCalls = 0;
    const controller = new AbortController();
    const result = await executeStalkerCatalogLifecycleSync({
      provider: readyProvider,
      mode: "manual",
      signal: controller.signal,
      isCurrent: () => true,
      sync: async () => { syncCalls += 1; return { persisted: 3 }; },
      refreshSnapshot: async () => {},
      onState: () => {},
    });
    assert.equal(result.result, "SUCCESS");
    assert.equal(syncCalls, 1);
  });

  await scenario("single-flight joins concurrent work for the same provider", async () => {
    const gate = new StalkerLiveSyncSingleFlight<number>();
    let taskCalls = 0;
    let resolve!: (value: number) => void;
    const deferred = new Promise<number>((next) => { resolve = next; });
    const first = gate.run("provider-a", undefined, async () => { taskCalls += 1; return deferred; });
    const second = gate.run("provider-a", undefined, async () => { taskCalls += 1; return 99; });
    assert.equal(first, second);
    assert.equal(taskCalls, 1);
    resolve(8);
    assert.equal(await first, 8);
  });

  await scenario("Xtream remains outside the Stalker lifecycle controller", () => {
    assert.equal(isStalkerCatalogLifecycleProvider("xtream"), false);
  });

  await scenario("M3U remains outside the Stalker lifecycle controller", () => {
    assert.equal(isStalkerCatalogLifecycleProvider("m3u"), false);
  });

  assert.equal(passed, 13);
  console.log("stalker catalog lifecycle scenarios: 13/13 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
