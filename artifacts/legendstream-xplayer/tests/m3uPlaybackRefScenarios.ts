import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasUsableM3UCacheSnapshot } from "../lib/m3uCacheAvailability";
import {
  buildM3UStreamUrl,
  isSafeM3UPlaybackRef,
  parseM3UProviderSource,
  parseM3UStreamRef,
} from "../lib/m3uCatalogRefs";
import { enqueueM3UCacheWrite } from "../lib/m3uCacheWriteQueue";
import { inspectM3UStreamRef } from "../lib/m3uStreamRefDiagnostics";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogCacheSource = readFileSync(resolve(ROOT, "lib/catalogCache.ts"), "utf8");
const runnerSource = readFileSync(resolve(ROOT, "lib/m3uCacheWriteRunner.ts"), "utf8");
const providerSource = "https://panel.example/get.php?username=alice&password=secret&type=m3u_plus";
const provider = parseM3UProviderSource(providerSource);
assert.ok(provider);

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function main() {
  await scenario("extensionless three-segment credential path is a safe live ref", () => {
    const ref = parseM3UStreamRef(providerSource, "https://panel.example/alice/secret/801", "live");
    assert.deepEqual(ref, {
      type: "m3u-path",
      kind: "live",
      streamId: "801",
      containerExtension: null,
    });
    assert.equal(isSafeM3UPlaybackRef(ref), true);
  });

  await scenario("canonical live path with extension remains valid", () => {
    const ref = parseM3UStreamRef(providerSource, "https://panel.example/live/alice/secret/802.ts", "live");
    assert.deepEqual(ref, {
      type: "m3u-path",
      kind: "live",
      streamId: "802",
      containerExtension: "ts",
    });
  });

  await scenario("different origin remains rejected", () => {
    const inspection = inspectM3UStreamRef(provider, "https://other.example/alice/secret/803", "live");
    assert.equal(inspection.ref, null);
    assert.equal(inspection.reason, "origin-mismatch");
  });

  await scenario("credential path mismatch remains rejected", () => {
    const inspection = inspectM3UStreamRef(provider, "https://panel.example/alice/wrong/804", "live");
    assert.equal(inspection.ref, null);
    assert.equal(inspection.reason, "credential-path-mismatch");
  });

  await scenario("query string remains rejected", () => {
    const inspection = inspectM3UStreamRef(provider, "https://panel.example/alice/secret/805?token=nope", "live");
    assert.equal(inspection.ref, null);
    assert.equal(inspection.reason, "query-present");
  });

  await scenario("runtime URL is rebuilt from current provider credentials without persisting raw URL", () => {
    const ref = parseM3UStreamRef(providerSource, "https://panel.example/alice/secret/806", "live");
    assert.ok(ref);
    const rebuilt = buildM3UStreamUrl(
      "https://panel.example/get.php?username=fresh-user&password=fresh-pass&type=m3u_plus",
      ref,
    );
    assert.equal(rebuilt, "https://panel.example/fresh-user/fresh-pass/806");
    const persisted = JSON.stringify(ref);
    assert.doesNotMatch(persisted, /panel\.example|alice|secret|fresh-user|fresh-pass/);
  });

  await scenario("cleanup uses isolated transaction and stale rows remain unusable after error", () => {
    const cleanupStart = catalogCacheSource.indexOf("export async function deleteProviderCatalog");
    assert.ok(cleanupStart >= 0);
    const cleanup = catalogCacheSource.slice(cleanupStart);
    assert.match(cleanup, /withExclusiveTransactionAsync\(async \(txn\)/);
    assert.match(cleanup, /txn\.runAsync\("DELETE FROM catalog_items WHERE provider_id = \?"/);
    assert.equal(hasUsableM3UCacheSnapshot({ live: 801, vod: 1200, series: 0 }, "error"), false);
  });

  await scenario("M3U background cache writes are serialized before SQLite mutation", async () => {
    assert.match(runnerSource, /enqueueM3UCacheWrite/);
    const order: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = enqueueM3UCacheWrite(async () => {
      order.push("first-start");
      markFirstStarted();
      await firstGate;
      order.push("first-end");
      return 1;
    });
    const second = enqueueM3UCacheWrite(async () => {
      order.push("second-start");
      return 2;
    });
    await firstStarted;
    assert.deepEqual(order, ["first-start"]);
    releaseFirst();
    assert.deepEqual(await Promise.all([first, second]), [1, 2]);
    assert.deepEqual(order, ["first-start", "first-end", "second-start"]);
  });

  assert.equal(passed, 8);
  console.log("m3u playback ref scenarios: 8/8 passed");
}

void main();
