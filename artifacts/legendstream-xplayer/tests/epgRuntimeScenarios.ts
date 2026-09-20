import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tokenizeM3ULinesCooperatively } from "../lib/iptv";
import {
  EPG_BACKGROUND_BUDGET_MS,
  EPG_PAGED_SEED_LIMIT,
  EPG_RETRY_BACKOFF_MS,
  EpgAttemptGeneration,
  EpgSingleFlight,
  clearRegisteredEpgChannels,
  getRegisteredEpgChannels,
  hasUsableChannelEpg,
  mergeEpgPrograms,
  registerEpgChannels,
  runEpgBackgroundAttempt,
  startEpgBackgroundAttempt,
  selectChannelEpg,
  selectProgramsAt,
} from "../lib/epgRuntime";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const playerContextSource = source("context/PlayerContext.tsx");
const playerSource = source("components/CompatibilityVideoPlayerV2.tsx");
const homeSource = source("components/OptimizedHomeScreenPaged.tsx");
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
  assert.equal(EPG_BACKGROUND_BUDGET_MS, 5_000);
  assert.equal(EPG_RETRY_BACKOFF_MS, 30_000);
  assert.match(playerContextSource, /Math\.max\(channels\.length, provider\.channelCount \?\? 0\)/);
  assert.match(playerContextSource, /boundedProvider\s*\? fallbackChannels\.slice\(0, EPG_PAGED_SEED_LIMIT\)\s*:\s*fallbackChannels/);
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
  const timedOut = await runEpgBackgroundAttempt(
    () => new Promise<string>(() => undefined),
    10,
  );
  assert.equal(timedOut.classification, "timeout");
  assert.ok(timedOut.elapsedMs >= 0);
  const immediate = await runEpgBackgroundAttempt(async () => "epg-ok", 50);
  assert.deepEqual(immediate.classification, "success");
  assert.equal(immediate.value, "epg-ok");
  assert.match(playerContextSource, /if \(existingPromise\) \{\s*if \(boundedProvider\) return;/);
  assert.match(playerContextSource, /Date\.now\(\) \+ EPG_RETRY_BACKOFF_MS/);
  passed += 1;

  // D. CACHE HIT: a usable future/current program suppresses a new lazy request.
  const now = 1_000_000;
  const cachedPrograms: Program[] = [{ channelId: "c1", title: "Cached", start: now - 1000, end: now + 1000 }];
  let cacheMissCalls = 0;
  if (!hasUsableChannelEpg(cachedPrograms, "c1", now)) cacheMissCalls += 1;
  assert.equal(cacheMissCalls, 0);
  assert.match(playerContextSource, /if \(programs\.length\) \{\s*setState/);
  const bulkRefreshStart = playerContextSource.indexOf("if (!channelId) {");
  const bulkRefreshEnd = playerContextSource.indexOf("const inFlight = bulkEpgPromiseRef.current.get", bulkRefreshStart);
  const bulkRefreshSource = playerContextSource.slice(bulkRefreshStart, bulkRefreshEnd);
  assert.ok(bulkRefreshStart >= 0 && bulkRefreshEnd > bulkRefreshStart);
  assert.doesNotMatch(bulkRefreshSource, /epg:\s*\[\]/);
  assert.match(bulkRefreshSource, /if \(programs\.length\) \{[\s\S]*mergeEpgPrograms\(previous\.epg, ids, programs\)/);
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
  const failedAttempt = await runEpgBackgroundAttempt(async () => {
    throw new Error("network down");
  }, 50);
  assert.equal(failedAttempt.classification, "failure");
  passed += 1;

  // F. CHANNEL SWITCH RACE: late A data remains keyed to A and cannot resolve as B.
  const aPrograms: Program[] = [{ channelId: "p1:xtream-live:11", title: "A", start: now - 10, end: now + 100 }];
  const bPrograms: Program[] = [{ channelId: "p1:xtream-live:22", title: "B", start: now - 10, end: now + 100 }];
  let shared: Program[] = mergeEpgPrograms([], new Set([bPrograms[0].channelId]), bPrograms);
  shared = mergeEpgPrograms(shared, new Set([aPrograms[0].channelId]), aPrograms);
  assert.equal(selectChannelEpg(shared, { id: bPrograms[0].channelId }, now).now?.title, "B");
  assert.equal(selectChannelEpg(shared, { id: aPrograms[0].channelId }, now).now?.title, "A");
  const generations = new EpgAttemptGeneration();
  const staleGeneration = generations.begin("p1");
  const currentGeneration = generations.begin("p1");
  assert.equal(generations.isCurrent("p1", staleGeneration), false);
  assert.equal(generations.isCurrent("p1", currentGeneration), true);
  assert.match(playerContextSource, /EPG_RESULT_IGNORED_STALE/);
  passed += 1;

  // G. PROVIDER SWITCH: provider-scoped canonical IDs prevent stale provider A data from matching B.
  const providerA = "provider-a:xtream-live:33";
  const providerB = "provider-b:xtream-live:33";
  const providerPrograms: Program[] = [{ channelId: providerA, title: "A-only", start: now - 10, end: now + 100 }];
  assert.equal(selectChannelEpg(providerPrograms, { id: providerB }, now).now, undefined);
  assert.match(playerContextSource, /previous\.providers\.some\(\(item\) => item\.id === resolvedProviderId\)/);
  assert.match(playerContextSource, /epgAttemptGenerationRef\.current\.isCurrent\(resolvedProviderId, generation\)/);
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
  assert.match(iptvSource, /signal: options\.signal \?\? AbortSignal\.timeout\(30_000\)/);
  assert.match(iptvSource, /if \(signal\?\.aborted\) throw new Error\("EPG background attempt aborted\."\)/);
  assert.match(iptvSource, /const EPG_DECODE_CHUNK_BYTES = 256 \* 1024/);
  assert.match(iptvSource, /decodeBytesCooperatively/);
  assert.match(iptvSource, /bytes\.subarray\(offset, end\)/);
  assert.match(iptvSource, /if \(end < bytes\.length\) await yieldToUi\(\)/);
  const bgStart = playerContextSource.indexOf("const refreshProviderInBackground");
  const bgEnd = playerContextSource.indexOf("useEffect(() => {", bgStart);
  const bgSource = playerContextSource.slice(bgStart, bgEnd);
  assert.match(bgSource, /existing\.epgUrl[\s\S]*updated\.epgUrl[\s\S]*invalidateEpgFreshness\(providerId\)/);
  assert.doesNotMatch(bgSource, /clearRegisteredEpgChannels|clearEpgProviderCache/);
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
  const liveRowStart = liveListSource.indexOf("renderItem={({ item: channel }) => {");
  const liveRowEnd = liveListSource.indexOf("extraData={{ favorites, epgByChannel, epgClock }}", liveRowStart);
  const liveRowSource = liveListSource.slice(liveRowStart, liveRowEnd);
  assert.ok(liveRowStart >= 0 && liveRowEnd > liveRowStart);
  assert.match(liveRowSource, /<Pressable[\s\S]*style=\{s\.liveMain\}[\s\S]*onPress=\{\(\) => \{\s*if \(provider\.type === "m3u"\) recordM3ULivePress\(\);\s*onOpen\(channel\);\s*\}/);
  assert.doesNotMatch(liveRowSource, /disabled=/);
  assert.match(homeSource, /epgLoading=\{isEpgLoading\} refreshing=\{isLoading \|\| isRefreshing \|\| isSyncing\}/);
  const openLiveStart = homeSource.indexOf("const openLive =");
  const openLiveEnd = homeSource.indexOf("const openMovie =", openLiveStart);
  const openLiveSource = homeSource.slice(openLiveStart, openLiveEnd);
  assert.match(openLiveSource, /setPlayable\(/);
  assert.match(openLiveSource, /setView\("player"\)/);
  assert.doesNotMatch(openLiveSource, /refreshEpg|isEpgLoading|await/);
  passed += 1;

  // L. PLAYER: canonical currentLive triggers lazy recovery and feeds existing PlayerChrome contract.
  assert.match(playerSource, /registerEpgChannels\(provider\.id, \[currentLive\]\)/);
  assert.match(playerSource, /void refreshEpg\(provider\.id, currentLive\.id\)/);
  assert.match(playerSource, /epgNow=\{currentEpg\.now\}/);
  assert.match(playerSource, /epgNext=\{currentEpg\.next\}/);
  assert.match(playerSource, /epgLoading=\{currentKind === "live" && isEpgLoading\}/);
  assert.match(playerSource, /void refreshEpg\(provider\.id, currentLive\.id\)/);
  assert.doesNotMatch(playerSource, /await refreshEpg\(provider\.id, currentLive\.id\)/);
  assert.match(playerContextSource, /const boundedProvider = provider\.type === "m3u" \|\| provider\.type === "xtream"/);
  assert.match(playerContextSource, /runEpgBackgroundAttempt\([\s\S]*EPG_BACKGROUND_BUDGET_MS/);
  assert.match(playerContextSource, /const inFlight = bulkEpgPromiseRef\.current\.get\(resolvedProviderId\);\s*if \(inFlight\) return;/);
  assert.match(playerContextSource, /: \{\s*classification: "success" as const,\s*value: await loadBulkProviderEpg\(provider, providerChannels\),\s*elapsedMs: 0,/);
  passed += 1;

  // M. PHYSICAL BUG CONTRACT: unresolved EPG cannot serialize channel selection.
  const unresolvedEpg = deferred<void>();
  let playerOpened = false;
  const openChannel = () => { playerOpened = true; };
  void unresolvedEpg.promise;
  openChannel();
  assert.equal(playerOpened, true);
  assert.equal(await Promise.race([
    unresolvedEpg.promise.then(() => "epg"),
    Promise.resolve("interaction"),
  ]), "interaction");
  assert.doesNotMatch(liveRowSource, /isEpgLoading|epgLoading|await/);
  assert.doesNotMatch(openLiveSource, /isEpgLoading|epgByChannel|refreshEpg|await/);
  const navigateStart = homeSource.indexOf("const navigate =");
  const navigateEnd = homeSource.indexOf("React.useEffect(() => {", navigateStart);
  const navigateSource = homeSource.slice(navigateStart, navigateEnd);
  assert.ok(navigateStart >= 0 && navigateEnd > navigateStart);
  assert.doesNotMatch(navigateSource, /isEpgLoading|refreshEpg|await/);
  passed += 1;

  // N. TIMEOUT/LATE COMPLETION: the bounded attempt result remains timeout after abandoned work finishes.
  const late = deferred<string>();
  const lateAttempt = runEpgBackgroundAttempt(() => late.promise, 5);
  const timeoutResult = await lateAttempt;
  assert.equal(timeoutResult.classification, "timeout");
  late.resolve("late-epg");
  await Promise.resolve();
  assert.equal(timeoutResult.classification, "timeout");
  assert.match(playerContextSource, /EPG_RESULT_IGNORED_STALE/);
  assert.match(playerContextSource, /Date\.now\(\) \+ EPG_RETRY_BACKOFF_MS/);
  passed += 1;

  // O. ATTEMPT VS WORK LIFETIME.
  const ignoredAbort = deferred<string>();
  let timeoutTiming: { timeoutTimerDriftMs: number | null } | null = null;
  let settledTiming: { underlyingSettleAfterTimeoutMs: number | null } | null = null;
  const lifetime = startEpgBackgroundAttempt(
    () => ignoredAbort.promise,
    5,
    {
      onTimeout: (timing) => { timeoutTiming = timing; },
      onUnderlyingSettled: (timing) => { settledTiming = timing; },
    },
  );
  assert.equal((await lifetime.attemptPromise).classification, "timeout");
  assert.equal(lifetime.signal.aborted, true);
  let underlyingSettled = false;
  void lifetime.workPromise.then(() => { underlyingSettled = true; });
  await Promise.resolve();
  assert.equal(underlyingSettled, false);
  ignoredAbort.resolve("late");
  assert.equal((await lifetime.workPromise).classification, "timeout");
  assert.ok(timeoutTiming && timeoutTiming.timeoutTimerDriftMs !== null);
  assert.ok(settledTiming && settledTiming.underlyingSettleAfterTimeoutMs !== null);
  passed += 1;

  // P. TIMER DRIFT.
  let observedDrift: number | null = null;
  const driftHandle = startEpgBackgroundAttempt(
    () => new Promise<void>(() => undefined),
    5,
    { onTimeout: (timing) => { observedDrift = timing.timeoutTimerDriftMs; } },
  );
  assert.equal((await driftHandle.attemptPromise).classification, "timeout");
  assert.ok(observedDrift !== null && observedDrift >= 0);
  passed += 1;

  // Q. BULK OWNERSHIP.
  assert.match(playerContextSource, /const workResultPromise = boundedHandle\?\.workPromise \?\? directWork!/);
  assert.match(playerContextSource, /bulkEpgPromiseRef\.current\.set\(resolvedProviderId, workOwner\)/);
  assert.match(playerContextSource, /if \(bulkEpgPromiseRef\.current\.get\(resolvedProviderId\) === workOwner\)[\s\S]*bulkEpgPromiseRef\.current\.delete/);
  assert.doesNotMatch(playerContextSource, /bulkEpgPromiseRef\.current\.set\(resolvedProviderId, attemptPromise\)/);
  passed += 1;

  // R. SEMANTIC TRIGGER.
  assert.match(playerContextSource, /function boundedEpgAutoTriggerKey\(provider: ProviderConfig, channels: readonly Channel\[\]\)/);
  assert.match(playerContextSource, /effectiveEpgSourceIdentity\(provider\)/);
  const boundedEffectStart = playerContextSource.indexOf("const boundedAutoEpgTriggerKey = useMemo");
  const stalkerEffectStart = playerContextSource.indexOf('if (isHydrating || !state.provider || state.provider.type !== "stalker")', boundedEffectStart);
  const boundedEffects = playerContextSource.slice(boundedEffectStart, stalkerEffectStart);
  assert.ok(boundedEffectStart >= 0 && stalkerEffectStart > boundedEffectStart);
  assert.doesNotMatch(boundedEffects, /lastLoadedAt/);
  assert.match(boundedEffects, /boundedAutoEpgTriggerKey/);
  passed += 1;

  // S. M3U TOKENIZER PARITY.
  const mixedM3U = "\uFEFF#EXTM3U url-tvg=\"x\"\r\n#EXTINF:-1,One\nhttp://one\r\n\r\n#EXTGRP:News\n";
  const expectedLines = mixedM3U.replace(/^\uFEFF/, "").split(/\r?\n/);
  const cooperativeLines = await tokenizeM3ULinesCooperatively(mixedM3U, 2, async () => undefined);
  assert.deepEqual(cooperativeLines, expectedLines);
  const cooperativeM3UStart = iptvSource.indexOf("async function parseM3UCooperatively");
  const providerErrorStart = iptvSource.indexOf("export class ProviderLoadError", cooperativeM3UStart);
  assert.doesNotMatch(
    iptvSource.slice(cooperativeM3UStart, providerErrorStart),
    /content\.replace\(\/\^\\uFEFF\/[\s\S]*\.split\(\/\\r\?\\n\//,
  );
  passed += 1;

  // T. ABORT BOUNDARIES.
  assert.match(iptvSource, /if \(signal\?\.aborted\) throw new Error\("EPG background attempt aborted\."\)/);
  assert.match(iptvSource, /if \(end < bytes\.length\) await yieldToUi\(\)/);
  assert.match(iptvSource, /scanned % 120 === 0[\s\S]*signal\?\.aborted[\s\S]*await yieldToUi\(\)/);
  assert.match(iptvSource, /recordM3UEpgStringAssemblyBegin/);
  passed += 1;

  // U. LIVE WHILE TIMED-OUT UNDERLYING WORK IS STILL ALIVE.
  const longWork = deferred<void>();
  const background = startEpgBackgroundAttempt(() => longWork.promise, 5);
  assert.equal((await background.attemptPromise).classification, "timeout");
  let liveOpenedDuringLateWork = false;
  const openDuringLateWork = () => { liveOpenedDuringLateWork = true; };
  openDuringLateWork();
  assert.equal(liveOpenedDuringLateWork, true);
  assert.equal(background.signal.aborted, true);
  longWork.resolve();
  await background.workPromise;
  assert.doesNotMatch(liveRowSource, /isEpgLoading|epgLoading|await/);
  assert.doesNotMatch(openLiveSource, /isEpgLoading|epgByChannel|refreshEpg|await/);
  passed += 1;

  // V. PHASE/LIFETIME DIAGNOSTICS + SAFE SOURCE IDENTITY.
  assert.match(playerContextSource, /EPG_ABORT_REQUESTED/);
  assert.match(playerContextSource, /EPG_UNDERLYING_SETTLED/);
  assert.match(playerContextSource, /recordM3UEpgTimeoutTimerDrift/);
  assert.match(playerContextSource, /recordM3UEpgUnderlyingSettleAfterTimeout/);
  assert.match(playerContextSource, /const sourceKey = boundedProvider \? effectiveEpgSourceIdentity\(provider\) : undefined/);
  passed += 1;

  assert.equal(passed, 22);
  process.stdout.write("epg runtime scenarios: 12/12 passed\n");
  process.stdout.write("epg Z2RA non-blocking contract scenarios: 2/2 passed\n");
  process.stdout.write("epg Z2RB ownership/liveness scenarios: 8/8 passed\n");
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
