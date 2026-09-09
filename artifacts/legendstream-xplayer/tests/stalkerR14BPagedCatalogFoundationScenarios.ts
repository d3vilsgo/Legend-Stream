import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootstrapStalkerProviderForLifecycle } from "../lib/stalkerCatalogBootstrap";
import {
  StalkerPagedCatalogController,
  chooseDefaultStalkerCategory,
  clearStalkerCategoryDialect,
  fetchStalkerOrderedPage,
  hasMoreStalkerOrderedPages,
  readStalkerCategoryDialect,
  type StalkerOrderedPage,
} from "../lib/stalkerPagedCatalog";
import { projectStalkerLiveItem, normalizeStalkerLivePage } from "../lib/stalkerLiveCatalog";
import { StalkerPortalError } from "../lib/stalkerPortal";
import { classifyStalkerDiagnosticAction } from "../lib/stalkerDiagnostics";

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function payload(ids: number[], total = ids.length, max = Math.max(1, ids.length), page = 1) {
  return {
    data: ids.map((id) => ({ id, name: `Item ${id}`, cmd: `ffmpeg opaque-${id}` })),
    total_items: total,
    max_page_items: max,
    cur_page: page,
  };
}

function fakeSession(handler: (params: Record<string, unknown>) => unknown | Promise<unknown>) {
  return { request: async (params: Record<string, unknown>) => handler(params) } as any;
}

function invalidDialect(status = 400) {
  return new StalkerPortalError("HTTP_ERROR", "dialect rejected", status);
}

type ControllerItem = { id: string; semantic: string };

function controllerItem(id: string, semantic = `cmd-${id}`): ControllerItem {
  return { id, semantic };
}

async function main() {
  await scenario("A provider bootstrap stops at handshake/profile/live categories", async () => {
    const calls: string[] = [];
    const result = await bootstrapStalkerProviderForLifecycle(
      { id: "provider-a", type: "stalker", url: "https://portal.invalid", mac: "00:1A:79:00:00:01" },
      {},
      {
        acquireSession: () => ({
          handshake: async () => { calls.push("handshake"); return { authenticated: true as const }; },
          request: async () => { throw new Error("unexpected direct request"); },
        }),
        bootstrapProfile: async () => { calls.push("get_profile"); return { supported: true as const, payload: { id: 1 } }; },
        fetchLiveCategories: async () => { calls.push("get_genres"); return [{ id: "10", name: "News" }]; },
        rememberLiveCategories: () => undefined,
      },
    );
    assert.deepEqual(calls, ["handshake", "get_profile", "get_genres"]);
    assert.equal(result?.cachedCatalogCount, 0);
    assert.equal(calls.includes("get_all_channels"), false);
    assert.equal(calls.includes("get_ordered_list"), false);
  });

  for (const [label, kind] of [["B Live", "itv"], ["C VOD", "vod"], ["D Series", "series"]] as const) {
    await scenario(`${label} requests p=1 immediately through common ordered-list`, async () => {
      clearStalkerCategoryDialect(`provider-${kind}`);
      const calls: Record<string, unknown>[] = [];
      const result = await fetchStalkerOrderedPage({
        session: fakeSession((params) => { calls.push(params); return payload([1], 2, 1, 1); }),
        providerId: `provider-${kind}`,
        kind,
        categoryId: "0",
        page: 1,
      });
      assert.equal(result.page, 1);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].type, kind);
      assert.equal(calls[0].action, "get_ordered_list");
      assert.equal(calls[0].p, 1);
    });
  }

  await scenario("E genre_id success is cached provider-scoped", async () => {
    clearStalkerCategoryDialect("dialect-e");
    await fetchStalkerOrderedPage({
      session: fakeSession(() => payload([1])),
      providerId: "dialect-e", kind: "itv", categoryId: "7", page: 1,
    });
    assert.equal(readStalkerCategoryDialect("dialect-e"), "genre_id");
  });

  await scenario("F genre_id failure probes genre sequentially", async () => {
    clearStalkerCategoryDialect("dialect-f");
    const calls: Record<string, unknown>[] = [];
    const result = await fetchStalkerOrderedPage({
      session: fakeSession((params) => {
        calls.push(params);
        if ("genre_id" in params) throw invalidDialect();
        return payload([1]);
      }),
      providerId: "dialect-f", kind: "itv", categoryId: "7", page: 1,
    });
    assert.equal(result.dialect, "genre");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].genre_id, "7");
    assert.equal(calls[1].genre, "7");
  });

  await scenario("G genre_id and genre failures probe dual last", async () => {
    clearStalkerCategoryDialect("dialect-g");
    const calls: Record<string, unknown>[] = [];
    const result = await fetchStalkerOrderedPage({
      session: fakeSession((params) => {
        calls.push(params);
        const dual = "genre" in params && "genre_id" in params;
        if (!dual) throw invalidDialect();
        return payload([1]);
      }),
      providerId: "dialect-g", kind: "vod", categoryId: "9", page: 1,
    });
    assert.equal(result.dialect, "dual");
    assert.equal(calls.length, 3);
    assert.equal(calls[2].genre, "9");
    assert.equal(calls[2].genre_id, "9");
  });

  await scenario("H successful dialect is reused on p=2 without reprobe", async () => {
    clearStalkerCategoryDialect("dialect-h");
    const calls: Record<string, unknown>[] = [];
    const session = fakeSession((params) => { calls.push(params); return payload([Number(params.p)], 2, 1, Number(params.p)); });
    await fetchStalkerOrderedPage({ session, providerId: "dialect-h", kind: "series", categoryId: "0", page: 1 });
    await fetchStalkerOrderedPage({ session, providerId: "dialect-h", kind: "series", categoryId: "0", page: 2 });
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.genre_id === "0" && !("genre" in call)));
  });

  await scenario("I total_items/max_page_items determine hasMore", () => {
    assert.equal(hasMoreStalkerOrderedPages({ page: 1, rowCount: 14, totalItems: 29, maxPageItems: 14 }), true);
    assert.equal(hasMoreStalkerOrderedPages({ page: 3, rowCount: 1, totalItems: 29, maxPageItems: 14 }), false);
  });

  await scenario("J ordered request never invents page-size parameters", async () => {
    clearStalkerCategoryDialect("params-j");
    let captured: Record<string, unknown> = {};
    await fetchStalkerOrderedPage({
      session: fakeSession((params) => { captured = params; return payload([1]); }),
      providerId: "params-j", kind: "itv", categoryId: "0", page: 1,
    });
    for (const forbidden of ["max_item", "limit", "page_size", "per_page"]) assert.equal(forbidden in captured, false);
    assert.deepEqual(Object.keys(captured).sort(), ["action", "genre_id", "p", "type"]);
  });

  await scenario("K repeated end-reached events start only one pending next page", async () => {
    let pageTwoCalls = 0;
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const controller = new StalkerPagedCatalogController({
      categoryId: "0",
      identityKey: (item: ControllerItem) => item.id,
      semanticKey: (item: ControllerItem) => item.semantic,
      fetchPage: async (page) => {
        if (page === 2) { pageTwoCalls += 1; await wait; }
        return { items: [controllerItem(String(page))], totalItems: 3, maxPageItems: 1, hasMore: page < 3, fingerprint: `page-${page}` };
      },
    });
    await controller.loadFirst();
    const first = controller.loadMore();
    const second = controller.loadMore();
    assert.equal(pageTwoCalls, 1);
    release();
    await Promise.all([first, second]);
  });

  await scenario("L same-page same-semantic duplicate is suppressed", async () => {
    const controller = new StalkerPagedCatalogController({
      categoryId: "0",
      identityKey: (item: ControllerItem) => item.id,
      semanticKey: (item: ControllerItem) => item.semantic,
      fetchPage: async () => ({
        items: [controllerItem("1", "same"), controllerItem("1", "same")],
        totalItems: 1, maxPageItems: 2, hasMore: false, fingerprint: "dup-same",
      }),
    });
    await controller.loadFirst();
    assert.equal(controller.snapshot().items.length, 1);
  });

  await scenario("M category switch aborts obsolete request", async () => {
    let oldAborted = false;
    const controller = new StalkerPagedCatalogController({
      categoryId: "1",
      identityKey: (item: ControllerItem) => item.id,
      semanticKey: (item: ControllerItem) => item.semantic,
      fetchPage: (page, category, signal) => new Promise((resolve, reject) => {
        if (category !== "1") return resolve({ items: [controllerItem("2")], totalItems: 1, maxPageItems: 1, hasMore: false, fingerprint: "new" });
        signal.addEventListener("abort", () => { oldAborted = true; reject(new StalkerPortalError("CANCELLED", "old")); }, { once: true });
      }),
    });
    const old = controller.loadFirst();
    await Promise.resolve();
    await controller.switchCategory("2");
    await old;
    assert.equal(oldAborted, true);
    assert.equal(controller.snapshot().categoryId, "2");
  });

  await scenario("N provider/unmount cancellation aborts active request", async () => {
    let aborted = false;
    const controller = new StalkerPagedCatalogController({
      categoryId: "0",
      identityKey: (item: ControllerItem) => item.id,
      semanticKey: (item: ControllerItem) => item.semantic,
      fetchPage: (_page, _category, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { aborted = true; reject(new StalkerPortalError("CANCELLED", "cancel")); }, { once: true });
      }),
    });
    const pending = controller.loadFirst();
    await Promise.resolve();
    controller.cancel();
    await pending;
    assert.equal(aborted, true);
    assert.equal(controller.snapshot().status, "CANCELLED");
  });

  await scenario("O empty first page terminates as END_REACHED", async () => {
    const controller = new StalkerPagedCatalogController({
      categoryId: "0",
      identityKey: (item: ControllerItem) => item.id,
      semanticKey: (item: ControllerItem) => item.semantic,
      fetchPage: async () => ({ items: [], totalItems: 0, maxPageItems: 14, hasMore: false, fingerprint: "empty" }),
    });
    await controller.loadFirst();
    assert.equal(controller.snapshot().status, "END_REACHED");
  });

  await scenario("P repeated page fingerprint fails bounded", async () => {
    const controller = new StalkerPagedCatalogController({
      categoryId: "0",
      identityKey: (item: ControllerItem) => item.id,
      semanticKey: (item: ControllerItem) => item.semantic,
      fetchPage: async (page) => ({ items: [controllerItem(String(page))], totalItems: 3, maxPageItems: 1, hasMore: true, fingerprint: "same-page" }),
    });
    await controller.loadFirst();
    await controller.loadMore();
    assert.equal(controller.snapshot().status, "ERROR");
  });

  await scenario("Q synthetic Tümü uses id=0 when zero-all is supported", () => {
    assert.deepEqual(chooseDefaultStalkerCategory([{ id: "7", name: "News" }], true), { id: "0", name: "Tümü", synthetic: true });
  });

  await scenario("R first concrete category is selected when zero-all is unavailable", () => {
    assert.deepEqual(chooseDefaultStalkerCategory([{ id: "7", name: "News" }, { id: "8", name: "Sport" }], false), { id: "7", name: "News", synthetic: false });
  });

  await scenario("S revisiting a loaded category exposes cached p=1 before refresh resolves", async () => {
    let calls = 0;
    const controller = new StalkerPagedCatalogController({
      categoryId: "0",
      identityKey: (item: ControllerItem) => item.id,
      semanticKey: (item: ControllerItem) => item.semantic,
      fetchPage: async (_page, category) => {
        calls += 1;
        return { items: [controllerItem(category)], totalItems: 1, maxPageItems: 1, hasMore: false, fingerprint: `${category}-${calls}` };
      },
    });
    await controller.loadFirst();
    await controller.switchCategory("1");
    const revisit = controller.switchCategory("0");
    assert.equal(controller.snapshot().items[0]?.id, "0");
    await revisit;
  });

  await scenario("T same id and same semantic reference keeps first canonical occurrence", async () => {
    const controller = new StalkerPagedCatalogController({
      categoryId: "0",
      identityKey: (item: ControllerItem) => item.id,
      semanticKey: (item: ControllerItem) => item.semantic,
      fetchPage: async (page) => ({
        items: [controllerItem("1", "cmd-a")], totalItems: 2, maxPageItems: 1, hasMore: page === 1, fingerprint: `t-${page}`,
      }),
    });
    await controller.loadFirst();
    await controller.loadMore();
    assert.equal(controller.snapshot().items.length, 1);
  });

  await scenario("U same id with different semantic reference fails bounded", async () => {
    const controller = new StalkerPagedCatalogController({
      categoryId: "0",
      identityKey: (item: ControllerItem) => item.id,
      semanticKey: (item: ControllerItem) => item.semantic,
      fetchPage: async (page) => ({
        items: [controllerItem("1", page === 1 ? "cmd-a" : "cmd-b")], totalItems: 2, maxPageItems: 1, hasMore: page === 1, fingerprint: `u-${page}`,
      }),
    });
    await controller.loadFirst();
    await controller.loadMore();
    assert.equal(controller.snapshot().status, "ERROR");
  });

  await scenario("V normal ordered-list success never calls get_all fallback", async () => {
    clearStalkerCategoryDialect("normal-v");
    let fallbackCalls = 0;
    await fetchStalkerOrderedPage({
      session: fakeSession(() => payload([1])),
      providerId: "normal-v", kind: "itv", categoryId: "0", page: 1,
      compatibilityFallback: async () => { fallbackCalls += 1; throw new Error("unexpected fallback"); },
    });
    assert.equal(fallbackCalls, 0);
  });

  await scenario("W get_all compatibility fallback is bounded to first-page ordered failure", async () => {
    clearStalkerCategoryDialect("fallback-w");
    let orderedCalls = 0;
    let fallbackCalls = 0;
    const fallbackPage: StalkerOrderedPage = {
      kind: "itv", categoryId: "0", page: 1, payload: payload([1]), rows: [{ id: 1 }],
      totalItems: 1, maxPageItems: 1, currentPage: 1, hasMore: false,
      dialect: "genre_id", compatibilityFallback: true,
    };
    const result = await fetchStalkerOrderedPage({
      session: fakeSession(() => { orderedCalls += 1; throw invalidDialect(); }),
      providerId: "fallback-w", kind: "itv", categoryId: "0", page: 1,
      compatibilityFallback: async () => { fallbackCalls += 1; return fallbackPage; },
    });
    assert.equal(orderedCalls, 3);
    assert.equal(fallbackCalls, 1);
    assert.equal(result.compatibilityFallback, true);
  });

  await scenario("X existing Live playback reference remains stalker-live portalId+cmd", () => {
    const page = normalizeStalkerLivePage(payload([42]), "provider-x", 1, []);
    const persisted = projectStalkerLiveItem("provider-x", page.items[0]);
    assert.deepEqual(persisted.playbackRef, { type: "stalker-live", portalId: "42", cmd: "ffmpeg opaque-42" });
  });

  await scenario("Y R14-B foundation contains no M3U or Xtream behavior branch", () => {
    const source = fs.readFileSync(path.resolve("lib/stalkerPagedCatalog.ts"), "utf8");
    assert.doesNotMatch(source, /\bm3u\b/i);
    assert.doesNotMatch(source, /\bxtream\b/i);
  });

  await scenario("Z R14-A diagnostic action classifier remains safe and compiling", () => {
    assert.equal(classifyStalkerDiagnosticAction("get_all_channels"), "get_all_channels");
    assert.equal(classifyStalkerDiagnosticAction("get_ordered_list"), "get_ordered_list");
    assert.equal(classifyStalkerDiagnosticAction("https://secret.invalid"), "other");
  });

  assert.equal(passed, 26);
  console.log(`R14-B paged catalog foundation scenarios passed: ${passed}/26`);
}

void main();
