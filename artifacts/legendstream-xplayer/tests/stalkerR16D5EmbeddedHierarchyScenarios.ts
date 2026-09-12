import assert from "node:assert/strict";
import { extractStalkerSeriesEmbeddedHierarchy, probeStalkerSeriesPhysicalRowShape, STALKER_SERIES_D4_SHAPE_LIMITS, STALKER_SERIES_D5_HIERARCHY_LIMITS } from "../lib/stalkerSeriesShapeProbe";

type Params = Record<string, string | number | boolean | undefined>;
type Handler = (params: Params, signal?: AbortSignal) => unknown | Promise<unknown>;
function harness(handler: Handler) {
  const calls: Params[] = [];
  return {
    calls,
    session: {
      async handshake() { return { authenticated: true as const }; },
      async request(params: Params, signal?: AbortSignal) {
        calls.push({ ...params });
        return handler(params, signal);
      },
    },
  };
}

async function main() {
  const physical = extractStalkerSeriesEmbeddedHierarchy({ data: [
    { season_num: 1, name: "Season 1", series: [1, 2, 3, 4] },
    { season_num: 2, name: "Season 2", series: [1, 2] },
  ] });
  assert.equal(physical.classification, "EMBEDDED_HIERARCHY_FOUND");
  assert.equal(physical.totalSeasons, 2);
  assert.equal(physical.totalEmbeddedEpisodes, 6);
  assert.deepEqual(physical.seasons[0]?.episodeIds, ["1", "2", "3", "4"]);
  assert.deepEqual(physical.seasons[1]?.episodeIds, ["1", "2"]);

  const strings = extractStalkerSeriesEmbeddedHierarchy({ data: [{ season: "1", name: "Season 1", series: ["1", "2", "3"] }] });
  assert.deepEqual(strings.seasons[0]?.episodeIds, ["1", "2", "3"]);

  const duplicates = extractStalkerSeriesEmbeddedHierarchy({ data: [{ season_number: 1, name: "Season 1", series: [1, 1, 2, 2, 3] }] });
  assert.deepEqual(duplicates.seasons[0]?.episodeIds, ["1", "2", "3"]);

  const unsafe = extractStalkerSeriesEmbeddedHierarchy({ data: [{ season_id: "1", name: "Season 1", series: [1, null, {}, ["nested"], 2, true] }] });
  assert.deepEqual(unsafe.seasons[0]?.episodeIds, ["1", "2"]);

  const emptySeries = extractStalkerSeriesEmbeddedHierarchy({ data: [{ season_num: 1, name: "Season 1", series: [] }] });
  assert.equal(emptySeries.classification, "SEASONS_ONLY");
  assert.equal(emptySeries.totalEmbeddedEpisodes, 0);
  assert.deepEqual(emptySeries.seasons[0]?.episodeIds, []);

  const noSeries = extractStalkerSeriesEmbeddedHierarchy({ data: [{ season_num: 1, name: "Season 1" }] });
  assert.equal(noSeries.classification, "SEASONS_ONLY");
  assert.equal(noSeries.totalSeasons, 1);
  assert.equal(noSeries.totalEmbeddedEpisodes, 0);

  const scoped = extractStalkerSeriesEmbeddedHierarchy({ data: [
    { season_num: 1, name: "Season 1", series: [1] },
    { season_num: 2, name: "Season 2", series: [1] },
  ] });
  assert.deepEqual(scoped.seasons.map((season) => [season.id, season.episodeIds]), [["1", ["1"]], ["2", ["1"]]]);
  assert.equal(scoped.totalEmbeddedEpisodes, 2);

  const malformed = extractStalkerSeriesEmbeddedHierarchy({ data: [{ season_num: 1, name: "Season 1", series: { one: 1 } }] });
  assert.equal(malformed.classification, "SEASONS_ONLY");
  assert.equal(malformed.totalEmbeddedEpisodes, 0);

  const fallback = extractStalkerSeriesEmbeddedHierarchy({ data: [{ name: "Season 7", series: [1, 2] }] });
  assert.equal(fallback.seasons[0]?.id, "7");
  assert.deepEqual(fallback.seasons[0]?.episodeIds, ["1", "2"]);

  const unsupported = extractStalkerSeriesEmbeddedHierarchy({ data: [{ name: "Collection", series: [1, 2] }] });
  assert.equal(unsupported.classification, "UNSUPPORTED");
  assert.equal(unsupported.totalSeasons, 0);

  const security = extractStalkerSeriesEmbeddedHierarchy({ data: [{
    season_num: 1,
    name: "Season 1",
    series: [1, 2],
    cmd: "secret-cmd-value",
    url: "https://secret.example/episode",
    uri: "secret-uri",
    token: "secret-token",
    auth: "secret-auth",
    authorization: "Bearer secret",
    cookie: "secret-cookie",
    mac: "AA:BB:CC:DD:EE:FF",
    password: "secret-password",
    secret: "secret-secret",
    credential: "secret-credential",
    login: "secret-login",
    stream: "secret-stream",
    link: "secret-link",
  }] });
  const safeOutput = JSON.stringify(security);
  for (const leaked of ["secret-cmd-value", "secret.example", "secret-uri", "secret-token", "secret-auth", "Bearer secret", "secret-cookie", "AA:BB:CC:DD:EE:FF", "secret-password", "secret-secret", "secret-credential", "secret-login", "secret-stream", "secret-link"]) {
    assert.equal(safeOutput.includes(leaked), false, `hierarchy leaked ${leaked}`);
  }

  const manyEpisodes = Array.from({ length: STALKER_SERIES_D5_HIERARCHY_LIMITS.maxEpisodeIdsPerSeason + 5 }, (_, index) => index + 1);
  const bounded = extractStalkerSeriesEmbeddedHierarchy({ data: Array.from({ length: STALKER_SERIES_D5_HIERARCHY_LIMITS.maxSeasonRows + 5 }, (_, index) => ({ season_num: index + 1, name: `Season ${index + 1}`, series: manyEpisodes })) });
  assert.equal(bounded.totalSeasons, STALKER_SERIES_D5_HIERARCHY_LIMITS.maxSeasonRows);
  assert.ok(bounded.totalEmbeddedEpisodes <= STALKER_SERIES_D5_HIERARCHY_LIMITS.maxTotalEpisodeIds);
  assert.ok(bounded.seasons.every((season) => season.episodeCount <= STALKER_SERIES_D5_HIERARCHY_LIMITS.maxEpisodeIdsPerSeason));

  const rawId = "22927:22927";
  const networkHarness = harness((params) => {
    assert.deepEqual(params, { type: "series", action: "get_ordered_list", movie_id: rawId, p: 1 });
    return { total_items: 2, max_page_items: 14, cur_page: 0, data: [
      { season_num: 1, name: "Season 1", series: [1, 2, 3, 4], cmd: "must-not-leak" },
      { season_num: 2, name: "Season 2", series: [1, 2], token: "must-not-leak-token" },
    ] };
  });
  const bp3 = await probeStalkerSeriesPhysicalRowShape(networkHarness.session, { id: rawId, title: "Reacher", raw: { id: rawId } });
  const bp3RequestCount = networkHarness.calls.length;
  assert.equal(bp3RequestCount, 1);
  assert.equal(bp3.hierarchy.classification, "EMBEDDED_HIERARCHY_FOUND");
  assert.equal(bp3.hierarchy.totalSeasons, 2);
  assert.equal(bp3.hierarchy.totalEmbeddedEpisodes, 6);
  assert.equal(networkHarness.calls.length - bp3RequestCount, 0, "BP4 must make zero additional requests");
  assert.equal(JSON.stringify(bp3.hierarchy).includes("must-not-leak"), false);
  assert.equal(STALKER_SERIES_D4_SHAPE_LIMITS.maxDetailRequests, 1);
  assert.equal(STALKER_SERIES_D4_SHAPE_LIMITS.page, 1);
  assert.equal(STALKER_SERIES_D4_SHAPE_LIMITS.timeoutMs, 12_000);
  assert.equal(STALKER_SERIES_D5_HIERARCHY_LIMITS.additionalRequests, 0);

  console.log("stalker R16-D5 embedded hierarchy scenarios passed");
}

main().catch((error) => { console.error(error); process.exit(1); });
