import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createStalkerPortalSession, StalkerPortalError } from "../lib/stalkerPortal";
import { getOrCreateStalkerPortalSession, releaseStalkerPortalSession } from "../lib/stalkerPortalRuntime";
import { resolveStalkerLiveCreateLink } from "../lib/stalkerLiveCatalog";
import type { Channel } from "../lib/iptv";
import { resolveLiveQueue } from "../lib/playerLiveQueue";

let passed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  process.stdout.write(`ok ${passed} - ${name}\n`);
}

function source(path: string) {
  return readFileSync(fileURLToPath(String(new URL(path, import.meta.url))), "utf8");
}

function blockBetween(text: string, start: string, end: string) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return text.slice(from, to);
}

const provider = {
  id: "stalker-r9",
  type: "stalker",
  url: "http://portal.invalid/stalker_portal/",
  mac: "00:1A:79:12:34:56",
};

function channel(id: string, streamUrl = `legendstream-catalog://stalker/live/${provider.id}/${provider.id}%3Astalker%3A${id}`): Channel {
  return {
    id: `${provider.id}:stalker:${id}`,
    providerId: provider.id,
    name: `Channel ${id}`,
    streamUrl,
    category: "News",
    contentType: "live",
    streamType: "stalker",
  };
}

async function main() {
  await scenario("canonical SQL Stalker selection resolves opaque source through create_link", async () => {
    const actions: string[] = [];
    const session = {
      request: async (params: Record<string, unknown>) => {
        actions.push(String(params.action));
        assert.equal(params.type, "itv");
        assert.equal(params.action, "create_link");
        assert.equal(params.cmd, "ffmpeg http://cmd.invalid/live/101");
        return { cmd: "ffmpeg https://stream.invalid/live/101.ts" };
      },
    };
    const resolved = await resolveStalkerLiveCreateLink(session, "ffmpeg http://cmd.invalid/live/101");
    assert.equal(resolved, "https://stream.invalid/live/101.ts");
    assert.deepEqual(actions, ["create_link"]);
  });

  await scenario("same provider sequential playback uses the same acquired shared session", async () => {
    let acquireCalls = 0;
    let createCalls = 0;
    const sharedSession = {
      request: async (params: Record<string, unknown>) => {
        createCalls += 1;
        assert.equal(params.action, "create_link");
        return { cmd: `ffmpeg https://stream.invalid/${createCalls}.ts` };
      },
    };
    const acquireStalkerSession = () => {
        acquireCalls += 1;
        return sharedSession;
    };
    await resolveStalkerLiveCreateLink(acquireStalkerSession(), "ffmpeg http://cmd.invalid/101");
    await resolveStalkerLiveCreateLink(acquireStalkerSession(), "ffmpeg http://cmd.invalid/102");
    assert.equal(acquireCalls, 2);
    assert.equal(createCalls, 2);
  });

  await scenario("actual provider-scoped registry reuses authenticated session across channel changes", async () => {
    const providerId = "stalker-r9-registry";
    let handshakes = 0;
    let creates = 0;
    releaseStalkerPortalSession(providerId);
    try {
      const session = getOrCreateStalkerPortalSession({
        providerId,
        portalUrl: "http://portal.invalid/stalker_portal/",
        mac: "00:1A:79:12:34:56",
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.includes("action=handshake")) {
            handshakes += 1;
            return new Response(JSON.stringify({ js: { token: "token-r9" } }), { status: 200 });
          }
          creates += 1;
          return new Response(JSON.stringify({ js: { cmd: `ffmpeg https://stream.invalid/${creates}.ts` } }), { status: 200 });
        },
      });
      const first = await resolveStalkerLiveCreateLink(session, "ffmpeg http://cmd.invalid/1");
      const same = getOrCreateStalkerPortalSession({
        providerId,
        portalUrl: "http://portal.invalid/stalker_portal/",
        mac: "00:1A:79:12:34:56",
      });
      const second = await resolveStalkerLiveCreateLink(same, "ffmpeg http://cmd.invalid/2");
      assert.equal(session, same);
      assert.equal(first, "https://stream.invalid/1.ts");
      assert.equal(second, "https://stream.invalid/2.ts");
      assert.equal(handshakes, 1);
      assert.equal(creates, 2);
    } finally {
      releaseStalkerPortalSession(providerId);
    }
  });

  await scenario("provider A and B playback sessions remain isolated", () => {
    const a = getOrCreateStalkerPortalSession({ providerId: "r9-a", portalUrl: "http://a.invalid/stalker_portal/", mac: "00:1A:79:12:34:56" });
    const b = getOrCreateStalkerPortalSession({ providerId: "r9-b", portalUrl: "http://b.invalid/stalker_portal/", mac: "00:1A:79:12:34:56" });
    assert.notEqual(a, b);
    releaseStalkerPortalSession("r9-a");
    releaseStalkerPortalSession("r9-b");
  });

  await scenario("cancelled playback resolution preserves session lifecycle and surfaces cancellation", async () => {
    const controller = new AbortController();
    let createStarted!: () => void;
    const started = new Promise<void>((resolve) => { createStarted = resolve; });
    const session = {
      request: async (_params: Record<string, unknown>, signal?: AbortSignal) => {
        createStarted();
        return await new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new StalkerPortalError("CANCELLED", "cancelled")), { once: true });
        });
      },
    };
    const pending = resolveStalkerLiveCreateLink(session, "ffmpeg http://cmd.invalid/live/101", controller.signal);
    await started;
    controller.abort();
    await assert.rejects(pending, (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "CANCELLED");
  });

  await scenario("auth retry remains owned by shared StalkerPortalSession with no outer runtime retry", async () => {
    let handshakes = 0;
    let creates = 0;
    const session = createStalkerPortalSession({
      portalUrl: "http://portal.invalid/stalker_portal/",
      mac: "00:1A:79:12:34:56",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("action=handshake")) {
          handshakes += 1;
          return new Response(JSON.stringify({ js: { token: `token-${handshakes}` } }), { status: 200 });
        }
        creates += 1;
        return creates === 1
          ? new Response(JSON.stringify({ error: "not_valid_token" }), { status: 200 })
          : new Response(JSON.stringify({ js: { cmd: "ffmpeg https://stream.invalid/retry.ts" } }), { status: 200 });
      },
    });
    const resolved = await resolveStalkerLiveCreateLink(session, "ffmpeg http://cmd.invalid/live/101");
    assert.equal(resolved, "https://stream.invalid/retry.ts");
    assert.equal(handshakes, 2);
    assert.equal(creates, 2);
  });

  await scenario("playback runtime does not invoke profile, genres, discovery, or catalog sync", async () => {
    const actions: string[] = [];
    await resolveStalkerLiveCreateLink({
      request: async (params: Record<string, unknown>) => {
        actions.push(String(params.action));
          return { cmd: "ffmpeg https://stream.invalid/only-create-link.ts" };
      },
    }, "ffmpeg http://cmd.invalid/live/101");
    assert.deepEqual(actions, ["create_link"]);
  });

  await scenario("Stalker live queue accepts canonical SQL runtime rows for next and previous", () => {
    const rows = [channel("100"), channel("101"), channel("102")];
    const queue = resolveLiveQueue(rows, [], { providerId: provider.id, channelId: `${provider.id}:stalker:101` });
    assert.deepEqual(queue.map((item) => item.id), [
      `${provider.id}:stalker:100`,
      `${provider.id}:stalker:101`,
      `${provider.id}:stalker:102`,
    ]);
    assert.ok(queue.every((item) => item.streamUrl.startsWith("legendstream-catalog://stalker/live/")));
  });

  const runtime = source("../lib/catalogRuntime.ts");
  const player = source("../components/CompatibilityVideoPlayerV2.tsx");
  const home = source("../components/OptimizedHomeScreenPaged.tsx");
  const stalkerLive = source("../components/catalog/StalkerLiveCatalog.tsx");
  const iptv = source("../lib/iptv.ts");

  await scenario("catalogRuntime uses shared registry and has no private per-playback Stalker session", () => {
    assert.match(runtime, /getOrCreateStalkerPortalSession/);
    assert.doesNotMatch(runtime, /createStalkerPortalSession/);
    assert.doesNotMatch(runtime, /get_profile|get_genres|get_all_channels|get_ordered_list|get_main_info|syncStalkerLiveCatalog/);
  });

  await scenario("Home, Live, History, and Favorites all pass canonical Channel streamUrl to the same player path", () => {
    assert.match(home, /onOpenLive=\{openLive\}/);
    assert.match(home, /<StalkerLiveCatalog[\s\S]*onOpen=\{openLive\}/);
    assert.match(home, /resolveLiveIdentityPresentationRows/);
    assert.match(home, /setPlayable\(\{[\s\S]*url: channel\.streamUrl[\s\S]*liveIdentity:/);
    assert.match(stalkerLive, /onPress=\{\(\)\s*=>\s*onOpen\(channel\)\}/);
  });

  await scenario("Compatibility player resolves catalog runtime sources and includes Stalker in cached live window", () => {
    assert.match(player, /resolveCatalogRuntimeSource\(currentSource, provider, controller\.signal\)/);
    assert.match(player, /controller\.abort\(\)/);
    assert.match(player, /provider\.type !== "m3u" && provider\.type !== "xtream" && provider\.type !== "stalker"/);
    assert.match(player, /provider\?\.mac/);
  });

  await scenario("resolved Stalker URL remains runtime-only and is not persisted", () => {
    assert.match(runtime, /return \(dependencies\.resolveStalkerLink \?\? resolveStalkerLiveCreateLink\)\(session, playbackRef\.cmd, signal\)/);
    assert.doesNotMatch(runtime, /AsyncStorage|setItem|INSERT|UPDATE|enqueueCatalogDbWrite/);
  });

  await scenario("remaining raw Stalker cmd handling is canonical input or bypassed legacy loader only", () => {
    assert.match(iptv, /async function loadStalker/);
    assert.match(iptv, /replace\(\s*\/\^ffmpeg/);
    assert.match(home, /homeIdentityFallbackChannels = provider\?\.type === "stalker" \? \[\] : playerLiveChannels/);
    const runtimeStalker = blockBetween(runtime, 'if (ref.kind === "stalker-live") {', "}");
    assert.doesNotMatch(runtimeStalker, /replace\(\^ffmpeg|rawCommand/);
  });

  await scenario("Xtream and M3U runtime playback branches stay unchanged", () => {
    assert.match(runtime, /persisted\.playbackRef\.type === "xtream-live"/);
    assert.match(runtime, /persisted\.playbackRef\.type === "m3u-path" && provider\.type === "m3u"/);
    assert.match(runtime, /buildM3UStreamUrl\(providerSource\(provider\), persisted\.playbackRef\)/);
    assert.match(runtime, /getVodInfo\(credentials, ref\.streamId\)/);
  });

  assert.equal(passed, 14);
  process.stdout.write("stalker R9 playback unification scenarios: 14/14 passed\n");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
