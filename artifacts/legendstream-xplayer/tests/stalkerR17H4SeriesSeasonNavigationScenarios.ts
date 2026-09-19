import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  goldenSeriesBackTarget,
  initialGoldenSeriesSeasonId,
  orderGoldenSeriesSeasons,
  selectedGoldenSeriesSeason,
  type GoldenSeriesSeasonModel,
} from "../lib/goldenSeriesDetail";
import { createStalkerSeriesProductController } from "../lib/stalkerSeriesProduct";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viewsSource = readFileSync(resolve(ROOT, "components/catalog/PagedCatalogViews.tsx"), "utf8");
const goldenStart = viewsSource.indexOf("export function GoldenSeriesCatalog");
const pagedStart = viewsSource.indexOf("export function PagedSeriesCatalog");
const goldenSource = viewsSource.slice(goldenStart, pagedStart);

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

function season(id: string, count: number): GoldenSeriesSeasonModel {
  return {
    id,
    label: `Sezon ${id}`,
    episodes: Array.from({ length: count }, (_, index) => ({
      id: String(index + 1),
      title: `Bölüm ${index + 1}`,
      seasonId: id,
    })),
  };
}

async function main() {
  const multi = orderGoldenSeriesSeasons([season("2", 20), season("1", 12), season("3", 7)]);

  await scenario("multi-season detail exposes every normalized season", () => {
    assert.deepEqual(multi.map((item) => item.id), ["1", "2", "3"]);
  });

  await scenario("episode data is not truncated at the physical seven-row viewport", () => {
    assert.equal(multi.reduce((total, item) => total + item.episodes.length, 0), 39);
    assert.doesNotMatch(goldenSource, /episodes\.slice\(|slice\(0,\s*7\)/);
  });

  await scenario("season one exposes all twelve episodes", () => {
    assert.equal(selectedGoldenSeriesSeason(multi, "1")?.episodes.length, 12);
  });

  await scenario("season two exposes all twenty episodes", () => {
    assert.equal(selectedGoldenSeriesSeason(multi, "2")?.episodes.length, 20);
  });

  await scenario("single-season detail auto-selects its only season", () => {
    assert.equal(initialGoldenSeriesSeasonId([season("1", 10)]), "1");
  });

  await scenario("multi-season detail starts at the season selector", () => {
    assert.equal(initialGoldenSeriesSeasonId(multi), null);
    assert.match(goldenSource, /t\("selectSeason"\)/);
  });

  await scenario("season switching selects an already-normalized local dataset", () => {
    assert.equal(selectedGoldenSeriesSeason(multi, "1")?.episodes.at(-1)?.id, "12");
    assert.equal(selectedGoldenSeriesSeason(multi, "2")?.episodes.at(-1)?.id, "20");
  });

  await scenario("season selection neither resolves playback nor creates a link", () => {
    assert.match(goldenSource, /onPress=\{\(\) => setSelectedSeasonId\(season\.id\)\}/);
    assert.doesNotMatch(goldenSource, /create_link|resolveEpisode/);
  });

  await scenario("season switching performs no hierarchy request or N plus one fetch", () => {
    assert.doesNotMatch(goldenSource, /loadDetail|session\.request|get_ordered_list/);
  });

  await scenario("episode tap preserves exact normalized season and episode ids", () => {
    assert.match(goldenSource, /onEpisode\(selectedSeason\.id, episode\.id\)/);
  });

  await scenario("numeric episode identity order is one through ten, not lexical", () => {
    const unordered = season("1", 0);
    unordered.episodes = ["10", "2", "1", "3"].map((id) => ({ id, title: `Bölüm ${id}`, seasonId: "1" }));
    assert.deepEqual(orderGoldenSeriesSeasons([unordered])[0]!.episodes.map((episode) => episode.id), ["1", "2", "3", "10"]);
  });

  await scenario("selected season episodes are owned by a bounded virtualized vertical list", () => {
    assert.match(goldenSource, /return <FlatList[\s\S]*data=\{selectedSeason\.episodes\}/);
    assert.match(goldenSource, /initialNumToRender=\{8\}/);
    assert.match(goldenSource, /maxToRenderPerBatch=\{10\}/);
    assert.match(goldenSource, /windowSize=\{7\}/);
    assert.doesNotMatch(goldenSource, /selectedSeason\.episodes\.map/);
  });

  await scenario("back from a selected multi-season episode list returns to seasons", () => {
    assert.equal(goldenSeriesBackTarget("2", 3), "seasons");
  });

  await scenario("back from the selector or a single season returns to catalog", () => {
    assert.equal(goldenSeriesBackTarget(null, 3), "catalog");
    assert.equal(goldenSeriesBackTarget("1", 1), "catalog");
  });

  await scenario("R17-H3 hierarchy fallback remains one bounded targeted request", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const session = {
      async handshake() { return { authenticated: true as const }; },
      async request(params: Record<string, unknown>) {
        calls.push({ ...params });
        if (params.type === "series") return { data: [] };
        if (params.type === "vod" && params.action === "get_ordered_list") {
          return { data: [{ season_num: 1, series: Array.from({ length: 12 }, (_, index) => index + 1), cmd: "opaque" }] };
        }
        throw new Error("unexpected request");
      },
    };
    const controller = createStalkerSeriesProductController(session as never, "provider-h4");
    const detail = await controller.loadDetail({ id: "series-h4", title: "Series H4" });
    assert.equal(detail.seasons[0]?.episodes.length, 12);
    assert.equal(calls.filter((call) => call.action === "get_ordered_list").length, 2);
    assert.equal(calls.filter((call) => call.type === "vod").length, 1);
  });

  assert.equal(passed, 15);
  console.log("R17-H4 Series season navigation scenarios: 15/15 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
