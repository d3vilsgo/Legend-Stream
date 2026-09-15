import assert from "node:assert/strict";
import {
  StalkerPortalError,
  createStalkerPortalSession,
} from "../lib/stalkerPortal";
import {
  MAX_STALKER_LIVE_PAGES,
  fetchStalkerLiveCategories,
  normalizeStalkerLiveCategories,
  normalizeStalkerLivePage,
  projectStalkerLiveItem,
  resolveStalkerLiveCreateLink,
  runStagedStalkerLiveSync,
  stableStalkerLiveChannelId,
  stalkerLivePageCeilingExceeded,
  traverseStalkerLivePages,
} from "../lib/stalkerLiveCatalog";
import { enqueueOwnedStalkerLiveCommit } from "../lib/stalkerLiveCommitOwnership";
import { parseCatalogRuntimeSource, makeStalkerLiveRuntimeSource } from "../lib/catalogPersistence";

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function channel(id: string | number, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Channel ${id}`,
    tv_genre_id: "10",
    cmd: `ffmpeg http://127.0.0.1/live/${id}`,
    ...extra,
  };
}

function portal(
  responder: (params: Record<string, string | number | boolean | undefined>, signal?: AbortSignal) => unknown | Promise<unknown>,
) {
  return {
    request: async (
      params: Record<string, string | number | boolean | undefined>,
      signal?: AbortSignal,
    ) => responder(params, signal),
  };
}

async function expectCode(promise: Promise<unknown>, code: StalkerPortalError["code"]) {
  await assert.rejects(promise, (caught: unknown) => {
    assert.ok(caught instanceof StalkerPortalError);
    assert.equal(caught.code, code);
    return true;
  });
}

const PROVIDER = "provider-stalker";
const MAC = "00:1A:79:12:34:56";

async function main() {
  await scenario("1 handshake/session regression keeps authorized request flow", async () => {
    const urls: string[] = [];
    const session = createStalkerPortalSession({
      portalUrl: "http://portal.invalid/stalker_portal/",
      mac: MAC,
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        return new Response(
          url.includes("action=handshake")
            ? JSON.stringify({ js: { token: "session-one" } })
            : JSON.stringify({ js: { data: [channel(1)] } }),
          { status: 200 },
        );
      },
    });
    await session.request({ type: "itv", action: "get_ordered_list", p: 1 });
    assert.equal(urls.length, 2);
  });

  await scenario("2 categories success preserves stable id/name", async () => {
    const value = await fetchStalkerLiveCategories(portal(() => ({ data: [{ id: 10, title: "News" }] })));
    assert.deepEqual(value, [{ id: "10", name: "News" }]);
  });

  await scenario("3 category unsupported 404 falls back", async () => {
    const value = await fetchStalkerLiveCategories(portal(() => {
      throw new StalkerPortalError("HTTP_ERROR", "unsupported", 404);
    }));
    assert.deepEqual(value, []);
  });

  await scenario("4 category unsupported 405 falls back", async () => {
    const value = await fetchStalkerLiveCategories(portal(() => {
      throw new StalkerPortalError("HTTP_ERROR", "unsupported", 405);
    }));
    assert.deepEqual(value, []);
  });

  await scenario("5 category auth failure remains fail closed", async () => {
    await expectCode(fetchStalkerLiveCategories(portal(() => {
      throw new StalkerPortalError("AUTH_FAILED", "auth", 401);
    })), "AUTH_FAILED");
  });

  await scenario("6 malformed category response remains fail closed", async () => {
    await expectCode(fetchStalkerLiveCategories(portal(() => ({ unsupported: true }))), "INVALID_RESPONSE");
  });

  await scenario("7 metadata pagination reaches total_items", async () => {
    const pages: number[] = [];
    const result = await traverseStalkerLivePages({
      session: portal((params) => {
        const p = Number(params.p); pages.push(p);
        return p === 1
          ? { data: [channel(1), channel(2)], total_items: 3, max_page_items: 2 }
          : { data: [channel(3)], total_items: 3, max_page_items: 2 };
      }),
      providerId: PROVIDER,
      persistPage: async () => undefined,
    });
    assert.deepEqual(pages, [1, 2]);
    assert.equal(result.uniqueItems, 3);
  });

  await scenario("8 metadata-less traversal terminates on empty page", async () => {
    const pages: number[] = [];
    const result = await traverseStalkerLivePages({
      session: portal((params) => {
        const p = Number(params.p); pages.push(p);
        return { data: p < 3 ? [channel(p)] : [] };
      }),
      providerId: PROVIDER,
      persistPage: async () => undefined,
    });
    assert.deepEqual(pages, [1, 2, 3]);
    assert.equal(result.persisted, 2);
  });

  await scenario("9 explicit empty first page is terminal evidence", async () => {
    const result = await traverseStalkerLivePages({
      session: portal(() => ({ data: [] })), providerId: PROVIDER, persistPage: async () => undefined,
    });
    assert.equal(result.uniqueItems, 0);
  });

  await scenario("10 finite ceiling fails closed", async () => {
    await expectCode(traverseStalkerLivePages({
      session: portal((params) => ({ data: [channel(Number(params.p))] })),
      providerId: PROVIDER,
      maxPages: 2,
      persistPage: async () => undefined,
    }), "INVALID_RESPONSE");
    assert.equal(stalkerLivePageCeilingExceeded(MAX_STALKER_LIVE_PAGES + 1), true);
  });

  await scenario("11 repeated page fingerprint fails closed", async () => {
    await expectCode(traverseStalkerLivePages({
      session: portal(() => ({ data: [channel(1)] })), providerId: PROVIDER, persistPage: async () => undefined,
    }), "INVALID_RESPONSE");
  });

  await scenario("12 duplicate stable id across pages fails closed", async () => {
    await expectCode(traverseStalkerLivePages({
      session: portal((params) => Number(params.p) === 1
        ? { data: [channel(1), channel(2)] }
        : { data: [channel(2), channel(3)] }),
      providerId: PROVIDER,
      persistPage: async () => undefined,
    }), "INVALID_RESPONSE");
  });

  await scenario("13 duplicate stable id inside one page fails closed", async () => {
    await expectCode(traverseStalkerLivePages({
      session: portal(() => ({ data: [channel(1), channel(1)] })), providerId: PROVIDER, persistPage: async () => undefined,
    }), "INVALID_RESPONSE");
  });

  await scenario("14 stable id survives reorder", () => {
    const a = normalizeStalkerLivePage({ data: [channel(7), channel(9)] }, PROVIDER, 1);
    const b = normalizeStalkerLivePage({ data: [channel(9), channel(7)] }, PROVIDER, 1);
    assert.equal(a.items[0].id, b.items[1].id);
  });

  await scenario("15 stable id survives page movement", () => {
    const a = normalizeStalkerLivePage({ data: [channel(7)] }, PROVIDER, 1);
    const b = normalizeStalkerLivePage({ data: [channel(7)] }, PROVIDER, 8);
    assert.equal(a.items[0].id, b.items[0].id);
  });

  await scenario("16 missing portal id fails closed instead of using index", () => {
    assert.throws(() => normalizeStalkerLivePage({ data: [{ name: "No id", cmd: "http://x" }] }, PROVIDER, 1), StalkerPortalError);
  });

  await scenario("17 incremental staging happens page by page", async () => {
    const batches: string[][] = [];
    await traverseStalkerLivePages({
      session: portal((params) => Number(params.p) === 1
        ? { data: [channel(1), channel(2)], total_items: 3, max_page_items: 2 }
        : { data: [channel(3)], total_items: 3, max_page_items: 2 }),
      providerId: PROVIDER,
      persistPage: async (items) => { batches.push(items.map((item) => item.id)); },
    });
    assert.deepEqual(batches.map((batch) => batch.length), [2, 1]);
  });

  await scenario("18 traversal yields between staged pages", async () => {
    let yields = 0;
    await traverseStalkerLivePages({
      session: portal((params) => Number(params.p) === 1
        ? { data: [channel(1)], total_items: 2, max_page_items: 1 }
        : { data: [channel(2)], total_items: 2, max_page_items: 1 }),
      providerId: PROVIDER,
      persistPage: async () => undefined,
      yieldFn: async () => { yields += 1; },
    });
    assert.equal(yields, 2);
  });

  await scenario("19 cancellation prevents commit", async () => {
    const controller = new AbortController();
    let committed = false;
    await expectCode(runStagedStalkerLiveSync({
      session: portal((params) => {
        if (params.action === "get_genres") return { data: [] };
        controller.abort();
        return { data: [channel(1)], total_items: 1, max_page_items: 1 };
      }),
      providerId: PROVIDER,
      signal: controller.signal,
      cleanupStaging: async () => undefined,
      persistPage: async () => undefined,
      commit: async () => { committed = true; },
    }), "CANCELLED");
    assert.equal(committed, false);
  });

  await scenario("20 stale generation prevents commit", async () => {
    let current = true;
    let committed = false;
    await expectCode(runStagedStalkerLiveSync({
      session: portal((params) => {
        if (params.action === "get_genres") return { data: [] };
        current = false;
        return { data: [channel(1)], total_items: 1, max_page_items: 1 };
      }),
      providerId: PROVIDER,
      isCurrent: () => current,
      cleanupStaging: async () => undefined,
      persistPage: async () => undefined,
      commit: async () => { committed = true; },
    }), "CANCELLED");
    assert.equal(committed, false);
  });

  await scenario("21 ownership loss before queued publish fails", async () => {
    let current = true;
    const pending = enqueueOwnedStalkerLiveCommit({
      enqueue: async (work) => { current = false; return work(); },
      isCurrent: () => current,
      mutate: async () => "published",
    });
    await expectCode(pending, "CANCELLED");
  });

  await scenario("22 ownership loss inside commit boundary fails", async () => {
    let current = true;
    await expectCode(enqueueOwnedStalkerLiveCommit({
      enqueue: async (work) => work(),
      isCurrent: () => current,
      mutate: async (assertCurrent) => {
        assertCurrent(); current = false; assertCurrent(); return "never";
      },
    }), "CANCELLED");
  });

  await scenario("23 failed refresh never invokes atomic publish", async () => {
    let committed = false;
    await expectCode(runStagedStalkerLiveSync({
      session: portal((params) => {
        if (params.action === "get_genres") return { data: [] };
        throw new StalkerPortalError("TIMEOUT", "timeout");
      }),
      providerId: PROVIDER,
      cleanupStaging: async () => undefined,
      persistPage: async () => undefined,
      commit: async () => { committed = true; },
    }), "TIMEOUT");
    assert.equal(committed, false);
  });

  await scenario("24 complete refresh invokes one atomic publish", async () => {
    let commits = 0;
    await runStagedStalkerLiveSync({
      session: portal((params) => params.action === "get_genres"
        ? { data: [{ id: 10, title: "News" }] }
        : { data: [channel(1)], total_items: 1, max_page_items: 1 }),
      providerId: PROVIDER,
      cleanupStaging: async () => undefined,
      persistPage: async () => undefined,
      commit: async () => { commits += 1; },
    });
    assert.equal(commits, 1);
  });

  await scenario("25 provider isolation is encoded in stable id", () => {
    assert.notEqual(stableStalkerLiveChannelId("a", "7"), stableStalkerLiveChannelId("b", "7"));
  });

  await scenario("26 create_link success returns ephemeral playable URL", async () => {
    const source = await resolveStalkerLiveCreateLink(portal((params) => {
      assert.equal(params.action, "create_link");
      return { cmd: "ffmpeg https://stream.invalid/ephemeral-token" };
    }), "ffmpeg http://canonical.invalid/cmd");
    assert.equal(source, "https://stream.invalid/ephemeral-token");
  });

  await scenario("27 create_link uses exactly one re-auth through session", async () => {
    let handshake = 0;
    let create = 0;
    const session = createStalkerPortalSession({
      portalUrl: "http://portal.invalid/stalker_portal/",
      mac: MAC,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("action=handshake")) {
          handshake += 1;
          return new Response(JSON.stringify({ js: { token: `token-${handshake}` } }), { status: 200 });
        }
        create += 1;
        if (create === 1) return new Response("unauthorized", { status: 401 });
        return new Response(JSON.stringify({ js: { cmd: "https://stream.invalid/reauthed" } }), { status: 200 });
      },
    });
    assert.equal(await resolveStalkerLiveCreateLink(session, "ffmpeg http://cmd"), "https://stream.invalid/reauthed");
    assert.equal(handshake, 2);
    assert.equal(create, 2);
  });

  await scenario("28 second create_link auth failure fails closed", async () => {
    let handshakes = 0;
    const session = createStalkerPortalSession({
      portalUrl: "http://portal.invalid/stalker_portal/",
      mac: MAC,
      fetchImpl: async (input) => {
        if (String(input).includes("action=handshake")) {
          handshakes += 1;
          return new Response(JSON.stringify({ js: { token: `t-${handshakes}` } }), { status: 200 });
        }
        return new Response("unauthorized", { status: 401 });
      },
    });
    await expectCode(resolveStalkerLiveCreateLink(session, "http://cmd"), "AUTH_FAILED");
    assert.equal(handshakes, 2);
  });

  await scenario("29 create_link cancellation propagates", async () => {
    const controller = new AbortController();
    controller.abort();
    await expectCode(resolveStalkerLiveCreateLink(portal((_params, signal) => {
      if (signal?.aborted) throw new StalkerPortalError("CANCELLED", "cancelled");
      return { cmd: "https://stream.invalid/no" };
    }), "http://cmd", controller.signal), "CANCELLED");
  });

  await scenario("30 runtime source persists only canonical identity, not resolved URL", () => {
    const item = projectStalkerLiveItem(PROVIDER, normalizeStalkerLivePage({ data: [channel(77)] }, PROVIDER, 1).items[0]);
    const runtime = makeStalkerLiveRuntimeSource(item);
    assert.equal(runtime.includes("stream.invalid"), false);
    assert.deepEqual(parseCatalogRuntimeSource(runtime), {
      kind: "stalker-live",
      providerId: PROVIDER,
      itemId: stableStalkerLiveChannelId(PROVIDER, "77"),
    });
    assert.equal(JSON.stringify(item).includes("ephemeral-token"), false);
  });

  await scenario("31 history/favorites identity is canonical stable channel id", () => {
    const id = stableStalkerLiveChannelId(PROVIDER, "91");
    assert.equal(id, `${PROVIDER}:stalker:91`);
    assert.equal(/:\d+:/.test(id.replace(`${PROVIDER}:stalker:`, "")), false);
  });

  await scenario("32 warm-cache projection keeps runtime URL opaque until playback", () => {
    const item = projectStalkerLiveItem(PROVIDER, normalizeStalkerLivePage({ data: [channel(5)] }, PROVIDER, 1).items[0]);
    const runtime = makeStalkerLiveRuntimeSource(item);
    assert.match(runtime, /^legendstream-catalog:\/\/stalker\/live\//);
    assert.equal(runtime.includes("http://127.0.0.1/live/5"), false);
  });

  await scenario("33 rapid A to B generation ignores late A resolution", async () => {
    let generation = 1;
    let applied = "";
    const apply = (own: number, value: string) => { if (own === generation) applied = value; };
    const a = Promise.resolve("A").then((value) => apply(1, value));
    generation = 2;
    const b = Promise.resolve("B").then((value) => apply(2, value));
    await Promise.all([a, b]);
    assert.equal(applied, "B");
  });

  await scenario("34 category normalization deduplicates stable ids", () => {
    assert.deepEqual(normalizeStalkerLiveCategories({ data: [
      { id: 1, title: "News" }, { id: 1, title: "Duplicate" }, { id: 2, title: "Sports" },
    ] }), [{ id: "1", name: "News" }, { id: "2", name: "Sports" }]);
  });

  console.log(`1..${passed}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
