import assert from "node:assert/strict";
import { createStalkerPortalSession, StalkerPortalError, type StalkerPortalSession } from "../lib/stalkerPortal";
import { normalizeStalkerLiveAggregateCooperatively, STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE } from "../lib/stalkerLiveDiscovery";
import { syncStalkerLiveCatalogWithDependencies } from "../lib/stalkerLiveSync";
import { StalkerLiveSyncSingleFlight } from "../lib/stalkerLiveSyncSingleFlight";

let passed = 0;
type Marker = { event: string; details: Record<string, unknown> };

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function channel(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Channel ${id}`,
    cmd: `ffmpeg opaque-${id}`,
    tv_genre_id: "10",
    ...overrides,
  };
}

async function captureMarkers<T>(run: () => Promise<T> | T): Promise<{ markers: Marker[]; result: T }> {
  const originalInfo = console.info;
  const markers: Marker[] = [];
  console.info = (event?: unknown, details?: unknown) => {
    if (typeof event === "string" && event.startsWith("STALKER_")) {
      markers.push({ event, details: (details ?? {}) as Record<string, unknown> });
    }
  };
  try {
    return { markers, result: await run() };
  } finally {
    console.info = originalInfo;
  }
}

function markerEvents(markers: readonly Marker[], action?: string) {
  return markers
    .filter((entry) => action === undefined || entry.details.action === action)
    .map((entry) => entry.event);
}

function makeSession(responder: (action: string, url: URL) => Response | Promise<Response>) {
  const calls: string[] = [];
  const session = createStalkerPortalSession({
    portalUrl: "https://diagnostic-host.invalid/stalker_portal/",
    mac: "00:1A:79:AA:BB:CC",
    afterResponse: async () => {},
    diagnostics: { providerId: "r14-provider" },
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      const action = url.searchParams.get("action") || "";
      calls.push(action);
      if (action === "handshake") return response({ js: { token: "secret-token-r14" } });
      return responder(action, url);
    },
  });
  return { session, calls };
}

function makeSyncHarness(session: StalkerPortalSession) {
  const stageSizes: number[] = [];
  const commits: number[] = [];
  let yields = 0;
  return {
    stageSizes,
    commits,
    get yields() { return yields; },
    dependencies: {
      acquireSession: () => session,
      cleanupStaging: async () => {},
      stageItems: async (_providerId: string, _stagingId: string, items: Array<{ id: string }>) => {
        stageSizes.push(items.length);
        return items.length;
      },
      commitStaging: async (_providerId: string, _stagingId: string, _categories: readonly unknown[], count: number) => {
        commits.push(count);
      },
      yieldFn: async () => { yields += 1; },
    },
  };
}

async function main() {
  await scenario("A marker ordering is deterministic for one successful request", async () => {
    const transport = makeSession((action) => {
      assert.equal(action, "get_all_channels");
      return response({ js: { data: [channel(1)], total_items: 1 } });
    });
    const { markers } = await captureMarkers(() => transport.session.request(
      { type: "itv", action: "get_all_channels" },
      undefined,
      undefined,
      { syncRunId: "run-order", providerId: "r14-provider" },
    ));
    assert.deepEqual(markerEvents(markers, "get_all_channels"), [
      "STALKER_FETCH_START",
      "STALKER_FETCH_RESOLVED",
      "STALKER_BODY_READ_START",
      "STALKER_BODY_READ_END",
      "STALKER_POST_BODY_YIELD_START",
      "STALKER_POST_BODY_YIELD_END",
      "STALKER_JSON_PARSE_START",
      "STALKER_JSON_PARSE_END",
      "STALKER_REQUEST_RETURN",
    ]);
  });

  await scenario("B success request marker chain carries safe timing and correlation metadata", async () => {
    const transport = makeSession(() => response({ js: { data: [channel(1)], total_items: 1 } }));
    const { markers } = await captureMarkers(() => transport.session.request(
      { type: "itv", action: "get_all_channels" },
      undefined,
      undefined,
      { syncRunId: "run-success", providerId: "r14-provider" },
    ));
    const chain = markers.filter((entry) => entry.details.action === "get_all_channels");
    assert.equal(chain.length, 9);
    for (const entry of chain) {
      assert.equal(entry.details.syncRunId, "run-success");
      assert.equal(entry.details.providerId, "r14-provider");
      assert.equal(typeof entry.details.elapsedMs, "number");
    }
  });

  await scenario("C parse failure keeps INVALID_RESPONSE semantics", async () => {
    const calls: string[] = [];
    const session = createStalkerPortalSession({
      portalUrl: "https://parse.invalid",
      mac: "00:1A:79:AA:BB:CC",
      afterResponse: async () => {},
      fetchImpl: async (input) => {
        const action = new URL(String(input)).searchParams.get("action") || "";
        calls.push(action);
        if (action === "handshake") return response({ js: { token: "token" } });
        return new Response("not-json", { status: 200 });
      },
    });
    const { markers } = await captureMarkers(async () => {
      await assert.rejects(
        session.request({ type: "itv", action: "get_all_channels" }),
        (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "INVALID_RESPONSE",
      );
    });
    assert.equal(calls.filter((action) => action === "get_all_channels").length, 1);
    assert.equal(markers.some((entry) => entry.event === "STALKER_JSON_PARSE_END" && entry.details.ok === false), true);
    assert.equal(markers.some((entry) => entry.event === "STALKER_REQUEST_RETURN" && entry.details.action === "get_all_channels"), false);
  });

  await scenario("D cancellation semantics remain fail-fast and do not create transport work", async () => {
    const transport = makeSession(() => response({ js: {} }));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      transport.session.request({ type: "itv", action: "get_all_channels" }, controller.signal),
      (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "CANCELLED",
    );
    assert.equal(transport.calls.length, 0);
  });

  await scenario("E diagnostic marker payloads contain no URL MAC token body or channel identity", async () => {
    const secretName = "SECRET_CHANNEL_NAME";
    const secretCmd = "SECRET_CMD_VALUE";
    const transport = makeSession(() => response({ js: { data: [channel(1, { name: secretName, cmd: secretCmd })], total_items: 1 } }));
    const { markers } = await captureMarkers(() => transport.session.request(
      { type: "itv", action: "get_all_channels" },
      undefined,
      undefined,
      { syncRunId: "run-safe", providerId: "r14-provider" },
    ));
    const serialized = JSON.stringify(markers);
    for (const forbidden of [
      "diagnostic-host.invalid",
      "00:1A:79:AA:BB:CC",
      "secret-token-r14",
      secretName,
      secretCmd,
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });

  await scenario("F aggregate normalization remains 250-row chunked with cooperative yields", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => channel(index + 1));
    let yields = 0;
    const { markers, result } = await captureMarkers(() => normalizeStalkerLiveAggregateCooperatively({
      payload: { data: rows, total_items: rows.length },
      providerId: "r14-normalize",
      syncRunId: "run-normalize",
      networkWaitMs: 0,
      yieldFn: async () => { yields += 1; },
    }));
    assert.equal(result.kind, "complete");
    assert.equal(STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE, 250);
    assert.equal(yields, 3);
    assert.equal(markers.filter((entry) => entry.event === "STALKER_FIRST_NORMALIZE_YIELD").length, 1);
    assert.deepEqual(markerEvents(markers).filter((event) => event.includes("NORMALIZE")), [
      "STALKER_AGGREGATE_NORMALIZE_START",
      "STALKER_FIRST_NORMALIZE_YIELD",
      "STALKER_AGGREGATE_NORMALIZE_END",
    ]);
  });

  await scenario("G staging remains 250-row chunked and yields after every staged chunk", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => channel(index + 1));
    const transport = makeSession((action) => {
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [{ id: "10", title: "News" }] });
      if (action === "get_all_channels") return response({ js: { data: rows, total_items: rows.length } });
      throw new Error(`unexpected ${action}`);
    });
    const harness = makeSyncHarness(transport.session);
    const { markers, result } = await captureMarkers(() => syncStalkerLiveCatalogWithDependencies(
      { provider: { id: "r14-provider", url: "https://diagnostic-host.invalid", mac: "00:1A:79:AA:BB:CC" } },
      harness.dependencies,
    ));
    assert.equal(result.persisted, 501);
    assert.deepEqual(harness.stageSizes, [250, 250, 1]);
    assert.deepEqual(harness.commits, [501]);
    assert.equal(markers.filter((entry) => entry.event === "STALKER_FIRST_STAGE_WRITE_START").length, 1);
    assert.equal(markers.filter((entry) => entry.event === "STALKER_FIRST_STAGE_WRITE_END").length, 1);
    assert.equal(markers.filter((entry) => entry.event === "STALKER_FIRST_STAGE_YIELD").length, 1);
  });

  await scenario("H same-provider single-flight semantics are unchanged", async () => {
    const flight = new StalkerLiveSyncSingleFlight<number>();
    let starts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const task = async () => {
      starts += 1;
      await gate;
      return 7;
    };
    let joins = 0;
    const first = flight.run("provider", undefined, task);
    const second = flight.run("provider", undefined, task, () => { joins += 1; });
    assert.equal(first, second);
    assert.equal(starts, 1);
    assert.equal(joins, 1);
    release();
    assert.equal(await second, 7);
  });

  await scenario("I canonical successful sync request count remains handshake profile genres get_all only", async () => {
    const transport = makeSession((action) => {
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [{ id: "10", title: "News" }] });
      if (action === "get_all_channels") return response({ js: { data: [channel(1)], total_items: 1, max_page_items: 14, cur_page: 0 } });
      throw new Error(`unexpected ${action}`);
    });
    const harness = makeSyncHarness(transport.session);
    await syncStalkerLiveCatalogWithDependencies(
      { provider: { id: "r14-provider", url: "https://diagnostic-host.invalid", mac: "00:1A:79:AA:BB:CC" } },
      harness.dependencies,
    );
    assert.deepEqual(transport.calls, ["handshake", "get_profile", "get_genres", "get_all_channels"]);
    assert.equal(transport.calls.includes("get_ordered_list"), false);
  });

  await scenario("J HTTP-200 anti-DDoS remains terminal without reauth or retry", async () => {
    const transport = makeSession((action) => {
      assert.equal(action, "get_all_channels");
      return new Response("DDoS protection: request rate limited", { status: 200 });
    });
    await assert.rejects(
      transport.session.request({ type: "itv", action: "get_all_channels" }),
      (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "PORTAL_RATE_LIMITED_OR_ANTI_DDOS",
    );
    assert.deepEqual(transport.calls, ["handshake", "get_all_channels"]);
  });

  console.log(`stalker R14-A post-get-all diagnostics scenarios: ${passed}/${passed} passed`);
}

void main().catch((caught) => {
  console.error(caught);
  process.exitCode = 1;
});
