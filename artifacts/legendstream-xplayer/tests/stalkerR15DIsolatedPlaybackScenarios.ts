import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadIsolatedStalkerCategoryChannels,
  loadIsolatedStalkerGenres,
  resolveIsolatedStalkerChannelLink,
  runIsolatedStalkerLogin,
  type StalkerIsolatedChannel,
} from "../lib/stalkerIsolatedLogin";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const screenSource = source("components/OptimizedHomeScreenPaged.tsx");
const isolatedLoginSource = source("lib/stalkerIsolatedLogin.ts");
const productSurfaceSource = source("components/product/ProductLiveSurface.tsx");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

type RequestParams = Record<string, string | number | boolean | undefined>;

function sessionHarness(options: {
  failCreateLink?: boolean;
  createLinkPayload?: unknown;
  channels?: unknown;
} = {}) {
  const calls: RequestParams[] = [];
  return {
    calls,
    session: {
      async handshake() {
        calls.push({ action: "handshake" });
        return { authenticated: true as const };
      },
      async request(params: RequestParams) {
        calls.push(params);
        if (params.action === "get_profile") return { name: "Demo", status: "active" };
        if (params.action === "get_main_info") return { tariff_plan: "Basic" };
        if (params.action === "get_genres") {
          assert.equal(params.type, "itv");
          return [{ id: "sports", title: "Sports", number: 1 }];
        }
        if (params.action === "get_ordered_list") {
          assert.equal(params.type, "itv");
          assert.equal(params.genre, "sports");
          assert.equal(params.p, 1);
          return options.channels ?? [
            { id: "101", name: "Sport One", number: 1, cmd: "ffmpeg http://portal.example/ch/101" },
          ];
        }
        if (params.action === "create_link") {
          assert.equal(params.type, "itv");
          if (options.failCreateLink) throw new Error("link unavailable");
          return options.createLinkPayload ?? { cmd: "ffmpeg http://stream.example/live/101.ts" };
        }
        throw new Error(`unexpected action ${String(params.action)}`);
      },
    },
  };
}

const channel: StalkerIsolatedChannel = {
  id: "101",
  title: "Sport One",
  cmd: "ffmpeg http://portal.example/ch/101",
  number: 1,
};

async function main() {
  await scenario("R15-A login remains unchanged", async () => {
    const harness = sessionHarness();
    const result = await runIsolatedStalkerLogin(
      { portalUrl: "https://portal.example", mac: "00:11:22:33:44:55" },
      { createSession: () => harness.session },
    );
    assert.equal(result.state, "CONNECTED");
    assert.deepEqual(harness.calls.map((call) => call.action), ["handshake", "get_profile", "get_main_info"]);
  });

  await scenario("R15-B genres remain unchanged", async () => {
    const harness = sessionHarness();
    const categories = await loadIsolatedStalkerGenres(harness.session);
    assert.deepEqual(categories.map((category) => category.id), ["sports"]);
    assert.deepEqual(harness.calls, [{ type: "itv", action: "get_genres" }]);
  });

  await scenario("R15-C ordered-list contract remains unchanged", async () => {
    const harness = sessionHarness();
    await loadIsolatedStalkerCategoryChannels(harness.session, { id: "sports", title: "Sports" });
    assert.deepEqual(harness.calls, [{ type: "itv", action: "get_ordered_list", genre: "sports", p: 1 }]);
  });

  await scenario("Selecting category transitions to channels screen", () => {
    const loadBlock = screenSource.slice(
      screenSource.indexOf("const loadStalkerChannelsForCategory"),
      screenSource.indexOf("const openStalkerChannel"),
    );
    assert.match(loadBlock, /setSelectedStalkerCategoryId\(key\)/);
    assert.match(loadBlock, /setStalkerScreen\("STALKER_CHANNELS_SCREEN"\)/);
    assert.match(screenSource, /onSelectCategory=\{\(id\) => \{[\s\S]*loadStalkerChannelsForCategory\(category\)/);
  });

  await scenario("Genres are not stacked with channel list in the same UX state", () => {
    assert.match(productSurfaceSource, /screen === "categories"/);
    assert.match(productSurfaceSource, /screen === "channels"/);
    assert.doesNotMatch(productSurfaceSource, /GET_ORDERED_LIST completed|GET_GENRES completed|GET_ORDERED_LIST tamamlandı|GET_GENRES tamamlandı/);
    assert.match(screenSource, /stalkerScreen === "STALKER_CHANNELS_SCREEN"/);
  });

  await scenario("Back from channels returns to genres without re-login", () => {
    const start = screenSource.indexOf("const backToStalkerGenres");
    const backSource = screenSource.slice(start, screenSource.indexOf("const retrySelectedStalkerPlayback", start));
    assert.match(backSource, /setStalkerScreen\("STALKER_GENRES_SCREEN"\)/);
    assert.doesNotMatch(backSource, /runIsolatedStalkerLogin|setStalkerSession\(null\)|setStalkerStatus\("CONNECTING"\)/);
    assert.match(screenSource, /onBackToCategories=\{backToStalkerGenres\}/);
  });

  await scenario("Channel tap triggers create_link exactly once", async () => {
    const harness = sessionHarness();
    const source = await resolveIsolatedStalkerChannelLink(harness.session, channel);
    assert.equal(source, "http://stream.example/live/101.ts");
    assert.deepEqual(harness.calls, [{ type: "itv", action: "create_link", cmd: channel.cmd }]);
  });

  await scenario("create_link uses exact selected channel command", async () => {
    const harness = sessionHarness({ createLinkPayload: { url: "http://stream.example/alt.ts" } });
    await resolveIsolatedStalkerChannelLink(harness.session, { ...channel, cmd: "ffmpeg http://portal.example/custom" });
    assert.equal(harness.calls[0].cmd, "ffmpeg http://portal.example/custom");
  });

  await scenario("create_link is not called before channel selection", async () => {
    const harness = sessionHarness();
    await runIsolatedStalkerLogin(
      { portalUrl: "https://portal.example", mac: "00:11:22:33:44:55" },
      { createSession: () => harness.session },
    );
    await loadIsolatedStalkerGenres(harness.session);
    await loadIsolatedStalkerCategoryChannels(harness.session, { id: "sports", title: "Sports" });
    assert.equal(harness.calls.some((call) => call.action === "create_link"), false);
  });

  await scenario("Rapid duplicate channel taps are guarded from uncontrolled fan-out", () => {
    const openSource = screenSource.slice(
      screenSource.indexOf("const openStalkerChannel"),
      screenSource.indexOf("const backToStalkerGenres"),
    );
    assert.match(openSource, /stalkerPlaybackStatus === "PLAYBACK_LOADING"/);
    assert.match(openSource, /if \(!force && currentRequest\.key === key && stalkerPlaybackStatus === "PLAYBACK_LOADING"\) return;/);
  });

  await scenario("Stale create_link response cannot open the wrong channel", () => {
    const openSource = screenSource.slice(
      screenSource.indexOf("const openStalkerChannel"),
      screenSource.indexOf("const backToStalkerGenres"),
    );
    assert.match(openSource, /stalkerPlaybackRequestRef\.current\.sequence !== sequence/);
    assert.match(openSource, /stalkerPlaybackRequestRef\.current\.key !== key/);
  });

  await scenario("create_link failure leaves channel list intact", async () => {
    const harness = sessionHarness({ failCreateLink: true });
    await assert.rejects(resolveIsolatedStalkerChannelLink(harness.session, channel), /link unavailable/);
    const openSource = screenSource.slice(
      screenSource.indexOf("const openStalkerChannel"),
      screenSource.indexOf("const backToStalkerGenres"),
    );
    assert.match(openSource, /setStalkerPlaybackStatus\("PLAYBACK_ERROR"\)/);
    assert.doesNotMatch(openSource, /setStalkerChannels\(\[\]\)|setStalkerCategories\(\[\]\)|setStalkerStatus\("ERROR"\)/);
  });

  await scenario("Playback failure is presented locally without invalidating session content", () => {
    assert.match(productSurfaceSource, /playbackError[\s\S]*LocalError[\s\S]*Yayın başlatılamadı/);
    const setupBlock = screenSource.slice(
      screenSource.indexOf("const openStalkerChannel"),
      screenSource.indexOf("const submit"),
    );
    assert.doesNotMatch(setupBlock, /setStalkerStatus\("ERROR"\)|setStalkerCategories\(\[\]\)/);
  });

  await scenario("Successful create_link hands normalized URL to player", async () => {
    const harness = sessionHarness({ createLinkPayload: "ffmpeg http://stream.example/direct.ts" });
    const source = await resolveIsolatedStalkerChannelLink(harness.session, channel);
    assert.equal(source, "http://stream.example/direct.ts");
    assert.match(screenSource, /setStalkerPlayable\(\{[\s\S]*url: source/);
    assert.match(screenSource, /<NativeVideoPlayer[\s\S]*source=\{stalkerPlayable\.url\}/);
  });

  await scenario("Back from player returns to the same channel surface", () => {
    assert.match(screenSource, /onFullscreenExit=\{\(\) => setStalkerScreen\("STALKER_CHANNELS_SCREEN"\)\}/);
    const playerBlock = screenSource.slice(
      screenSource.indexOf('stalkerScreen === "STALKER_PLAYER_SCREEN"'),
      screenSource.indexOf("const productScreen"),
    );
    assert.doesNotMatch(playerBlock, /loadStalkerGenres|loadStalkerChannelsForCategory|runIsolatedStalkerLogin/);
    assert.doesNotMatch(playerBlock, /setStalkerChannels\(\[\]\)|setStalkerCategories\(\[\]\)/);
  });

  await scenario("get_all_channels remains unreachable from the isolated R15-D path", () => {
    assert.doesNotMatch(isolatedLoginSource, /get_all_channels/);
  });

  await scenario("No SQL or shared catalog persistence dependency is used", () => {
    assert.doesNotMatch(isolatedLoginSource, /AsyncStorage|SecureStore|replaceProviderCatalogAtomically|rememberStalkerLiveCategories|\bpersist\(/);
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.doesNotMatch(setupBlock, /replaceProviderCatalogAtomically|rememberStalkerLiveCategories|\bpersist\(/);
    assert.doesNotMatch(productSurfaceSource, /usePlayer|useCatalogSync|useCatalogPage|catalogPageRepository/);
  });

  await scenario("Xtream routing remains unchanged", () => {
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.match(setupBlock, /if \(type === "xtream" && \(!username\.trim\(\) \|\| !password\)\)/);
    assert.match(setupBlock, /await onSubmit\(\{[\s\S]*username: type === "xtream"/);
  });

  await scenario("M3U routing remains unchanged", () => {
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.match(setupBlock, /await onSubmit\(\{[\s\S]*type,[\s\S]*playlistUrl: clean/);
    assert.match(setupBlock, /epgUrl: epgUrl\.trim\(\) \|\| undefined/);
  });

  await scenario("R15-A B and C focused tests remain wired", () => {
    const packageJson = source("package.json");
    assert.match(packageJson, /stalkerR15AIsolatedLoginScenarios/);
    assert.match(packageJson, /stalkerR15BIsolatedGenresScenarios/);
    assert.match(packageJson, /stalkerR15CIsolatedChannelListScenarios/);
  });

  await scenario("Playable response supports cmd url link and string shapes", async () => {
    const fromCmd = await resolveIsolatedStalkerChannelLink(
      sessionHarness({ createLinkPayload: { cmd: "ffmpeg http://stream.example/cmd.ts" } }).session,
      channel,
    );
    const fromUrl = await resolveIsolatedStalkerChannelLink(
      sessionHarness({ createLinkPayload: { url: "http://stream.example/url.ts" } }).session,
      channel,
    );
    const fromLink = await resolveIsolatedStalkerChannelLink(
      sessionHarness({ createLinkPayload: { link: "http://stream.example/link.ts" } }).session,
      channel,
    );
    assert.deepEqual([fromCmd, fromUrl, fromLink], [
      "http://stream.example/cmd.ts",
      "http://stream.example/url.ts",
      "http://stream.example/link.ts",
    ]);
  });

  await scenario("Invalid playable response fails closed without fabricating a stream", async () => {
    await assert.rejects(
      resolveIsolatedStalkerChannelLink(
        sessionHarness({ createLinkPayload: { cmd: "not-a-url" } }).session,
        channel,
      ),
      /playable link/,
    );
  });

  console.log(`stalker R15-D isolated playback scenarios passed: ${passed}/22`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
