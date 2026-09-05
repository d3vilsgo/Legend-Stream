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
import {
  buildCatalogPageSql,
  catalogPageQueryKey,
  type CatalogPageRequest,
} from "../lib/catalogPaging";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type CapturedRequest = { url: string; init?: RequestInit };
type Responder = (request: CapturedRequest, index: number) => Response | Promise<Response>;

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
    const request = { url: input instanceof Request ? input.url : String(input), init };
    const index = requests.length;
    requests.push(request);
    const responder = responders[index];
    if (!responder) throw new Error(`Unexpected request ${index + 1}.`);
    return responder(request, index);
  };
  return { fetchImpl, requests };
}

function abortingResponse(request: CapturedRequest): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const abort = () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    const signal = request.init?.signal;
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
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

const PROVIDER = "stalker-provider";
const MAC = "00:1A:79:12:34:56";
const TOKEN_1 = "secret-session-token-one";
const TOKEN_2 = "secret-session-token-two";

function channel(id: string | number, category = "10", extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Channel ${id}`,
    tv_genre_id: category,
    cmd: `ffmpeg http://localhost/ch/${id}_`,
    ...extra,
  };
}

function fakePortal(
  responder: (params: Record<string, string | number | boolean | undefined>, signal?: AbortSignal) => unknown | Promise<unknown>,
) {
  return {
    request: async (
      params: Record<string, string | number | boolean | undefined>,
      signal?: AbortSignal,
    ) => responder(params, signal),
  };
}

async function main() {
  await scenario("Live category fetch normalizes stable id and name", async () => {
    const calls: Record<string, unknown>[] = [];
    const session = fakePortal((params) => {
      calls.push(params);
      return { data: [{ id: "10", title: "News" }, { id: 20, name: "Sports" }] };
    });
    const categories = await fetchStalkerLiveCategories(session);
    assert.deepEqual(categories, [{ id: "10", name: "News" }, { id: "20", name: "Sports" }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, "itv");
    assert.equal(calls[0].action, "get_genres");
  });

  await scenario("category response variants dedupe by stable category id", () => {
    const categories = normalizeStalkerLiveCategories({
      data: {
        genres: [
          { genre_id: "5", genre_name: "Kids" },
          { genre_id: "5", genre_name: "Duplicate" },
          { category_id: "6", category_name: "Music" },
        ],
      },
    });
    assert.deepEqual(categories, [
      { id: "5", name: "Kids" },
      { id: "6", name: "Music" },
    ]);
  });

  await scenario("category capability absence fails open only for empty shape and HTTP 404/405", async () => {
    assert.deepEqual(await fetchStalkerLiveCategories(fakePortal(() => ({ unsupported: true }))), []);
    for (const status of [404, 405]) {
      const categories = await fetchStalkerLiveCategories(fakePortal(() => {
        throw new StalkerPortalError("HTTP_ERROR", "category capability unavailable", status);
      }));
      assert.deepEqual(categories, []);
    }

    const events: string[] = [];
    const completed = await runStagedStalkerLiveSync({
      session: fakePortal((params) => {
        if (params.action === "get_genres") {
          throw new StalkerPortalError("HTTP_ERROR", "category capability unavailable", 404);
        }
        return { data: [channel(1, "99")], total_items: 1, max_page_items: 1 };
      }),
      providerId: PROVIDER,
      cleanupStaging: async () => { events.push("cleanup"); },
      persistPage: async (items) => { events.push(`persist-${items.length}`); },
      commit: async (categories) => { events.push(`commit-categories-${categories.length}`); },
    });
    assert.equal(completed.categories.length, 0);
    assert.equal(completed.result.persisted, 1);
    assert.deepEqual(events, ["cleanup", "persist-1", "commit-categories-0", "cleanup"]);
  });

  await scenario("category transport and auth failures remain fail closed", async () => {
    const failures: Array<StalkerPortalError> = [
      new StalkerPortalError("AUTH_FAILED", "auth failed", 401),
      new StalkerPortalError("AUTH_FAILED", "auth failed", 403),
      new StalkerPortalError("TIMEOUT", "timeout"),
      new StalkerPortalError("CANCELLED", "cancelled"),
      new StalkerPortalError("NETWORK_ERROR", "network"),
      new StalkerPortalError("HTTP_ERROR", "server", 500),
      new StalkerPortalError("INVALID_RESPONSE", "invalid json"),
    ];
    for (const failure of failures) {
      await expectCode(fetchStalkerLiveCategories(fakePortal(() => { throw failure; })), failure.code);
    }
  });

  await scenario("canonical channel identity is independent from page order", () => {
    const categories = [{ id: "10", name: "News" }];
    const first = normalizeStalkerLivePage({ data: [channel(77), channel(88)] }, PROVIDER, 1, categories);
    const second = normalizeStalkerLivePage({ data: [channel(88), channel(77)] }, PROVIDER, 2, categories);
    assert.equal(first.items[0].id, stableStalkerLiveChannelId(PROVIDER, "77"));
    assert.equal(first.items[0].id, second.items[1].id);
    assert.equal(first.items[0].categoryId, "10");
    assert.equal(first.items[0].categoryName, "News");
  });

  await scenario("total_items and max_page_items traverse all required pages", async () => {
    const pages: number[] = [];
    const persisted: string[][] = [];
    const session = fakePortal((params) => {
      if (params.action === "get_ordered_list") {
        const p = Number(params.p);
        pages.push(p);
        return p === 1
          ? { data: [channel(1), channel(2)], total_items: 3, max_page_items: 2 }
          : { data: [channel(3)], total_items: 3, max_page_items: 2 };
      }
      return [];
    });
    const result = await traverseStalkerLivePages({
      session,
      providerId: PROVIDER,
      persistPage: async (items) => {
        persisted.push(items.map((item) => item.id));
      },
    });
    assert.deepEqual(pages, [1, 2]);
    assert.deepEqual(persisted.map((rows) => rows.length), [2, 1]);
    assert.equal(result.uniqueItems, 3);
    assert.equal(result.persisted, 3);
  });

  await scenario("metadata-less pagination continues until an empty page", async () => {
    const pages: number[] = [];
    const session = fakePortal((params) => {
      const p = Number(params.p);
      pages.push(p);
      if (p === 1) return { data: [channel(1), channel(2)] };
      if (p === 2) return { data: [channel(3)] };
      return { data: [] };
    });
    const result = await traverseStalkerLivePages({
      session,
      providerId: PROVIDER,
      persistPage: async () => undefined,
    });
    assert.deepEqual(pages, [1, 2, 3]);
    assert.equal(result.uniqueItems, 3);
  });

  await scenario("pagination hard ceiling policy is finite and test-overridable", () => {
    assert.ok(Number.isInteger(MAX_STALKER_LIVE_PAGES));
    assert.ok(MAX_STALKER_LIVE_PAGES >= 1_000);
    assert.equal(stalkerLivePageCeilingExceeded(3, 3), false);
    assert.equal(stalkerLivePageCeilingExceeded(4, 3), true);
  });

  await scenario("pagination hard ceiling fails closed without committing staged rows", async () => {
    let requests = 0;
    let commits = 0;
    let cleanups = 0;
    let staged: string[] = [];
    const committed = ["old-1", "old-2"];
    await expectCode(runStagedStalkerLiveSync({
      session: fakePortal((params) => {
        if (params.action === "get_genres") return { unsupported: true };
        requests += 1;
        return { data: [channel(requests)] };
      }),
      providerId: PROVIDER,
      maxPages: 3,
      cleanupStaging: async () => {
        cleanups += 1;
        staged = [];
      },
      persistPage: async (items) => { staged.push(...items.map((item) => item.id)); },
      commit: async () => { commits += 1; },
    }), "INVALID_RESPONSE");
    assert.equal(requests, 3);
    assert.equal(commits, 0);
    assert.equal(cleanups, 2);
    assert.deepEqual(staged, []);
    assert.deepEqual(committed, ["old-1", "old-2"]);
  });

  await scenario("empty first page stops without persistence", async () => {
    let writes = 0;
    const session = fakePortal(() => ({ data: [] }));
    const result = await traverseStalkerLivePages({
      session,
      providerId: PROVIDER,
      persistPage: async () => { writes += 1; },
    });
    assert.equal(writes, 0);
    assert.equal(result.uniqueItems, 0);
  });

  await scenario("repeated page fingerprint stops portals that ignore p", async () => {
    let requests = 0;
    let writes = 0;
    const session = fakePortal(() => {
      requests += 1;
      return { data: [channel(1), channel(2)] };
    });
    const result = await traverseStalkerLivePages({
      session,
      providerId: PROVIDER,
      persistPage: async () => { writes += 1; },
    });
    assert.equal(requests, 2);
    assert.equal(writes, 1);
    assert.equal(result.uniqueItems, 2);
  });

  await scenario("no-progress page stops even when row order changes", async () => {
    let requests = 0;
    const session = fakePortal(() => {
      requests += 1;
      return requests === 1
        ? { data: [channel(1), channel(2)] }
        : { data: [channel(2), channel(1)] };
    });
    const result = await traverseStalkerLivePages({
      session,
      providerId: PROVIDER,
      persistPage: async () => undefined,
    });
    assert.equal(requests, 2);
    assert.equal(result.uniqueItems, 2);
  });

  await scenario("duplicate stable channel ids are persisted exactly once", async () => {
    const ids: string[] = [];
    const session = fakePortal(() => ({
      data: [channel(1), channel(1), channel(2)],
      total_items: 2,
      max_page_items: 3,
    }));
    const result = await traverseStalkerLivePages({
      session,
      providerId: PROVIDER,
      persistPage: async (items) => {
        ids.push(...items.map((item) => item.id));
      },
    });
    assert.deepEqual(ids, [
      stableStalkerLiveChannelId(PROVIDER, "1"),
      stableStalkerLiveChannelId(PROVIDER, "2"),
    ]);
    assert.equal(result.persisted, 2);
  });

  await scenario("external cancellation after page persistence prevents remaining fetches", async () => {
    const controller = new AbortController();
    let requests = 0;
    const session = fakePortal(() => {
      requests += 1;
      return { data: [channel(requests)], total_items: 5, max_page_items: 1 };
    });
    await expectCode(traverseStalkerLivePages({
      session,
      providerId: PROVIDER,
      signal: controller.signal,
      persistPage: async () => controller.abort(),
    }), "CANCELLED");
    assert.equal(requests, 1);
  });

  await scenario("stale ownership after first page prevents final commit", async () => {
    let current = true;
    let commits = 0;
    let cleanups = 0;
    const session = fakePortal((params) => {
      if (params.action === "get_genres") return { data: [{ id: "10", title: "News" }] };
      return { data: [channel(1)], total_items: 1, max_page_items: 1 };
    });
    await expectCode(runStagedStalkerLiveSync({
      session,
      providerId: PROVIDER,
      isCurrent: () => current,
      cleanupStaging: async () => { cleanups += 1; },
      persistPage: async () => { current = false; },
      commit: async () => { commits += 1; },
    }), "CANCELLED");
    assert.equal(commits, 0);
    assert.equal(cleanups, 2);
  });

  await scenario("queued commit rechecks ownership before any DB mutation", async () => {
    let current = true;
    let releaseQueue!: () => void;
    const queued = new Promise<void>((resolve) => { releaseQueue = resolve; });
    let mutations = 0;
    const pending = enqueueOwnedStalkerLiveCommit({
      enqueue: async (work) => {
        await queued;
        return work();
      },
      isCurrent: () => current,
      mutate: async (assertCurrent) => {
        mutations += 1;
        assertCurrent();
      },
    });
    current = false;
    releaseQueue();
    await expectCode(pending, "CANCELLED");
    assert.equal(mutations, 0);
  });

  await scenario("transaction ownership loss throws so the mutation can roll back", async () => {
    let current = true;
    let active = ["old-1", "old-2"];
    await expectCode(enqueueOwnedStalkerLiveCommit({
      enqueue: async (work) => work(),
      isCurrent: () => current,
      mutate: async (assertCurrent) => {
        const before = [...active];
        try {
          assertCurrent();
          active = [];
          await Promise.resolve();
          current = false;
          assertCurrent();
          active = ["new-1"];
        } catch (caught) {
          active = before;
          throw caught;
        }
      },
    }), "CANCELLED");
    assert.deepEqual(active, ["old-1", "old-2"]);
  });

  await scenario("failed staged sync preserves old committed cache", async () => {
    let committed = ["old-1", "old-2"];
    let staged: string[] = [];
    let page = 0;
    const session = fakePortal((params) => {
      if (params.action === "get_genres") return { data: [{ id: "10", title: "News" }] };
      page += 1;
      if (page === 1) return { data: [channel(1)] };
      throw new StalkerPortalError("NETWORK_ERROR", "Stalker portal could not be reached.");
    });
    await expectCode(runStagedStalkerLiveSync({
      session,
      providerId: PROVIDER,
      cleanupStaging: async () => { staged = []; },
      persistPage: async (items) => { staged.push(...items.map((item) => item.id)); },
      commit: async () => { committed = [...staged]; },
    }), "NETWORK_ERROR");
    assert.deepEqual(committed, ["old-1", "old-2"]);
    assert.deepEqual(staged, []);
  });

  await scenario("provider A and B identities and staged rows remain isolated", async () => {
    const a = projectStalkerLiveItem("provider-a", normalizeStalkerLivePage({ data: [channel(7)] }, "provider-a", 1).items[0]);
    const b = projectStalkerLiveItem("provider-b", normalizeStalkerLivePage({ data: [channel(7)] }, "provider-b", 1).items[0]);
    assert.notEqual(a.id, b.id);
    assert.equal(a.providerId, "provider-a");
    assert.equal(b.providerId, "provider-b");
    assert.equal(a.playbackRef.type, "stalker-live");
    assert.equal(b.playbackRef.type, "stalker-live");
  });

  await scenario("remote pages persist and yield before the next fetch", async () => {
    const events: string[] = [];
    const session = fakePortal((params) => {
      const p = Number(params.p);
      events.push(`fetch-${p}`);
      return p <= 2 ? { data: [channel(p)], max_page_items: 1 } : { data: [] };
    });
    await traverseStalkerLivePages({
      session,
      providerId: PROVIDER,
      persistPage: async (_items, pageInfo) => { events.push(`persist-${pageInfo.page}`); },
      yieldFn: async () => { events.push("yield"); },
    });
    assert.deepEqual(events, [
      "fetch-1", "persist-1", "yield",
      "fetch-2", "persist-2", "yield",
      "fetch-3",
    ]);
  });

  await scenario("Stalker category and search requests stay SQL-paged", () => {
    const request: CatalogPageRequest = {
      providerId: PROVIDER,
      providerType: "stalker",
      kind: "live",
      categoryId: "10",
      search: "Haber",
      sort: "default",
      limit: 100,
    };
    const plan = buildCatalogPageSql(request);
    assert.match(plan.countSql, /provider_id = \? AND kind = \? AND category_id = \?/);
    assert.match(plan.countSql, /name LIKE \?/);
    assert.equal(plan.limit, 100);
    assert.deepEqual(plan.countArgs.slice(0, 3), [PROVIDER, "live", "10"]);
    assert.ok(plan.countArgs.some((value) => String(value).includes("Haber")));
  });

  await scenario("Stalker paging identity is provider-scoped and distinct", () => {
    const stalker = catalogPageQueryKey({ providerId: "a", providerType: "stalker", kind: "live", sort: "default" });
    const stalkerB = catalogPageQueryKey({ providerId: "b", providerType: "stalker", kind: "live", sort: "default" });
    const xtream = catalogPageQueryKey({ providerId: "a", providerType: "xtream", kind: "live", sort: "default" });
    assert.notEqual(stalker, stalkerB);
    assert.notEqual(stalker, xtream);
  });

  await scenario("create_link resolves a playable ephemeral URL", async () => {
    const mock = queuedFetch([
      () => json({ js: { token: TOKEN_1 } }),
      () => json({ js: { cmd: "ffmpeg https://stream.example/live/7.m3u8" } }),
    ]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: mock.fetchImpl });
    const resolved = await resolveStalkerLiveCreateLink(session, "ffmpeg http://localhost/ch/7_");
    assert.equal(resolved, "https://stream.example/live/7.m3u8");
    assert.equal(mock.requests.length, 2);
    assert.equal(new URL(mock.requests[1].url).searchParams.get("action"), "create_link");
  });

  await scenario("create_link auth expiry performs exactly one re-handshake", async () => {
    const mock = queuedFetch([
      () => json({ token: TOKEN_1 }),
      () => new Response("", { status: 401 }),
      () => json({ token: TOKEN_2 }),
      () => json({ cmd: "https://stream.example/live/8.ts" }),
    ]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: mock.fetchImpl });
    assert.equal(await resolveStalkerLiveCreateLink(session, "ffmpeg http://localhost/ch/8_"), "https://stream.example/live/8.ts");
    const handshakes = mock.requests.filter((request) => new URL(request.url).searchParams.get("action") === "handshake");
    assert.equal(handshakes.length, 2);
    assert.equal(mock.requests.length, 4);
  });

  await scenario("second create_link auth failure fails closed", async () => {
    const mock = queuedFetch([
      () => json({ token: TOKEN_1 }),
      () => new Response("", { status: 401 }),
      () => json({ token: TOKEN_2 }),
      () => new Response("", { status: 403 }),
    ]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: mock.fetchImpl });
    await expectCode(resolveStalkerLiveCreateLink(session, "ffmpeg http://localhost/ch/9_"), "AUTH_FAILED");
    assert.equal(mock.requests.length, 4);
  });

  await scenario("create_link external cancellation is deterministic and never retries auth", async () => {
    const controller = new AbortController();
    const mock = queuedFetch([
      () => json({ token: TOKEN_1 }),
      (request) => abortingResponse(request),
    ]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: mock.fetchImpl, timeoutMs: 1_000 });
    const pending = resolveStalkerLiveCreateLink(session, "ffmpeg http://localhost/ch/10_", controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expectCode(pending, "CANCELLED");
    assert.equal(mock.requests.length, 2);
  });

  await scenario("create_link timeout is deterministic and never retries auth", async () => {
    const mock = queuedFetch([
      () => json({ token: TOKEN_1 }),
      (request) => abortingResponse(request),
    ]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: mock.fetchImpl, timeoutMs: 5 });
    await expectCode(resolveStalkerLiveCreateLink(session, "ffmpeg http://localhost/ch/11_"), "TIMEOUT");
    assert.equal(mock.requests.length, 2);
  });

  await scenario("resolved create_link URL never enters persisted canonical payload", async () => {
    const normalized = normalizeStalkerLivePage({ data: [channel(12)] }, PROVIDER, 1).items[0];
    const persisted = projectStalkerLiveItem(PROVIDER, normalized);
    const mock = queuedFetch([
      () => json({ token: TOKEN_1 }),
      () => json({ cmd: "https://ephemeral.example/tokenized/12.ts?token=secret" }),
    ]);
    const session = createStalkerPortalSession({ portalUrl: "https://portal.example", mac: MAC, fetchImpl: mock.fetchImpl });
    const resolved = await resolveStalkerLiveCreateLink(session, normalized.cmd);
    assert.match(resolved, /ephemeral\.example/);
    const serialized = JSON.stringify(persisted);
    assert.equal(serialized.includes("ephemeral.example"), false);
    assert.equal(serialized.includes("tokenized"), false);
    assert.equal(persisted.playbackRef.type, "stalker-live");
  });

  await scenario("M3U paging SQL semantics remain unchanged", () => {
    const plan = buildCatalogPageSql({
      providerId: "m3u-a",
      providerType: "m3u",
      kind: "live",
      categoryId: "News",
      search: "TRT",
      sort: "default",
      limit: 100,
    });
    assert.deepEqual(plan.countArgs.slice(0, 3), ["m3u-a", "live", "News"]);
    assert.match(plan.pageSql, /ORDER BY rowid ASC LIMIT \?/);
    assert.equal(plan.limit, 100);
  });

  await scenario("Xtream paging SQL semantics remain unchanged", () => {
    const plan = buildCatalogPageSql({
      providerId: "xtream-a",
      providerType: "xtream",
      kind: "live",
      categoryId: "7",
      search: "Sport",
      sort: "alphaAsc",
      limit: 100,
    });
    assert.deepEqual(plan.countArgs.slice(0, 3), ["xtream-a", "live", "7"]);
    assert.match(plan.pageSql, /ORDER BY name COLLATE NOCASE ASC, item_id ASC LIMIT \?/);
    assert.equal(plan.limit, 100);
  });

  await scenario("successful staged sync commits only after all pages complete", async () => {
    const events: string[] = [];
    let page = 0;
    const session = fakePortal((params) => {
      if (params.action === "get_genres") {
        events.push("categories");
        return { data: [{ id: "10", title: "News" }] };
      }
      page += 1;
      events.push(`fetch-${page}`);
      return page === 1
        ? { data: [channel(1)], total_items: 2, max_page_items: 1 }
        : { data: [channel(2)], total_items: 2, max_page_items: 1 };
    });
    const result = await runStagedStalkerLiveSync({
      session,
      providerId: PROVIDER,
      cleanupStaging: async () => { events.push("cleanup"); },
      persistPage: async (_items, pageInfo) => { events.push(`persist-${pageInfo.page}`); },
      yieldFn: async () => { events.push("yield"); },
      commit: async (_categories, traversal) => { events.push(`commit-${traversal.persisted}`); },
    });
    assert.equal(result.result.persisted, 2);
    assert.deepEqual(events, [
      "cleanup", "categories", "fetch-1", "persist-1", "yield",
      "fetch-2", "persist-2", "yield", "commit-2", "cleanup",
    ]);
  });

  await scenario("primary sync error is preserved when cleanup also fails", async () => {
    let cleanupCalls = 0;
    const session = fakePortal((params) => {
      if (params.action === "get_genres") return { data: [{ id: "10", title: "News" }] };
      throw new StalkerPortalError("NETWORK_ERROR", "Stalker portal could not be reached.");
    });
    const error = await expectCode(runStagedStalkerLiveSync({
      session,
      providerId: PROVIDER,
      cleanupStaging: async () => {
        cleanupCalls += 1;
        if (cleanupCalls === 2) throw new Error("cleanup failed");
      },
      persistPage: async () => undefined,
      commit: async () => undefined,
    }), "NETWORK_ERROR");
    assert.equal(error.message, "Stalker portal could not be reached.");
    assert.equal(cleanupCalls, 2);
  });

  assert.equal(passed, 32);
  console.log("stalker live catalog scenarios: 32/32 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
