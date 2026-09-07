import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enqueueCatalogDbWrite } from "../lib/catalogDbWriter";
import { resolveStalkerLiveCreateLink } from "../lib/stalkerLiveCatalog";
import { createStalkerPortalSession, StalkerPortalError } from "../lib/stalkerPortal";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheSource = readFileSync(resolve(ROOT, "lib/stalkerLiveCache.ts"), "utf8");
const syncSource = readFileSync(resolve(ROOT, "lib/stalkerLiveSync.ts"), "utf8");
const playerSource = readFileSync(resolve(ROOT, "components/CompatibilityVideoPlayerV2.tsx"), "utf8");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function expectCancelled(promise: Promise<unknown>) {
  await assert.rejects(promise, (caught: unknown) => {
    assert.ok(caught instanceof StalkerPortalError);
    assert.equal(caught.code, "CANCELLED");
    return true;
  });
}

async function main() {
  await scenario("stale Stalker stage cannot contaminate a newer serialized staging run", async () => {
    assert.match(cacheSource, /upsertCatalogItems\(stagingId, "live", staged/);
    assert.match(cacheSource, /isCancelled:\s*\(\) => Boolean\(isCurrent && !isCurrent\(\)\)/);
    assert.match(cacheSource, /onBatchStarted:\s*assertCurrent/);
    assert.match(cacheSource, /onSqliteStage:\s*assertCurrent/);
    assert.match(syncSource, /stageStalkerLivePage\(providerId, items, syncStartedAt, options\.isCurrent\)/);

    const staging = new Set<string>();
    const committed = new Set<string>(["old-good"]);
    let runACurrent = true;
    let releaseWriter!: () => void;
    const writerGate = new Promise<void>((resolveGate) => { releaseWriter = resolveGate; });

    const blocker = enqueueCatalogDbWrite(async () => writerGate);
    const delayedA = enqueueCatalogDbWrite(async () => {
      if (!runACurrent) return;
      staging.add("A-stale");
    });

    runACurrent = false;
    const cleanupB = enqueueCatalogDbWrite(async () => { staging.clear(); });
    const stageB = enqueueCatalogDbWrite(async () => { staging.add("B-current"); });
    const publishB = enqueueCatalogDbWrite(async () => {
      committed.clear();
      for (const row of staging) committed.add(row);
    });

    releaseWriter();
    await Promise.all([blocker, delayedA, cleanupB, stageB, publishB]);

    assert.equal(committed.has("A-stale"), false);
    assert.equal(committed.has("B-current"), true);

    staging.clear();
    committed.clear();
    committed.add("old-good-2");
    runACurrent = true;

    const earlyA = enqueueCatalogDbWrite(async () => {
      assert.equal(runACurrent, true);
      staging.add("A-before-loss");
    });
    await earlyA;
    runACurrent = false;
    await enqueueCatalogDbWrite(async () => { staging.clear(); });
    await enqueueCatalogDbWrite(async () => { staging.add("B-after-cleanup"); });
    await enqueueCatalogDbWrite(async () => {
      committed.clear();
      for (const row of staging) committed.add(row);
    });

    assert.deepEqual([...committed], ["B-after-cleanup"]);
  });

  await scenario("player switch aborts pending create_link without auth retry and B proceeds", async () => {
    assert.match(playerSource, /const controller = new AbortController\(\)/);
    assert.match(playerSource, /resolveCatalogRuntimeSource\(currentSource, provider, controller\.signal\)/);
    assert.match(playerSource, /cancelled = true;\s*controller\.abort\(\)/s);
    assert.match(playerSource, /if \(!cancelled\) setResolvedSource\(next\)/);

    const controllerA = new AbortController();
    let handshakesA = 0;
    let createsA = 0;
    let createStarted!: () => void;
    const createStartedPromise = new Promise<void>((resolveStarted) => { createStarted = resolveStarted; });

    const sessionA = createStalkerPortalSession({
      portalUrl: "http://portal.invalid/stalker_portal/",
      mac: "00:1A:79:12:34:56",
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.includes("action=handshake")) {
          handshakesA += 1;
          return new Response(JSON.stringify({ js: { token: "token-a" } }), { status: 200 });
        }
        createsA += 1;
        createStarted();
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    });

    const pendingA = resolveStalkerLiveCreateLink(
      sessionA,
      "ffmpeg http://canonical.invalid/a",
      controllerA.signal,
    );
    await createStartedPromise;
    controllerA.abort();
    await expectCancelled(pendingA);
    assert.equal(handshakesA, 1, "cancellation must not trigger re-handshake");
    assert.equal(createsA, 1, "cancellation must not retry create_link");

    const controllerB = new AbortController();
    const sessionB = createStalkerPortalSession({
      portalUrl: "http://portal.invalid/stalker_portal/",
      mac: "00:1A:79:12:34:56",
      fetchImpl: async (input) => String(input).includes("action=handshake")
        ? new Response(JSON.stringify({ js: { token: "token-b" } }), { status: 200 })
        : new Response(JSON.stringify({ js: { cmd: "ffmpeg https://stream.invalid/b" } }), { status: 200 }),
    });
    const resolvedB = await resolveStalkerLiveCreateLink(
      sessionB,
      "ffmpeg http://canonical.invalid/b",
      controllerB.signal,
    );
    assert.equal(resolvedB, "https://stream.invalid/b");
  });

  assert.equal(passed, 2);
  console.log("stalker remediation race scenarios: 2/2 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
