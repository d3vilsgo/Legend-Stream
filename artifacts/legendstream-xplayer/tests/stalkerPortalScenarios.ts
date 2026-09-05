import assert from "node:assert/strict";
import {
  StalkerPortalError,
  createStalkerPortalSession,
} from "../lib/stalkerPortal";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type CapturedRequest = {
  url: string;
  init?: RequestInit;
};

type Responder = (
  request: CapturedRequest,
  index: number,
) => Response | Promise<Response>;

let passed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function queuedFetch(responders: Responder[]) {
  const requests: CapturedRequest[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const request = {
      url: input instanceof Request ? input.url : String(input),
      init,
    };
    const index = requests.length;
    requests.push(request);
    const responder = responders[index];
    if (!responder) throw new Error(`Unexpected Stalker request ${index + 1}.`);
    return responder(request, index);
  };
  return { fetchImpl, requests };
}

function abortingFetch(): FetchLike {
  return async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const rejectAbort = () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (init?.signal?.aborted) {
      rejectAbort();
      return;
    }
    init?.signal?.addEventListener("abort", rejectAbort, { once: true });
  });
}

async function expectCode(
  operation: Promise<unknown> | (() => Promise<unknown>),
  code: StalkerPortalError["code"],
) {
  try {
    await (typeof operation === "function" ? operation() : operation);
    assert.fail(`Expected ${code}.`);
  } catch (caught) {
    assert.ok(caught instanceof StalkerPortalError);
    assert.equal(caught.code, code);
    return caught;
  }
}

const MAC = "00:1A:79:12:34:56";
const TOKEN_1 = "session-token-one-secret";
const TOKEN_2 = "session-token-two-secret";

async function main() {
  await scenario("portal.php handshake and current Live p=1 request", async () => {
    const mock = queuedFetch([
      () => json({ js: { token: TOKEN_1 } }),
      () => json({ js: { data: [{ id: 7, name: "News" }] } }),
    ]);
    const session = createStalkerPortalSession({
      portalUrl: "https://portal.example",
      mac: MAC,
      fetchImpl: mock.fetchImpl,
    });
    await session.handshake();
    const live = await session.request({ type: "itv", action: "get_ordered_list", p: 1 });
    assert.deepEqual(live, { data: [{ id: 7, name: "News" }] });
    assert.equal(mock.requests.length, 2);
    const handshakeUrl = new URL(mock.requests[0].url);
    const liveUrl = new URL(mock.requests[1].url);
    assert.equal(handshakeUrl.pathname, "/portal.php");
    assert.equal(handshakeUrl.searchParams.get("type"), "stb");
    assert.equal(handshakeUrl.searchParams.get("action"), "handshake");
    assert.equal(liveUrl.pathname, "/portal.php");
    assert.equal(liveUrl.searchParams.get("type"), "itv");
    assert.equal(liveUrl.searchParams.get("action"), "get_ordered_list");
    assert.equal(liveUrl.searchParams.get("p"), "1");
    assert.equal(new Headers(mock.requests[0].init?.headers).has("Authorization"), false);
    assert.equal(new Headers(mock.requests[1].init?.headers).get("Authorization"), `Bearer ${TOKEN_1}`);
  });

  await scenario("stalker_portal base resolves server/load.php for handshake and Live", async () => {
    const mock = queuedFetch([
      () => json({ token: TOKEN_1 }),
      () => json({ data: [] }),
    ]);
    const session = createStalkerPortalSession({
      portalUrl: "https://portal.example/stalker_portal",
      mac: MAC,
      fetchImpl: mock.fetchImpl,
    });
    await session.handshake();
    await session.request({ type: "itv", action: "get_ordered_list", p: 1 });
    assert.equal(session.endpointKind, "server/load.php");
    assert.equal(new URL(mock.requests[0].url).pathname, "/stalker_portal/server/load.php");
    assert.equal(new URL(mock.requests[1].url).pathname, "/stalker_portal/server/load.php");
  });

  await scenario("wrapped js response is unwrapped", async () => {
    const mock = queuedFetch([
      () => json({ js: { token: TOKEN_1 } }),
      () => json({ js: { marker: "wrapped" } }),
    ]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: mock.fetchImpl });
    await session.handshake();
    assert.deepEqual(await session.request({ type: "itv", action: "get_ordered_list", p: 1 }), { marker: "wrapped" });
  });

  await scenario("raw JSON response remains raw", async () => {
    const mock = queuedFetch([
      () => json({ token: TOKEN_1 }),
      () => json({ marker: "raw" }),
    ]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example/portal.php", mac: MAC, fetchImpl: mock.fetchImpl });
    await session.handshake();
    assert.deepEqual(await session.request({ type: "itv", action: "get_ordered_list", p: 1 }), { marker: "raw" });
  });

  await scenario("missing handshake token fails closed", async () => {
    const mock = queuedFetch([() => json({ js: {} })]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: mock.fetchImpl });
    await expectCode(session.handshake(), "MISSING_TOKEN");
    assert.equal(session.isAuthenticated(), false);
  });

  await scenario("invalid JSON is deterministic", async () => {
    const mock = queuedFetch([() => new Response("not-json", { status: 200 })]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: mock.fetchImpl });
    await expectCode(session.handshake(), "INVALID_RESPONSE");
  });

  await scenario("request timeout is deterministic", async () => {
    const session = createStalkerPortalSession({
      portalUrl: "https://portal.example",
      mac: MAC,
      fetchImpl: abortingFetch(),
      timeoutMs: 5,
    });
    await expectCode(session.handshake(), "TIMEOUT");
  });

  await scenario("external cancellation is deterministic", async () => {
    const controller = new AbortController();
    const session = createStalkerPortalSession({
      portalUrl: "https://portal.example",
      mac: MAC,
      fetchImpl: abortingFetch(),
      timeoutMs: 1_000,
    });
    const pending = session.handshake(controller.signal);
    controller.abort();
    await expectCode(pending, "CANCELLED");
  });

  await scenario("non-auth HTTP failure is deterministic", async () => {
    const mock = queuedFetch([() => new Response("server unavailable", { status: 503 })]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: mock.fetchImpl });
    const error = await expectCode(session.handshake(), "HTTP_ERROR");
    assert.equal(error.status, 503);
  });

  await scenario("recognized expired session performs exactly one re-handshake", async () => {
    const mock = queuedFetch([
      () => json({ js: { token: TOKEN_1 } }),
      () => new Response("", { status: 401 }),
      () => json({ js: { token: TOKEN_2 } }),
      () => json({ js: { data: [{ id: 9 }] } }),
    ]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: mock.fetchImpl });
    await session.handshake();
    const result = await session.request({ type: "itv", action: "get_ordered_list", p: 1 });
    assert.deepEqual(result, { data: [{ id: 9 }] });
    assert.equal(mock.requests.length, 4);
    const handshakes = mock.requests.filter((request) => new URL(request.url).searchParams.get("action") === "handshake");
    assert.equal(handshakes.length, 2);
  });

  await scenario("second auth failure fails closed without infinite retry", async () => {
    const mock = queuedFetch([
      () => json({ token: TOKEN_1 }),
      () => new Response("", { status: 401 }),
      () => json({ token: TOKEN_2 }),
      () => new Response("", { status: 403 }),
    ]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: mock.fetchImpl });
    await session.handshake();
    await expectCode(session.request({ type: "itv", action: "get_ordered_list", p: 1 }), "AUTH_FAILED");
    assert.equal(mock.requests.length, 4);
    const handshakes = mock.requests.filter((request) => new URL(request.url).searchParams.get("action") === "handshake");
    assert.equal(handshakes.length, 2);
  });

  await scenario("timeout network and 5xx never trigger auth retry", async () => {
    const timeoutMock = queuedFetch([
      () => json({ token: TOKEN_1 }),
      (_request, _index) => abortingFetch()("https://unused.example", { signal: _request.init?.signal }),
    ]);
    const timeoutSession = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: timeoutMock.fetchImpl, timeoutMs: 5 });
    await timeoutSession.handshake();
    await expectCode(timeoutSession.request({ type: "itv", action: "get_ordered_list", p: 1 }), "TIMEOUT");
    assert.equal(timeoutMock.requests.length, 2);

    const networkMock = queuedFetch([
      () => json({ token: TOKEN_1 }),
      () => Promise.reject(new Error("socket closed")),
    ]);
    const networkSession = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: networkMock.fetchImpl });
    await networkSession.handshake();
    await expectCode(networkSession.request({ type: "itv", action: "get_ordered_list", p: 1 }), "NETWORK_ERROR");
    assert.equal(networkMock.requests.length, 2);

    const serverMock = queuedFetch([
      () => json({ token: TOKEN_1 }),
      () => new Response("", { status: 500 }),
    ]);
    const serverSession = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: serverMock.fetchImpl });
    await serverSession.handshake();
    await expectCode(serverSession.request({ type: "itv", action: "get_ordered_list", p: 1 }), "HTTP_ERROR");
    assert.equal(serverMock.requests.length, 2);
  });

  await scenario("missing MAC fails closed before transport", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return json({ token: TOKEN_1 });
    };
    assert.throws(
      () => createStalkerPortalSession({ portalUrl: "https://portal.example", mac: "   ", fetchImpl }),
      (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "MISSING_MAC",
    );
    assert.equal(calls, 0);
  });

  await scenario("diagnostic surfaces do not expose token MAC Cookie or Authorization", async () => {
    const mock = queuedFetch([
      () => json({ token: TOKEN_1 }),
      () => new Response("", { status: 401 }),
      () => json({ token: TOKEN_2 }),
      () => new Response("", { status: 403 }),
    ]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: mock.fetchImpl });
    await session.handshake();
    const error = await expectCode(session.request({ type: "itv", action: "get_ordered_list", p: 1 }), "AUTH_FAILED");
    const diagnostic = `${error.name}:${error.code}:${error.status ?? ""}:${error.message}:${JSON.stringify(session)}`;
    for (const secret of [TOKEN_1, TOKEN_2, MAC, "Cookie", "Authorization"]) {
      assert.equal(diagnostic.includes(secret), false, `diagnostic leaked ${secret}`);
    }
  });

  assert.equal(passed, 14);
  console.log("stalker portal protocol scenarios: 14/14 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
