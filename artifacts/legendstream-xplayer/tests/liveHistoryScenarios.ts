import {
  LIVE_HISTORY_MIGRATION_ERROR,
  LIVE_HISTORY_PROVIDER_LIMIT,
  LIVE_HISTORY_V2_STORAGE_KEY,
  clearLiveHistoryProvider,
  commitLiveHistoryV2,
  historyForProvider,
  migrateLiveHistoryStorage,
  migrateLiveHistoryV1,
  parseLiveHistoryV2Payload,
  providerIdFromChannelId,
  recordLiveHistory,
  removeLiveHistory,
  type LiveHistoryStorageAdapter,
} from "../lib/liveHistory";

let passed = 0;
const expect = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  passed += 1;
};

const a = (index: number) => `provider-A:${index}:${1000 + index}`;
const b = (index: number) => `provider-B:${index}:${2000 + index}`;

expect(providerIdFromChannelId(a(1)) === "provider-A", "provider A prefix must parse");
expect(providerIdFromChannelId(b(2)) === "provider-B", "provider B prefix must parse");
expect(providerIdFromChannelId("legacy-id") === null, "unparseable id must remain unscoped");
expect(providerIdFromChannelId("provider-A:not-index:123") === null, "non-numeric index must remain unscoped");

const migrated = migrateLiveHistoryV1([
  a(1), b(1), a(2), "legacy-id", a(1), "broken:shape",
]);
expect(JSON.stringify(migrated.byProvider["provider-A"]) === JSON.stringify([a(1), a(2)]), "migration must retain provider A order and dedupe");
expect(JSON.stringify(migrated.byProvider["provider-B"]) === JSON.stringify([b(1)]), "migration must scope provider B independently");
expect(JSON.stringify(migrated.unscoped) === JSON.stringify(["legacy-id", "broken:shape"]), "unparseable ids must be preserved unscoped");

const oversizedLegacy = [
  ...Array.from({ length: 75 }, (_, index) => a(index)),
  ...Array.from({ length: 75 }, (_, index) => b(index)),
];
const capped = migrateLiveHistoryV1(oversizedLegacy);
expect(capped.byProvider["provider-A"].length === LIVE_HISTORY_PROVIDER_LIMIT, "provider A must cap at 50");
expect(capped.byProvider["provider-B"].length === LIVE_HISTORY_PROVIDER_LIMIT, "provider B must receive its own independent 50 quota");
expect(capped.byProvider["provider-A"][49] === a(49), "provider A must retain its first 50 most-recent entries");
expect(capped.byProvider["provider-B"][49] === b(49), "provider B must retain its first 50 most-recent entries");

let invalidRejected = false;
try {
  parseLiveHistoryV2Payload(JSON.stringify({ schemaVersion: 2, history: [a(1)], byProvider: {}, unscoped: [] }));
} catch { invalidRejected = true; }
expect(invalidRejected, "K2 must reject a reintroduced global history field");

invalidRejected = false;
try {
  parseLiveHistoryV2Payload(JSON.stringify({ schemaVersion: 2, byProvider: { "provider-A": [b(1)] }, unscoped: [] }));
} catch { invalidRejected = true; }
expect(invalidRejected, "K2 must reject cross-provider channel ids");

invalidRejected = false;
try {
  parseLiveHistoryV2Payload(JSON.stringify({ schemaVersion: 2, byProvider: {}, unscoped: [a(1)] }));
} catch { invalidRejected = true; }
expect(invalidRejected, "K2 must reject deterministically scoped ids hidden in unscoped");

invalidRejected = false;
try {
  parseLiveHistoryV2Payload(JSON.stringify({
    schemaVersion: 2,
    byProvider: { "provider-A": Array.from({ length: 51 }, (_, index) => a(index)) },
    unscoped: [],
  }));
} catch { invalidRejected = true; }
expect(invalidRejected, "K2 must reject provider buckets above 50");

const recorded = recordLiveHistory(migrated, "provider-A", a(2));
expect(recorded.byProvider["provider-A"][0] === a(2), "recording must move an existing channel to the front");
expect(recorded.byProvider["provider-B"][0] === b(1), "recording provider A must not mutate provider B");

const removed = removeLiveHistory(recorded, "provider-A", a(2));
expect(!removed.byProvider["provider-A"].includes(a(2)), "remove must affect active provider bucket");
expect(removed.byProvider["provider-B"][0] === b(1), "remove must preserve other provider buckets");

const cleared = clearLiveHistoryProvider(recorded, "provider-A");
expect(cleared.byProvider["provider-A"].length === 0, "clear must empty only the requested provider");
expect(cleared.byProvider["provider-B"][0] === b(1), "clear must preserve provider B");
expect(historyForProvider(recorded, "provider-A")[0] === a(2), "active-provider projection must expose only that provider");
expect(historyForProvider(recorded, undefined).length === 0, "logged-out projection must expose no provider history");

class MemoryStorage implements LiveHistoryStorageAdapter {
  values = new Map<string, string>();
  corruptReadBack = false;
  async getItem(key: string) {
    const value = this.values.get(key) ?? null;
    if (this.corruptReadBack && key === LIVE_HISTORY_V2_STORAGE_KEY && value !== null) return `${value}x`;
    return value;
  }
  async setItem(key: string, value: string) { this.values.set(key, value); }
}

const storage = new MemoryStorage();
let legacyDeleted = false;
const verified = await migrateLiveHistoryStorage(storage, [a(1), b(1), "legacy-id"], async () => {
  legacyDeleted = true;
});
expect(legacyDeleted, "K1 must delete legacy only after verified v2 commit");
expect(verified.byProvider["provider-A"][0] === a(1), "K1 committed v2 must preserve provider A");
expect(parseLiveHistoryV2Payload(storage.values.get(LIVE_HISTORY_V2_STORAGE_KEY)!).unscoped[0] === "legacy-id", "committed v2 must preserve unscoped ids");

const failingStorage = new MemoryStorage();
failingStorage.corruptReadBack = true;
legacyDeleted = false;
let fixedError = "";
try {
  await migrateLiveHistoryStorage(failingStorage, [a(1)], async () => { legacyDeleted = true; });
} catch (error) {
  fixedError = error instanceof Error ? error.message : "";
}
expect(!legacyDeleted, "K1 must not delete legacy when exact read-back fails");
expect(fixedError === LIVE_HISTORY_MIGRATION_ERROR, "migration failure must expose only the fixed error code");

const recoveryStorage = new MemoryStorage();
recoveryStorage.values.set(LIVE_HISTORY_V2_STORAGE_KEY, "{corrupt");
legacyDeleted = false;
const recovered = await migrateLiveHistoryStorage(recoveryStorage, [a(3), "legacy-old"], async () => { legacyDeleted = true; });
expect(recovered.byProvider["provider-A"][0] === a(3), "corrupt partial v2 must recover from intact legacy");
expect(legacyDeleted, "recovered v2 must clean legacy after verification");

const noLegacyStorage = new MemoryStorage();
noLegacyStorage.values.set(LIVE_HISTORY_V2_STORAGE_KEY, "{corrupt");
fixedError = "";
try {
  await migrateLiveHistoryStorage(noLegacyStorage, undefined, async () => undefined);
} catch (error) {
  fixedError = error instanceof Error ? error.message : "";
}
expect(fixedError === LIVE_HISTORY_MIGRATION_ERROR, "corrupt v2 without legacy must fail closed instead of overwriting with empty history");

const directStorage = new MemoryStorage();
const direct = migrateLiveHistoryV1([a(4), b(4)]);
await commitLiveHistoryV2(directStorage, direct);
expect(parseLiveHistoryV2Payload(directStorage.values.get(LIVE_HISTORY_V2_STORAGE_KEY)!).byProvider["provider-B"][0] === b(4), "direct K1 commit/read-back must round-trip canonical v2");

process.stdout.write(`live history scenarios: ${passed}/32 passed\n`);
