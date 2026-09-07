import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EPG_PAGED_SEED_LIMIT,
  EpgSingleFlight,
  clearRegisteredEpgChannels,
  getRegisteredEpgChannels,
  hasUsableChannelEpg,
  mergeEpgPrograms,
  registerEpgChannels,
  selectChannelEpg,
  selectProgramsAt,
} from "../lib/epgRuntime";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const playerContextSource = source("context/PlayerContext.tsx");
const playerSource = source("components/CompatibilityVideoPlayerV2.tsx");
const liveListSource = source("components/catalog/PagedCatalogViews.tsx");
const iptvSource = source("lib/iptv.ts");

type Program = {
  channelId: string;
  title: string;
  start: number;
  end: number;
};

type Channel = {
  id: string;
  providerId: string;
  name: string;
  streamUrl: string;
  category: string;
  streamType?: string;
  tvgId?: string;
};

const channel = (providerId: string, id: string): Channel => ({
  id,
  providerId,
  name: id,
  streamUrl: "https://example.invalid/live",
  category: "Live",
  streamType: "xtream",
});

const deferred = <T,>() => {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};

async function main() {
  let passed = 0;

  // A. PAGED OWNERSHIP REGRESSION: an empty PlayerContext channel list is no longer
  // a prerequisite for canonical paged Live rows to become EPG input.
  clearRegisteredEpgChannels("p1");
  const paged = [channel("p1", "p1:xtream-live:101"), channel("p1", "p1:xtream-live:102")];
  registerEpgChannels("p1", paged);
  assert.deepEqual(getRegisteredEpgChannels<Channel>("p1").map((item) => item.id), paged.map((item) => item.id));
  assert.match(playerContextSource, /getRegisteredEpgChannels<Channel>\(resolvedProviderId\)/);
  assert.match(liveListSource, /registerEpgChannels\(provider\.id, seed\)/);
  passed += 1;

  // Performance gate: the bridge is bounded and never represents a full catalog.
  clearRegisteredEpgChannels("p-bound");
  registerEpgChannels(
    "p-bound",
    Array.from({ length: 500 }, (_, index) => channel("p-bound", `p-bound:xtream-live:${index}`)),
  );
  assert.equal(getRegisteredEpgChannels("p-bound").length, EPG_PAGED_SEED_LIMIT);
  assert.equal(EPG_PAGED_SEED_LIMIT, 48);
  assert.match(playerContextSource, /Math\.max\(channels\.length, provider\.channelCount \?\? 0\)/);
  passed += 1;

  // B + C. ACTIVE XTREAM + NO REQUEST STORM: same provider/channel has one in-flight task.
  const flight = new EpgSingleFlight();
  const pending = deferred<string>();
  let calls = 0;
  const first = flight.run("p1\u0000c1", async () => {
    calls += 1;
    return pending.promise;
  });
  const second = flight.run("p1\u0000c1", async () => {
    calls += 1;
    return "unexpected";
  });
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve("ok");
  assert.equal(await first, "ok");
  assert.equal(await second, "ok");
  assert.match(playerContextSource, /activeEpgSingleFlightRef\.current\.run\(requestKey/);
  passed += 1;

  // D. CACHE HIT: a usable future/current program suppresses a new lazy request.
  const now = 1_000_000;
  const cachedPrograms: Program[] = [{ channelId: "c1", title: "Cached", start: now - 1000, end: now + 1000 }];
  let cacheMissCalls = 0;
  if (!hasUsableChannelEpg(cachedPrograms, "c1", now)) cacheMissCalls += 1;
  assert.equal(cacheMissCalls, 0);
  passed += 1;

  // E. FAILURE RECOVERY: rejected single-flight entries are released and can be retried.
  const retryFlight = new EpgSingleFlight();
  let attempts = 0;
  await assert.rejects(() => retryFlight.run("p1\u0000c2", async () => {
    attempts += 1;
    throw new Error("expected fake failure");
  }));
  assert.equal(retryFlight.has("p1\u0000c2"), false);
  const retryResult = await retryFlight.run("p1\u0000c2", async () => {
    attempts += 1;
    return "recovered";
  });
  assert.equal(retryResult, "recovered");
  assert.equal(attempts, 2);
  passed += 1;

  // F. CHANNEL SWITCH RACE: late A data remains keyed to A and cannot resolve as B.
  const aPrograms: Program[] = [{ channelId: "p1:xtream-live:11", title: "A", start: now - 10, end: now + 100 }];
  const bPrograms: Program[] = [{ channelId: "p1:xtream-live:22", title: "B", start: now - 10, end: now + 100 }];
  let shared: Program[] = mergeEpgPrograms([], new Set([bPrograms[0].channelId]), bPrograms);
  shared = mergeEpgPrograms(shared, new Set([aPrograms[0].channelId]), aPrograms);
  assert.equal(selectChannelEpg(shared, { id: bPrograms[0].channelId }, now).now?.title, "B");
  assert.equal(selectChannelEpg(shared, { id: aPrograms[0].channelId }, now).now?.title, "A");
  passed += 1;

  // G. PROVIDER SWITCH: provider-scoped canonical IDs prevent stale provider A data from matching B.
  const providerA = "provider-a:xtream-live:33";
  const providerB = "provider-b:xtream-live:33";
  const providerPrograms: Program[] = [{ channelId: providerA, title: "A-only", start: now - 10, end: now + 100 }];
  assert.equal(selectChannelEpg(providerPrograms, { id: providerB }, now).now, undefined);
  assert.match(playerContextSource, /previous\.providers\.some\(\(item\) => item\.id === resolvedProviderId\)/);
  passed += 1;

  // H. XTREAM STABLE ID: legacy short-EPG lookup takes the final segment, valid for both ID forms.
  const legacyId = "provider:7:4567";
  const stableId = "provider:xtream-live:4567";
  assert.equal(legacyId.split(":").pop(), "4567");
  assert.equal(stableId.split(":").pop(), "4567");
  assert.match(iptvSource, /const streamId = channel\.id\.split\(":"\)\.pop\(\)/);
  assert.match(iptvSource, /action=get_short_epg&stream_id=/);
  assert.match(iptvSource, /epg_listings/);
  assert.match(iptvSource, /start_timestamp/);
  assert.match(iptvSource, /stop_timestamp/);
  passed += 1;

  // I. M3U/XMLTV CONTROL: preserve exact tvg-id / XMLTV channel mapping; no fuzzy matcher introduced.
  assert.match(iptvSource, /state\.epgUrl = attributes\["url-tvg"\] \?\? attributes\["x-tvg-url"\]/);
  assert.match(iptvSource, /const tvgId = state\.pending\.attributes\["tvg-id"\] \|\| undefined/);
  assert.match(iptvSource, /function channelIdMap\(channels: Channel\[\]\)/);
  assert.match(iptvSource, /channel\.tvgId \|\| channel\.name/);
  assert.match(iptvSource, /channelIds\.get\(decodeEpgText\(attributes\.channel \|\| ""\)\)/);
  passed += 1;

  // J. CURRENT/NEXT RESOLVER semantics.
  const timeline: Program[] = [
    { channelId: "c", title: "Now", start: now - 100, end: now + 100 },
    { channelId: "c", title: "Next", start: now + 100, end: now + 200 },
  ];
  const selection = selectProgramsAt(timeline, now);
  assert.equal(selection.now?.title, "Now");
  assert.equal(selection.next?.title, "Next");
  assert.equal(selectProgramsAt(timeline, now + 100).now?.title, "Next");
  passed += 1;

  // K. LIVE LIST: existing UI contract consumes the shared cache and keeps literal fallback.
  assert.match(liveListSource, /selectProgramsAt\(epgByChannel\.get\(channel\.id\), epgClock\)\.now/);
  assert.match(liveListSource, /current \? `Şu an:/);
  assert.match(liveListSource, /: "—"/);
  assert.match(liveListSource, /void refreshEpg\(provider\.id\)/);
  passed += 1;

  // L. PLAYER: canonical currentLive triggers lazy recovery and feeds existing PlayerChrome contract.
  assert.match(playerSource, /registerEpgChannels\(provider\.id, \[currentLive\]\)/);
  assert.match(playerSource, /void refreshEpg\(provider\.id, currentLive\.id\)/);
  assert.match(playerSource, /epgNow=\{currentEpg\.now\}/);
  assert.match(playerSource, /epgNext=\{currentEpg\.next\}/);
  assert.match(playerSource, /epgLoading=\{currentKind === "live" && isEpgLoading\}/);
  passed += 1;

  assert.equal(passed, 12);
  process.stdout.write(`epg runtime scenarios: ${passed}/12 passed\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
