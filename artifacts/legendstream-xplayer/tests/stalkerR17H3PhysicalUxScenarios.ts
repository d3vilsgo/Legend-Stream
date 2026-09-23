import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createStalkerSeriesProductController,
  STALKER_SERIES_PRODUCT_LIMITS,
} from "../lib/stalkerSeriesProduct";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
type Params = Record<string, string | number | boolean | undefined>;

async function main() {
  let passed = 0;
  const scenario = async (name: string, run: () => void | Promise<void>) => {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  };

  await scenario("nested season containers and episodes aliases normalize without a fallback request", async () => {
    const calls: Params[] = [];
    const controller = createStalkerSeriesProductController({ async request(params: Params) {
      calls.push({ ...params });
      return {
        result: {
          seasons: [{
            season_name: "Season 2",
            episodes: [
              { id: "1", name: "Pilot" },
              { episode_id: "2", title: "Second" },
            ],
            cmd: "season-two-command",
          }],
        },
      };
    } } as any, "provider-a");
    const detail = await controller.loadDetail({ id: "series-a", title: "Series A" });
    assert.equal(calls.length, 1);
    assert.deepEqual(detail.seasons.map((season) => season.episodes.map((episode) => episode.id)), [["1", "2"]]);
    assert.deepEqual(detail.seasons[0]?.episodes.map((episode) => episode.label), ["Pilot", "Second"]);
  });

  await scenario("the proven VOD hierarchy candidate is used only after an empty primary hierarchy", async () => {
    const calls: Params[] = [];
    const controller = createStalkerSeriesProductController({ async request(params: Params) {
      calls.push({ ...params });
      if (params.type === "series") return { info: { title: "Series B" } };
      if (params.action === "get_ordered_list") return { data: [
        { season_id: "1", episode_number: "1", name: "Pilot", cmd: "episode-one-command" },
        { season_id: "1", episode_number: "2", name: "Second", cmd: "episode-two-command" },
      ] };
      if (params.action === "create_link") return { cmd: "ffmpeg https://media.invalid/episode-two.m3u8" };
      throw new Error("unexpected request");
    } } as any, "provider-a");
    const detail = await controller.loadDetail({ id: "series-b", title: "Series B" });
    assert.deepEqual(calls.slice(0, 2), [
      { type: "series", action: "get_ordered_list", movie_id: "series-b", p: 1 },
      { type: "vod", action: "get_ordered_list", movie_id: "series-b", season_id: 0, episode_id: 0, p: 1 },
    ]);
    assert.deepEqual(detail.seasons[0]?.episodes.map((episode) => episode.id), ["1", "2"]);
    const url = await controller.resolveEpisode("series-b", "1", "2");
    assert.equal(url, "https://media.invalid/episode-two.m3u8");
    assert.deepEqual(calls.at(-1), {
      type: "vod",
      action: "create_link",
      cmd: "episode-two-command",
      series: "2",
    });
  });

  await scenario("embedded hierarchy keeps the single-request fast path", async () => {
    const calls: Params[] = [];
    const controller = createStalkerSeriesProductController({ async request(params: Params) {
      calls.push({ ...params });
      return { data: [{ season_num: 1, series: [1, 2], cmd: "season-command" }] };
    } } as any, "provider-a");
    await controller.loadDetail({ id: "series-c", title: "Series C" });
    assert.equal(calls.length, 1);
    assert.equal(STALKER_SERIES_PRODUCT_LIMITS.fallbackDialects, 1);
  });

  await scenario("an unsupported compatibility candidate preserves the primary empty hierarchy", async () => {
    let calls = 0;
    const controller = createStalkerSeriesProductController({ async request(params: Params) {
      calls += 1;
      if (params.type === "series") return { data: [{ season_num: 1, name: "Season 1" }] };
      throw new Error("unsupported");
    } } as any, "provider-a");
    const detail = await controller.loadDetail({ id: "series-empty", title: "Series Empty" });
    assert.equal(calls, 2);
    assert.equal(detail.seasons.length, 1);
    assert.equal(detail.seasons[0]?.episodes.length, 0);
  });

  await scenario("episode runtime commands remain memory-only and durable identity is unchanged", async () => {
    const controller = createStalkerSeriesProductController({ async request(params: Params) {
      if (params.action === "create_link") return { cmd: "https://media.invalid/e1" };
      return { data: [{ season_num: 1, episodes: [{ id: 1, cmd: "secret-runtime-command" }] }] };
    } } as any, "provider-a");
    const detail = await controller.loadDetail({ id: "series-d", title: "Series D" });
    const serialized = JSON.stringify(detail);
    assert.equal(serialized.includes("secret-runtime-command"), false);
    assert.match(detail.seasons[0]!.episodes[0]!.key, /provider-a/);
  });

  const player = source("components/CompatibilityVideoPlayerV2.tsx");
  await scenario("startup feedback is owned above the native VLC surface", () => {
    assert.match(player, /const \[startupPending, setStartupPending\] = useState\(true\)/);
    assert.match(player, /handlePlaying[\s\S]*?setStartupPending\(false\)/);
    assert.match(player, /!pipActive && startupPending && !errorText/);
    assert.match(player, /startupOverlay: \{[\s\S]*?zIndex: 200,[\s\S]*?elevation: 200/);
    assert.ok(player.indexOf("<PlayerChrome") < player.indexOf("style={styles.startupOverlay}"));
  });

  await scenario("startup feedback resets for source and codec changes and clears on terminal error", () => {
    assert.match(player, /setStartupPending\(true\);\n  \}, \[currentSource, codecMode\]\)/);
    assert.match(player, /const handleError[\s\S]*?setStartupPending\(false\)/);
    assert.match(player, /Akış hazırlanıyor…/);
  });

  const mainPage = source("components/StalkerMainPage.tsx");
  const historyView = source("components/ContinueWatchingView.tsx");
  await scenario("Stalker History resolves durable Live identities from persisted catalog rows", () => {
    assert.match(mainPage, /useResolvedLiveIdentityChannels/);
    assert.match(mainPage, /view === "history" \? \[\.\.\.history, \.\.\.favorites\] : \[\]/);
    assert.match(mainPage, /channels=\{resolvedHistoryChannels\}/);
  });

  await scenario("History hides empty section headings and removes the duplicate progress heading", () => {
    assert.match(mainPage, /\.filter\(\(section\) => section\.data\.length > 0\)/);
    assert.match(mainPage, /<ContinueWatchingView onOpen=\{onOpenMedia\} showHeading=\{false\} showEmpty=\{false\}/);
    assert.match(historyView, /showHeading = true/);
    assert.match(historyView, /showEmpty = true/);
    assert.match(historyView, /\{showHeading \? <View style=\{s\.header\}>/);
    assert.match(mainPage, /ListEmptyComponent=\{entries\.length \|\| unscopedEntries\.length/);
  });

  await scenario("player ownership and history return contracts remain top-level", () => {
    assert.match(mainPage, /returnTo: "history"/);
    assert.match(mainPage, /returnTo: "series"/);
    assert.match(mainPage, /<NativeVideoPlayer/);
    assert.doesNotMatch(source("components/stalker/StalkerSeriesProductSurface.tsx"), /NativeVideoPlayer|CompatibilityVideoPlayer/);
  });

  assert.equal(passed, 10);
  console.log(`stalker R17-H3 physical UX scenarios: ${passed}/10 passed`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
