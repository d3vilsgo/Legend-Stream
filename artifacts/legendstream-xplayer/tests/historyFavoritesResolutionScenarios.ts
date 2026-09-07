import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOME_LIVE_IDENTITY_PREVIEW_LIMIT,
  LIVE_ID_LOOKUP_CHUNK_SIZE,
  chunkLiveIdentityIds,
  homeLiveIdentityPreviewIds,
  normalizeLiveIdentityIds,
} from "../lib/catalogLiveIdentity";
import {
  indexLiveChannelsByProviderAndId,
  resolveLiveIdentityPresentationRows,
} from "../lib/historyFavoritesPresentation";
import type { Channel } from "../lib/iptv";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const screenSource = source("components/OptimizedHomeScreenPaged.tsx");
const hookSource = source("hooks/useResolvedLiveIdentityChannels.ts");
const repositorySource = source("lib/catalogLiveIdentityRepository.ts");

let passed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);

const channel = (providerId: string, id: string): Channel => ({
  id,
  providerId,
  name: id,
  streamUrl: `https://example.invalid/live/${id}`,
  category: "Live",
  contentType: "live",
});

async function main() {
  await scenario("650 favorites are not truncated by arbitrary resolver cap", () => {
    const favorites = ids("fav", 650);
    assert.equal(normalizeLiveIdentityIds(favorites).length, 650);
    assert.equal(normalizeLiveIdentityIds(favorites).at(-1), "fav-650");
  });

  await scenario("50 history plus 600 favorites preserves the tail of Favorites resolution", () => {
    const history = ids("history", 50);
    const favorites = ids("favorite", 600);
    const combined = normalizeLiveIdentityIds([...history, ...favorites]);
    assert.equal(combined.length, 650);
    assert.equal(combined.at(-1), "favorite-600");
  });

  await scenario("more than 1000 requested IDs stay in bounded SQLite-sized chunks", () => {
    const requested = ids("id", 1_001);
    const chunks = chunkLiveIdentityIds(requested);
    assert.equal(LIVE_ID_LOOKUP_CHUNK_SIZE, 200);
    assert.equal(chunks.flat().length, 1_001);
    assert.ok(chunks.every((chunk) => chunk.length <= LIVE_ID_LOOKUP_CHUNK_SIZE));
    assert.ok(chunks.length > 1);
  });

  await scenario("chunk boundaries 199 200 201 400 401 have no duplicate or skip", () => {
    for (const count of [199, 200, 201, 400, 401]) {
      const requested = ids(`boundary-${count}`, count);
      const flattened = chunkLiveIdentityIds(requested).flat();
      assert.deepEqual(flattened, requested);
      assert.equal(new Set(flattened).size, count);
    }
  });

  await scenario("duplicate query identities dedupe while presentation semantics can preserve repeats", () => {
    const requested = ["same", "same", "other"];
    assert.deepEqual(normalizeLiveIdentityIds(requested), ["same", "other"]);
    const index = indexLiveChannelsByProviderAndId([
      channel("provider-a", "same"),
      channel("provider-a", "other"),
    ]);
    assert.deepEqual(
      resolveLiveIdentityPresentationRows("provider-a", requested, index).map((item) => item.id),
      requested,
    );
  });

  await scenario("missing persisted identities are safely dropped from presentation", () => {
    const index = indexLiveChannelsByProviderAndId([channel("provider-a", "present")]);
    assert.deepEqual(
      resolveLiveIdentityPresentationRows("provider-a", ["present", "missing"], index).map((item) => item.id),
      ["present"],
    );
  });

  await scenario("provider scoped index never resolves the same item id from another provider", () => {
    const index = indexLiveChannelsByProviderAndId([
      channel("provider-a", "shared"),
      channel("provider-b", "shared"),
    ]);
    const rows = resolveLiveIdentityPresentationRows("provider-a", ["shared"], index);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.providerId, "provider-a");
  });

  await scenario("requested ordering survives chunk merge and presentation lookup", () => {
    const requested = ["c", "a", "d", "b"];
    const index = indexLiveChannelsByProviderAndId([
      channel("provider-a", "a"),
      channel("provider-a", "b"),
      channel("provider-a", "c"),
      channel("provider-a", "d"),
    ]);
    assert.deepEqual(
      resolveLiveIdentityPresentationRows("provider-a", requested, index).map((item) => item.id),
      requested,
    );
  });

  await scenario("provider switch during resolution retains generation-based stale publish guard", () => {
    assert.match(hookSource, /const generation = \+\+generationRef\.current/);
    assert.match(hookSource, /if \(generationRef\.current !== generation\) return/);
    assert.match(hookSource, /provider\?\.id[\s\S]*identityKey/);
  });

  await scenario("identity resolution keeps provider scoped chunked SELECT without full Live hydration", () => {
    assert.match(repositorySource, /const lookupIds = normalizeLiveIdentityIds\(Array\.from\(lookupByRequested\.values\(\)\)\)/);
    assert.match(repositorySource, /for \(const chunk of chunkLiveIdentityIds\(lookupIds\)\)/);
    assert.match(repositorySource, /legacyXtreamLiveStreamId[\s\S]*stableXtreamLiveId\(provider\.id, legacyStreamId\)/);
    assert.match(repositorySource, /provider_id = \?[\s\S]*kind = 'live'[\s\S]*item_id IN/);
    assert.doesNotMatch(repositorySource, /getCachedLiveItems\(|hydrateM3UProviderKindCache|getM3UCatalog|installFullCatalog/);
  });

  await scenario("Home identity preview stays small while full History resolution activates only in History view", () => {
    const history = ids("history", 1_000);
    assert.equal(homeLiveIdentityPreviewIds(history).length, HOME_LIVE_IDENTITY_PREVIEW_LIMIT);
    assert.ok(HOME_LIVE_IDENTITY_PREVIEW_LIMIT < LIVE_ID_LOOKUP_CHUNK_SIZE);
    assert.match(screenSource, /homeLiveIdentityPreviewIds\(history\)/);
    assert.match(screenSource, /view === "history" \? \[\.\.\.history, \.\.\.favorites\] : \[\]/);
  });

  await scenario("History Favorites lookup is indexed and full-view rendering is virtualized", () => {
    const channels = ids("channel", 2_000).map((id) => channel("provider-a", id));
    const index = indexLiveChannelsByProviderAndId(channels);
    assert.equal(index.size, 2_000);
    assert.deepEqual(
      resolveLiveIdentityPresentationRows("provider-a", ["channel-2000", "channel-1"], index).map((item) => item.id),
      ["channel-2000", "channel-1"],
    );
    const historyViewStart = screenSource.indexOf("function HistoryView");
    const settingsStart = screenSource.indexOf("function Settings", historyViewStart);
    const historyViewSource = screenSource.slice(historyViewStart, settingsStart);
    assert.match(historyViewSource, /indexLiveChannelsByProviderAndId/);
    assert.doesNotMatch(historyViewSource, /channels\.find\(/);
    assert.match(historyViewSource, /<SectionList/);
    assert.match(screenSource, /view !== "history"/);
  });

  assert.equal(passed, 12);
  console.log("history favorites resolution scenarios: 12/12 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
