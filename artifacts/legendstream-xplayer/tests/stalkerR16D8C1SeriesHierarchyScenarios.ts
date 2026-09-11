import assert from "node:assert/strict";
import {
  createStalkerSeriesProductController,
  stalkerSeriesEpisodeIdentity,
  STALKER_SERIES_PRODUCT_LIMITS,
} from "../lib/stalkerSeriesProduct";

type Params = Record<string, string | number | boolean | undefined>;

const physicalHierarchy = [30, 34, 32, 34, 3, 27] as const;
const seasonNumbers = [6, 5, 4, 3, 2, 1] as const;

function episodes(count: number) {
  return Array.from({ length: count }, (_, index) => index + 1);
}

async function main() {
  const calls: Params[] = [];
  const detailRows = seasonNumbers.map((season, index) => ({
    season_num: season,
    name: `Season ${season}`,
    series: episodes(physicalHierarchy[index]!),
    cmd: `opaque-season-${season}-cmd`,
  }));
  const session = {
    async handshake() { return { authenticated: true as const }; },
    async request(params: Params) {
      calls.push({ ...params });
      if (params.type === "series" && params.action === "get_ordered_list" && params.movie_id === "series:physical") {
        return { data: detailRows };
      }
      if (params.type === "vod" && params.action === "create_link") {
        return { cmd: "ffmpeg https://media.invalid/episode.m3u8?sig=fake" };
      }
      throw new Error("unexpected request");
    },
  };

  const controller = createStalkerSeriesProductController(session as any, "provider-physical");
  const detail = await controller.loadDetail({ id: "series:physical", title: "Physical Fixture" });
  const counts = detail.seasons.map((season) => season.episodes.length);
  assert.deepEqual(counts, [30, 34, 32, 34, 3, 27]);
  assert.equal(detail.seasons.reduce((total, season) => total + season.episodes.length, 0), 160);
  assert.equal(detail.hierarchyTruncated, false);

  const required = [
    ["5", "34"],
    ["4", "32"],
    ["3", "34"],
    ["2", "3"],
    ["1", "27"],
  ] as const;
  for (const [seasonId, episodeId] of required) {
    const season = detail.seasons.find((item) => item.id === seasonId);
    assert.ok(season, `missing season ${seasonId}`);
    assert.ok(season.episodes.some((episode) => episode.id === episodeId), `missing S${seasonId}E${episodeId}`);
  }

  const duplicateAcrossSeasonsA = detail.seasons.find((item) => item.id === "6")!.episodes[0]!;
  const duplicateAcrossSeasonsB = detail.seasons.find((item) => item.id === "5")!.episodes[0]!;
  assert.equal(duplicateAcrossSeasonsA.id, "1");
  assert.equal(duplicateAcrossSeasonsB.id, "1");
  assert.notEqual(duplicateAcrossSeasonsA.key, duplicateAcrossSeasonsB.key);
  assert.equal(duplicateAcrossSeasonsA.key, stalkerSeriesEpisodeIdentity("provider-physical", "series:physical", "6", "1"));
  assert.equal(duplicateAcrossSeasonsB.key, stalkerSeriesEpisodeIdentity("provider-physical", "series:physical", "5", "1"));

  for (const season of detail.seasons) {
    for (const episode of season.episodes) assert.ok(episode.key && episode.id, `unselectable episode in season ${season.id}`);
  }

  const serialized = JSON.stringify(detail);
  for (const season of seasonNumbers) assert.equal(serialized.includes(`opaque-season-${season}-cmd`), false);

  const beforePlayback = calls.length;
  await controller.resolveEpisode("series:physical", "5", "34");
  assert.equal(calls.length - beforePlayback, 1);
  assert.deepEqual(calls.at(-1), {
    type: "vod",
    action: "create_link",
    cmd: "opaque-season-5-cmd",
    series: "34",
  });
  assert.equal(calls.filter((call) => call.action === "create_link").length, 1);
  assert.equal(STALKER_SERIES_PRODUCT_LIMITS.maxCreateLinksPerSelection, 1);
  assert.equal(STALKER_SERIES_PRODUCT_LIMITS.fallbackDialects, 0);
  assert.ok(STALKER_SERIES_PRODUCT_LIMITS.maxEpisodesPerSeason >= 34);
  assert.ok(STALKER_SERIES_PRODUCT_LIMITS.maxTotalEpisodes >= 160);

  const exactIdSession = {
    async handshake() { return { authenticated: true as const }; },
    async request(params: Params) {
      if (params.action === "get_ordered_list") {
        return { data: [{ season_num: " 01 ", series: [" 0007 "], cmd: "opaque" }] };
      }
      return { cmd: "https://media.invalid/a" };
    },
  };
  const exactController = createStalkerSeriesProductController(exactIdSession as any, "provider-exact");
  const exactDetail = await exactController.loadDetail({ id: "series-exact", title: "Exact" });
  assert.equal(exactDetail.seasons[0]!.id, " 01 ");
  assert.equal(exactDetail.seasons[0]!.episodes[0]!.id, " 0007 ");

  console.log("R16-D8-C1 lossless Series hierarchy scenarios: PASS");
}

void main();
