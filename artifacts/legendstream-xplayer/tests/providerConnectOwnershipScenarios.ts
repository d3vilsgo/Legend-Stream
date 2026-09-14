import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProviderConnectAttemptGate,
  withProviderConnectDeadline,
} from "../lib/providerConnectAttempt";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const playerSource = source("context/PlayerContext.tsx");
const screenSource = source("components/OptimizedHomeScreenPaged.tsx");
const routingSource = source("lib/stalkerLiveCatalogRouting.ts");
const bootstrapSource = source("lib/stalkerCatalogBootstrap.ts");

let passed = 0;
const scenario = async (name: string, run: () => void | Promise<void>) => {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

async function main() {
  await scenario("timeout aborts the owning underlying connect attempt", async () => {
    const gate = new ProviderConnectAttemptGate();
    const { attempt } = gate.begin(100);
    const pending = deferred<string>();
    attempt.signal.addEventListener("abort", () => pending.reject(new Error("aborted")), { once: true });
    const timeout = {
      callback: null as (() => void) | null,
    };
    const wrapped = withProviderConnectDeadline(pending.promise, {
      timeoutMs: 30_000,
      onTimeout: () => {
        assert.equal(gate.cancel(attempt, "TIMEOUT"), true);
        return new Error("timeout");
      },
      scheduler: {
        setTimeout: (callback) => { timeout.callback = callback; return 1; },
        clearTimeout: () => undefined,
      },
    });
    const fireTimeout = timeout.callback;
    assert.ok(fireTimeout);
    fireTimeout();
    await assert.rejects(wrapped, /timeout/);
    assert.equal(attempt.signal.aborted, true);
    assert.equal(attempt.cancelReason, "TIMEOUT");
    assert.equal(gate.isCurrent(attempt), false);
  });

  await scenario("user cancellation aborts the current attempt immediately", () => {
    const gate = new ProviderConnectAttemptGate();
    const { attempt } = gate.begin(100);
    assert.equal(gate.cancel(attempt, "USER"), true);
    assert.equal(attempt.signal.aborted, true);
    assert.equal(attempt.cancelReason, "USER");
    assert.equal(gate.current(), null);
  });

  await scenario("a second connect supersedes and aborts the first attempt", () => {
    const gate = new ProviderConnectAttemptGate();
    const first = gate.begin(100).attempt;
    const secondBegin = gate.begin(200);
    assert.equal(secondBegin.superseded, first);
    assert.equal(first.signal.aborted, true);
    assert.equal(first.cancelReason, "SUPERSEDED");
    assert.equal(gate.isCurrent(first), false);
    assert.equal(gate.isCurrent(secondBegin.attempt), true);
    assert.ok(secondBegin.attempt.id > first.id);
  });

  await scenario("a stale first attempt cannot publish after a second attempt owns the gate", async () => {
    const gate = new ProviderConnectAttemptGate();
    const first = gate.begin().attempt;
    const firstResult = deferred<string>();
    const publication: string[] = [];
    const firstTask = firstResult.promise.then((value) => {
      if (gate.isCurrent(first)) publication.push(value);
    });
    const second = gate.begin().attempt;
    publication.push(gate.isCurrent(second) ? "second" : "missing-second");
    firstResult.resolve("stale-first");
    await firstTask;
    assert.deepEqual(publication, ["second"]);
  });

  await scenario("stale finally cleanup is owner-aware and cannot clear newer busy state", () => {
    assert.match(playerSource, /const connectBusyOwnerRef = useRef<\{ attemptId: number; busyId: number \} \| null>\(null\);/);
    assert.match(playerSource, /if \(!owner \|\| owner\.attemptId !== attemptId\) return;[\s\S]*finishPlayerBusy\(owner\.busyId\);/);
    assert.match(playerSource, /finally \{[\s\S]*connectAttemptGateRef\.current\.finish\(attempt\)[\s\S]*finishConnectBusy\(attempt\.id\);/);
  });

  await scenario("cancelled or stale attempts cannot persist provider metadata", () => {
    assert.match(playerSource, /const persistConnectedProviderAttempt = async \([\s\S]*if \(!isCurrentConnectAttempt\(attempt\)\) return null;/);
    assert.match(playerSource, /const restoreCurrentState = async \(\) => \{[\s\S]*AsyncStorage\.setItem\(STORAGE_KEY, serializedPlayerState\(stateRef\.current\)\)/);
    assert.match(playerSource, /await AsyncStorage\.setItem\(STORAGE_KEY, serializedPlayerState\(next\)\);[\s\S]*if \(!isCurrentConnectAttempt\(attempt\)\) \{\s*await restoreCurrentState\(\);/);
    assert.match(playerSource, /if \(!isCurrentConnectAttempt\(attempt\)\) return false;\s*await saveProviderSecrets\(savedProvider\);\s*if \(!isCurrentConnectAttempt\(attempt\)\) return false;/);
  });

  await scenario("cancelled attempts cannot publish activeProviderId or channels", () => {
    const persistCall = playerSource.match(/const generation = await persistConnectedProviderAttempt\(attempt, \{[\s\S]*?\n      \}\);/)?.[0] ?? "";
    assert.match(persistCall, /activeProviderId: savedProvider\.id/);
    assert.match(persistCall, /channels:/);
    assert.match(playerSource, /if \(generation === null \|\| !isCurrentConnectAttempt\(attempt\)\) return false;/);
    assert.match(playerSource, /LS_PROVIDER_CONNECT_PUBLISH/);
  });

  await scenario("Stalker connect propagates AbortSignal and current ownership downstream", () => {
    assert.match(playerSource, /loadProviderSmart\(providerToLoad, \{[\s\S]*signal: attempt\.signal,[\s\S]*isCurrent: \(\) => isCurrentConnectAttempt\(attempt\),[\s\S]*stalkerSyncOwner:/);
    assert.match(routingSource, /bootstrapStalkerProviderForLifecycle\(provider, \{[\s\S]*signal: options\.signal,[\s\S]*isCurrent: options\.isCurrent/);
    assert.match(bootstrapSource, /await session\.handshake\(options\.signal\);/);
    assert.match(bootstrapSource, /fetchLiveCategories[\s\S]*options\.signal/);
  });

  await scenario("M3U connect loader behavior remains on the existing loadProvider path", () => {
    assert.match(playerSource, /if \(resolvedProviderTransport\(provider\) !== "xtream"\) \{\s*const loaded = await loadProvider\(provider\);/);
    assert.match(playerSource, /persistM3ULoadInBackground\(provider, loaded\)/);
  });

  await scenario("Xtream connect loader and fallback behavior remain unchanged", () => {
    assert.match(playerSource, /const parsed = parseXtreamGetPhp\(provider\.url\);/);
    assert.match(playerSource, /const loaded = await loadProvider\(toXtreamLoadProvider\(savedXtream\)\);/);
    assert.match(playerSource, /const fallback: RoutedProvider = \{[\s\S]*type: "m3u",[\s\S]*transport: "m3u"/);
  });

  await scenario("connect lifecycle diagnostics contain only sanitized ownership metadata", () => {
    for (const marker of [
      "LS_PROVIDER_CONNECT_START",
      "LS_PROVIDER_CONNECT_TRANSPORT_RESOLVED",
      "LS_PROVIDER_CONNECT_LOAD_START",
      "LS_PROVIDER_CONNECT_TIMEOUT",
      "LS_PROVIDER_CONNECT_CANCEL",
      "LS_PROVIDER_CONNECT_LOAD_END",
      "LS_PROVIDER_CONNECT_PUBLISH",
    ]) {
      assert.match(playerSource, new RegExp(marker));
    }
    const diagnosticLines = playerSource
      .split("\n")
      .filter((line) => line.includes("LS_PROVIDER_CONNECT_"))
      .join("\n");
    assert.doesNotMatch(diagnosticLines, /\burl\b|playlistUrl|\bmac\b|password|username|bearer|token/i);
    assert.match(screenSource, /cancelProviderConnect\(\);\s*setAdding\(false\);\s*setEditingProviderId\(null\);/);
  });

  assert.equal(passed, 11);
  console.log("provider connect ownership scenarios: 11/11 passed");
}

void main();
