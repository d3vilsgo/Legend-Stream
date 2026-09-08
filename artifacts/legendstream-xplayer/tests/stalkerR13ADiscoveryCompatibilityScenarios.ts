import assert from "node:assert/strict";
import { discoverStalkerLiveChannels } from "../lib/stalkerLiveDiscovery";
import { StalkerPortalError } from "../lib/stalkerPortal";

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  process.stdout.write(`ok ${passed} - ${name}\n`);
}

function channel(id: number | string, options: { cmd?: string; genre?: string; name?: string } = {}) {
  return {
    id,
    name: options.name ?? `Channel ${id}`,
    cmd: options.cmd ?? `ffmpeg opaque-${id}`,
    tv_genre_id: options.genre ?? "1",
  };
}

type RequestParams = Record<string, string | number | boolean | undefined>;

function sessionFor(handler: (params: RequestParams, signal?: AbortSignal) => unknown | Promise<unknown>) {
  const calls: RequestParams[] = [];
  return {
    calls,
    session: {
      async request(params: RequestParams, signal?: AbortSignal) {
        calls.push({ ...params });
        if (signal?.aborted) throw new StalkerPortalError("CANCELLED", "cancelled");
        return handler(params, signal);
      },
    },
  };
}

const categories = [
  { id: "1", name: "News" },
  { id: "2", name: "Sports" },
];

function page(data: unknown[], total: number, max: number) {
  return { data, total_items: total, max_page_items: max };
}

async function main() {
  await scenario("A clean complete aggregate is accepted", async () => {
    const fake = sessionFor((params) => {
      assert.equal(params.action, "get_all_channels");
      return { data: [channel(1), channel(2)], total_items: 2 };
    });
    const result = await discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories });
    assert.equal(result.source, "get_all_channels");
    assert.equal(result.rows.length, 2);
  });

  for (const [name, duplicate] of [
    ["B same-command aggregate duplicate falls back", channel(1)],
    ["D different-command aggregate duplicate falls back", channel(1, { cmd: "ffmpeg other" })],
  ] as const) {
    await scenario(name, async () => {
      const fake = sessionFor((params) => {
        if (params.action === "get_all_channels") return { data: [channel(1), duplicate], total_items: 2 };
        if (params.action === "get_ordered_list") {
          const genre = String(params.genre);
          return genre === "1" ? page([channel(1, { genre: "1" })], 1, 1) : page([channel(2, { genre: "2" })], 1, 1);
        }
        throw new Error("unexpected");
      });
      const result = await discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories });
      assert.equal(result.source, "get_ordered_list");
      assert.deepEqual(result.rows.map((row) => row.portalId), ["1", "2"]);
    });
  }

  await scenario("C aggregate same-command duplicate is not blind-deduped", async () => {
    const fake = sessionFor((params) => {
      if (params.action === "get_all_channels") return { data: [channel(1), channel(1)], total_items: 2 };
      if (params.action === "get_ordered_list") return page([channel(String(params.genre), { genre: String(params.genre) })], 1, 1);
      throw new Error("unexpected");
    });
    const result = await discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories });
    assert.equal(result.rows.length, 2);
    assert.ok(fake.calls.some((call) => call.action === "get_ordered_list"));
  });

  await scenario("E advertised total greater than aggregate rows falls back", async () => {
    const fake = sessionFor((params) => {
      if (params.action === "get_all_channels") return { data: [channel(1)], total_items: 9 };
      return page([channel(String(params.genre), { genre: String(params.genre) })], 1, 1);
    });
    const result = await discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories });
    assert.equal(result.source, "get_ordered_list");
  });

  await scenario("F empty aggregate falls back", async () => {
    const fake = sessionFor((params) => {
      if (params.action === "get_all_channels") return { data: [], total_items: 0 };
      return page([channel(String(params.genre), { genre: String(params.genre) })], 1, 1);
    });
    const result = await discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories });
    assert.equal(result.source, "get_ordered_list");
  });

  await scenario("G ordered fallback scopes requests to every genre", async () => {
    const fake = sessionFor((params) => {
      if (params.action === "get_all_channels") return { data: [channel(1)], total_items: 1, cur_page: 0, max_page_items: 14 };
      return page([channel(String(params.genre), { genre: String(params.genre) })], 1, 1);
    });
    await discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories });
    const ordered = fake.calls.filter((call) => call.action === "get_ordered_list");
    assert.deepEqual(ordered.map((call) => call.genre), ["1", "2"]);
    assert.ok(ordered.every((call) => call.p === 1));
    assert.ok(ordered.every((call) => !("limit" in call) && !("per_page" in call) && !("page_size" in call)));
  });

  await scenario("H total_items and max_page_items derive page count", async () => {
    const fake = sessionFor((params) => {
      if (params.action === "get_all_channels") return { data: [channel(99)], total_items: 5 };
      const p = Number(params.p);
      const data = p === 1 ? [channel(1), channel(2)] : p === 2 ? [channel(3), channel(4)] : [channel(5)];
      return page(data.map((row) => ({ ...row, tv_genre_id: "1" })), 5, 2);
    });
    const result = await discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories: [categories[0]] });
    assert.equal(result.pagesFetched, 3);
    assert.equal(result.rows.length, 5);
  });

  await scenario("I non-14 max_page_items is honored dynamically", async () => {
    const fake = sessionFor((params) => {
      if (params.action === "get_all_channels") return { data: [channel(99)], total_items: 7 };
      const p = Number(params.p);
      const start = (p - 1) * 3 + 1;
      const count = p < 3 ? 3 : 1;
      return page(Array.from({ length: count }, (_, index) => channel(start + index)), 7, 3);
    });
    const result = await discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories: [categories[0]] });
    assert.equal(result.pagesFetched, 3);
    assert.equal(result.rows.length, 7);
  });

  await scenario("J same channel across genres with same ID and cmd stays canonical", async () => {
    const fake = sessionFor((params) => {
      if (params.action === "get_all_channels") return { data: [channel(1)], total_items: 2 };
      return page([channel(7, { genre: String(params.genre), cmd: "ffmpeg shared" })], 1, 1);
    });
    const result = await discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].categoryId, "1");
  });

  await scenario("K same ID with different cmd in ordered fallback fails specifically", async () => {
    const fake = sessionFor((params) => {
      if (params.action === "get_all_channels") return { data: [channel(1)], total_items: 2 };
      const cmd = params.genre === "1" ? "ffmpeg first" : "ffmpeg second";
      return page([channel(7, { genre: String(params.genre), cmd })], 1, 1);
    });
    await assert.rejects(
      discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories }),
      (caught: unknown) => caught instanceof StalkerPortalError &&
        caught.code === "INVALID_RESPONSE" &&
        /ambiguous playback commands/.test(caught.message),
    );
  });

  await scenario("L category metadata difference alone is non-fatal", async () => {
    const fake = sessionFor((params) => {
      if (params.action === "get_all_channels") return { data: [channel(1)], total_items: 2 };
      return page([channel(7, { genre: String(params.genre), cmd: "ffmpeg shared", name: params.genre === "1" ? "One" : "Two" })], 1, 1);
    });
    const result = await discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories });
    assert.equal(result.rows.length, 1);
  });

  await scenario("M cancellation during fallback aborts cleanly", async () => {
    const controller = new AbortController();
    let orderedCalls = 0;
    const fake = sessionFor((params) => {
      if (params.action === "get_all_channels") return { data: [channel(1)], total_items: 2 };
      orderedCalls += 1;
      controller.abort();
      return page([channel(1)], 2, 1);
    });
    await assert.rejects(
      discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories, signal: controller.signal }),
      (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "CANCELLED",
    );
    assert.equal(orderedCalls, 1);
  });

  await scenario("N repeated genre page fails no-progress guard", async () => {
    const fake = sessionFor((params) => {
      if (params.action === "get_all_channels") return { data: [channel(1)], total_items: 3 };
      return page([channel(1)], 3, 1);
    });
    await assert.rejects(
      discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories: [categories[0]] }),
      (caught: unknown) => caught instanceof StalkerPortalError && /repeated or no-progress/.test(caught.message),
    );
  });

  await scenario("O hard page ceiling remains fail-closed", async () => {
    const fake = sessionFor((params) => {
      if (params.action === "get_all_channels") return { data: [channel(1)], total_items: 5 };
      return page([channel(Number(params.p))], 5, 1);
    });
    await assert.rejects(
      discoverStalkerLiveChannels({ session: fake.session as any, providerId: "p", categories: [categories[0]], maxPages: 2 }),
      (caught: unknown) => caught instanceof StalkerPortalError && /safety ceiling/.test(caught.message),
    );
  });

  assert.equal(passed, 15);
  process.stdout.write("stalker R13-A discovery compatibility scenarios: 15/15 passed\n");
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
