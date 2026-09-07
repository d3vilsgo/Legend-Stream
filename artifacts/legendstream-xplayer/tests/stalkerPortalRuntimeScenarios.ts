import assert from "node:assert/strict";
import {
  getOrCreateStalkerPortalSession,
  releaseStalkerPortalSession,
} from "../lib/stalkerPortalRuntime";
import { StalkerPortalError } from "../lib/stalkerPortal";

let passed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const response = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

async function main() {
  await scenario("same provider identity reuses the exact session", () => {
    const identity = { providerId: "provider-same", portalUrl: "https://same.invalid", mac: "00:00:00:00:00:01" };
    const first = getOrCreateStalkerPortalSession(identity);
    const second = getOrCreateStalkerPortalSession(identity);
    assert.equal(first, second);
    releaseStalkerPortalSession(identity.providerId);
  });

  await scenario("different providers receive isolated sessions", () => {
    const first = getOrCreateStalkerPortalSession({ providerId: "provider-a", portalUrl: "https://a.invalid", mac: "00:00:00:00:00:02" });
    const second = getOrCreateStalkerPortalSession({ providerId: "provider-b", portalUrl: "https://b.invalid", mac: "00:00:00:00:00:03" });
    assert.notEqual(first, second);
    releaseStalkerPortalSession("provider-a");
    releaseStalkerPortalSession("provider-b");
  });

  await scenario("changed endpoint identity replaces and disposes the old session", async () => {
    const first = getOrCreateStalkerPortalSession({ providerId: "provider-url-change", portalUrl: "https://before.invalid", mac: "00:00:00:00:00:04" });
    const second = getOrCreateStalkerPortalSession({ providerId: "provider-url-change", portalUrl: "https://after.invalid", mac: "00:00:00:00:00:04" });
    assert.notEqual(first, second);
    await assert.rejects(
      first.request({ type: "itv", action: "unused" }),
      (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "CANCELLED",
    );
    releaseStalkerPortalSession("provider-url-change");
  });

  await scenario("changed MAC identity replaces and disposes the old session", async () => {
    const first = getOrCreateStalkerPortalSession({ providerId: "provider-mac-change", portalUrl: "https://mac.invalid", mac: "00:00:00:00:00:05" });
    const second = getOrCreateStalkerPortalSession({ providerId: "provider-mac-change", portalUrl: "https://mac.invalid", mac: "00:00:00:00:00:06" });
    assert.notEqual(first, second);
    await assert.rejects(
      first.handshake(),
      (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "CANCELLED",
    );
    releaseStalkerPortalSession("provider-mac-change");
  });

  await scenario("release creates a fresh session on next acquisition", () => {
    const identity = { providerId: "provider-release", portalUrl: "https://release.invalid", mac: "00:00:00:00:00:07" };
    const first = getOrCreateStalkerPortalSession(identity);
    assert.equal(releaseStalkerPortalSession(identity.providerId), true);
    const second = getOrCreateStalkerPortalSession(identity);
    assert.notEqual(first, second);
    releaseStalkerPortalSession(identity.providerId);
  });

  await scenario("releasing provider A leaves provider B reusable and authenticated", async () => {
    let bHandshakes = 0;
    const providerA = getOrCreateStalkerPortalSession({ providerId: "release-a", portalUrl: "https://release-a.invalid", mac: "00:00:00:00:00:08" });
    const identityB = {
      providerId: "release-b",
      portalUrl: "https://release-b.invalid",
      mac: "00:00:00:00:00:09",
      fetchImpl: async (input: string | URL | Request) => {
        const action = new URL(String(input)).searchParams.get("action");
        if (action === "handshake") {
          bHandshakes += 1;
          return response({ token: "runtime-token" });
        }
        return response({ ok: true });
      },
    };
    const providerB = getOrCreateStalkerPortalSession(identityB);
    await providerB.request({ type: "itv", action: "before-release" });
    assert.equal(releaseStalkerPortalSession("release-a"), true);
    assert.equal(getOrCreateStalkerPortalSession(identityB), providerB);
    assert.deepEqual(await providerB.request({ type: "itv", action: "after-release" }), { ok: true });
    assert.equal(bHandshakes, 1);
    assert.equal(providerA.isAuthenticated(), false);
    releaseStalkerPortalSession("release-b");
  });

  await scenario("runtime session serialization exposes no token or MAC", async () => {
    const markerToken = "runtime-private-token";
    const markerMac = "00:00:00:00:00:10";
    const session = getOrCreateStalkerPortalSession({
      providerId: "provider-private",
      portalUrl: "https://private.invalid",
      mac: markerMac,
      fetchImpl: async (input) => {
        const action = new URL(String(input)).searchParams.get("action");
        return action === "handshake" ? response({ token: markerToken }) : response({ ok: true });
      },
    });
    await session.handshake();
    const serialized = JSON.stringify(session);
    assert.equal(serialized.includes(markerToken), false);
    assert.equal(serialized.includes(markerMac), false);
    releaseStalkerPortalSession("provider-private");
  });

  await scenario("release aborts a pending lifecycle-owned handshake", async () => {
    let handshakeStarted!: () => void;
    const started = new Promise<void>((resolve) => { handshakeStarted = resolve; });
    const providerId = "provider-pending-release";
    const session = getOrCreateStalkerPortalSession({
      providerId,
      portalUrl: "https://pending.invalid",
      mac: "00:00:00:00:00:11",
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        handshakeStarted();
        const abort = () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      }),
    });
    const pending = session.handshake();
    await started;
    assert.equal(releaseStalkerPortalSession(providerId), true);
    await assert.rejects(
      pending,
      (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "CANCELLED",
    );
  });

  assert.equal(passed, 8);
  console.log("stalker portal runtime scenarios: 8/8 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
