import assert from "node:assert/strict";
import { fetchStalkerLiveCategories } from "../lib/stalkerLiveCatalog";
import { discoverStalkerLiveChannels } from "../lib/stalkerLiveDiscovery";
import { createStalkerPortalSession, StalkerPortalError } from "../lib/stalkerPortal";
import { bootstrapStalkerProfile } from "../lib/stalkerProfileBootstrap";
import { StalkerLiveSyncSingleFlight } from "../lib/stalkerLiveSyncSingleFlight";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function main() {
  await scenario("T1 same-provider equivalent sync work joins one in-flight task", async () => {
    const gate = new StalkerLiveSyncSingleFlight<number>();
    const pending = deferred<number>();
    let starts = 0;
    const first = gate.run("provider-a", undefined, () => {
      starts += 1;
      return pending.promise;
    });
    const second = gate.run("provider-a", undefined, () => {
      starts += 1;
      return Promise.resolve(2);
    });
    assert.equal(first, second);
    assert.equal(starts, 1);
    pending.resolve(1);
    assert.equal(await second, 1);
  });

  await scenario("T2 aborted same-provider work may be superseded without joining stale work", async () => {
    const gate = new StalkerLiveSyncSingleFlight<number>();
    const controller = new AbortController();
    const firstPending = deferred<number>();
    let starts = 0;
    const first = gate.run("provider-a", controller.signal, () => {
      starts += 1;
      return firstPending.promise;
    });
    controller.abort();
    const second = gate.run("provider-a", undefined, () => {
      starts += 1;
      return Promise.resolve(2);
    });
    assert.notEqual(first, second);
    assert.equal(starts, 2);
    assert.equal(await second, 2);
    firstPending.resolve(1);
    assert.equal(await first, 1);
  });

  await scenario("T3 different providers remain independent", async () => {
    const gate = new StalkerLiveSyncSingleFlight<number>();
    const one = deferred<number>();
    const two = deferred<number>();
    let starts = 0;
    const first = gate.run("provider-a", undefined, () => {
      starts += 1;
      return one.promise;
    });
    const second = gate.run("provider-b", undefined, () => {
      starts += 1;
      return two.promise;
    });
    assert.equal(starts, 2);
    one.resolve(1);
    two.resolve(2);
    assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  });

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

  await scenario("T16 modeled same-provider physical request graph stays on complete aggregate", async () => {
    const rows = Array.from({ length: 28 }, (_, index) => channel(index + 1));
    const aggregatePending = deferred<Response>();
    const counts = {
      handshake: 0,
      profile: 0,
      genres: 0,
      aggregate: 0,
      ordered: 0,
      syncStarts: 0,
      syncJoins: 0,
    };
    const session = createStalkerPortalSession({
      portalUrl: "https://example.invalid/portal.php",
      mac: "00:00:00:00:00:00",
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        const action = url.searchParams.get("action");
        if (action === "handshake") {
          counts.handshake += 1;
          return response(JSON.stringify({ js: { token: "sanitized-token" } }));
        }
        if (action === "get_profile") {
          counts.profile += 1;
          return response(JSON.stringify({ js: { id: 1, name: "profile" } }));
        }
        if (action === "get_genres") {
          counts.genres += 1;
          return response(JSON.stringify({ js: [{ id: "1", title: "One" }] }));
        }
        if (action === "get_all_channels") {
          counts.aggregate += 1;
          return aggregatePending.promise;
        }
        if (action === "get_ordered_list") {
          counts.ordered += 1;
          return response(JSON.stringify({ js: { data: [] } }));
        }
        throw new Error(`unexpected action ${action ?? "missing"}`);
      },
      afterResponse: () => undefined,
    });
    const gate = new StalkerLiveSyncSingleFlight<Awaited<ReturnType<typeof discoverStalkerLiveChannels>>>();
    const runSync = () => gate.run("provider-safe", undefined, async () => {
      counts.syncStarts += 1;
      await bootstrapStalkerProfile(session);
      const categories = await fetchStalkerLiveCategories(session);
      return discoverStalkerLiveChannels({
        session,
        providerId: "provider-safe",
        categories,
        yieldFn: () => undefined,
      });
    }, () => {
      counts.syncJoins += 1;
    });

    const first = runSync();
    while (counts.aggregate === 0) await Promise.resolve();
    const second = runSync();
    assert.equal(first, second);
    aggregatePending.resolve(response(JSON.stringify({
      js: { data: rows, total_items: rows.length, max_page_items: 14, cur_page: 0 },
    })));
    const result = await second;
    assert.equal(result.source, "get_all_channels");
    assert.equal(result.rows.length, rows.length);
    assert.deepEqual(counts, {
      handshake: 1,
      profile: 1,
      genres: 1,
      aggregate: 1,
      ordered: 0,
      syncStarts: 1,
      syncJoins: 1,
    });
  });

  assert.equal(passed, 10);
  process.stdout.write("stalker R13-A.1 anti-DDoS discipline scenarios: 10/10 passed\n");
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
