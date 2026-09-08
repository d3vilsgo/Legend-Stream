import assert from "node:assert/strict";
import { createStalkerPortalSession, type StalkerPortalSession } from "../lib/stalkerPortal";
import {
  STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE,
  classifyStalkerAggregateDuplicate,
  discoverStalkerLiveChannels,
  normalizeStalkerLiveAggregateCooperatively,
} from "../lib/stalkerLiveDiscovery";
import { syncStalkerLiveCatalogWithDependencies } from "../lib/stalkerLiveSync";
import {
  getOrCreateStalkerPortalSession,
  releaseStalkerPortalSession,
} from "../lib/stalkerPortalRuntime";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type LogEntry = { event: string; details: Record<string, unknown> };

let passed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function channel(
  id: number | string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name: `Channel ${id}`,
    cmd: `ffmpeg opaque-command-${id}`,
    tv_genre_id: "1",
    logo: `logo-${id}`,
    xmltv_id: `tvg-${id}`,
    ...overrides,
  };
}

function normalized(id: number | string, overrides: Record<string, unknown> = {}) {
  return normalizeStalkerLiveAggregateCooperatively({
    payload: { data: [channel(id, overrides)] },
    providerId: "r12-normalize",
    networkWaitMs: 0,
    yieldFn: async () => {},
  }).then((result) => {
    assert.equal(result.kind, "complete");
    return result.rows[0];
  });
}

async function captureLogs(run: () => Promise<void> | void) {
  const originalInfo = console.info;
  const logs: LogEntry[] = [];
  console.info = (event?: unknown, details?: unknown) => {
    if (typeof event === "string" && event.startsWith("LS_STALKER_")) {
      logs.push({ event, details: details as Record<string, unknown> });
    }
  };
  try {
    await run();
  } finally {
    console.info = originalInfo;
  }
  return logs;
}

function events(logs: readonly LogEntry[], event: string) {
  return logs.filter((log) => log.event === event);
}

function createTransport(handler: (url: URL) => Response | Promise<Response>) {
  const requests: URL[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    if (url.searchParams.get("action") === "handshake") {
      return response({ js: { token: "token-r12" } });
    }
    return handler(url);
  };
  const session = createStalkerPortalSession({
    portalUrl: "https://portal.invalid",
    mac: "00:1A:79:12:34:56",
    fetchImpl,
  });
  return { session, requests };
}

function makeSyncHarness(session: StalkerPortalSession) {
  return {
    acquireSession: () => session,
    cleanupStaging: async () => {},
    stageItems: async (_providerId: string, _stagingId: string, items: Array<{ id: string }>) => items.length,
    commitStaging: async () => {},
    yieldFn: async () => {},
  };
}

async function main() {
  await scenario("get_all no duplicates emits safe aggregate shape", async () => {
    const transport = createTransport((url) => {
      assert.equal(url.searchParams.get("action"), "get_all_channels");
      return response({ js: { data: [channel(1), channel(2)], total_items: 2 } });
    });
    const logs = await captureLogs(async () => {
      const result = await discoverStalkerLiveChannels({
        session: transport.session,
        providerId: "r12-provider",
        syncRunId: "run-a",
      });
      assert.equal(result.rows.length, 2);
    });
    const shape = events(logs, "LS_STALKER_GET_ALL_SHAPE")[0]?.details;
    assert.equal(shape?.rowCount, 2);
    assert.equal(shape?.advertisedTotal, 2);
    assert.equal(shape?.rawVsAdvertisedRelation, "EQUAL");
    assert.equal(events(logs, "LS_STALKER_AGGREGATE_DUPLICATE_SUMMARY").length, 0);
  });

  await scenario("same portalId same cmd same metadata classifies without exposing cmd", async () => {
    const first = await normalized(1);
    const duplicate = await normalized(1);
    const result = classifyStalkerAggregateDuplicate(first, duplicate);
    assert.equal(result.duplicateClass, "DUPLICATE_SAME_COMMAND_SAME_METADATA");
    assert.equal(result.duplicateSameCommandCount, 1);
    assert.equal(result.duplicateDifferentCommandCount, 0);
  });

  await scenario("same portalId same cmd different category classifies category variant", async () => {
    const first = await normalized(1, { tv_genre_id: "1" });
    const duplicate = await normalized(1, { tv_genre_id: "2" });
    const result = classifyStalkerAggregateDuplicate(first, duplicate);
    assert.equal(result.duplicateClass, "DUPLICATE_SAME_COMMAND_CATEGORY_VARIANT");
    assert.equal(result.duplicateDifferentCategoryCount, 1);
  });

  await scenario("same portalId same cmd metadata difference classifies metadata variant", async () => {
    const first = await normalized(1);
    const duplicate = await normalized(1, { name: "Renamed", logo: "logo-other" });
    const result = classifyStalkerAggregateDuplicate(first, duplicate);
    assert.equal(result.duplicateClass, "DUPLICATE_SAME_COMMAND_METADATA_VARIANT");
    assert.equal(result.duplicateDifferentMetadataCount, 1);
  });

  await scenario("same portalId different cmd classifies command collision", async () => {
    const first = await normalized(1, { cmd: "ffmpeg opaque-a" });
    const duplicate = await normalized(1, { cmd: "ffmpeg opaque-b" });
    const result = classifyStalkerAggregateDuplicate(first, duplicate);
    assert.equal(result.duplicateClass, "DUPLICATE_DIFFERENT_COMMAND");
    assert.equal(result.duplicateDifferentCommandCount, 1);
  });

  await scenario("duplicate crossing chunk boundary emits fatal summary before unchanged throw", async () => {
    const data = Array.from({ length: STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE + 1 }, (_, index) =>
      channel(index === STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE ? 1 : index + 1),
    );
    let yields = 0;
    const logs = await captureLogs(async () => {
      await assert.rejects(
        normalizeStalkerLiveAggregateCooperatively({
          payload: { data },
          providerId: "r12-duplicate",
          syncRunId: "run-dup",
          networkWaitMs: 0,
          yieldFn: async () => { yields += 1; },
        }),
        /duplicate stable channel identifier/,
      );
    });
    const summary = events(logs, "LS_STALKER_AGGREGATE_DUPLICATE_SUMMARY")[0]?.details;
    assert.equal(summary?.rawRowCount, STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE + 1);
    assert.equal(summary?.uniqueBeforeFailure, STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE);
    assert.equal(summary?.firstDuplicateChunkIndex, 1);
    assert.equal(summary?.firstDuplicateClass, "DUPLICATE_SAME_COMMAND_SAME_METADATA");
    assert.equal(events(logs, "LS_STALKER_FALLBACK_DECISION")[0]?.details.reason, "DUPLICATE_PORTAL_ID");
    assert.equal(yields, 1);
  });

  await scenario("observed-style aggregate shape reports cur_page separately without changing behavior", async () => {
    const rows = Array.from({ length: 300 }, (_, index) => channel(index + 1));
    const transport = createTransport(() => response({
      js: { data: rows, total_items: 300, max_page_items: 14, cur_page: 0 },
    }));
    const logs = await captureLogs(async () => {
      await discoverStalkerLiveChannels({
        session: transport.session,
        providerId: "r12-observed",
        syncRunId: "run-shape",
      });
    });
    const shape = events(logs, "LS_STALKER_GET_ALL_SHAPE")[0]?.details;
    assert.equal(shape?.rowCount, 300);
    assert.equal(shape?.advertisedTotal, 300);
    assert.equal(shape?.hasMaxPageItems, true);
    assert.equal(shape?.hasCurPageMetadata, true);
    assert.equal(shape?.hasPaginationMetadata, true);
  });

  await scenario("two sync starts from different owners emit distinct run owners", async () => {
    const transport = createTransport((url) => {
      const action = url.searchParams.get("action");
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [] });
      if (action === "get_all_channels") return response({ js: { data: [channel(1)], total_items: 1 } });
      throw new Error(`unexpected ${action}`);
    });
    const provider = { id: "r12-owner", url: "https://portal.invalid", mac: "00:1A:79:12:34:56" };
    const logs = await captureLogs(async () => {
      await syncStalkerLiveCatalogWithDependencies(
        { provider, owner: "CONNECT_PROVIDER" },
        makeSyncHarness(transport.session),
      );
      await syncStalkerLiveCatalogWithDependencies(
        { provider, owner: "LIVE_MOUNT" },
        makeSyncHarness(transport.session),
      );
    });
    assert.deepEqual(events(logs, "LS_STALKER_SYNC_RUN_START").map((log) => log.details.owner), [
      "CONNECT_PROVIDER",
      "LIVE_MOUNT",
    ]);
  });

  await scenario("overlapping shared-session syncs keep request-scoped diagnostic attribution", async () => {
    let resolveHandshake!: () => void;
    let markHandshakeStarted!: () => void;
    const handshakeStarted = new Promise<void>((resolve) => { markHandshakeStarted = resolve; });
    const requests: URL[] = [];
    const fetchImpl: FetchLike = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      const action = url.searchParams.get("action");
      if (action === "handshake") {
        markHandshakeStarted();
        return new Promise<Response>((resolve) => {
          resolveHandshake = () => resolve(response({ js: { token: "token-overlap" } }));
        });
      }
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [] });
      if (action === "get_all_channels") return response({ js: { data: [channel(1)], total_items: 1 } });
      throw new Error(`unexpected ${action}`);
    };
    const session = createStalkerPortalSession({
      portalUrl: "https://portal.invalid",
      mac: "00:1A:79:12:34:56",
      fetchImpl,
    });
    const provider = { id: "r12-overlap", url: "https://portal.invalid", mac: "00:1A:79:12:34:56" };
    const logs = await captureLogs(async () => {
      const first = syncStalkerLiveCatalogWithDependencies(
        { provider, owner: "CONNECT_PROVIDER" },
        makeSyncHarness(session),
      );
      await handshakeStarted;
      const second = syncStalkerLiveCatalogWithDependencies(
        { provider, owner: "LIVE_MOUNT" },
        makeSyncHarness(session),
      );
      resolveHandshake();
      await Promise.all([first, second]);
    });
    assert.equal(requests.filter((url) => url.searchParams.get("action") === "handshake").length, 1);
    assert.equal(events(logs, "LS_STALKER_HANDSHAKE_START")[0]?.details.syncRunId, events(logs, "LS_STALKER_SYNC_RUN_START")[0]?.details.syncRunId);
    const pendingReuse = events(logs, "LS_STALKER_HANDSHAKE_REUSE").find((log) => log.details.reason === "PENDING_HANDSHAKE");
    assert.equal(pendingReuse?.details.syncRunId, events(logs, "LS_STALKER_SYNC_RUN_START")[1]?.details.syncRunId);
    assert.deepEqual(
      events(logs, "LS_STALKER_SYNC_RUN_START").map((log) => log.details.owner),
      ["CONNECT_PROVIDER", "LIVE_MOUNT"],
    );
  });

  await scenario("same-session syncs reuse existing token with TOKEN_PRESENT marker", async () => {
    let handshakes = 0;
    const transport = createTransport((url) => {
      if (url.searchParams.get("action") === "get_profile") return response({ js: { id: "profile" } });
      if (url.searchParams.get("action") === "get_genres") return response({ js: [] });
      if (url.searchParams.get("action") === "get_all_channels") return response({ js: { data: [channel(1)], total_items: 1 } });
      throw new Error("unexpected");
    });
    const originalFetch = (transport.session as unknown as never);
    assert.ok(originalFetch !== null);
    const provider = { id: "r12-reuse", url: "https://portal.invalid", mac: "00:1A:79:12:34:56" };
    const logs = await captureLogs(async () => {
      await syncStalkerLiveCatalogWithDependencies({ provider }, makeSyncHarness(transport.session));
      handshakes = transport.requests.filter((url) => url.searchParams.get("action") === "handshake").length;
      await syncStalkerLiveCatalogWithDependencies({ provider }, makeSyncHarness(transport.session));
    });
    assert.equal(handshakes, 1);
    assert.equal(transport.requests.filter((url) => url.searchParams.get("action") === "handshake").length, 1);
    assert.equal(events(logs, "LS_STALKER_HANDSHAKE_START").length, 1);
    assert.ok(events(logs, "LS_STALKER_HANDSHAKE_REUSE").some((log) => log.details.reason === "TOKEN_PRESENT"));
  });

  await scenario("pending handshake single-flight emits PENDING_HANDSHAKE for second waiter", async () => {
    let resolveHandshake!: () => void;
    let markHandshakeStarted!: () => void;
    const handshakeStarted = new Promise<void>((resolve) => { markHandshakeStarted = resolve; });
    const requests: URL[] = [];
    const fetchImpl: FetchLike = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      if (url.searchParams.get("action") === "handshake") {
        markHandshakeStarted();
        return new Promise<Response>((resolve) => {
          resolveHandshake = () => resolve(response({ js: { token: "token-pending" } }));
        });
      }
      return response({ js: { ok: true } });
    };
    const session = createStalkerPortalSession({
      portalUrl: "https://portal.invalid",
      mac: "00:1A:79:12:34:56",
      fetchImpl,
    });
    const logs = await captureLogs(async () => {
      const first = session.request(
        { type: "itv", action: "get_all_channels" },
        undefined,
        undefined,
        { syncRunId: "run-pending-a", providerId: "provider-pending" },
      );
      await handshakeStarted;
      const second = session.request(
        { type: "itv", action: "get_genres" },
        undefined,
        undefined,
        { syncRunId: "run-pending-b", providerId: "provider-pending" },
      );
      resolveHandshake();
      await Promise.all([first, second]);
    });
    assert.equal(requests.filter((url) => url.searchParams.get("action") === "handshake").length, 1);
    const pending = events(logs, "LS_STALKER_HANDSHAKE_REUSE").find((log) => log.details.reason === "PENDING_HANDSHAKE");
    assert.equal(pending?.details.syncRunId, "run-pending-b");
  });

  await scenario("session recreation path emits safe registry acquire reason", async () => {
    const providerId = "r12-registry";
    releaseStalkerPortalSession(providerId);
    const logs = await captureLogs(() => {
      getOrCreateStalkerPortalSession({
        providerId,
        portalUrl: "https://before.invalid",
        mac: "00:1A:79:12:34:56",
        diagnostics: { syncRunId: "run-registry", providerId },
      });
      getOrCreateStalkerPortalSession({
        providerId,
        portalUrl: "https://after.invalid",
        mac: "00:1A:79:12:34:56",
        diagnostics: { syncRunId: "run-registry-2", providerId },
      });
      releaseStalkerPortalSession(providerId);
    });
    const acquire = events(logs, "LS_STALKER_SESSION_ACQUIRE");
    assert.equal(acquire[0]?.details.reason, "MISS");
    assert.equal(acquire[1]?.details.reason, "ENDPOINT_CHANGED");
    assert.equal(acquire[1]?.details.recreated, true);
  });

  await scenario("cancellation remains fatal cancellation and does not continue aggregate", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      normalizeStalkerLiveAggregateCooperatively({
        payload: { data: [channel(1)] },
        providerId: "r12-cancel",
        networkWaitMs: 0,
        signal: controller.signal,
        yieldFn: async () => {},
      }),
      /cancelled/,
    );
  });

  await scenario("R10 invariant keeps at most 250 rows between cooperative yields", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => channel(index + 1));
    let yields = 0;
    await normalizeStalkerLiveAggregateCooperatively({
      payload: { data: rows, total_items: rows.length },
      providerId: "r12-r10",
      networkWaitMs: 0,
      yieldFn: async () => { yields += 1; },
    });
    assert.equal(yields, Math.ceil(rows.length / STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE));
  });

  assert.equal(passed, 14);
  console.log("stalker R12 runtime classification scenarios: 14/14 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
