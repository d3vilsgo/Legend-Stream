import assert from "node:assert/strict";
import { discoverStalkerLiveChannels } from "../lib/stalkerLiveDiscovery";
import { createStalkerPortalSession, StalkerPortalError } from "../lib/stalkerPortal";

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  process.stdout.write(`ok ${passed} - ${name}\n`);
}

function channel(id: number | string, genre = "1") {
  return { id, name: `Channel ${id}`, cmd: `ffmpeg opaque-${id}`, tv_genre_id: genre };
}

function response(body: string) {
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

async function main() {
  await scenario("T7/T8 plain HTTP-200 anti-DDoS body is terminal and does not re-handshake or retry", async () => {
    let fetchCount = 0;
    const session = createStalkerPortalSession({
      portalUrl: "https://example.invalid/portal.php",
      mac: "00:00:00:00:00:00",
      fetchImpl: async () => {
        fetchCount += 1;
        if (fetchCount === 1) return response(JSON.stringify({ js: { token: "sanitized-token" } }));
        return response("This client is under DDoS protection");
      },
      afterResponse: () => undefined,
    });
    await assert.rejects(
      session.request({ type: "itv", action: "get_all_channels" }),
      (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "PORTAL_RATE_LIMITED_OR_ANTI_DDOS",
    );
    assert.equal(fetchCount, 2);
    assert.equal(session.isAuthenticated(), true);
  });

  await scenario("T7 JSON anti-DDoS message is classified separately from auth failure", async () => {
    let fetchCount = 0;
    const session = createStalkerPortalSession({
      portalUrl: "https://example.invalid/portal.php",
      mac: "00:00:00:00:00:00",
      fetchImpl: async () => {
        fetchCount += 1;
        if (fetchCount === 1) return response(JSON.stringify({ js: { token: "sanitized-token" } }));
        return response(JSON.stringify({ js: { message: "MAC is under DDoS protection" } }));
      },
      afterResponse: () => undefined,
    });
    await assert.rejects(
      session.request({ type: "itv", action: "get_all_channels" }),
      (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "PORTAL_RATE_LIMITED_OR_ANTI_DDOS",
    );
    assert.equal(fetchCount, 2);
  });

  await scenario("T11 complete aggregate metadata does not launch ordered fallback", async () => {
    const calls: Record<string, unknown>[] = [];
    const rows = Array.from({ length: 28 }, (_, index) => channel(index + 1));
    const session = {
      async request(params: Record<string, unknown>) {
        calls.push({ ...params });
        return { data: rows, total_items: rows.length, max_page_items: 14, cur_page: 0 };
      },
    };
    const result = await discoverStalkerLiveChannels({
      session: session as any,
      providerId: "provider-safe",
      categories: [{ id: "*", name: "All" }, { id: "1", name: "One" }],
      yieldFn: () => undefined,
    });
    assert.equal(result.source, "get_all_channels");
    assert.equal(result.rows.length, 28);
    assert.equal(calls.length, 1);
    assert.equal(calls.some((call) => call.action === "get_ordered_list"), false);
  });

  await scenario("T15 fallback skips All when concrete genres exist", async () => {
    const orderedGenres: string[] = [];
    const session = {
      async request(params: Record<string, unknown>) {
        if (params.action === "get_all_channels") return { data: [channel(99)], total_items: 4 };
        orderedGenres.push(String(params.genre));
        return { data: [channel(String(params.genre), String(params.genre))], total_items: 1, max_page_items: 1 };
      },
    };
    const result = await discoverStalkerLiveChannels({
      session: session as any,
      providerId: "provider-safe",
      categories: [{ id: "*", name: "All" }, { id: "1", name: "One" }, { id: "2", name: "Two" }],
      yieldFn: () => undefined,
    });
    assert.equal(result.source, "get_ordered_list");
    assert.deepEqual(orderedGenres, ["1", "2"]);
  });

  await scenario("T9 anti-DDoS during ordered traversal stops later pages and genres immediately", async () => {
    const ordered: Array<{ genre: string; page: number }> = [];
    const session = {
      async request(params: Record<string, unknown>) {
        if (params.action === "get_all_channels") return { data: [channel(99)], total_items: 4 };
        const genre = String(params.genre);
        const page = Number(params.p);
        ordered.push({ genre, page });
        if (genre === "1" && page === 1) {
          return { data: [channel(1)], total_items: 2, max_page_items: 1 };
        }
        throw new StalkerPortalError(
          "PORTAL_RATE_LIMITED_OR_ANTI_DDOS",
          "Stalker portal temporarily rejected request traffic.",
        );
      },
    };
    await assert.rejects(
      discoverStalkerLiveChannels({
        session: session as any,
        providerId: "provider-safe",
        categories: [{ id: "*", name: "All" }, { id: "1", name: "One" }, { id: "2", name: "Two" }],
        yieldFn: () => undefined,
      }),
      (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "PORTAL_RATE_LIMITED_OR_ANTI_DDOS",
    );
    assert.deepEqual(ordered, [{ genre: "1", page: 1 }, { genre: "1", page: 2 }]);
  });

  await scenario("T13/T14 per-genre page count is derived only from that genre response", async () => {
    const orderedPages: number[] = [];
    const session = {
      async request(params: Record<string, unknown>) {
        if (params.action === "get_all_channels") return { data: [channel(99)], total_items: 9999 };
        const page = Number(params.p);
        orderedPages.push(page);
        return {
          data: page === 1 ? [channel(1), channel(2)] : [channel(3)],
          total_items: 3,
          max_page_items: 2,
        };
      },
    };
    const result = await discoverStalkerLiveChannels({
      session: session as any,
      providerId: "provider-safe",
      categories: [{ id: "1", name: "One" }],
      yieldFn: () => undefined,
    });
    assert.deepEqual(orderedPages, [1, 2]);
    assert.equal(result.rows.length, 3);
  });

  assert.equal(passed, 6);
  process.stdout.write("stalker R13-A.1 anti-DDoS discipline scenarios: 6/6 passed\n");
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
