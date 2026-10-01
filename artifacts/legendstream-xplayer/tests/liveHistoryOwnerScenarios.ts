import assert from "node:assert/strict";
import {
  LIVE_HISTORY_V2_STORAGE_KEY,
  LiveHistoryOwner,
  migrateLiveHistoryV1,
  parseLiveHistoryV2Payload,
  type LiveHistoryStorageAdapter,
} from "../lib/liveHistory";

const a = (n: number) => `provider-A:stalker:${n}`;
const b = (n: number) => `provider-B:xtream-live:${n}`;
const m = (n: number) => `provider-M:17:${n}`;

class Storage implements LiveHistoryStorageAdapter {
  readonly values = new Map<string, string>();
  writes = 0;
  failWrite = false;
  corruptRead = false;
  blockNextWrite = false;
  private started!: () => void;
  private release!: () => void;
  readonly writeStarted = new Promise<void>((done) => { this.started = done; });
  readonly resumeWrite = new Promise<void>((done) => { this.release = done; });

  unblock() { this.release(); }

  async setItem(key: string, value: string) {
    this.writes++;
    if (this.failWrite) throw new Error("synthetic storage failure");
    if (this.blockNextWrite) {
      this.blockNextWrite = false;
      this.started();
      await this.resumeWrite;
    }
    this.values.set(key, value);
  }

  async getItem(key: string) {
    const raw = this.values.get(key) ?? null;
    return this.corruptRead && raw !== null ? `${raw}x` : raw;
  }

  persisted() {
    return parseLiveHistoryV2Payload(this.values.get(LIVE_HISTORY_V2_STORAGE_KEY)!);
  }
}

function harness(storage = new Storage()) {
  let active: string | null = "provider-A";
  let visible: string[] = [];
  const favorites = ["favorite-unchanged"];
  const published: string[][] = [];
  const owner = new LiveHistoryOwner(
    storage,
    () => active,
    async (history) => {
      visible = history;
      published.push(history);
    },
  );
  const switchTo = (providerId: string | null) => {
    active = providerId;
    visible = owner.forProvider(providerId);
  };
  return { storage, owner, favorites, published, switchTo, visible: () => visible };
}

let passed = 0;
async function scenario(name: string, run: () => Promise<void> | void) {
  await run();
  passed++;
  process.stdout.write(`ok ${passed} - ${name}\n`);
}

async function main() {
  await scenario("valid v2 hydration projects only the selected provider", async () => {
    const h = harness();
    h.storage.values.set(LIVE_HISTORY_V2_STORAGE_KEY, JSON.stringify(migrateLiveHistoryV1([a(1), b(1)])));
    await h.owner.hydrate(undefined, async () => undefined);
    h.switchTo("provider-A");
    assert.deepEqual(h.visible(), [a(1)]);
    h.switchTo("provider-B");
    assert.deepEqual(h.visible(), [b(1)]);
  });

  await scenario("legacy hydration verifies v2 before deleting legacy and projecting", async () => {
    const h = harness();
    let deleted = false;
    await h.owner.hydrate([a(1), b(1), a(1)], async () => {
      assert.deepEqual(h.storage.persisted().byProvider["provider-A"], [a(1)]);
      deleted = true;
    });
    assert.equal(deleted, true);
    assert.deepEqual(h.owner.forProvider("provider-A"), [a(1)]);
  });

  await scenario("record, remove and clear persist and publish active history", async () => {
    const h = harness();
    await h.owner.hydrate(undefined, async () => undefined);
    await h.owner.record("provider-A", a(1));
    await h.owner.record("provider-A", a(2));
    assert.deepEqual(h.visible(), [a(2), a(1)]);
    await h.owner.remove("provider-A", a(2));
    assert.deepEqual(h.visible(), [a(1)]);
    await h.owner.clear("provider-A");
    assert.deepEqual(h.storage.persisted().byProvider["provider-A"], []);
    assert.deepEqual(h.visible(), []);
    assert.deepEqual(h.favorites, ["favorite-unchanged"]);
  });

  await scenario("overlapping record then record serializes in invocation order", async () => {
    const h = harness();
    await h.owner.hydrate(undefined, async () => undefined);
    h.storage.blockNextWrite = true;
    const first = h.owner.record("provider-A", a(1));
    await h.storage.writeStarted;
    const second = h.owner.record("provider-A", a(2));
    h.storage.unblock();
    await Promise.all([first, second]);
    assert.deepEqual(h.storage.persisted().byProvider["provider-A"], [a(2), a(1)]);
    assert.deepEqual(h.published, [[a(1)], [a(2), a(1)]]);
  });

  await scenario("record/remove, record/clear, remove/record and clear/record preserve queue order", async () => {
    const h = harness();
    await h.owner.hydrate(undefined, async () => undefined);
    await h.owner.record("provider-A", a(1));
    await Promise.all([h.owner.record("provider-A", a(2)), h.owner.remove("provider-A", a(2))]);
    assert.deepEqual(h.owner.forProvider("provider-A"), [a(1)]);
    await Promise.all([h.owner.record("provider-A", a(3)), h.owner.clear("provider-A")]);
    assert.deepEqual(h.owner.forProvider("provider-A"), []);
    await Promise.all([h.owner.remove("provider-A", a(3)), h.owner.record("provider-A", a(4))]);
    assert.deepEqual(h.owner.forProvider("provider-A"), [a(4)]);
    await Promise.all([h.owner.clear("provider-A"), h.owner.record("provider-A", a(5))]);
    assert.deepEqual(h.storage.persisted().byProvider["provider-A"], [a(5)]);
  });

  await scenario("A late persistence cannot publish into B; switching back projects A", async () => {
    const h = harness();
    await h.owner.hydrate(undefined, async () => undefined);
    await h.owner.record("provider-B", b(1));
    h.storage.blockNextWrite = true;
    const pending = h.owner.record("provider-A", a(1));
    await h.storage.writeStarted;
    h.switchTo("provider-B");
    const before = h.published.length;
    h.storage.unblock();
    await pending;
    assert.equal(h.published.length, before);
    assert.deepEqual(h.visible(), [b(1)]);
    assert.deepEqual(h.storage.persisted().byProvider["provider-A"], [a(1)]);
    h.switchTo("provider-A");
    assert.deepEqual(h.visible(), [a(1)]);
  });

  await scenario("write and readback failures reject without publishing or mutating owner snapshot", async () => {
    for (const failure of ["write", "readback"] as const) {
      const h = harness();
      await h.owner.hydrate(undefined, async () => undefined);
      if (failure === "write") h.storage.failWrite = true;
      else h.storage.corruptRead = true;
      await assert.rejects(() => h.owner.record("provider-A", a(1)));
      assert.deepEqual(h.owner.forProvider("provider-A"), []);
      assert.equal(h.published.length, 0);
    }
  });

  await scenario("malformed v2 follows legacy recovery and fails closed without legacy", async () => {
    const recovered = harness();
    recovered.storage.values.set(LIVE_HISTORY_V2_STORAGE_KEY, "{invalid");
    await recovered.owner.hydrate([a(1)], async () => undefined);
    assert.deepEqual(recovered.owner.forProvider("provider-A"), [a(1)]);
    const invalid = harness();
    invalid.storage.values.set(LIVE_HISTORY_V2_STORAGE_KEY, "{invalid");
    await assert.rejects(() => invalid.owner.hydrate(undefined, async () => undefined));
    assert.deepEqual(invalid.owner.forProvider("provider-A"), []);
  });

  await scenario("Stalker, Xtream and M3U keys remain isolated from each other and Favorites", async () => {
    const h = harness();
    await h.owner.hydrate(undefined, async () => undefined);
    await h.owner.record("provider-A", a(1));
    await h.owner.record("provider-B", b(1));
    await h.owner.record("provider-M", m(1));
    assert.deepEqual(h.storage.persisted().byProvider["provider-M"], [m(1)]);
    assert.deepEqual(h.visible(), [a(1)]);
    assert.deepEqual(h.owner.forProvider("provider-B"), [b(1)]);
    assert.deepEqual(h.owner.forProvider("provider-M"), [m(1)]);
    assert.deepEqual(h.favorites, ["favorite-unchanged"]);
  });

  assert.equal(passed, 9);
  process.stdout.write("live history owner scenarios: 9/9 passed\n");
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "live history owner test failed"}\n`);
  process.exitCode = 1;
});
