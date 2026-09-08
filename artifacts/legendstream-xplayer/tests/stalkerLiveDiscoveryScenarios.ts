import assert from "node:assert/strict";
import {
  StalkerPortalError,
  createStalkerPortalSession,
} from "../lib/stalkerPortal";
import { discoverStalkerLiveChannels } from "../lib/stalkerLiveDiscovery";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type TransportState = {
  requests: URL[];
  handshakes: number;
};

type ActionHandler = (
  url: URL,
  init: RequestInit | undefined,
  state: TransportState,
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

const MAC = "00:1A:79:12:34:56";

function channel(id: number | string) {
  return {
    id,
    name: `Channel ${id}`,
    cmd: `ffmpeg http://stream.invalid/${id}`,
    tv_genre_id: "1",
  };
}

function createTransport(handler: ActionHandler) {
  const state: TransportState = { requests: [], handshakes: 0 };
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    state.requests.push(url);
    if (url.searchParams.get("action") === "handshake") {
      state.handshakes += 1;
      return json({ js: { token: `token-${state.handshakes}` } });
    }
    return handler(url, init, state);
  };
  const session = createStalkerPortalSession({
    portalUrl: "https://portal.invalid",
    mac: MAC,
    fetchImpl,
    timeoutMs: 2_000,
  });
  return { session, state };
}

function actions(state: TransportState) {
  return state.requests.map((url) => url.searchParams.get("action"));
}

function orderedPages(
  aggregate: Response,
  pages: unknown[][],
  totalItems: number | null,
) {
  return createTransport((url) => {
    const action = url.searchParams.get("action");
    if (action === "get_all_channels") return aggregate.clone();
    if (action !== "get_ordered_list") throw new Error(`Unexpected action ${action}.`);
    const page = Number(url.searchParams.get("p"));
    const data = pages[page - 1] ?? [];
    const body: Record<string, unknown> = { data };
    if (totalItems !== null) body.total_items = totalItems;
    return json({ js: body });
  });
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

async function main() {
  await scenario("get_all_channels accepts direct and js/data aggregate shapes without fallback", async () => {
    for (const body of [
      [channel(1), channel(2)],
      { js: { data: [channel(1), channel(2)] } },
    ]) {
      const transport = createTransport((url) => {
        assert.equal(url.searchParams.get("type"), "itv");
        assert.equal(url.searchParams.get("action"), "get_all_channels");
        return json(body);
      });
      const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-a" });
      assert.equal(result.source, "get_all_channels");
      assert.equal(result.complete, true);
      assert.equal(result.rows.length, 2);
      assert.equal(actions(transport.state).includes("get_ordered_list"), false);
    }
  });

  await scenario("aggregate total equal to unique rows is complete", async () => {
    const transport = createTransport(() => json({ js: { data: [channel(1), channel(2)], total_items: 2 } }));
    const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-b" });
    assert.equal(result.source, "get_all_channels");
    assert.equal(result.totalItems, 2);
    assert.equal(result.rows.length, 2);
  });

  await scenario("aggregate non-empty response without total is complete", async () => {
    const transport = createTransport(() => json({ data: [channel(1)] }));
    const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-c" });
    assert.equal(result.source, "get_all_channels");
    assert.equal(result.totalItems, null);
    assert.equal(result.rows.length, 1);
  });

  await scenario("aggregate advertised total greater than rows falls back to ordered traversal", async () => {
    const transport = orderedPages(
      json({ js: { data: [channel(1)], total_items: 3 } }),
      [[channel(1), channel(2)], [channel(3)]],
      3,
    );
    const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-d" });
    assert.equal(result.source, "get_ordered_list");
    assert.equal(result.rows.length, 3);
    assert.deepEqual(
      transport.state.requests.filter((url) => url.searchParams.get("action") === "get_ordered_list").map((url) => url.searchParams.get("p")),
      ["1", "2"],
    );
  });

  await scenario("aggregate advertised total below unique rows changes to ordered discovery", async () => {
    const transport = orderedPages(
      json({ js: { data: [channel(1), channel(2)], total_items: 1 } }),
      [[channel(9)]],
      1,
    );
    const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-e" });
    assert.equal(result.source, "get_ordered_list");
    assert.deepEqual(result.rows.map((row) => row.portalId), ["9"]);
    assert.equal(actions(transport.state).includes("get_ordered_list"), true);
  });

  for (const status of [404, 405]) {
    await scenario(`HTTP ${status} aggregate capability absence falls back`, async () => {
      const transport = orderedPages(new Response("", { status }), [[channel(1)]], 1);
      const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: `provider-http-${status}` });
      assert.equal(result.source, "get_ordered_list");
      assert.equal(result.rows.length, 1);
    });
  }

  for (const message of ["unknown action", "not implemented"]) {
    await scenario(`structured ${message} aggregate capability absence falls back`, async () => {
      const transport = orderedPages(json({ js: { error: message } }), [[channel(1)]], 1);
      const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: `provider-${message.replace(/\s/g, "-")}` });
      assert.equal(result.source, "get_ordered_list");
      assert.equal(result.rows.length, 1);
    });
  }

  for (const status of [401, 403]) {
    await scenario(`HTTP ${status} remains auth failure and never becomes discovery fallback`, async () => {
      let aggregateCalls = 0;
      const transport = createTransport((url) => {
        if (url.searchParams.get("action") === "get_all_channels") {
          aggregateCalls += 1;
          return new Response("", { status });
        }
        throw new Error("ordered fallback must not run for auth failure");
      });
      await expectCode(discoverStalkerLiveChannels({ session: transport.session, providerId: `provider-auth-${status}` }), "AUTH_FAILED");
      assert.equal(aggregateCalls, 2);
      assert.equal(transport.state.handshakes, 2);
      assert.equal(actions(transport.state).includes("get_ordered_list"), false);
    });
  }

  await scenario("HTTP 500 propagates without fallback", async () => {
    const transport = createTransport(() => new Response("", { status: 500 }));
    const error = await expectCode(discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-500" }), "HTTP_ERROR");
    assert.equal(error.status, 500);
    assert.equal(actions(transport.state).includes("get_ordered_list"), false);
  });

  await scenario("network failure propagates without fallback", async () => {
    const transport = createTransport(() => Promise.reject(new Error("socket closed")));
    await expectCode(discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-network" }), "NETWORK_ERROR");
    assert.equal(actions(transport.state).includes("get_ordered_list"), false);
  });

  await scenario("invalid JSON propagates without fallback", async () => {
    const transport = createTransport(() => new Response("not-json", { status: 200 }));
    await expectCode(discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-json" }), "INVALID_RESPONSE");
    assert.equal(actions(transport.state).includes("get_ordered_list"), false);
  });

  await scenario("generic structurally unusable aggregate changes to ordered discovery", async () => {
    const transport = orderedPages(json({ js: { error: "failed" } }), [[channel(10)]], 1);
    const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-generic-error" });
    assert.equal(result.source, "get_ordered_list");
    assert.deepEqual(result.rows.map((row) => row.portalId), ["10"]);
  });

  await scenario("empty aggregate with explicit total zero changes to ordered discovery", async () => {
    const transport = orderedPages(json({ js: { data: [], total_items: 0 } }), [[channel(11)]], 1);
    const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-zero" });
    assert.equal(result.source, "get_ordered_list");
    assert.deepEqual(result.rows.map((row) => row.portalId), ["11"]);
  });

  await scenario("empty aggregate without total changes to ordered discovery", async () => {
    const transport = orderedPages(json({ js: { data: [] } }), [[channel(12)]], 1);
    const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-empty" });
    assert.equal(result.source, "get_ordered_list");
    assert.deepEqual(result.rows.map((row) => row.portalId), ["12"]);
  });

  await scenario("ordered fallback traverses p1 p2 p3 to exact total", async () => {
    const transport = orderedPages(
      new Response("", { status: 404 }),
      [[channel(1)], [channel(2)], [channel(3)]],
      3,
    );
    const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-r" });
    assert.equal(result.source, "get_ordered_list");
    assert.deepEqual(result.rows.map((row) => row.portalId), ["1", "2", "3"]);
    assert.equal(result.pagesFetched, 3);
  });

  await scenario("ordered fallback continues when first page is smaller than total", async () => {
    const transport = orderedPages(new Response("", { status: 405 }), [[channel(1)], [channel(2)]], 2);
    const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-s" });
    assert.equal(result.rows.length, 2);
    assert.equal(result.pagesFetched, 2);
  });

  await scenario("ordered repeated page fails closed", async () => {
    const transport = orderedPages(new Response("", { status: 404 }), [[channel(1)], [channel(1)]], 3);
    await expectCode(discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-t" }), "INVALID_RESPONSE");
  });

  await scenario("ordered duplicate portal ID across pages preserves duplicate guard", async () => {
    const transport = orderedPages(
      new Response("", { status: 404 }),
      [[channel(1), channel(2)], [channel(2), channel(3)]],
      4,
    );
    await expectCode(discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-u" }), "INVALID_RESPONSE");
  });

  await scenario("ordered malformed no-progress page fails closed", async () => {
    const transport = orderedPages(
      new Response("", { status: 404 }),
      [[channel(1)], [{ name: "missing-id", cmd: "ffmpeg http://stream.invalid/missing" }]],
      3,
    );
    await expectCode(discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-v" }), "INVALID_RESPONSE");
  });

  await scenario("ordered advertised total not reached fails closed", async () => {
    const transport = orderedPages(new Response("", { status: 404 }), [[channel(1)], []], 3);
    await expectCode(discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-w" }), "INVALID_RESPONSE");
  });

  await scenario("metadata-less ordered fallback terminates only after empty page evidence", async () => {
    const transport = orderedPages(
      new Response("", { status: 404 }),
      [[channel(1), channel(2)], [channel(3)], []],
      null,
    );
    const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-x" });
    assert.equal(result.rows.length, 3);
    assert.equal(result.pagesFetched, 3);
    assert.deepEqual(
      transport.state.requests.filter((url) => url.searchParams.get("action") === "get_ordered_list").map((url) => url.searchParams.get("p")),
      ["1", "2", "3"],
    );
  });

  await scenario("large deterministic ordered catalog is not truncated to first page", async () => {
    const total = 1_100;
    const pageSize = 100;
    const transport = createTransport((url) => {
      const action = url.searchParams.get("action");
      if (action === "get_all_channels") return new Response("", { status: 404 });
      if (action !== "get_ordered_list") throw new Error(`Unexpected action ${action}.`);
      const page = Number(url.searchParams.get("p"));
      const start = (page - 1) * pageSize;
      const data = Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, index) => channel(start + index + 1));
      return json({ js: { data, total_items: total, max_page_items: pageSize } });
    });
    const result = await discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-y" });
    assert.equal(result.rows.length, total);
    assert.equal(result.rows[0].portalId, "1");
    assert.equal(result.rows.at(-1)?.portalId, String(total));
    assert.equal(result.pagesFetched, 11);
  });

  await scenario("concurrent discovery calls share one token-less handshake", async () => {
    let aggregateCalls = 0;
    const transport = createTransport((url) => {
      if (url.searchParams.get("action") !== "get_all_channels") throw new Error("unexpected fallback");
      aggregateCalls += 1;
      return json({ js: { data: [channel(1)] } });
    });
    const [first, second] = await Promise.all([
      discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-concurrent" }),
      discoverStalkerLiveChannels({ session: transport.session, providerId: "provider-concurrent" }),
    ]);
    assert.equal(first.rows.length, 1);
    assert.equal(second.rows.length, 1);
    assert.equal(transport.state.handshakes, 1);
    assert.equal(aggregateCalls, 2);
  });

  await scenario("cancelling one discovery waiter does not kill shared handshake", async () => {
    let resolveHandshake!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const state: TransportState = { requests: [], handshakes: 0 };
    let aggregateCalls = 0;
    const fetchImpl: FetchLike = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      state.requests.push(url);
      if (url.searchParams.get("action") === "handshake") {
        state.handshakes += 1;
        markStarted();
        return new Promise<Response>((resolve) => {
          resolveHandshake = () => resolve(json({ js: { token: "shared-token" } }));
        });
      }
      if (url.searchParams.get("action") === "get_all_channels") {
        aggregateCalls += 1;
        return json({ js: { data: [channel(1)] } });
      }
      throw new Error("unexpected request");
    };
    const session = createStalkerPortalSession({
      portalUrl: "https://shared.invalid",
      mac: MAC,
      fetchImpl,
      timeoutMs: 2_000,
    });
    const controller = new AbortController();
    const cancelled = discoverStalkerLiveChannels({ session, providerId: "provider-shared", signal: controller.signal });
    const surviving = discoverStalkerLiveChannels({ session, providerId: "provider-shared" });
    await started;
    controller.abort();
    resolveHandshake();
    await expectCode(cancelled, "CANCELLED");
    const result = await surviving;
    assert.equal(result.rows.length, 1);
    assert.equal(state.handshakes, 1);
    assert.equal(aggregateCalls, 1);
  });

  assert.equal(passed, 27);
  console.log("stalker live discovery scenarios: 27/27 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});