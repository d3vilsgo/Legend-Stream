import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectHomeLiveSource } from "../lib/homeLiveSource";
import type { Channel } from "../lib/iptv";

let passed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

function channel(providerId: string, id: string): Channel {
  return {
    providerId,
    id,
    name: `Channel ${id}`,
    streamUrl: `legendstream-catalog://stalker/live/${providerId}/${id}`,
    category: "Live",
    contentType: "live",
  };
}

const emptySnapshot = {
  ready: false,
  counts: { live: 0 },
  live: [],
};

async function main() {
  await scenario("Stalker Home uses SQL count and bounded SQL cards instead of legacy 14", () => {
    const sql = Array.from({ length: 1100 }, (_, index) => channel("stalker-a", `stalker-a:stalker:${index}`));
    const legacy = Array.from({ length: 14 }, (_, index) => channel("stalker-a", `legacy:${index}`));
    const selected = selectHomeLiveSource({
      provider: { id: "stalker-a", type: "stalker" },
      snapshot: { providerId: "stalker-a", ready: true, counts: { live: 1100 }, live: sql },
      hasUsableCache: true,
      legacyChannels: legacy,
    });
    assert.equal(selected.totalCount, 1100);
    assert.equal(selected.countKnown, true);
    assert.equal(selected.channels.length, 48);
    assert.equal(selected.channels[0].id, "stalker-a:stalker:0");
    assert.equal(selected.channels.some((item) => item.id.startsWith("legacy:")), false);
  });

  await scenario("Stalker Home SQL zero does not fall back to legacy 14", () => {
    const selected = selectHomeLiveSource({
      provider: { id: "stalker-a", type: "stalker" },
      snapshot: { providerId: "stalker-a", ready: true, counts: { live: 0 }, live: [] },
      hasUsableCache: true,
      legacyChannels: Array.from({ length: 14 }, (_, index) => channel("stalker-a", `legacy:${index}`)),
    });
    assert.deepEqual(selected.channels, []);
    assert.equal(selected.totalCount, 0);
    assert.equal(selected.countKnown, true);
  });

  await scenario("Stalker Home keeps previous good SQL catalog when persistence retains it", () => {
    const previousGood = [channel("stalker-a", "stalker-a:stalker:42")];
    const selected = selectHomeLiveSource({
      provider: { id: "stalker-a", type: "stalker" },
      snapshot: { providerId: "stalker-a", ready: true, counts: { live: 1 }, live: previousGood },
      hasUsableCache: true,
      legacyChannels: [],
    });
    assert.equal(selected.totalCount, 1);
    assert.deepEqual(selected.channels.map((item) => item.id), ["stalker-a:stalker:42"]);
  });

  await scenario("Stalker Home is provider-isolated", () => {
    const selected = selectHomeLiveSource({
      provider: { id: "stalker-b", type: "stalker" },
      snapshot: { providerId: "stalker-a", ready: true, counts: { live: 1 }, live: [channel("stalker-a", "stalker-a:stalker:1")] },
      hasUsableCache: true,
      legacyChannels: [channel("stalker-b", "legacy:1")],
    });
    assert.deepEqual(selected.channels, []);
    assert.equal(selected.totalCount, null);
    assert.equal(selected.countKnown, false);
  });

  await scenario("delayed stale Stalker result cannot replace current provider selection", () => {
    const stale = selectHomeLiveSource({
      provider: { id: "stalker-b", type: "stalker" },
      snapshot: { providerId: "stalker-a", ready: true, counts: { live: 1100 }, live: [channel("stalker-a", "stalker-a:stalker:1")] },
      hasUsableCache: true,
      legacyChannels: [],
    });
    const current = selectHomeLiveSource({
      provider: { id: "stalker-b", type: "stalker" },
      snapshot: { providerId: "stalker-b", ready: true, counts: { live: 2 }, live: [channel("stalker-b", "stalker-b:stalker:1")] },
      hasUsableCache: true,
      legacyChannels: [],
    });
    assert.deepEqual(stale.channels, []);
    assert.equal(current.channels[0].providerId, "stalker-b");
    assert.equal(current.totalCount, 2);
  });

  await scenario("Xtream Home source semantics keep legacy fallback when SQL preview is empty", () => {
    const selected = selectHomeLiveSource({
      provider: { id: "xtream-a", type: "xtream" },
      snapshot: { ...emptySnapshot, providerId: "xtream-a", ready: false },
      hasUsableCache: false,
      legacyChannels: [channel("xtream-a", "xtream-live-1")],
    });
    assert.equal(selected.channels[0].id, "xtream-live-1");
    assert.equal(selected.totalCount, null);
  });

  await scenario("M3U Home source semantics keep legacy fallback when SQL preview is empty", () => {
    const selected = selectHomeLiveSource({
      provider: { id: "m3u-a", type: "m3u" },
      snapshot: { ...emptySnapshot, providerId: "m3u-a", ready: false },
      hasUsableCache: false,
      legacyChannels: [channel("m3u-a", "m3u-live-1")],
    });
    assert.equal(selected.channels[0].id, "m3u-live-1");
    assert.equal(selected.totalCount, null);
  });

  await scenario("Stalker Home item IDs remain canonical persisted IDs", () => {
    const selected = selectHomeLiveSource({
      provider: { id: "stalker-a", type: "stalker" },
      snapshot: { providerId: "stalker-a", ready: true, counts: { live: 1 }, live: [channel("stalker-a", "stalker-a:stalker:9000")] },
      hasUsableCache: true,
      legacyChannels: [channel("stalker-a", "0")],
    });
    assert.equal(selected.channels[0].id, "stalker-a:stalker:9000");
    assert.notEqual(selected.channels[0].id, "0");
  });

  await scenario("Home Stalker ownership adds no Stalker network calls or playback changes", () => {
    const screenSource = source("components/OptimizedHomeScreenPaged.tsx");
    const selectorSource = source("lib/homeLiveSource.ts");
    assert.match(screenSource, /selectHomeLiveSource/);
    assert.match(screenSource, /provider\?\.type === "stalker" \? \[\] : playerLiveChannels/);
    assert.doesNotMatch(selectorSource, /handshake|get_profile|get_genres|get_all_channels|get_ordered_list|create_link|fetch/);
    assert.doesNotMatch(screenSource, /bootstrapProfile|getProfile|get_all_channels|get_main_info/);
  });

  assert.equal(passed, 9);
  console.log("home live source scenarios: 9/9 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
