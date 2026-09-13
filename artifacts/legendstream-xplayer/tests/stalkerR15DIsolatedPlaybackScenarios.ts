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
const liveCatalogSource = source("components/catalog/StalkerLiveCatalog.tsx");

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

  await scenario("Category selection stays inside canonical Stalker pager state", () => {
    const setCategoryBlock = liveCatalogSource.slice(
      liveCatalogSource.indexOf("const setCategory = useCallback"),
      liveCatalogSource.indexOf("const page = useCatalogPage"),
    );
    assert.match(setCategoryBlock, /rememberCatalogCategorySelection\(providerId, "live", id\)/);
    assert.match(liveCatalogSource, /<StalkerCategoryPager[\s\S]*onSelect=\{setCategory\}/);
    assert.doesNotMatch(screenSource, /STALKER_CHANNELS_SCREEN|setStalkerScreen/);
  });

  await scenario("Canonical pager composes categories and page.items without isolated screens", () => {
    assert.match(liveCatalogSource, /<StalkerCategoryPager[\s\S]*categories=\{categories\}/);
    assert.match(liveCatalogSource, /data=\{page\.items\}/);
    assert.doesNotMatch(screenSource, /STALKER_GENRES_SCREEN|STALKER_CHANNELS_SCREEN/);
  });

  await scenario("Changing category does not re-run isolated login", () => {
    const setCategoryBlock = liveCatalogSource.slice(
      liveCatalogSource.indexOf("const setCategory = useCallback"),
      liveCatalogSource.indexOf("const epgSeedKey"),
    );
    assert.match(setCategoryBlock, /categoryId: category/);
    assert.doesNotMatch(setCategoryBlock, /runIsolatedStalkerLogin|loadIsolatedStalkerGenres/);
  });

  await scenario("Channel tap triggers create_link exactly once", async () => {
    const harness = sessionHarness();
    const resolved = await resolveIsolatedStalkerChannelLink(harness.session, channel);
    assert.equal(resolved, "http://stream.example/live/101.ts");
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

  await scenario("Channel tap delegates exactly one production onOpen handoff", () => {
    assert.equal((liveCatalogSource.match(/onOpen\(channel\)/g) ?? []).length, 1);
    assert.match(liveCatalogSource, /onPress=\{\(\) => onOpen\(channel\)\}/);
    const routeBlock = screenSource.slice(
      screenSource.indexOf('{view === "live" && provider.type === "stalker"'),
      screenSource.indexOf('{view === "movies"'),
    );
    assert.match(routeBlock, /onOpen=\{openLive\}/);
  });

  await scenario("Production Live UI does not own create_link request state", () => {
    assert.doesNotMatch(liveCatalogSource, /stalkerPlaybackRequestRef|stalkerPlaybackStatus|create_link|resolveIsolatedStalkerChannelLink/);
    const openLiveBlock = screenSource.slice(
      screenSource.indexOf("const openLive"),
      screenSource.indexOf("const openMovie"),
    );
    assert.match(openLiveBlock, /channel\.streamUrl/);
  });

  await scenario("create_link failure remains a lower-level helper failure", async () => {
    const harness = sessionHarness({ failCreateLink: true });
    await assert.rejects(resolveIsolatedStalkerChannelLink(harness.session, channel), /link unavailable/);
    assert.doesNotMatch(screenSource, /stalkerPlaybackStatus|stalkerPlaybackRequestRef|setStalkerPlayable/);
  });

  await scenario("Missing shared playback URL fails at root handoff without opening player", () => {
    const openLiveBlock = screenSource.slice(
      screenSource.indexOf("const openLive"),
      screenSource.indexOf("const openMovie"),
    );
    assert.match(openLiveBlock, /if \(!channel\.streamUrl\) \{ setCatalogError\([\s\S]*return; \}/);
    assert.ok(openLiveBlock.indexOf("if (!channel.streamUrl)") < openLiveBlock.indexOf("setPlayable("));
  });

  await scenario("Canonical Live handoff reaches shared application player", async () => {
    const harness = sessionHarness({ createLinkPayload: "ffmpeg http://stream.example/direct.ts" });
    const resolved = await resolveIsolatedStalkerChannelLink(harness.session, channel);
    assert.equal(resolved, "http://stream.example/direct.ts");
    const openLiveBlock = screenSource.slice(
      screenSource.indexOf("const openLive"),
      screenSource.indexOf("const openMovie"),
    );
    assert.match(openLiveBlock, /url: channel\.streamUrl/);
    assert.match(openLiveBlock, /kind: "live"/);
    assert.match(openLiveBlock, /returnTo: "live"/);
    assert.match(openLiveBlock, /setView\("player"\)/);
    assert.match(screenSource, /<NativeVideoPlayer source=\{playable\.url\}/);
  });

  await scenario("Shared player exits back to recorded content destination", () => {
    assert.match(screenSource, /onFullscreenExit=\{\(\) => setView\(playable\.returnTo\)\}/);
    assert.doesNotMatch(screenSource, /STALKER_PLAYER_SCREEN|backToStalkerGenres/);
  });

  await scenario("get_all_channels remains unreachable from the isolated R15-D path", () => {
    assert.doesNotMatch(isolatedLoginSource, /get_all_channels/);
  });

  await scenario("No SQL or shared catalog persistence dependency is used by isolated helpers", () => {
    assert.doesNotMatch(isolatedLoginSource, /AsyncStorage|SecureStore|replaceProviderCatalogAtomically|rememberStalkerLiveCategories|\bpersist\(/);
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.doesNotMatch(setupBlock, /replaceProviderCatalogAtomically|rememberStalkerLiveCategories|\bpersist\(/);
    assert.match(liveCatalogSource, /useCatalogPage/);
  });

  await scenario("Xtream routing remains unchanged", () => {
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.match(setupBlock, /if \(type === "xtream" && \(!username\.trim\(\) \|\| !password\)\)/);
    assert.match(setupBlock, /await onSubmit\(\{[\s\S]*username: type === "xtream" \? username\.trim\(\) : undefined/);
  });

  await scenario("M3U routing remains unchanged", () => {
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.match(setupBlock, /await onSubmit\(\{[\s\S]*type,[\s\S]*playlistUrl: clean/);
    assert.match(setupBlock, /epgUrl: type === "stalker" \? undefined : epgUrl\.trim\(\) \|\| undefined/);
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
    const fromString = await resolveIsolatedStalkerChannelLink(
      sessionHarness({ createLinkPayload: "ffmpeg http://stream.example/string.ts" }).session,
      channel,
    );
    assert.deepEqual([fromCmd, fromUrl, fromLink, fromString], [
      "http://stream.example/cmd.ts",
      "http://stream.example/url.ts",
      "http://stream.example/link.ts",
      "http://stream.example/string.ts",
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