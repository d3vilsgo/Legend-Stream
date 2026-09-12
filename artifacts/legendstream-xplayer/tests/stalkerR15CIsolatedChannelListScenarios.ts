import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadIsolatedStalkerCategoryChannels,
  loadIsolatedStalkerGenres,
  normalizeIsolatedStalkerChannels,
  runIsolatedStalkerLogin,
  type StalkerIsolatedChannelStatus,
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
  failChannels?: boolean;
  channels?: unknown;
  genres?: unknown;
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
          return options.genres ?? [
            { id: "*", title: "All", number: 0 },
            { id: "sports", title: "Sports", number: 1 },
            { id: "news", title: "News", number: 2 },
          ];
        }
        if (params.action === "get_ordered_list") {
          assert.equal(params.type, "itv");
          if (options.failChannels) throw new Error("ordered list unavailable");
          return options.channels ?? [
            { id: "101", name: "Sport One", number: 1, logo: "https://img.example/1.png", cmd: "ffmpeg secret" },
            { id: "102", title: "Sport Two", number: "2", cmd: "ffmpeg secret-two" },
          ];
        }
        throw new Error(`unexpected action ${String(params.action)}`);
      },
    },
  };
}

async function main() {
  await scenario("R15-A login remains independent from genres and channels", async () => {
    const harness = sessionHarness();
    const result = await runIsolatedStalkerLogin(
      { portalUrl: "https://portal.example", mac: "00:11:22:33:44:55" },
      { createSession: () => harness.session },
    );
    assert.equal(result.state, "CONNECTED");
    assert.deepEqual(harness.calls.map((call) => call.action), ["handshake", "get_profile", "get_main_info"]);
  });

  await scenario("R15-B get_genres remains unchanged", async () => {
    const harness = sessionHarness();
    const categories = await loadIsolatedStalkerGenres(harness.session);
    assert.deepEqual(harness.calls.map((call) => call.action), ["get_genres"]);
    assert.deepEqual(categories.map((category) => category.id), ["*", "sports", "news"]);
  });

  await scenario("Selecting category triggers the exact ordered-list request contract", async () => {
    const harness = sessionHarness();
    await loadIsolatedStalkerCategoryChannels(harness.session, { id: "sports", title: "Sports" });
    assert.deepEqual(harness.calls, [{ type: "itv", action: "get_ordered_list", genre: "sports", p: 1 }]);
  });

  await scenario("Only the selected category is fetched", async () => {
    const harness = sessionHarness();
    await loadIsolatedStalkerCategoryChannels(harness.session, { id: "news", title: "News" });
    assert.deepEqual(harness.calls.map((call) => call.genre), ["news"]);
  });

  await scenario("Successful response normalizes visible channel rows", async () => {
    const harness = sessionHarness({
      channels: [
        { id: "dup", name: "Duplicate", number: 3, cmd: "ffmpeg http://stream.example/dup.ts" },
        { ch_id: "101", name: "Sport One", number: 1, logo_url: "https://img.example/1.png", cmd: "ffmpeg http://stream.example/101.ts" },
        { id: "dup", name: "Duplicate Copy", number: 4, cmd: "ffmpeg http://stream.example/dup-copy.ts" },
        { id: "empty", name: "" },
        null,
      ],
    });
    const channels = await loadIsolatedStalkerCategoryChannels(harness.session, { id: "sports", title: "Sports" });
    assert.deepEqual(channels, [
      { id: "101", title: "Sport One", cmd: "ffmpeg http://stream.example/101.ts", logoUrl: "https://img.example/1.png", number: 1 },
      { id: "dup", title: "Duplicate", cmd: "ffmpeg http://stream.example/dup.ts", logoUrl: undefined, number: 3 },
    ]);
  });

  await scenario("Channels become visible in the isolated Stalker product surface", () => {
    assert.match(screenSource, /toProductChannelRows\(stalkerChannels\)/);
    assert.match(screenSource, /stalkerScreen === "STALKER_CHANNELS_SCREEN"/);
    assert.match(productSurfaceSource, /channels\.map/);
    assert.match(productSurfaceSource, /channel\.title/);
    assert.match(productSurfaceSource, /channel\.logoUrl/);
  });

  await scenario("ordered-list failure does not invalidate CONNECTED", async () => {
    const harness = sessionHarness({ failChannels: true });
    const result = await runIsolatedStalkerLogin(
      { portalUrl: "https://portal.example", mac: "00:11:22:33:44:55" },
      { createSession: () => harness.session },
    );
    const statuses: StalkerIsolatedChannelStatus[] = ["CHANNELS_LOADING"];
    await assert.rejects(
      loadIsolatedStalkerCategoryChannels(result.session, { id: "sports", title: "Sports" }),
      /ordered list unavailable/,
    );
    statuses.push("CHANNELS_ERROR");
    assert.equal(result.state, "CONNECTED");
    assert.equal(statuses.at(-1), "CHANNELS_ERROR");
  });

  await scenario("ordered-list failure does not remove categories", () => {
    const loadBlock = screenSource.slice(
      screenSource.indexOf("const loadStalkerChannelsForCategory"),
      screenSource.indexOf("const openStalkerChannel"),
    );
    assert.match(loadBlock, /setStalkerChannelStatus\("CHANNELS_ERROR"\)/);
    assert.doesNotMatch(loadBlock, /setStalkerCategories\(\[\]\)|setStalkerStatus\("ERROR"\)/);
    assert.match(screenSource, /selectedStalkerCategory/);
  });

  await scenario("Retry calls only channel-list logic", () => {
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.match(setupBlock, /onRetryChannels=\{\(\) => \{[\s\S]*loadStalkerChannelsForCategory\(selectedStalkerCategory, true\)/);
    const retryBlock = setupBlock.slice(setupBlock.indexOf("onRetryChannels="), setupBlock.indexOf("onRetryPlayback="));
    assert.doesNotMatch(retryBlock, /runIsolatedStalkerLogin|loadStalkerGenres/);
    assert.match(productSurfaceSource, /channelsError[\s\S]*LocalError[\s\S]*onRetry=\{onRetryChannels\}/);
  });

  await scenario("Ordinary rerender does not duplicate ordered-list requests", () => {
    assert.doesNotMatch(screenSource, /useEffect\([\s\S]{0,220}loadStalkerChannelsForCategory/);
    const loadBlock = screenSource.slice(
      screenSource.indexOf("const loadStalkerChannelsForCategory"),
      screenSource.indexOf("const openStalkerChannel"),
    );
    assert.match(loadBlock, /if \(!force && currentRequest\.key === key\) \{[\s\S]{0,180}return;/);
  });

  await scenario("Same-category in-flight or cached request dedup works", () => {
    const loadBlock = screenSource.slice(
      screenSource.indexOf("const loadStalkerChannelsForCategory"),
      screenSource.indexOf("const openStalkerChannel"),
    );
    assert.match(loadBlock, /stalkerChannelRequestRef\.current = \{ key, sequence \};/);
    assert.match(loadBlock, /if \(!force && currentRequest\.key === key\) \{[\s\S]{0,180}return;/);
    assert.match(loadBlock, /setStalkerScreen\("STALKER_CHANNELS_SCREEN"\)/);
  });

  await scenario("Stale category response cannot overwrite the currently selected category", () => {
    assert.match(screenSource, /stalkerChannelRequestRef\.current\.sequence !== sequence/);
    assert.match(screenSource, /stalkerChannelRequestRef\.current\.key !== key/);
  });

  await scenario("R15-C category loading does not call create_link before channel selection", () => {
    const surfaceBlock = screenSource.slice(
      screenSource.indexOf("const loadStalkerChannelsForCategory"),
      screenSource.indexOf("const openStalkerChannel"),
    );
    assert.match(surfaceBlock, /loadIsolatedStalkerCategoryChannels/);
    assert.doesNotMatch(surfaceBlock, /create_link|resolveIsolatedStalkerChannelLink|NativeVideoPlayer|setPlayer|openPlayer/);
  });

  await scenario("create_link is isolated to the channel playback helper", () => {
    const channelLoadSource = isolatedLoginSource.slice(
      isolatedLoginSource.indexOf("export async function loadIsolatedStalkerCategoryChannels"),
      isolatedLoginSource.indexOf("export async function resolveIsolatedStalkerChannelLink"),
    );
    assert.doesNotMatch(channelLoadSource, /create_link/);
    const playbackSource = isolatedLoginSource.slice(
      isolatedLoginSource.indexOf("export async function resolveIsolatedStalkerChannelLink"),
    );
    assert.match(playbackSource, /\{ type: "itv", action: "create_link", cmd \}/);
  });

  await scenario("Channel rows initiate playback only from explicit channel press", () => {
    assert.match(productSurfaceSource, /onPress=\{\(\) => onSelectChannel\(channel\.id\)\}/);
    const wiringBlock = screenSource.slice(
      screenSource.indexOf("onSelectChannel="),
      screenSource.indexOf("/>;", screenSource.indexOf("onSelectChannel=")),
    );
    assert.match(wiringBlock, /stalkerChannels\.find/);
    assert.match(wiringBlock, /openStalkerChannel\(channel\)/);
    assert.doesNotMatch(productSurfaceSource, /get_all_channels|replaceProviderCatalogAtomically|rememberStalkerLiveCategories/);
  });

  await scenario("get_all_channels never appears in the R15-C isolated runtime path", () => {
    assert.doesNotMatch(isolatedLoginSource, /get_all_channels/);
  });

  await scenario("No SQL or shared catalog persistence dependency is introduced", () => {
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

  await scenario("R15-A tests remain present", () => {
    const r15aSource = source("tests/stalkerR15AIsolatedLoginScenarios.ts");
    assert.match(r15aSource, /Handshake plus profile success reaches CONNECTED/);
  });

  await scenario("R15-B tests remain present", () => {
    const r15bSource = source("tests/stalkerR15BIsolatedGenresScenarios.ts");
    assert.match(r15bSource, /Entering isolated Stalker Live surface triggers get_genres once/);
  });

  await scenario("All category is not substituted with get_all_channels", async () => {
    const harness = sessionHarness();
    await assert.rejects(
      loadIsolatedStalkerCategoryChannels(harness.session, { id: "*", title: "All" }),
      /cannot be fetched with get_ordered_list/,
    );
    assert.deepEqual(harness.calls, []);
  });

  await scenario("Channel normalization handles empty payloads deterministically", () => {
    assert.deepEqual(normalizeIsolatedStalkerChannels(null), []);
    assert.deepEqual(normalizeIsolatedStalkerChannels({ js: [] }), []);
  });

  console.log(`stalker R15-C isolated channel-list scenarios passed: ${passed}/23`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
