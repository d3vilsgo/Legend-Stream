import fs from "node:fs";
import path from "node:path";
import {
  MEDIA_PROGRESS_MIGRATION_ERROR,
  MEDIA_PROGRESS_V1_STORAGE_KEY,
  MEDIA_PROGRESS_V2_STORAGE_KEY,
  claimProgressForProvider,
  clearMediaProgressForProvider,
  isMediaProgressV2PayloadSafe,
  mediaProgressForProvider,
  migrateMediaProgressStorage,
  migrateMediaProgressV1Entries,
  trimMediaProgressByScope,
  type MediaPlaybackRef,
  type MediaProgressCredentialSnapshot,
  type MediaProgressStorageAdapter,
  type MediaProgressV2,
} from "../lib/mediaProgress";

let passed = 0;
const expect = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  passed += 1;
};

const sourceA = "https://iptv.example/movie/alice/secret-A/101.mp4";
const sourceB = "https://iptv.example/movie/bob/secret-B/101.mp4";
const snapshots: MediaProgressCredentialSnapshot[] = [
  {
    providerId: "provider-A",
    type: "xtream",
    secrets: {
      url: "https://iptv.example/get.php?username=alice&password=secret-A&type=m3u_plus",
      username: "alice",
      password: "secret-A",
    },
  },
  {
    providerId: "provider-B",
    type: "xtream",
    secrets: {
      url: "https://iptv.example",
      username: "bob",
      password: "secret-B",
    },
  },
];

const legacy = (source: string, kind: "movie" | "episode" = "movie", index = 0) => ({
  id: `legacy-${index}`,
  kind,
  title: kind === "movie" ? `Movie ${index}` : `Episode ${index}`,
  source,
  position: 120 + index,
  duration: 3600,
  updatedAt: 1_700_000_000_000 + index,
});

async function main() {
  const migratedA = migrateMediaProgressV1Entries([legacy(sourceA)], snapshots)[0];
  expect(
    migratedA.providerId === "provider-A" && migratedA.playbackRef.type === "xtream-vod" && migratedA.playbackRef.streamId === "101",
    "canonical Xtream movie must attribute to the exact SecureStore provider",
  );

  const episode = migrateMediaProgressV1Entries([
    legacy("https://iptv.example/series/alice/secret-A/700.mkv", "episode"),
  ], snapshots)[0];
  expect(
    episode.providerId === "provider-A" && episode.playbackRef.type === "xtream-episode" && episode.playbackRef.episodeId === "700",
    "canonical Xtream episode must migrate to a secret-free episode descriptor",
  );

  const encodedSnapshots: MediaProgressCredentialSnapshot[] = [{
    providerId: "encoded",
    type: "xtream",
    secrets: { url: "https://encoded.example", username: "user name", password: "p@ss/word" },
  }];
  const encoded = migrateMediaProgressV1Entries([
    legacy("https://encoded.example/movie/user%20name/p%40ss%2Fword/99.mp4"),
  ], encodedSnapshots)[0];
  expect(encoded.providerId === "encoded", "URL-encoded Xtream credentials must compare after RAM-only decode");

  const sameServerDifferentUser = migrateMediaProgressV1Entries([legacy(sourceB)], snapshots)[0];
  expect(sameServerDifferentUser.providerId === "provider-B", "same server with a different username must not cross-attribute");

  const passwordSnapshots: MediaProgressCredentialSnapshot[] = [
    snapshots[0],
    {
      providerId: "provider-A-wrong-password",
      type: "xtream",
      secrets: { url: "https://iptv.example", username: "alice", password: "wrong-password" },
    },
  ];
  const sameUserDifferentPassword = migrateMediaProgressV1Entries([legacy(sourceA)], passwordSnapshots)[0];
  expect(
    sameUserDifferentPassword.providerId === "provider-A",
    "same server and username with a different password must still attribute only to the exact account",
  );

  const ambiguousSnapshots: MediaProgressCredentialSnapshot[] = [
    snapshots[0],
    { ...snapshots[0], providerId: "provider-A-clone" },
  ];
  const ambiguous = migrateMediaProgressV1Entries([legacy(sourceA)], ambiguousSnapshots)[0];
  expect(ambiguous.providerId === null, "multiple exact credential matches must fail closed to unscoped");

  const missingCredentials = migrateMediaProgressV1Entries([legacy(sourceA)], [snapshots[1]])[0];
  expect(missingCredentials.providerId === null, "missing SecureStore credentials must preserve progress as unscoped");

  const direct = migrateMediaProgressV1Entries([
    legacy("https://cdn.example/watch/video.mp4?token=must-not-persist"),
  ], snapshots)[0];
  expect(
    direct.providerId === null && direct.playbackRef.type === "unresolved",
    "legacy direct_source rows must remain unscoped without retaining the URL",
  );

  const m3u = migrateMediaProgressV1Entries([
    legacy("https://playlist.example/vod/movie-55.ts"),
  ], snapshots)[0];
  expect(
    m3u.providerId === null && m3u.playbackRef.type === "unresolved",
    "legacy M3U rows without deterministic provider identity must remain unscoped",
  );

  const malformed = migrateMediaProgressV1Entries([legacy("not-a-url")], snapshots)[0];
  expect(malformed.providerId === null && malformed.playbackRef.type === "unresolved", "malformed legacy sources must be preserved unscoped");

  const deletedProvider = migrateMediaProgressV1Entries([
    legacy("https://deleted.example/movie/old-user/old-pass/88.mp4"),
  ], snapshots)[0];
  expect(
    deletedProvider.providerId === null && deletedProvider.playbackRef.type === "xtream-vod",
    "canonical progress for a deleted provider must retain a safe playbackRef but remain unscoped",
  );

  const hundred = Array.from({ length: 100 }, (_, index) =>
    legacy(`https://iptv.example/movie/alice/secret-A/${1000 + index}.mp4`, "movie", index));
  const hundredMigrated = migrateMediaProgressV1Entries(hundred, snapshots);
  expect(hundredMigrated.length === 100, "100 legacy progress rows must migrate without loss");

  const migratedJson = JSON.stringify(hundredMigrated);
  expect(
    !migratedJson.includes("alice") && !migratedJson.includes("secret-A") && !migratedJson.includes("iptv.example") &&
    hundredMigrated.every((entry) => !entry.id.includes("secret-A")),
    "v2 payload and ids must not derive from or retain credentials/source URLs",
  );

  expect(isMediaProgressV2PayloadSafe(hundredMigrated, snapshots), "migrated v2 payload must pass the K2 secret scan");

  const unsafeSource = { ...migratedA, source: sourceA } as unknown as MediaProgressV2;
  expect(
    !isMediaProgressV2PayloadSafe([unsafeSource], snapshots),
    "K2 regression gate must reject any reintroduced persisted source field",
  );

  const unsafeSecret = {
    ...migratedA,
    playbackRef: { ...(migratedA.playbackRef as any), streamId: "secret-A" },
  } as MediaProgressV2;
  expect(!isMediaProgressV2PayloadSafe([unsafeSecret], snapshots), "K2 must reject known credential material anywhere in persisted v2");

  let readCount = 0;
  let removedOnK1Failure = false;
  const k1Storage: MediaProgressStorageAdapter = {
    async getItem(key) {
      if (key === MEDIA_PROGRESS_V1_STORAGE_KEY) return JSON.stringify([legacy(sourceA)]);
      if (key === MEDIA_PROGRESS_V2_STORAGE_KEY) {
        readCount += 1;
        return readCount === 1 ? null : "tampered-read-back";
      }
      return null;
    },
    async setItem() {},
    async removeItem() { removedOnK1Failure = true; },
  };
  let k1Error = "";
  try { await migrateMediaProgressStorage(k1Storage, snapshots); }
  catch (error) { k1Error = error instanceof Error ? error.message : String(error); }
  expect(
    k1Error === MEDIA_PROGRESS_MIGRATION_ERROR && !removedOnK1Failure,
    "K1 read-back failure must be fail-closed and must not delete v1",
  );

  let removedOnK2Failure = false;
  const k2Legacy = { ...legacy(sourceA), title: "secret-A" };
  const k2StorageState = new Map<string, string>([[MEDIA_PROGRESS_V1_STORAGE_KEY, JSON.stringify([k2Legacy])]]);
  const k2Storage: MediaProgressStorageAdapter = {
    async getItem(key) { return k2StorageState.get(key) ?? null; },
    async setItem(key, value) { k2StorageState.set(key, value); },
    async removeItem(key) {
      if (key === MEDIA_PROGRESS_V1_STORAGE_KEY) removedOnK2Failure = true;
      k2StorageState.delete(key);
    },
  };
  let k2Error = "";
  try { await migrateMediaProgressStorage(k2Storage, snapshots); }
  catch (error) { k2Error = error instanceof Error ? error.message : String(error); }
  expect(
    k2Error === MEDIA_PROGRESS_MIGRATION_ERROR && !removedOnK2Failure && k2StorageState.has(MEDIA_PROGRESS_V1_STORAGE_KEY),
    "K2 failure must keep the authoritative v1 progress intact",
  );

  let cleanupRemoved = false;
  const cleanV2 = JSON.stringify([migratedA]);
  const recoveryStorage: MediaProgressStorageAdapter = {
    async getItem(key) {
      if (key === MEDIA_PROGRESS_V2_STORAGE_KEY) return cleanV2;
      if (key === MEDIA_PROGRESS_V1_STORAGE_KEY) return JSON.stringify([legacy(sourceA)]);
      return null;
    },
    async setItem() { throw new Error("existing v2 must not be rewritten"); },
    async removeItem(key) { if (key === MEDIA_PROGRESS_V1_STORAGE_KEY) cleanupRemoved = true; },
  };
  const recovered = await migrateMediaProgressStorage(recoveryStorage, snapshots);
  expect(
    recovered.length === 1 && recovered[0].id === migratedA.id && cleanupRemoved,
    "existing verified v2 plus leftover v1 must perform cleanup, not a second migration",
  );

  const interruptedState = new Map<string, string>([
    [MEDIA_PROGRESS_V1_STORAGE_KEY, JSON.stringify([legacy(sourceA)])],
    [MEDIA_PROGRESS_V2_STORAGE_KEY, "partial-corrupt-v2"],
  ]);
  let interruptedRemoved = false;
  const interruptedStorage: MediaProgressStorageAdapter = {
    async getItem(key) { return interruptedState.get(key) ?? null; },
    async setItem(key, value) { interruptedState.set(key, value); },
    async removeItem(key) {
      if (key === MEDIA_PROGRESS_V1_STORAGE_KEY) interruptedRemoved = true;
      interruptedState.delete(key);
    },
  };
  const interruptedRecovered = await migrateMediaProgressStorage(interruptedStorage, snapshots);
  expect(
    interruptedRecovered.length === 1 && interruptedRecovered[0].providerId === "provider-A" && interruptedRemoved &&
    !interruptedState.has(MEDIA_PROGRESS_V1_STORAGE_KEY),
    "partial/corrupt v2 with intact v1 must retry the one-step migration and recover without progress loss",
  );

  const secretUrl = "https://secret.example/movie/alice/do-not-log/77.mp4";
  let logCalls = 0;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => { logCalls += 1; };
  console.warn = () => { logCalls += 1; };
  console.error = () => { logCalls += 1; };
  const failingStorage: MediaProgressStorageAdapter = {
    async getItem(key) {
      if (key === MEDIA_PROGRESS_V1_STORAGE_KEY) return JSON.stringify([legacy(secretUrl)]);
      return null;
    },
    async setItem() { throw new Error(`backend failed for ${secretUrl}`); },
    async removeItem() {},
  };
  let fixedFailure = "";
  try { await migrateMediaProgressStorage(failingStorage, snapshots); }
  catch (error) { fixedFailure = error instanceof Error ? error.message : String(error); }
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  expect(
    fixedFailure === MEDIA_PROGRESS_MIGRATION_ERROR && !fixedFailure.includes(secretUrl),
    "E2/K4 migration errors must expose only the fixed code and never the source URL",
  );
  expect(logCalls === 0, "E2/K4 migration must never log source-bearing failures");

  const sourceFile = fs.readFileSync(path.join(process.cwd(), "lib/mediaProgress.ts"), "utf8");
  expect(
    !sourceFile.includes("console.log") && !sourceFile.includes("console.warn") && !sourceFile.includes("console.error") && !sourceFile.includes("safeLog"),
    "migration implementation must remain log-free",
  );

  const unscopedCanonical: MediaProgressV2 = { ...migratedA, id: "legacy-unscoped", providerId: null };
  const canonicalRef = unscopedCanonical.playbackRef as Extract<MediaPlaybackRef, { type: "xtream-vod" }>;
  const activeRef: MediaPlaybackRef = { ...canonicalRef, sourceMode: "direct" };
  const claimed = claimProgressForProvider([unscopedCanonical], "provider-A", activeRef);
  expect(
    claimed.changed && claimed.entry?.providerId === "provider-A" && claimed.entries.every((entry) => entry.providerId !== null),
    "E1 opening the same content under an active provider must naturally scope an unscoped row even if transport mode changed",
  );

  const scopedOlder: MediaProgressV2 = { ...migratedA, id: "scoped-old", updatedAt: migratedA.updatedAt - 10 };
  const unscopedNewer: MediaProgressV2 = { ...migratedA, id: "unscoped-new", providerId: null, updatedAt: migratedA.updatedAt + 10 };
  const mergedClaim = claimProgressForProvider([scopedOlder, unscopedNewer], "provider-A", activeRef);
  expect(
    mergedClaim.changed && mergedClaim.entries.length === 1 && mergedClaim.entry?.id === "unscoped-new" && mergedClaim.entry.providerId === "provider-A",
    "E1 claim must collapse duplicate scoped/unscoped identity without losing the newer progress",
  );

  const onlyA: MediaProgressV2 = { ...migratedA, providerId: "provider-A" };
  const wrongProvider = claimProgressForProvider([onlyA], "provider-B", activeRef);
  expect(!wrongProvider.entry && !wrongProvider.changed, "provider B must never resume provider A scoped progress");

  const manyA = Array.from({ length: 101 }, (_, index) => ({
    ...migratedA,
    id: `a-${index}`,
    providerId: "provider-A",
    updatedAt: migratedA.updatedAt + index,
  }));
  const twoB = Array.from({ length: 2 }, (_, index) => ({
    ...migratedA,
    id: `b-${index}`,
    providerId: "provider-B",
    updatedAt: migratedA.updatedAt + index,
  }));
  const trimmed = trimMediaProgressByScope([...manyA, ...twoB]);
  expect(
    trimmed.filter((entry) => entry.providerId === "provider-A").length === 100 &&
    trimmed.filter((entry) => entry.providerId === "provider-B").length === 2,
    "progress retention limit must be per provider scope rather than globally shared",
  );

  const providerBProgress: MediaProgressV2 = {
    ...migratedA,
    id: "provider-b-progress",
    providerId: "provider-B",
    playbackRef: { ...(migratedA.playbackRef as Extract<MediaPlaybackRef, { type: "xtream-vod" }>), streamId: "909" },
  };
  const unscopedProgress: MediaProgressV2 = { ...deletedProvider, id: "legacy-deleted", providerId: null };
  const multiProvider = [migratedA, providerBProgress, unscopedProgress];
  expect(
    mediaProgressForProvider(multiProvider, "provider-A").map((entry) => entry.id).join(",") === migratedA.id,
    "provider A view must exclude provider B and unscoped progress",
  );

  const afterClearA = clearMediaProgressForProvider(multiProvider, "provider-A");
  expect(
    !afterClearA.some((entry) => entry.providerId === "provider-A") &&
    afterClearA.some((entry) => entry.providerId === "provider-B") &&
    afterClearA.some((entry) => entry.providerId === null),
    "clearing provider A must preserve provider B and unscoped legacy progress",
  );

  const afterBWrite = [providerBProgress, migratedA];
  expect(
    mediaProgressForProvider(afterBWrite, "provider-A")[0]?.position === migratedA.position,
    "creating/updating provider B progress must leave provider A progress unchanged",
  );

  const contextSource = fs.readFileSync(path.join(process.cwd(), "context/MediaLibraryContext.tsx"), "utf8");
  expect(
    contextSource.includes("unscopedIdFromRuntimeSource") &&
    contextSource.includes("item.id !== unscopedId") &&
    contextSource.includes("provider?.id, toView"),
    "unscoped rows must remain individually removable after provider switches",
  );

  process.stdout.write(`media progress scenarios: ${passed}/31 passed\n`);
}

void main();
