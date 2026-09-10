import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverStalkerSeriesDetails, discoverStalkerSeriesEpisodes, extractStalkerSeriesHierarchy, observeStalkerSeriesPayload, probeStalkerSeriesCategories, probeStalkerSeriesCreateLink, probeStalkerSeriesPage, STALKER_SERIES_PROBE_LIMITS, type StalkerSeriesProbeItem, type StalkerSeriesSeason } from "../lib/stalkerSeriesProbe";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
type Params = Record<string, string | number | boolean | undefined>;
type Handler = (params: Params, signal?: AbortSignal) => unknown | Promise<unknown>;
function harness(handler: Handler) { const calls: Params[] = []; return { calls, session: { async handshake() { return { authenticated: true as const }; }, async request(params: Params, signal?: AbortSignal) { calls.push({ ...params }); return handler(params, signal); } } }; }

async function main() {
  const categoriesHarness = harness(() => ({ js: [{ id: "*", title: "All" }, { id: "21", title: "Series Category" }, { id: "21", title: "Duplicate" }] }));
  const categories = await probeStalkerSeriesCategories(categoriesHarness.session);
  assert.deepEqual(categoriesHarness.calls, [{ type: "series", action: "get_categories" }]);
  assert.deepEqual(categories.categories.map((item) => item.id), ["*", "21"]);

  const pageHarness = harness(() => ({ total_items: 29, max_page_items: 14, cur_page: 0, data: [{ id: "22866:22866", name: "Series A", arbitrary_field: "observed" }] }));
  const page = await probeStalkerSeriesPage(pageHarness.session, { id: "21", title: "Series Category" });
  assert.deepEqual(pageHarness.calls, [{ type: "series", action: "get_ordered_list", category: "21", p: 1 }]);
  assert.equal(page.items[0]?.id, "22866:22866");
  assert.equal(page.observation.totalItems, 29);
  assert.equal(page.observation.maxPageItems, 14);
  assert.equal(page.observation.currentPage, 0);

  const seasonOnly = extractStalkerSeriesHierarchy({ data: [{ id: "s2", title: "Season 2", season_num: 2, cmd: "opaque-season-command" }] });
  assert.equal(seasonOnly.seasons.length, 1);
  assert.equal(seasonOnly.episodes.length, 0);
  const sevenSeasons = extractStalkerSeriesHierarchy({ data: Array.from({ length: 7 }, (_, index) => ({ id: `season-${index + 1}`, title: `Season ${index + 1}`, season_num: index + 1, cmd: `opaque-${index + 1}` })) });
  assert.equal(sevenSeasons.seasons.length, 7);
  assert.equal(sevenSeasons.episodes.length, 0);

  const rawIdItem: StalkerSeriesProbeItem = { id: "22866:22866", title: "Series A", raw: { id: "22866:22866", name: "Series A" } };
  const physicalSeasonShapeHarness = harness(() => ({ data: Array.from({ length: 7 }, (_, index) => ({ id: `s-${index + 1}`, season_num: index + 1, title: `Season ${index + 1}`, cmd: `opaque-season-${index + 1}` })) }));
  const physicalShape = await discoverStalkerSeriesDetails(physicalSeasonShapeHarness.session, rawIdItem);
  assert.equal(physicalShape.classification, "SEASONS_FOUND");
  assert.equal(physicalShape.seasons.length, 7);
  assert.equal(physicalShape.episodes.length, 0);
  assert.equal(physicalSeasonShapeHarness.calls.length, 1);

  const twoCandidateHarness = harness((params) => params.type === "series" ? { info: { title: "Series A", year: "2026" } } : { data: [{ id: "ep-1", name: "Pilot", season_id: "1", episode_number: 1, cmd: "ffmpeg http://portal/series/ep-1" }, { id: "ep-2", name: "Second", season_id: "1", episode_number: 2, cmd: "ffmpeg http://portal/series/ep-2" }] });
  const discovery = await discoverStalkerSeriesDetails(twoCandidateHarness.session, rawIdItem);
  assert.deepEqual(twoCandidateHarness.calls, [{ type: "series", action: "get_ordered_list", movie_id: "22866:22866", p: 1 }, { type: "vod", action: "get_ordered_list", movie_id: "22866:22866", season_id: 0, episode_id: 0, p: 1 }]);
  assert.equal(discovery.classification, "EPISODES_FOUND");
  assert.equal(discovery.source, "CANDIDATE_2");
  assert.equal(discovery.seasons.length, 1);
  assert.equal(discovery.episodes.length, 2);

  const evidenceItem: StalkerSeriesProbeItem = { id: "701:701", title: "Series B", raw: { id: "701:701", name: "Series B" } };
  const evidenceHarness = harness((params) => {
    if (params.type === "series" && params.action === "get_ordered_list") return { metadata: { type: "series", action: "get_season_rows", movie_id: "701:701", p: 1 } };
    if (params.type === "vod") return { note: "no hierarchy" };
    if (params.action === "get_season_rows") return { data: [{ id: "x1", title: "Episode X", season_number: 3, episode_num: 1, cmd: "opaque-episode-command" }] };
    return {};
  });
  const evidence = await discoverStalkerSeriesDetails(evidenceHarness.session, evidenceItem);
  assert.equal(evidenceHarness.calls.length, 3);
  assert.deepEqual(evidenceHarness.calls[2], { type: "series", action: "get_season_rows", movie_id: "701:701", p: 1 });
  assert.equal(evidence.source, "EVIDENCE_REQUEST");
  assert.equal(evidence.candidateNumberUsed, 3);
  assert.equal(evidence.classification, "EPISODES_FOUND");

  const embeddedSeason: StalkerSeriesSeason = { id: "2", label: "Season 2", rows: [{ season_num: 2, cmd: "opaque-season-command", series: [1, 2, 3] }] };
  const embeddedHarness = harness(() => { throw new Error("embedded episodes must not request"); });
  const embedded = await discoverStalkerSeriesEpisodes(embeddedHarness.session, rawIdItem, embeddedSeason);
  assert.equal(embedded.source, "EMBEDDED");
  assert.deepEqual(embedded.episodes.map((episode) => episode.id), ["1", "2", "3"]);
  assert.equal(embeddedHarness.calls.length, 0);

  const e1Season: StalkerSeriesSeason = { id: "2", label: "Season 2", rows: [{ season_num: 2, cmd: "opaque-season-command" }] };
  const e1Harness = harness(() => ({ data: [{ id: "provider-row-a", season_num: 2, episode_num: 1, name: "Episode 1" }, { id: "provider-row-b", season_num: 2, episode_num: 2, name: "Episode 2" }] }));
  const e1 = await discoverStalkerSeriesEpisodes(e1Harness.session, rawIdItem, e1Season);
  assert.deepEqual(e1Harness.calls, [{ type: "series", action: "get_ordered_list", movie_id: "22866:22866", season_id: "2", episode_id: 0, p: 1 }]);
  assert.equal(e1.source, "EPISODE_CANDIDATE_1");
  assert.deepEqual(e1.episodes.map((episode) => episode.id), ["1", "2"]);

  const e2Season: StalkerSeriesSeason = { id: "3", label: "Season 3", rows: [{ season_num: 3, cmd: "opaque-season-command", category: "observed" }] };
  const e2Harness = harness((params) => params.genre === "*" ? { data: [{ season_num: 3, episode_number: 4, name: "Episode 4" }] } : { data: [] });
  const e2 = await discoverStalkerSeriesEpisodes(e2Harness.session, rawIdItem, e2Season);
  assert.equal(e2Harness.calls.length, 2);
  assert.deepEqual(e2Harness.calls[1], { type: "series", action: "get_ordered_list", movie_id: "22866:22866", category: "22866:22866", genre: "*", season_id: "3", episode_id: 0, p: 1 });
  assert.equal(e2.source, "EPISODE_CANDIDATE_2");

  const noE2Harness = harness(() => ({ data: [] }));
  const noE2 = await discoverStalkerSeriesEpisodes(noE2Harness.session, rawIdItem, e1Season);
  assert.equal(noE2Harness.calls.length, 1);
  assert.equal(noE2.candidateCount, 1);

  const emptyHarness = harness(() => ({ data: [] }));
  const empty = await discoverStalkerSeriesDetails(emptyHarness.session, { id: "702:702", title: "Empty", raw: { id: "702:702" } });
  assert.equal(emptyHarness.calls.length, 2, "candidate 3 must not be invented without response evidence");
  assert.equal(empty.classification, "EMPTY");

  const rawSeasonCmd = "  eyJzZXJpZXNfaWQiOjE4NjQ0LCJzZWFzb25fbnVtIjoyLCJ0eXBlIjoic2VyaWVzIn0=  ";
  const playbackSeason: StalkerSeriesSeason = { id: "2", label: "Season 2", rows: [{ season_num: 2, cmd: rawSeasonCmd }] };
  const playbackHarness = harness(() => ({ cmd: "ffmpeg https://stream.example/episode.m3u8", headers: null }));
  const linked = await probeStalkerSeriesCreateLink(playbackHarness.session, playbackSeason, { id: "2", label: "Episode 2", seasonId: "2", row: { episode_num: 2 } });
  assert.deepEqual(playbackHarness.calls, [{ type: "vod", action: "create_link", cmd: rawSeasonCmd, series: "2" }]);
  assert.equal(playbackHarness.calls[0]?.cmd, rawSeasonCmd);
  assert.equal(linked.observation.classification, "SUCCESS");
  assert.equal(linked.observation.resolvedScheme, "https");
  assert.equal(linked.observation.wrapperPrefix, true);
  assert.equal(linked.observation.extraTransportHints, true);

  const missingCmd = harness(() => { throw new Error("must not request"); });
  const notLinked = await probeStalkerSeriesCreateLink(missingCmd.session, { id: "2", label: "Season 2", rows: [{}] }, { id: "1", label: "Episode 1", seasonId: "2", row: { episode_num: 1 } });
  assert.equal(notLinked.observation.classification, "EVIDENCE_REQUIRED");
  assert.equal(missingCmd.calls.length, 0);

  const redacted = observeStalkerSeriesPayload({ data: [{ title: "see https://secret.example/a", token: "secret-token", url: "https://secret.example/b", cmd: rawSeasonCmd }] });
  assert.equal(redacted.samplePrimitives.join(" ").includes("secret.example"), false);
  assert.equal(redacted.samplePrimitives.some((item) => item.startsWith("token=")), false);
  assert.equal(redacted.samplePrimitives.some((item) => item.startsWith("url=")), false);
  assert.equal(redacted.samplePrimitives.some((item) => item.startsWith("cmd=")), false);

  assert.equal(STALKER_SERIES_PROBE_LIMITS.maxEvidenceCandidates, 3);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.maxEpisodeListCandidates, 2);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.maxPlaybackCandidates, 2);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.page, 1);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.maxSeasonSelections, 1);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.maxEpisodeSelections, 1);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.timeoutMs, 12_000);

  const probeSource = source("lib/stalkerSeriesProbe.ts"), panelSource = source("components/stalker/StalkerSeriesProbePanel.tsx"), productSource = source("components/product/ProductLiveSurface.tsx");
  for (const forbidden of ["get_all_channels", "get_all_movies", "get_all_series", "Promise.all", "while ("]) assert.equal(probeSource.includes(forbidden), false, `Series probe must not contain ${forbidden}`);
  assert.doesNotMatch(probeSource, /\.split\(\s*["']:["']\s*\)/);
  assert.match(probeSource, /movie_id: item\.id/);
  assert.match(probeSource, /evidenceRequestDescriptor/);
  assert.match(probeSource, /type: "vod", action: "create_link", cmd, series: episode\.id/);
  assert.doesNotMatch(probeSource, /type: "series", action: "create_link"/);
  assert.doesNotMatch(probeSource, /atob|btoa|Buffer\.from\([^\n]*base64/i);
  assert.doesNotMatch(probeSource, /\/series\/\$\{|\/episode\/\$\{|streamUrl\s*=/);
  assert.doesNotMatch(probeSource, /disable_ad|download/);
  assert.match(probeSource, /linkedSignal/);
  assert.match(probeSource, /SERIES_PROBE_REQUEST/);
  assert.match(probeSource, /SERIES_PROBE_RESPONSE/);
  assert.match(panelSource, /R16-D3 Diagnostic only/);
  assert.match(panelSource, /BP1 · SERIES CATEGORIES/);
  assert.match(panelSource, /BP2 · SERIES LIST p=1/);
  assert.match(panelSource, /BP3 · SEASONS/);
  assert.match(panelSource, /BP4 · EPISODES/);
  assert.match(panelSource, /BP5 · PLAYBACK DIALECT/);
  assert.match(panelSource, /season fields=/);
  assert.doesNotMatch(panelSource, /NativeVideoPlayer/);
  assert.doesNotMatch(productSource, /section === "series"|setSection\("series"\)|label="Diziler"/);
  assert.match(productSource, /StalkerSeriesProbePanel/);
  assert.match(source("package.json"), /stalkerR16DSeriesProbeScenarios/);
  console.log("stalker R16-D/R16-D2/R16-D3 bounded Series probe scenarios passed");
}
main().catch((error) => { console.error(error); process.exit(1); });
