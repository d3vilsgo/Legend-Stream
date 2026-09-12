import assert from "node:assert/strict";
import { createStalkerPortalSession, StalkerPortalError } from "../lib/stalkerPortal";
import { syncStalkerLiveCatalogWithDependencies } from "../lib/stalkerLiveSync";

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const PROVIDER = { id: "r5-provider", url: "http://portal.invalid/stalker_portal/", mac: "00:1A:79:12:34:56" };

function channel(id: number) {
  return { id, name: `Channel ${id}`, tv_genre_id: "10", cmd: `ffmpeg http://127.0.0.1/live/${id}` };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function actionOf(input: string | URL | Request) {
  return new URL(String(input)).searchParams.get("action") || "";
}

function makeHarness(responder: (action: string, url: URL) => Response | Promise<Response>) {
  const calls: string[] = [];
  const staged: string[] = [];
  const commits: number[] = [];
  let session: ReturnType<typeof createStalkerPortalSession> | null = null;
  const acquireSession = () => {
    if (!session) {
      session = createStalkerPortalSession({
        portalUrl: PROVIDER.url,
        mac: PROVIDER.mac,
        afterResponse: async () => {},
        fetchImpl: async (input) => {
          const url = new URL(String(input));
          const action = actionOf(input);
          calls.push(action);
          return responder(action, url);
        },
      });
    }
    return session;
  };
  return {
    calls,
    staged,
    commits,
    acquireSession,
    dependencies: {
      acquireSession: () => acquireSession(),
      cleanupStaging: async () => {},
      stageItems: async (_providerId: string, _stagingId: string, items: Array<{ id: string }>) => {
        staged.push(...items.map((item) => item.id));
        return items.length;
      },
      commitStaging: async (_providerId: string, _stagingId: string, _categories: readonly unknown[], count: number) => {
        commits.push(count);
      },
      yieldFn: async () => {},
    },
  };
}

async function main() {
  await scenario("canonical sync exact supported call order uses aggregate without ordered fallback", async () => {
    const h = makeHarness((action) => {
      if (action === "handshake") return response({ js: { token: "token-a" } });
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [{ id: "10", title: "News" }] });
      if (action === "get_all_channels") return response({ js: { data: [channel(1), channel(2)], total_items: 2 } });
      throw new Error(`unexpected ${action}`);
    });
    const result = await syncStalkerLiveCatalogWithDependencies({ provider: PROVIDER }, h.dependencies);
    assert.deepEqual(h.calls, ["handshake", "get_profile", "get_genres", "get_all_channels"]);
    assert.equal(h.calls.includes("get_ordered_list"), false);
    assert.equal(result.persisted, 2);
    assert.deepEqual(h.commits, [2]);
  });

  await scenario("explicit unsupported profile continues to genres and aggregate discovery", async () => {
    const h = makeHarness((action) => {
      if (action === "handshake") return response({ js: { token: "token-b" } });
      if (action === "get_profile") return response({ js: { error: "unknown action" } });
      if (action === "get_genres") return response({ js: [] });
      if (action === "get_all_channels") return response({ js: { data: [channel(1)], total_items: 1 } });
      throw new Error(`unexpected ${action}`);
    });
    await syncStalkerLiveCatalogWithDependencies({ provider: PROVIDER }, h.dependencies);
    assert.deepEqual(h.calls, ["handshake", "get_profile", "get_genres", "get_all_channels"]);
    assert.deepEqual(h.commits, [1]);
  });

  await scenario("successive same-provider syncs reuse the same session token", async () => {
    const h = makeHarness((action) => {
      if (action === "handshake") return response({ js: { token: "token-reuse" } });
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [] });
      if (action === "get_all_channels") return response({ js: { data: [channel(1)], total_items: 1 } });
      throw new Error(`unexpected ${action}`);
    });
    await syncStalkerLiveCatalogWithDependencies({ provider: PROVIDER }, h.dependencies);
    await syncStalkerLiveCatalogWithDependencies({ provider: PROVIDER }, h.dependencies);
    assert.equal(h.calls.filter((action) => action === "handshake").length, 1);
    assert.equal(h.calls.filter((action) => action === "get_profile").length, 2);
  });

  await scenario("aggregate 404 falls back to complete ordered traversal", async () => {
    const h = makeHarness((action, url) => {
      if (action === "handshake") return response({ js: { token: "token-fallback" } });
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [] });
      if (action === "get_all_channels") return response({ error: "missing" }, 404);
      if (action === "get_ordered_list") {
        const page = Number(url.searchParams.get("p"));
        return response({ js: { data: page === 1 ? [channel(1), channel(2)] : [channel(3)], total_items: 3, max_page_items: 2 } });
      }
      throw new Error(`unexpected ${action}`);
    });
    const result = await syncStalkerLiveCatalogWithDependencies({ provider: PROVIDER }, h.dependencies);
    assert.equal(result.discoverySource, "get_ordered_list");
    assert.equal(result.persisted, 3);
    assert.equal(h.calls.filter((action) => action === "get_ordered_list").length, 2);
    assert.deepEqual(h.commits, [3]);
  });

  await scenario("advertised partial aggregate falls back and publishes exact total", async () => {
    const h = makeHarness((action, url) => {
      if (action === "handshake") return response({ js: { token: "token-partial" } });
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [] });
      if (action === "get_all_channels") return response({ js: { data: [channel(1)], total_items: 2 } });
      if (action === "get_ordered_list") {
        const page = Number(url.searchParams.get("p"));
        return response({ js: { data: page === 1 ? [channel(1)] : [channel(2)], total_items: 2, max_page_items: 1 } });
      }
      throw new Error(`unexpected ${action}`);
    });
    const result = await syncStalkerLiveCatalogWithDependencies({ provider: PROVIDER }, h.dependencies);
    assert.equal(result.persisted, 2);
    assert.deepEqual(h.commits, [2]);
  });

  await scenario("malformed aggregate fails closed without publish", async () => {
    const h = makeHarness((action) => {
      if (action === "handshake") return response({ js: { token: "token-malformed" } });
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [] });
      if (action === "get_all_channels") return response({ js: { data: [], total_items: 0 } });
      throw new Error(`unexpected ${action}`);
    });
    await assert.rejects(syncStalkerLiveCatalogWithDependencies({ provider: PROVIDER }, h.dependencies), StalkerPortalError);
    assert.deepEqual(h.commits, []);
  });

  await scenario("1000+ aggregate rows are staged in bounded chunks and published exactly", async () => {
    const rows = Array.from({ length: 1100 }, (_, index) => channel(index + 1));
    const h = makeHarness((action) => {
      if (action === "handshake") return response({ js: { token: "token-large" } });
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [] });
      if (action === "get_all_channels") return response({ js: { data: rows, total_items: rows.length } });
      throw new Error(`unexpected ${action}`);
    });
    const result = await syncStalkerLiveCatalogWithDependencies({ provider: PROVIDER }, h.dependencies);
    assert.equal(result.persisted, 1100);
    assert.equal(h.staged.length, 1100);
    assert.deepEqual(h.commits, [1100]);
  });

  await scenario("cancellation prevents publish and a later sync reuses the surviving session", async () => {
    const controller = new AbortController();
    const h = makeHarness((action) => {
      if (action === "handshake") return response({ js: { token: "token-cancel" } });
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [] });
      if (action === "get_all_channels") {
        if (!controller.signal.aborted) controller.abort();
        return response({ js: { data: [channel(1)], total_items: 1 } });
      }
      throw new Error(`unexpected ${action}`);
    });
    await assert.rejects(
      syncStalkerLiveCatalogWithDependencies({ provider: PROVIDER, signal: controller.signal }, h.dependencies),
      (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "CANCELLED",
    );
    assert.deepEqual(h.commits, []);

    const before = h.calls.filter((action) => action === "handshake").length;
    await syncStalkerLiveCatalogWithDependencies({ provider: PROVIDER }, h.dependencies);
    assert.equal(h.calls.filter((action) => action === "handshake").length, before);
    assert.deepEqual(h.commits, [1]);
  });
}

main().then(() => console.log(`stalker live sync adoption scenarios passed: ${passed}`));
