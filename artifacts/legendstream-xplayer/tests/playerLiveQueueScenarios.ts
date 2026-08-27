import assert from "node:assert/strict";
import type { Channel } from "../lib/iptv";
import {
  buildLiveQueue,
  liveNavigationState,
  resolveLiveQueue,
  type LiveChannelIdentity,
} from "../lib/playerLiveQueue";

const channel = (
  id: string,
  providerId: string,
  category: string,
  streamUrl = `https://runtime.invalid/live/${id}.ts`,
): Channel => ({
  id,
  providerId,
  name: `Channel ${id}`,
  streamUrl,
  category,
  contentType: "live",
});

const identity = (providerId: string, channelId: string): LiveChannelIdentity => ({
  providerId,
  channelId,
});

let passed = 0;
const scenario = (name: string, run: () => void) => {
  run();
  passed += 1;
  process.stdout.write(`PASS ${name}\n`);
};

scenario("cold restart resolves cached Xtream live queue by stable identity", () => {
  const cached = [
    channel("101", "xtream-a", "News"),
    channel("102", "xtream-a", "News"),
    channel("201", "xtream-a", "Sports"),
  ];
  const queue = resolveLiveQueue([], cached, identity("xtream-a", "102"));
  assert.deepEqual(queue.map((item) => item.id), ["101", "102"]);
  assert.equal(liveNavigationState(queue, identity("xtream-a", "102")).currentIndex, 1);
});

scenario("normal connected live prefers PlayerContext channel queue", () => {
  const connected = [
    channel("1", "xtream-b", "General"),
    channel("2", "xtream-b", "General"),
  ];
  const staleCached = [channel("9", "xtream-b", "General")];
  const queue = resolveLiveQueue(connected, staleCached, identity("xtream-b", "1"));
  assert.deepEqual(queue.map((item) => item.id), ["1", "2"]);
});

scenario("M3U live queue uses the same providerId plus channelId identity", () => {
  const connected = [
    channel("m3u-1", "m3u-a", "Local", "https://m3u.invalid/a"),
    channel("m3u-2", "m3u-a", "Local", "https://m3u.invalid/b"),
  ];
  const queue = resolveLiveQueue(connected, [], identity("m3u-a", "m3u-2"));
  assert.deepEqual(queue.map((item) => item.id), ["m3u-1", "m3u-2"]);
});

scenario("category filter keeps only broadcasts related to the active channel", () => {
  const rows = [
    channel("n1", "p", "News"),
    channel("s1", "p", "Sports"),
    channel("n2", "p", "News"),
    channel("o1", "other", "News"),
  ];
  const queue = buildLiveQueue(rows, identity("p", "n2"));
  assert.deepEqual(queue.map((item) => item.id), ["n1", "n2"]);
});

scenario("first and last channel expose deterministic disabled states", () => {
  const queue = [
    channel("a", "p", "News"),
    channel("b", "p", "News"),
    channel("c", "p", "News"),
  ];
  const first = liveNavigationState(queue, identity("p", "a"));
  const last = liveNavigationState(queue, identity("p", "c"));
  assert.equal(first.canPrevious, false);
  assert.equal(first.canNext, true);
  assert.equal(last.canPrevious, true);
  assert.equal(last.canNext, false);
});

scenario("duplicate stream URLs cannot change active channel identity", () => {
  const duplicateUrl = "https://runtime.invalid/shared.ts";
  const rows = [
    channel("stable-a", "p", "News", duplicateUrl),
    channel("stable-b", "p", "News", duplicateUrl),
  ];
  const queue = resolveLiveQueue(rows, [], identity("p", "stable-b"));
  const state = liveNavigationState(queue, identity("p", "stable-b"));
  assert.equal(state.currentIndex, 1);
  assert.equal(queue[state.currentIndex]?.id, "stable-b");
});

assert.equal(passed, 6);
process.stdout.write(`player live queue scenarios: ${passed}/6 passed\n`);
