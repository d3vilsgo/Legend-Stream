import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginStalkerPlaybackTrace,
  clearStalkerTraceEntries,
  getStalkerTraceEntries,
  traceStalker,
} from "../lib/stalkerPlaybackTrace";
import { projectC3HPhysicalTrace } from "../lib/c3hPhysicalTraceProjection";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  clearStalkerTraceEntries();
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}
function tap() {
  const traceId = beginStalkerPlaybackTrace();
  traceStalker("STALKER_LIVE_TAP", { traceId });
  traceStalker("PLAYBACK_REACQUIRE_START", { traceId });
  return traceId;
}
function projected() {
  return projectC3HPhysicalTrace(getStalkerTraceEntries());
}

async function main() {
  await scenario("A single exact lookup projects one C3J row", () => {
    const traceId = tap();
    traceStalker("C3J_LOOKUP_START", { traceId, lookupSeq: 1, lookupKind: "EXACT" });
    traceStalker("C3J_LOOKUP_DONE", { traceId, lookupSeq: 1, lookupKind: "EXACT", lookupResult: "OK", durationMs: 218, networkMs: 205, yieldMs: 7, parseMs: 1 });
    traceStalker("C3J_LOOKUP_MATCH", { traceId, lookupSeq: 1, lookupResult: "FOUND" });
    assert.deepEqual(projected().c3jLookups, [{
      sequence: 1, kind: "EXACT", result: "FOUND", durationMs: 218, networkMs: 205, yieldMs: 7, parseMs: 1,
    }]);
  });

  await scenario("B category traversal preserves lookup order", () => {
    const traceId = tap();
    for (const [seq, result, ms] of [[1, "MISS", 190], [2, "FOUND", 240]] as const) {
      traceStalker("C3J_LOOKUP_START", { traceId, lookupSeq: seq, lookupKind: "CATEGORY" });
      traceStalker("C3J_LOOKUP_DONE", { traceId, lookupSeq: seq, lookupKind: "CATEGORY", lookupResult: "OK", durationMs: ms });
      traceStalker("C3J_LOOKUP_MATCH", { traceId, lookupSeq: seq, lookupResult: result });
    }
    assert.deepEqual(projected().c3jLookups.map((row) => [row.sequence, row.kind, row.result]), [
      [1, "CATEGORY", "MISS"], [2, "CATEGORY", "FOUND"],
    ]);
  });

  await scenario("C full fallback kind stays diagnostic-only", () => {
    const traceId = tap();
    traceStalker("C3J_LOOKUP_START", { traceId, lookupSeq: 1, lookupKind: "FULL" });
    traceStalker("C3J_LOOKUP_DONE", { traceId, lookupSeq: 1, lookupKind: "FULL", lookupResult: "OK", durationMs: 5000 });
    traceStalker("C3J_LOOKUP_MATCH", { traceId, lookupSeq: 1, lookupResult: "FOUND" });
    traceStalker("PLAYBACK_REACQUIRE_SOURCE", { traceId, source: "FULL_DISCOVERY" });
    assert.equal(projected().path, "FULL_DISCOVERY");
    assert.equal(projected().c3jLookups[0]?.kind, "FULL");
  });

  await scenario("D durations remain non-negative numeric diagnostics", () => {
    const traceId = tap();
    traceStalker("C3J_LOOKUP_START", { traceId, lookupSeq: 1, lookupKind: "EXACT" });
    traceStalker("C3J_LOOKUP_DONE", { traceId, lookupSeq: 1, lookupKind: "EXACT", lookupResult: "OK", durationMs: 0, networkMs: 0, parseMs: 0 });
    assert.equal(projected().c3jLookups[0]?.durationMs, 0);
  });

  await scenario("E new trace resets previous C3J rows", () => {
    const first = tap();
    traceStalker("C3J_LOOKUP_START", { traceId: first, lookupSeq: 1, lookupKind: "EXACT" });
    traceStalker("C3J_LOOKUP_DONE", { traceId: first, lookupSeq: 1, lookupKind: "EXACT", lookupResult: "OK", durationMs: 10 });
    const second = beginStalkerPlaybackTrace();
    traceStalker("STALKER_LIVE_TAP", { traceId: second });
    traceStalker("PLAYBACK_REACQUIRE_START", { traceId: second });
    assert.equal(projected().traceId, second);
    assert.deepEqual(projected().c3jLookups, []);
  });

  await scenario("F late prior-trace completion is ignored", () => {
    const first = tap();
    const second = beginStalkerPlaybackTrace();
    traceStalker("STALKER_LIVE_TAP", { traceId: second });
    traceStalker("PLAYBACK_REACQUIRE_START", { traceId: second });
    traceStalker("C3J_LOOKUP_DONE", { traceId: first, lookupSeq: 1, lookupKind: "EXACT", lookupResult: "OK", durationMs: 9999 });
    assert.deepEqual(projected().c3jLookups, []);
  });

  await scenario("G abort and error result enums project safely", () => {
    const traceId = tap();
    traceStalker("C3J_LOOKUP_START", { traceId, lookupSeq: 1, lookupKind: "EXACT" });
    traceStalker("C3J_LOOKUP_DONE", { traceId, lookupSeq: 1, lookupKind: "EXACT", lookupResult: "ABORTED", durationMs: 3 });
    traceStalker("C3J_LOOKUP_START", { traceId, lookupSeq: 2, lookupKind: "CATEGORY" });
    traceStalker("C3J_LOOKUP_DONE", { traceId, lookupSeq: 2, lookupKind: "CATEGORY", lookupResult: "ERROR", durationMs: 4 });
    assert.deepEqual(projected().c3jLookups.map((row) => row.result), ["ABORTED", "ERROR"]);
  });

  await scenario("H missing completion remains pending", () => {
    const traceId = tap();
    traceStalker("C3J_LOOKUP_START", { traceId, lookupSeq: 1, lookupKind: "EXACT" });
    assert.equal(projected().c3jLookups[0]?.result, "PENDING");
    assert.equal(projected().c3jLookups[0]?.durationMs, null);
  });

  await scenario("H2 unavailable transport subtiming stays unknown instead of fake zero", () => {
    const traceId = tap();
    traceStalker("C3J_LOOKUP_START", { traceId, lookupSeq: 1, lookupKind: "EXACT" });
    traceStalker("C3J_LOOKUP_DONE", {
      traceId,
      lookupSeq: 1,
      lookupKind: "EXACT",
      lookupResult: "TIMEOUT",
      durationMs: 20000,
      timingSamples: 0,
    });
    assert.equal(projected().c3jLookups[0]?.networkMs, null);
    assert.equal(projected().c3jLookups[0]?.yieldMs, null);
    assert.equal(projected().c3jLookups[0]?.parseMs, null);
  });

  await scenario("I PATH semantics remain independent of C3J rows", () => {
    const traceId = tap();
    traceStalker("C3J_LOOKUP_START", { traceId, lookupSeq: 1, lookupKind: "EXACT" });
    traceStalker("C3J_LOOKUP_DONE", { traceId, lookupSeq: 1, lookupKind: "EXACT", lookupResult: "OK", durationMs: 10 });
    traceStalker("C3J_LOOKUP_MATCH", { traceId, lookupSeq: 1, lookupResult: "FOUND" });
    traceStalker("PLAYBACK_REACQUIRE_SOURCE", { traceId, source: "EXACT_PAGE" });
    assert.equal(projected().path, "EXACT_PAGE");
  });

  await scenario("J existing LOOKUPS counter remains request-event based", () => {
    const traceId = tap();
    for (let seq = 1; seq <= 3; seq += 1) {
      traceStalker("PLAYBACK_REACQUIRE_LOOKUP", { traceId });
      traceStalker("C3J_LOOKUP_START", { traceId, lookupSeq: seq, lookupKind: "EXACT" });
    }
    assert.equal(projected().lookups, 3);
    assert.equal(projected().c3jLookups.length, 3);
  });

  await scenario("K auth recovery projects only count and duration", () => {
    const traceId = tap();
    traceStalker("PLAYBACK_REACQUIRE_AUTH_START", { traceId });
    traceStalker("PLAYBACK_REACQUIRE_AUTH_DONE", { traceId, success: true, authMs: 321 });
    assert.equal(projected().authRecoveries, 1);
    assert.equal(projected().authMs, 321);
  });

  await scenario("L closed enums reject arbitrary diagnostic strings", () => {
    const traceId = tap();
    traceStalker("C3J_LOOKUP_START", {
      traceId,
      lookupSeq: 1,
      lookupKind: "http://secret.invalid",
      lookupResult: "Bearer secret",
    });
    const entry = getStalkerTraceEntries().find((item) => item.event === "C3J_LOOKUP_START");
    assert.equal(entry?.details.lookupKind, undefined);
    assert.equal(entry?.details.lookupResult, undefined);
  });

  await scenario("M secret-like fields cannot enter projection", () => {
    const traceId = tap();
    traceStalker("C3J_LOOKUP_START", {
      traceId,
      lookupSeq: 1,
      lookupKind: "EXACT",
      mac: "00:11:22:33:44:55",
      authorization: "Bearer hidden",
      cookie: "hidden",
      token: "hidden-token",
      cmd: "ffmpeg http://secret.invalid",
      url: "http://secret.invalid/?play_token=hidden",
      portalId: "hidden-id",
    } as any);
    const rendered = JSON.stringify(projected());
    for (const secret of ["00:11:22:33:44:55","Bearer hidden","hidden-token","ffmpeg","secret.invalid","play_token","hidden-id"]) {
      assert.equal(rendered.includes(secret), false);
    }
  });

  await scenario("N diagnostics remain memory-only and bounded by existing trace ring", () => {
    assert.doesNotMatch(source("lib/c3hPhysicalTraceProjection.ts"), /AsyncStorage|SecureStore|FileSystem|fetch\(|XMLHttpRequest/);
    assert.match(source("lib/stalkerPlaybackTrace.ts"), /const MAX_ENTRIES = 180/);
  });

  await scenario("O diagnostic listener remains fail-open", () => {
    assert.match(source("lib/stalkerPlaybackTrace.ts"), /try\{listener\(\);\}catch/);
  });

  await scenario("P overlay keeps C3H summary and adds compact C3J section", () => {
    const ui = source("components/debug/C3HPhysicalTraceOverlay.tsx");
    assert.match(ui, /C3H TRACE/);
    assert.match(ui, /C3J LOOKUPS/);
    assert.match(ui, /state\.c3jLookups\.slice\(-4\)/);
  });

  await scenario("Q production decision points remain source-identical in meaning", () => {
    const runtime = source("lib/stalkerLiveRuntimeLocator.ts");
    assert.match(runtime, /if \(!locator\)[\s\S]*bounded \?\? fullDiscovery\(\)/);
    assert.match(runtime, /if \(exact\) return \{ channel: exact, source: "EXACT_PAGE"/);
    assert.match(runtime, /return bounded \?\? fullDiscovery\(\)/);
  });

  assert.equal(passed, 18);
  console.log("C3J physical lookup trace scenarios: 18/18 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
