import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStalkerPortalSession, StalkerPortalError } from "../lib/stalkerPortal";
import {
  noteStalkerLivePublishSuccess,
  readStalkerLivePublishRevision,
  resetStalkerLivePublishRevisionForTests,
  subscribeStalkerLivePublishRevision,
} from "../lib/stalkerLivePublishRevision";
import { syncStalkerLiveCatalogWithDependencies } from "../lib/stalkerLiveSync";

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const hookSource = source("hooks/useCatalogPage.ts");
const syncSource = source("lib/stalkerLiveSync.ts");
const homeSource = source("components/OptimizedHomeScreenPaged.tsx");

const PROVIDER = { id: "r7-provider", url: "http://portal.invalid/stalker_portal/", mac: "00:1A:79:12:34:56" };

function channel(id: number) {
  return { id, name: `Channel ${id}`, tv_genre_id: "10", cmd: `ffmpeg http://127.0.0.1/live/${id}` };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function actionOf(input: string | URL | Request) {
  return new URL(String(input)).searchParams.get("action") || "";
}

function makeHarness(
  responder: (action: string, url: URL) => Response | Promise<Response>,
  notePublishSuccess?: (providerId: string, kind: "live") => void,
) {
  const calls: string[] = [];
  const events: string[] = [];
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
    events,
    dependencies: {
      acquireSession,
      cleanupStaging: async () => {
        events.push("cleanup");
      },
      stageItems: async (_providerId: string, _stagingId: string, items: Array<{ id: string }>) => {
        events.push(`stage:${items.length}`);
        return items.length;
      },
      commitStaging: async () => {
        events.push("commit");
      },
      notePublishSuccess: (providerId: string, kind: "live") => {
        events.push(`publish:${providerId}:${kind}`);
        notePublishSuccess?.(providerId, kind);
      },
      yieldFn: async () => {},
    },
  };
}

async function main() {
  await scenario("revision notifications are provider and kind scoped", () => {
    resetStalkerLivePublishRevisionForTests();
    const providerA: number[] = [];
    const providerB: number[] = [];
    const unsubscribeA = subscribeStalkerLivePublishRevision("provider-a", "live", (revision) => providerA.push(revision));
    const unsubscribeB = subscribeStalkerLivePublishRevision("provider-b", "live", (revision) => providerB.push(revision));

    assert.equal(readStalkerLivePublishRevision("provider-a", "live"), 0);
    assert.equal(noteStalkerLivePublishSuccess("provider-a", "live"), 1);
    assert.equal(noteStalkerLivePublishSuccess("provider-a", "live"), 2);

    assert.deepEqual(providerA, [1, 2]);
    assert.deepEqual(providerB, []);
    assert.equal(readStalkerLivePublishRevision("provider-a", "live"), 2);
    assert.equal(readStalkerLivePublishRevision("provider-b", "live"), 0);

    unsubscribeA();
    unsubscribeB();
  });

  await scenario("unsubscribe stops mounted-page invalidation delivery", () => {
    resetStalkerLivePublishRevisionForTests();
    const received: number[] = [];
    const unsubscribe = subscribeStalkerLivePublishRevision("provider-a", "live", (revision) => received.push(revision));
    noteStalkerLivePublishSuccess("provider-a", "live");
    unsubscribe();
    noteStalkerLivePublishSuccess("provider-a", "live");
    assert.deepEqual(received, [1]);
    assert.equal(readStalkerLivePublishRevision("provider-a", "live"), 2);
  });

  await scenario("successful sync notifies exactly once after atomic commit", async () => {
    resetStalkerLivePublishRevisionForTests();
    const h = makeHarness((action) => {
      if (action === "handshake") return response({ js: { token: "token-r7" } });
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [] });
      if (action === "get_all_channels") return response({ js: { data: [channel(1), channel(2)], total_items: 2 } });
      throw new Error(`unexpected ${action}`);
    });

    await syncStalkerLiveCatalogWithDependencies({ provider: PROVIDER }, h.dependencies);

    assert.deepEqual(h.events.filter((event) => event.startsWith("publish:")), ["publish:r7-provider:live"]);
    assert.ok(h.events.indexOf("commit") < h.events.indexOf("publish:r7-provider:live"));
  });

  await scenario("failed discovery does not publish a revision", async () => {
    resetStalkerLivePublishRevisionForTests();
    const h = makeHarness((action) => {
      if (action === "handshake") return response({ js: { token: "token-r7-fail" } });
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [] });
      if (action === "get_all_channels") return response({ js: { data: [], total_items: 0 } });
      throw new Error(`unexpected ${action}`);
    });

    await assert.rejects(syncStalkerLiveCatalogWithDependencies({ provider: PROVIDER }, h.dependencies), StalkerPortalError);
    assert.deepEqual(h.events.filter((event) => event.startsWith("publish:")), []);
  });

  await scenario("cancelled stale sync after commit does not publish a revision", async () => {
    resetStalkerLivePublishRevisionForTests();
    const h = makeHarness((action) => {
      if (action === "handshake") return response({ js: { token: "token-r7-stale" } });
      if (action === "get_profile") return response({ js: { id: "profile" } });
      if (action === "get_genres") return response({ js: [] });
      if (action === "get_all_channels") return response({ js: { data: [channel(1)], total_items: 1 } });
      throw new Error(`unexpected ${action}`);
    });
    let current = true;
    h.dependencies.commitStaging = async () => {
      h.events.push("commit");
      current = false;
    };

    await assert.rejects(
      syncStalkerLiveCatalogWithDependencies({ provider: PROVIDER, isCurrent: () => current }, h.dependencies),
      (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "CANCELLED",
    );
    assert.deepEqual(h.events.filter((event) => event.startsWith("publish:")), []);
  });

  await scenario("mounted Stalker Live page subscribes to revision and reloads the lazy page", () => {
    assert.match(hookSource, /subscribeStalkerLivePublishRevision/);
    assert.match(hookSource, /readStalkerLivePublishRevision/);
    assert.match(hookSource, /observedStalkerLivePublishRevisionRef/);
    assert.match(hookSource, /stalkerLivePublishRevision[\s\S]*reload\(\)/);
    assert.match(hookSource, /getStalkerLazyLivePage/);
    assert.doesNotMatch(hookSource, /getCachedStalkerLivePage/);
    assert.match(hookSource, /stalkerRequestRef/);
    assert.match(hookSource, /AbortController/);
    assert.match(hookSource, /signal: stalkerController\?\.signal/);
  });

  await scenario("revision reload hook has no Stalker network, sync, or playback side effect", () => {
    assert.doesNotMatch(hookSource, /handshake|get_profile|get_genres|get_all_channels|get_ordered_list|create_link|syncStalkerLiveCatalog/);
    assert.doesNotMatch(hookSource, /setTimeout|setInterval/);
  });

  await scenario("sync notifies only after post-commit current ownership check", () => {
    assert.match(syncSource, /commitStaging[\s\S]*assertCurrent\(options\.signal, options\.isCurrent\)[\s\S]*notePublishSuccess/s);
  });

  await scenario("R6 Home ownership stays sealed and Stalker never falls back to legacy live channels", () => {
    assert.match(homeSource, /provider\?\.type === "stalker" \? \[\] : playerLiveChannels/);
    assert.doesNotMatch(homeSource, /noteStalkerLivePublishSuccess|subscribeStalkerLivePublishRevision|readStalkerLivePublishRevision/);
  });

  assert.equal(passed, 9);
  console.log("stalker live publish revision scenarios: 9/9 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
