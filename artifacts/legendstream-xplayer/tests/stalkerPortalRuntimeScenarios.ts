import assert from "node:assert/strict";
import {
  getOrCreateStalkerPortalSession,
  releaseStalkerPortalSession,
} from "../lib/stalkerPortalRuntime";
import {
  StalkerPortalError,
  createStalkerPortalSession,
} from "../lib/stalkerPortal";
import { bootstrapStalkerProfile } from "../lib/stalkerProfileBootstrap";

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

type CapturedRequest = { url: string; init?: RequestInit };
type Responder = (request: CapturedRequest, index: number) => Response | Promise<Response>;

const PROFILE_MAC = "00:1A:79:12:34:56";
const PROFILE_TOKEN_1 = "profile-token-one";
const PROFILE_TOKEN_2 = "profile-token-two";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function queuedFetch(responders: Responder[]) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const request = { url: input instanceof Request ? input.url : String(input), init };
    const index = requests.length;
    requests.push(request);
    const responder = responders[index];
    if (!responder) throw new Error(`Unexpected Stalker request ${index + 1}.`);
    return responder(request, index);
  };
  return { fetchImpl, requests };
}

function actionOf(request: CapturedRequest) {
  return new URL(request.url).searchParams.get("action");
}

function profileRequests(requests: CapturedRequest[]) {
  return requests.filter((request) => actionOf(request) === "get_profile");
}

function handshakeRequests(requests: CapturedRequest[]) {
  return requests.filter((request) => actionOf(request) === "handshake");
}

async function expectCode(operation: Promise<unknown>, code: StalkerPortalError["code"]) {
  try {
    await operation;
    assert.fail(`Expected ${code}.`);
  } catch (caught) {
    assert.ok(caught instanceof StalkerPortalError);
    assert.equal(caught.code, code);
    return caught;
  }
}

function profileSession(mock: ReturnType<typeof queuedFetch>) {
  return createStalkerPortalSession({
    portalUrl: "https://portal.example",
    mac: PROFILE_MAC,
    fetchImpl: mock.fetchImpl,
  });
}

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

  await scenario("R3 A default profile request sends only stb get_profile capability fields", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => jsonResponse({ js: { id: 1, name: "profile" } }),
    ]);
    const result = await bootstrapStalkerProfile(profileSession(mock));
    assert.equal(result.supported, true);
    const url = new URL(profileRequests(mock.requests)[0].url);
    assert.equal(url.searchParams.get("type"), "stb");
    assert.equal(url.searchParams.get("action"), "get_profile");
    assert.equal(url.searchParams.has("hd"), false);
    assert.equal(url.searchParams.has("stb_type"), false);
  });

  await scenario("R3 B supplied profile options serialize hd and stb_type without global defaults", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => jsonResponse({ js: { id: 2 } }),
    ]);
    const result = await bootstrapStalkerProfile(profileSession(mock), {
      profileOptions: { hd: 1, stbType: "MAG254" },
    });
    assert.equal(result.supported, true);
    const url = new URL(profileRequests(mock.requests)[0].url);
    assert.equal(url.searchParams.get("hd"), "1");
    assert.equal(url.searchParams.get("stb_type"), "MAG254");
  });

  await scenario("R3 C HTTP 404 is typed unsupported without auth invalidation", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => new Response("", { status: 404 }),
    ]);
    const session = profileSession(mock);
    assert.deepEqual(await bootstrapStalkerProfile(session), { supported: false, reason: "unsupported" });
    assert.equal(handshakeRequests(mock.requests).length, 1);
    assert.equal(profileRequests(mock.requests).length, 1);
    assert.equal(session.isAuthenticated(), true);
  });

  await scenario("R3 D HTTP 405 is typed unsupported", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => new Response("", { status: 405 }),
    ]);
    assert.deepEqual(await bootstrapStalkerProfile(profileSession(mock)), { supported: false, reason: "unsupported" });
  });

  await scenario("R3 E structured unknown action is typed unsupported", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => jsonResponse({ js: { error: "Unknown action get_profile" } }),
    ]);
    assert.deepEqual(await bootstrapStalkerProfile(profileSession(mock)), { supported: false, reason: "unsupported" });
  });

  await scenario("R3 F structured not implemented is typed unsupported", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => jsonResponse({ js: { message: "Action not implemented" } }),
    ]);
    assert.deepEqual(await bootstrapStalkerProfile(profileSession(mock)), { supported: false, reason: "unsupported" });
  });

  await scenario("R3 G HTTP 401 uses normal one-reauth path and is not unsupported", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => new Response("", { status: 401 }),
      () => jsonResponse({ token: PROFILE_TOKEN_2 }),
      () => jsonResponse({ js: { recovered: true } }),
    ]);
    const result = await bootstrapStalkerProfile(profileSession(mock));
    assert.deepEqual(result, { supported: true, payload: { recovered: true } });
    assert.equal(handshakeRequests(mock.requests).length, 2);
    assert.equal(profileRequests(mock.requests).length, 2);
  });

  await scenario("R3 H HTTP 403 remains auth failure after the single retry", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => new Response("", { status: 403 }),
      () => jsonResponse({ token: PROFILE_TOKEN_2 }),
      () => new Response("", { status: 403 }),
    ]);
    await expectCode(bootstrapStalkerProfile(profileSession(mock)), "AUTH_FAILED");
    assert.equal(handshakeRequests(mock.requests).length, 2);
    assert.equal(profileRequests(mock.requests).length, 2);
  });

  await scenario("R3 I network failure propagates and is not unsupported", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => Promise.reject(new Error("socket closed")),
    ]);
    await expectCode(bootstrapStalkerProfile(profileSession(mock)), "NETWORK_ERROR");
  });

  await scenario("R3 J cancellation propagates and does not become unsupported", async () => {
    const mock = queuedFetch([() => jsonResponse({ token: PROFILE_TOKEN_1 })]);
    const session = profileSession(mock);
    await session.handshake();
    const controller = new AbortController();
    controller.abort();
    await expectCode(bootstrapStalkerProfile(session, { signal: controller.signal }), "CANCELLED");
    assert.equal(profileRequests(mock.requests).length, 0);
    assert.equal(session.isAuthenticated(), true);
  });

  await scenario("R3 K HTTP 500 propagates and is not unsupported", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => new Response("", { status: 500 }),
    ]);
    const error = await expectCode(bootstrapStalkerProfile(profileSession(mock)), "HTTP_ERROR");
    assert.equal(error.status, 500);
  });

  await scenario("R3 L invalid JSON propagates and is not unsupported", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => new Response("not-json", { status: 200 }),
    ]);
    await expectCode(bootstrapStalkerProfile(profileSession(mock)), "INVALID_RESPONSE");
  });

  await scenario("R3 M generic error payload fails closed instead of becoming unsupported", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => jsonResponse({ js: { error: "failed" } }),
    ]);
    await expectCode(bootstrapStalkerProfile(profileSession(mock)), "INVALID_RESPONSE");
  });

  await scenario("R3 N authenticated session profile performs no extra handshake", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => jsonResponse({ js: { ready: true } }),
    ]);
    const session = profileSession(mock);
    await session.handshake();
    assert.equal((await bootstrapStalkerProfile(session)).supported, true);
    assert.equal(handshakeRequests(mock.requests).length, 1);
    assert.equal(profileRequests(mock.requests).length, 1);
  });

  await scenario("R3 O concurrent token-less profile calls share one handshake and issue two profile requests", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => jsonResponse({ js: { profile: "a" } }),
      () => jsonResponse({ js: { profile: "b" } }),
    ]);
    const session = profileSession(mock);
    const results = await Promise.all([
      bootstrapStalkerProfile(session),
      bootstrapStalkerProfile(session),
    ]);
    assert.equal(results.every((result) => result.supported), true);
    assert.equal(handshakeRequests(mock.requests).length, 1);
    assert.equal(profileRequests(mock.requests).length, 2);
  });

  await scenario("R3 P explicit invalidateSession causes exactly one fresh handshake before next profile", async () => {
    const mock = queuedFetch([
      () => jsonResponse({ token: PROFILE_TOKEN_1 }),
      () => jsonResponse({ js: { generation: 1 } }),
      () => jsonResponse({ token: PROFILE_TOKEN_2 }),
      () => jsonResponse({ js: { generation: 2 } }),
    ]);
    const session = profileSession(mock);
    assert.equal((await bootstrapStalkerProfile(session)).supported, true);
    session.invalidateSession();
    assert.equal((await bootstrapStalkerProfile(session)).supported, true);
    assert.equal(handshakeRequests(mock.requests).length, 2);
    assert.equal(profileRequests(mock.requests).length, 2);
  });

  assert.equal(passed, 24);
  console.log("stalker portal runtime scenarios: 24/24 passed (R3 profile bootstrap 16/16)");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
