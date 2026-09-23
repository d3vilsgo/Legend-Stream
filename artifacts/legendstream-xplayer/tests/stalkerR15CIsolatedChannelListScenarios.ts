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
const liveCatalogSource = source("components/catalog/StalkerLiveCatalog.tsx");

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

  await scenario("Canonical Live rows are sourced from page.items", () => {
    assert.match(liveCatalogSource, /data=\{page\.items\}/);
    assert.match(liveCatalogSource, /keyExtractor=\{\(channel\) => channel\.id\}/);
    assert.match(liveCatalogSource, /channel\.logoUrl/);
    assert.match(liveCatalogSource, /channel\.name/);
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

  await scenario("Category controls remain independent from paged channel acquisition", () => {
    assert.match(liveCatalogSource, /<StalkerCategoryPager[\s\S]*categories=\{categories\}[\s\S]*onSelect=\{setCategory\}/);
    assert.match(liveCatalogSource, /const page = useCatalogPage\(\{/);
    assert.doesNotMatch(screenSource, /loadStalkerChannelsForCategory|selectedStalkerCategory|STALKER_CHANNELS_SCREEN/);
  });

  await scenario("Canonical retry refreshes sync categories and current page only", () => {
    const refreshBlock = liveCatalogSource.slice(
      liveCatalogSource.indexOf("onPress={() => {"),
      liveCatalogSource.indexOf("style={[styles.refreshButton"),
    );
    assert.match(refreshBlock, /sync\.refresh\(\)/);
    assert.match(refreshBlock, /loadCategories\(\)/);
    assert.match(refreshBlock, /page\.reload\(\)/);
    assert.doesNotMatch(refreshBlock, /runIsolatedStalkerLogin|loadIsolatedStalkerCategoryChannels/);
  });

  await scenario("Paged Live acquisition is provider-gated", () => {
    const pageBlock = liveCatalogSource.slice(
      liveCatalogSource.indexOf("const page = useCatalogPage"),
      liveCatalogSource.indexOf("const epgSeedKey"),
    );
    assert.match(pageBlock, /provider: provider\?\.id === providerId && provider\.type === "stalker" \? provider : null/);
    assert.match(liveCatalogSource, /if \(!provider \|\| provider\.id !== providerId \|\| provider\.type !== "stalker"\) return null;/);
  });

  await scenario("Paged Live acquisition remains category-aware", () => {
    const pageBlock = liveCatalogSource.slice(
      liveCatalogSource.indexOf("const page = useCatalogPage"),
      liveCatalogSource.indexOf("const epgSeedKey"),
    );
    assert.match(pageBlock, /kind: "live"/);
    assert.match(pageBlock, /categoryId: category/);
    assert.match(pageBlock, /search,/);
    assert.match(pageBlock, /enabled: category !== null && sync\.categoriesReady/);
    assert.match(liveCatalogSource, /onEndReached=\{page\.loadMore\}/);
  });

  await scenario("Category cache responses are generation-guarded", () => {
    const loadBlock = liveCatalogSource.slice(
      liveCatalogSource.indexOf("const loadCategories = useCallback"),
      liveCatalogSource.indexOf("const setCategory = useCallback"),
    );
    assert.match(loadBlock, /const generation = \+\+categoryGeneration\.current/);
    assert.match(loadBlock, /if \(categoryGeneration\.current !== generation\) return;/);
  });

  await scenario("Paged channel acquisition does not resolve playback links in the UI layer", () => {
    assert.match(liveCatalogSource, /const page = useCatalogPage\(\{/);
    assert.doesNotMatch(liveCatalogSource, /create_link|resolveIsolatedStalkerChannelLink/);
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

  await scenario("Channel rows hand off explicit open and favorite actions", () => {
    assert.match(liveCatalogSource, /onPress=\{\(\) => onOpen\(channel\)\}/);
    assert.match(liveCatalogSource, /onPress=\{\(\) => onFavorite\(channel\.id\)\}/);
    const routeBlock = screenSource.slice(
      screenSource.indexOf('{view === "live" && provider.type === "stalker"'),
      screenSource.indexOf('{view === "movies"'),
    );
    assert.match(routeBlock, /onOpen=\{openLive\}/);
    assert.equal((liveCatalogSource.match(/\b_channels\b/g) ?? []).length, 1);
    assert.doesNotMatch(liveCatalogSource, /data=\{_channels\}/);
    assert.match(liveCatalogSource, /data=\{page\.items\}/);
  });

  await scenario("get_all_channels never appears in the R15-C isolated runtime path", () => {
    assert.doesNotMatch(isolatedLoginSource, /get_all_channels/);
  });

  await scenario("Isolated helper persistence remains independent from canonical paged Live", () => {
    assert.doesNotMatch(isolatedLoginSource, /AsyncStorage|SecureStore|replaceProviderCatalogAtomically|rememberStalkerLiveCategories|\bpersist\(/);
    assert.match(liveCatalogSource, /useCatalogPage/);
    assert.doesNotMatch(screenSource, /ProductLiveSurface|stalkerChannelRequestRef|loadStalkerChannelsForCategory/);
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

  await scenario("R15-A tests remain present", () => {
    const r15aSource = source("tests/stalkerR15AIsolatedLoginScenarios.ts");
    assert.match(r15aSource, /Handshake plus profile success reaches CONNECTED/);
  });

  await scenario("R15-B tests remain present", () => {
    const r15bSource = source("tests/stalkerR15BIsolatedGenresScenarios.ts");
    assert.match(r15bSource, /Canonical Stalker Live surface is shell-routed and provider-gated/);
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
