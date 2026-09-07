import assert from "node:assert/strict";
import {
  LIVE_HISTORY_V2_STORAGE_KEY,
  LiveHistoryMutationQueue,
  commitLiveHistoryV2,
  emptyLiveHistoryV2,
  parseLiveHistoryV2Payload,
  providerIdFromChannelId,
  recordLiveHistory,
  type LiveHistoryStorageAdapter,
  type LiveHistoryV2,
} from "../lib/liveHistory";

class RaceStorage implements LiveHistoryStorageAdapter {
  values = new Map<string, string>();
  setCalls = 0;
  activeOperations = 0;
  maxActiveOperations = 0;
  failSetCall: number | null = null;
  corruptNextRead = false;
  private firstSetEnteredResolve!: () => void;
  private releaseFirstSetResolve!: () => void;
  readonly firstSetEntered = new Promise<void>((resolve) => { this.firstSetEnteredResolve = resolve; });
  readonly releaseFirstSet = new Promise<void>((resolve) => { this.releaseFirstSetResolve = resolve; });

  releaseBlockedSet() {
    this.releaseFirstSetResolve();
  }

  async setItem(key: string, value: string) {
    this.setCalls += 1;
    const call = this.setCalls;
    this.activeOperations += 1;
    this.maxActiveOperations = Math.max(this.maxActiveOperations, this.activeOperations);
    try {
      if (this.failSetCall === call) throw new Error("synthetic storage write failure");
      if (call === 1) {
        this.firstSetEnteredResolve();
        await this.releaseFirstSet;
      }
      this.values.set(key, value);
    } finally {
      this.activeOperations -= 1;
    }
  }

  async getItem(key: string) {
    this.activeOperations += 1;
    this.maxActiveOperations = Math.max(this.maxActiveOperations, this.activeOperations);
    try {
      const value = this.values.get(key) ?? null;
      if (this.corruptNextRead && key === LIVE_HISTORY_V2_STORAGE_KEY && value !== null) {
        this.corruptNextRead = false;
        return `${value}x`;
      }
      return value;
    } finally {
      this.activeOperations -= 1;
    }
  }
}

class InterleavingStorage implements LiveHistoryStorageAdapter {
  values = new Map<string, string>();
  setCalls = 0;
  private releaseFirstGetResolve!: () => void;
  private secondSetCompleteResolve!: () => void;
  readonly releaseFirstGet = new Promise<void>((resolve) => { this.releaseFirstGetResolve = resolve; });
  readonly secondSetComplete = new Promise<void>((resolve) => { this.secondSetCompleteResolve = resolve; });

  allowFirstReadback() {
    this.releaseFirstGetResolve();
  }

  async setItem(key: string, value: string) {
    this.setCalls += 1;
    this.values.set(key, value);
    if (this.setCalls === 2) this.secondSetCompleteResolve();
  }

  async getItem(key: string) {
    if (this.setCalls === 1) {
      await this.releaseFirstGet;
    }
    return this.values.get(key) ?? null;
  }
}

const xtreamId = "provider-X:xtream-live:445566";
const m3uId = "provider-M:17:998877";

async function runMutation(
  queue: LiveHistoryMutationQueue,
  storage: LiveHistoryStorageAdapter,
  currentRef: { current: LiveHistoryV2 },
  providerId: string,
  channelId: string,
  publishEvents: string[] = [],
) {
  return queue.run({
    storage,
    current: () => currentRef.current,
    mutate: (current) => recordLiveHistory(current, providerId, channelId),
    publish: async (verified) => {
      publishEvents.push(channelId);
      currentRef.current = verified;
    },
  });
}

async function main() {
  let passed = 0;
  const scenario = async (name: string, run: () => Promise<void> | void) => {
    await run();
    passed += 1;
    process.stdout.write(`ok ${passed} - ${name}\n`);
  };

  await scenario("legacy overlapping commits can deterministically trip exact readback", async () => {
    const storage = new InterleavingStorage();
    const a = recordLiveHistory(emptyLiveHistoryV2(), "provider-M", "provider-M:1:1001");
    const b = recordLiveHistory(emptyLiveHistoryV2(), "provider-M", "provider-M:2:1002");
    const first = commitLiveHistoryV2(storage, a);
    await Promise.resolve();
    const second = commitLiveHistoryV2(storage, b);
    await storage.secondSetComplete;
    storage.allowFirstReadback();
    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  });

  await scenario("two fast recordWatched-style mutations serialize without lost update", async () => {
    const storage = new RaceStorage();
    const queue = new LiveHistoryMutationQueue();
    const ref = { current: emptyLiveHistoryV2() };
    const events: string[] = [];
    const first = runMutation(queue, storage, ref, "provider-M", "provider-M:1:1001", events);
    await storage.firstSetEntered;
    const second = runMutation(queue, storage, ref, "provider-M", "provider-M:2:1002", events);
    storage.releaseBlockedSet();
    await Promise.all([first, second]);
    assert.deepEqual(ref.current.byProvider["provider-M"], ["provider-M:2:1002", "provider-M:1:1001"]);
    assert.deepEqual(events, ["provider-M:1:1001", "provider-M:2:1002"]);
  });

  await scenario("Xtream stable live ids remain provider-scoped and canonical", async () => {
    assert.equal(providerIdFromChannelId(xtreamId), "provider-X");
    const storage = new RaceStorage();
    storage.releaseBlockedSet();
    const committed = await commitLiveHistoryV2(storage, recordLiveHistory(emptyLiveHistoryV2(), "provider-X", xtreamId));
    assert.deepEqual(committed.byProvider["provider-X"], [xtreamId]);
  });

  await scenario("M3U-like live ids remain provider-scoped and canonical", async () => {
    assert.equal(providerIdFromChannelId(m3uId), "provider-M");
    const storage = new RaceStorage();
    storage.releaseBlockedSet();
    const committed = await commitLiveHistoryV2(storage, recordLiveHistory(emptyLiveHistoryV2(), "provider-M", m3uId));
    assert.deepEqual(committed.byProvider["provider-M"], [m3uId]);
  });

  await scenario("final stored state is parseable canonical and contains every fast mutation", async () => {
    const storage = new RaceStorage();
    const queue = new LiveHistoryMutationQueue();
    const ref = { current: emptyLiveHistoryV2() };
    const first = runMutation(queue, storage, ref, "provider-M", "provider-M:1:1001");
    await storage.firstSetEntered;
    const second = runMutation(queue, storage, ref, "provider-M", "provider-M:2:1002");
    storage.releaseBlockedSet();
    await Promise.all([first, second]);
    const raw = storage.values.get(LIVE_HISTORY_V2_STORAGE_KEY);
    assert.ok(raw);
    const parsed = parseLiveHistoryV2Payload(raw);
    assert.deepEqual(parsed, ref.current);
    assert.deepEqual(parsed.byProvider["provider-M"], ["provider-M:2:1002", "provider-M:1:1001"]);
  });

  await scenario("exact readback verification remains fail closed", async () => {
    const storage = new RaceStorage();
    storage.releaseBlockedSet();
    storage.corruptNextRead = true;
    await assert.rejects(() => commitLiveHistoryV2(
      storage,
      recordLiveHistory(emptyLiveHistoryV2(), "provider-M", m3uId),
    ));
  });

  await scenario("failed mutation does not permanently reject the queue", async () => {
    const storage = new RaceStorage();
    storage.failSetCall = 1;
    storage.releaseBlockedSet();
    const queue = new LiveHistoryMutationQueue();
    const ref = { current: emptyLiveHistoryV2() };
    await assert.rejects(() => runMutation(queue, storage, ref, "provider-M", "provider-M:1:1001"));
    const verified = await runMutation(queue, storage, ref, "provider-M", "provider-M:2:1002");
    assert.deepEqual(verified.byProvider["provider-M"], ["provider-M:2:1002"]);
  });

  await scenario("publish stays inside the serialized logical transaction", async () => {
    const storage = new RaceStorage();
    const queue = new LiveHistoryMutationQueue();
    const ref = { current: emptyLiveHistoryV2() };
    const events: string[] = [];
    const first = queue.run({
      storage,
      current: () => ref.current,
      mutate: (current) => { events.push("A-mutate"); return recordLiveHistory(current, "provider-M", "provider-M:1:1001"); },
      publish: async (verified) => { events.push("A-publish"); ref.current = verified; },
    });
    await storage.firstSetEntered;
    const second = queue.run({
      storage,
      current: () => ref.current,
      mutate: (current) => { events.push("B-mutate"); return recordLiveHistory(current, "provider-M", "provider-M:2:1002"); },
      publish: async (verified) => { events.push("B-publish"); ref.current = verified; },
    });
    storage.releaseBlockedSet();
    await Promise.all([first, second]);
    assert.deepEqual(events, ["A-mutate", "A-publish", "B-mutate", "B-publish"]);
  });

  process.stdout.write(`live history concurrency scenarios: ${passed}/8 passed\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "live history concurrency test failed"}\n`);
  process.exitCode = 1;
});
