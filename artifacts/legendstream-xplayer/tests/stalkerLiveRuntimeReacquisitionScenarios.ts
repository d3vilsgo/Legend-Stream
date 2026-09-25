import assert from "node:assert/strict";
import { StalkerPortalError } from "../lib/stalkerPortal";
import {
  clearStalkerLiveRuntimeLocators,
  readStalkerLiveRuntimeLocator,
  reacquireStalkerLiveChannel,
  registerStalkerLiveRuntimeLocators,
} from "../lib/stalkerLiveRuntimeLocator";
import {
  normalizeStalkerLivePage,
  projectStalkerLiveItem,
  resolveStalkerLiveRuntimeCmd,
} from "../lib/stalkerLiveCatalog";

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  clearStalkerLiveRuntimeLocators();
  await run();
  passed += 1;
  process.stdout.write(`ok ${passed} - ${name}\n`);
}
const session = () => ({ request: async () => ({}) });
function page(p: number, ids: number[], opts: { prefix?: string; category?: string; more?: boolean } = {}) {
  const categoryId = opts.category ?? "10";
  const prefix = opts.prefix ?? "fresh";
  return {
    kind: "itv" as const,
    categoryId,
    page: p,
    payload: { data: ids.map((id) => ({ id, name: `Channel ${id}`, tv_genre_id: categoryId, cmd: `ffmpeg ${prefix}-${id}` })) },
    rows: [],
    totalItems: null,
    maxPageItems: null,
    currentPage: p,
    hasMore: opts.more ?? false,
    dialect: "genre_id" as const,
    compatibilityFallback: false,
  };
}

async function main() {
  await scenario("A locator stores no CMD URL token MAC or credential material", () => {
    const s = session();
    registerStalkerLiveRuntimeLocators(s, "provider-a", "10", 3, [{ portalId: "101" }]);
    const locator = readStalkerLiveRuntimeLocator(s, "provider-a", "101");
    assert.deepEqual(locator, { providerId: "provider-a", categoryId: "10", page: 3 });
    assert.doesNotMatch(JSON.stringify(locator), /cmd|url|token|cookie|authorization|bearer|mac/i);
  });

  await scenario("B exact-page hit is one ordered request and zero full discovery", async () => {
    const s = session();
    registerStalkerLiveRuntimeLocators(s, "provider-a", "10", 3, [{ portalId: "101" }]);
    const seen: number[] = []; let full = 0;
    const result = await reacquireStalkerLiveChannel(
      { session: s, providerId: "provider-a", portalId: "101" },
      {
        fetchOrderedPage: async (input) => { seen.push(input.page); return page(input.page, [101]); },
        fullDiscover: async () => { full += 1; return { rows: [] }; },
      },
    );
    assert.equal(result.source, "EXACT_PAGE");
    assert.equal(result.channel.cmd, "ffmpeg fresh-101");
    assert.deepEqual(seen, [3]);
    assert.equal(full, 0);
  });

  await scenario("C playback-time fresh CMD wins over old page-time value", async () => {
    const s = session();
    registerStalkerLiveRuntimeLocators(s, "provider-a", "10", 1, [{ portalId: "101" }]);
    const result = await reacquireStalkerLiveChannel(
      { session: s, providerId: "provider-a", portalId: "101" },
      { fetchOrderedPage: async () => page(1, [101], { prefix: "playback-time" }) },
    );
    assert.equal(result.channel.cmd, "ffmpeg playback-time-101");
    assert.notEqual(result.channel.cmd, "ffmpeg page-time-101");
  });

  await scenario("D session/provider mismatch cannot consume locator", () => {
    const a = session(), b = session();
    registerStalkerLiveRuntimeLocators(a, "provider-a", "10", 1, [{ portalId: "101" }]);
    assert.equal(readStalkerLiveRuntimeLocator(b, "provider-a", "101"), null);
    assert.equal(readStalkerLiveRuntimeLocator(a, "provider-b", "101"), null);
  });

  await scenario("E provider switch epoch invalidates old locator", () => {
    const s = session();
    registerStalkerLiveRuntimeLocators(s, "provider-a", "10", 1, [{ portalId: "101" }]);
    clearStalkerLiveRuntimeLocators();
    assert.equal(readStalkerLiveRuntimeLocator(s, "provider-a", "101"), null);
  });

  await scenario("F exact miss searches category, finds moved page, refreshes locator", async () => {
    const s = session(); const calls: number[] = [];
    registerStalkerLiveRuntimeLocators(s, "provider-a", "10", 3, [{ portalId: "101" }]);
    const result = await reacquireStalkerLiveChannel(
      { session: s, providerId: "provider-a", portalId: "101" },
      { fetchOrderedPage: async (input) => {
        calls.push(input.page);
        if (input.page === 3) return page(3, [303]);
        if (input.page === 1) return page(1, [111], { more: true });
        return page(2, [101], { prefix: "moved", more: true });
      } },
    );
    assert.equal(result.source, "CATEGORY");
    assert.equal(result.channel.cmd, "ffmpeg moved-101");
    assert.deepEqual(calls, [3, 1, 2]);
    assert.equal(readStalkerLiveRuntimeLocator(s, "provider-a", "101")?.page, 2);
  });

  await scenario("G category miss reaches full discovery", async () => {
    const s = session(); let full = 0;
    registerStalkerLiveRuntimeLocators(s, "provider-a", "10", 1, [{ portalId: "101" }]);
    const result = await reacquireStalkerLiveChannel(
      { session: s, providerId: "provider-a", portalId: "101" },
      {
        fetchOrderedPage: async () => page(1, [999]),
        fullDiscover: async () => { full += 1; return { rows: [{ portalId: "101", cmd: "ffmpeg full-101" }] }; },
      },
    );
    assert.equal(result.source, "FULL_DISCOVERY"); assert.equal(full, 1);
  });

  await scenario("H no locator retains full compatibility path", async () => {
    const s = session(); let ordered = 0;
    const result = await reacquireStalkerLiveChannel(
      { session: s, providerId: "provider-a", portalId: "101" },
      {
        fetchOrderedPage: async () => { ordered += 1; return page(1, [101]); },
        fullDiscover: async () => ({ rows: [{ portalId: "101", cmd: "ffmpeg full-101" }] }),
      },
    );
    assert.equal(result.source, "FULL_DISCOVERY"); assert.equal(ordered, 0);
  });

  await scenario("I targeted API unsupported falls back safely", async () => {
    const s = session();
    registerStalkerLiveRuntimeLocators(s, "provider-a", "10", 1, [{ portalId: "101" }]);
    const result = await reacquireStalkerLiveChannel(
      { session: s, providerId: "provider-a", portalId: "101" },
      {
        fetchOrderedPage: async () => { throw new StalkerPortalError("HTTP_ERROR", "unsupported", 405); },
        fullDiscover: async () => ({ rows: [{ portalId: "101", cmd: "ffmpeg full-101" }] }),
      },
    );
    assert.equal(result.source, "FULL_DISCOVERY");
  });

  await scenario("J abort exact page does not continue to fallback", async () => {
    const s = session(); const ac = new AbortController(); let full = 0;
    registerStalkerLiveRuntimeLocators(s, "provider-a", "10", 1, [{ portalId: "101" }]);
    await assert.rejects(reacquireStalkerLiveChannel(
      { session: s, providerId: "provider-a", portalId: "101", signal: ac.signal },
      {
        fetchOrderedPage: async () => { ac.abort(); throw new StalkerPortalError("CANCELLED", "cancelled"); },
        fullDiscover: async () => { full += 1; return { rows: [] }; },
      },
    ), (e: unknown) => e instanceof StalkerPortalError && e.code === "CANCELLED");
    assert.equal(full, 0);
  });

  await scenario("K abort category does not continue to full discovery", async () => {
    const s = session(); const ac = new AbortController(); let full = 0;
    registerStalkerLiveRuntimeLocators(s, "provider-a", "10", 2, [{ portalId: "101" }]);
    await assert.rejects(reacquireStalkerLiveChannel(
      { session: s, providerId: "provider-a", portalId: "101", signal: ac.signal },
      {
        fetchOrderedPage: async (input) => {
          if (input.page === 2) return page(2, [999]);
          ac.abort(); throw new StalkerPortalError("CANCELLED", "cancelled");
        },
        fullDiscover: async () => { full += 1; return { rows: [] }; },
      },
    ), (e: unknown) => e instanceof StalkerPortalError && e.code === "CANCELLED");
    assert.equal(full, 0);
  });

  await scenario("L conflicting targeted duplicate portalId fails closed", async () => {
    const s = session();
    registerStalkerLiveRuntimeLocators(s, "provider-a", "10", 1, [{ portalId: "101" }]);
    await assert.rejects(reacquireStalkerLiveChannel(
      { session: s, providerId: "provider-a", portalId: "101" },
      { fetchOrderedPage: async () => ({
        ...page(1, [101]),
        payload: { data: [
          { id: 101, name: "A", tv_genre_id: "10", cmd: "ffmpeg one" },
          { id: 101, name: "A", tv_genre_id: "10", cmd: "ffmpeg two" },
        ] },
      }) },
    ), (e: unknown) => e instanceof StalkerPortalError && e.code === "INVALID_RESPONSE");
  });

  await scenario("M durable playback ref remains portalId only", () => {
    const normalized = normalizeStalkerLivePage({ data: [{ id: 101, name: "A", tv_genre_id: "10", cmd: "ffmpeg secret" }] }, "provider-a", 1);
    const persisted = projectStalkerLiveItem("provider-a", normalized.items[0]);
    assert.deepEqual(persisted.playbackRef, { type: "stalker-live", portalId: "101" });
    assert.equal(JSON.stringify(persisted).includes("secret"), false);
  });

  await scenario("N C3F resolved targeted CMD bypasses create_link", async () => {
    let create = 0;
    const url = await resolveStalkerLiveRuntimeCmd(
      { request: async () => { create += 1; return {}; } },
      "ffmpeg http://example.invalid/play/live.php?stream=101&play_token=synthetic",
    );
    assert.equal(create, 0); assert.match(url, /stream=101/);
  });

  await scenario("O C3F unresolved targeted CMD invokes create_link once", async () => {
    let create = 0;
    const url = await resolveStalkerLiveRuntimeCmd(
      { request: async () => { create += 1; return { cmd: "https://stream.invalid/live.ts" }; } },
      "ffmpeg opaque-101",
    );
    assert.equal(create, 1); assert.equal(url, "https://stream.invalid/live.ts");
  });

  await scenario("P C3F empty stream remains fail closed", async () => {
    await assert.rejects(resolveStalkerLiveRuntimeCmd(
      { request: async () => ({}) },
      "ffmpeg http://example.invalid/play/live.php?stream=&play_token=synthetic",
    ), (e: unknown) => e instanceof StalkerPortalError && e.code === "INVALID_RESPONSE");
  });

  await scenario("Q locator page remains one-based and is reissued exactly", async () => {
    const s = session(); let observed = 0;
    registerStalkerLiveRuntimeLocators(s, "provider-a", "10", 7, [{ portalId: "101" }]);
    await reacquireStalkerLiveChannel(
      { session: s, providerId: "provider-a", portalId: "101" },
      { fetchOrderedPage: async (input) => { observed = input.page; return page(input.page, [101]); } },
    );
    assert.equal(observed, 7);
  });

  assert.equal(passed, 17);
  process.stdout.write("stalker live targeted reacquisition scenarios: 17/17 passed\n");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
