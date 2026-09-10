import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverStalkerSeriesDetails,
  extractStalkerSeriesHierarchy,
  observeStalkerSeriesPayload,
  probeStalkerSeriesCategories,
  probeStalkerSeriesCreateLink,
  probeStalkerSeriesPage,
  STALKER_SERIES_PROBE_LIMITS,
  type StalkerSeriesProbeItem,
} from "../lib/stalkerSeriesProbe";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
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
  const categoriesHarness = harness(() => ({ js: [
    { id: "*", title: "All" },
    { id: "21", title: "Series Category" },
    { id: "21", title: "Duplicate" },
  ] }));
  const categories = await probeStalkerSeriesCategories(categoriesHarness.session);
  assert.deepEqual(categoriesHarness.calls, [{ type: "series", action: "get_categories" }]);
  assert.deepEqual(categories.categories.map((item) => item.id), ["*", "21"]);

  const pageHarness = harness(() => ({
    total_items: 29,
    max_page_items: 14,
    cur_page: 0,
    data: [{ id: "22866:22866", name: "Series A", arbitrary_field: "observed" }],
  }));
  const page = await probeStalkerSeriesPage(pageHarness.session, { id: "21", title: "Series Category" });
  assert.deepEqual(pageHarness.calls, [{ type: "series", action: "get_ordered_list", category: "21", p: 1 }]);
  assert.equal(page.items[0]?.id, "22866:22866");
  assert.equal(page.observation.totalItems, 29);
  assert.equal(page.observation.maxPageItems, 14);
  assert.equal(page.observation.currentPage, 0);

  const rawIdItem: StalkerSeriesProbeItem = {
    id: "22866:22866",
    title: "Series A",
    raw: { id: "22866:22866", name: "Series A" },
  };
  const twoCandidateHarness = harness((params) => {
    if (params.type === "series") return { info: { title: "Series A", year: "2026" } };
    return {
      total_items: 2,
      max_page_items: 14,
      cur_page: 0,
      data: [
        { id: "ep-1", name: "Pilot", season_id: "1", episode_number: 1, cmd: "ffmpeg http://portal/series/ep-1" },
        { id: "ep-2", name: "Second", season_id: "1", episode_number: 2, cmd: "ffmpeg http://portal/series/ep-2" },
      ],
    };
  });
  const discovery = await discoverStalkerSeriesDetails(twoCandidateHarness.session, rawIdItem);
  assert.deepEqual(twoCandidateHarness.calls, [
    { type: "series", action: "get_ordered_list", movie_id: "22866:22866", p: 1 },
    { type: "vod", action: "get_ordered_list", movie_id: "22866:22866", season_id: 0, episode_id: 0, p: 1 },
  ]);
  assert.equal(discovery.classification, "EPISODES_FOUND");
  assert.equal(discovery.source, "CANDIDATE_2");
  assert.equal(discovery.candidateCount, 2);
  assert.equal(discovery.candidateNumberUsed, 2);
  assert.equal(discovery.seasons.length, 1);
  assert.equal(discovery.seasons[0]?.id, "1");
  assert.equal(discovery.episodes.length, 2);
  assert.equal(discovery.episodes[0]?.row.cmd, "ffmpeg http://portal/series/ep-1");

  const implicitHierarchy = extractStalkerSeriesHierarchy({
    data: [
      { id: "a", title: "Episode A", season: "S01", cmd: "http://portal/a" },
      { id: "b", title: "Episode B", season: "S02", cmd: "http://portal/b" },
    ],
  });
  assert.deepEqual(implicitHierarchy.seasons.map((item) => item.id), ["S01", "S02"]);
  assert.equal(implicitHierarchy.episodes.length, 2);

  const directItem: StalkerSeriesProbeItem = {
    id: "direct:direct",
    title: "Direct Series",
    raw: {
      seasons: [{ season_id: "7", episodes: [{ id: "d1", episode_number: 1, name: "Direct Episode", cmd: "http://portal/direct" }] }],
    },
  };
  const noNetwork = harness(() => { throw new Error("must not request"); });
  const direct = await discoverStalkerSeriesDetails(noNetwork.session, directItem);
  assert.equal(direct.classification, "EPISODES_FOUND");
  assert.equal(direct.source, "SELECTED_ROW");
  assert.equal(direct.candidateCount, 0);
  assert.equal(noNetwork.calls.length, 0);

  const evidenceItem: StalkerSeriesProbeItem = {
    id: "701:701",
    title: "Series B",
    raw: { id: "701:701", name: "Series B" },
  };
  const evidenceHarness = harness((params) => {
    if (params.type === "series" && params.action === "get_ordered_list") {
      return { metadata: { type: "series", action: "get_season_rows", movie_id: "701:701", p: 1 } };
    }
    if (params.type === "vod") return { note: "no hierarchy" };
    if (params.action === "get_season_rows") {
      return { data: [{ id: "x1", title: "Episode X", season_number: 3, episode_num: 1, cmd: "http://portal/x1" }] };
    }
    return {};
  });
  const evidence = await discoverStalkerSeriesDetails(evidenceHarness.session, evidenceItem);
  assert.equal(evidenceHarness.calls.length, 3);
  assert.deepEqual(evidenceHarness.calls[2], { type: "series", action: "get_season_rows", movie_id: "701:701", p: 1 });
  assert.equal(evidence.source, "EVIDENCE_REQUEST");
  assert.equal(evidence.candidateNumberUsed, 3);
  assert.equal(evidence.classification, "EPISODES_FOUND");

  const emptyHarness = harness(() => ({ data: [] }));
  const empty = await discoverStalkerSeriesDetails(emptyHarness.session, { id: "702:702", title: "Empty", raw: { id: "702:702" } });
  assert.equal(emptyHarness.calls.length, 2, "candidate 3 must not be invented without response evidence");
  assert.equal(empty.candidateCount, 2);
  assert.equal(empty.classification, "EMPTY");

  const controller = new AbortController();
  controller.abort();
  const abortedHarness = harness(() => { throw new Error("must not request after abort"); });
  const aborted = await discoverStalkerSeriesDetails(abortedHarness.session, { id: "703:703", title: "Abort", raw: { id: "703:703" } }, controller.signal);
  assert.equal(abortedHarness.calls.length, 0);
  assert.equal(aborted.classification, "ERROR");

  const actualCmd = "ffmpeg http://portal/series/episode/real-1";
  const linkHarness = harness(() => ({ cmd: "ffmpeg https://stream.example/episode.m3u8", headers: null }));
  const linked = await probeStalkerSeriesCreateLink(linkHarness.session, { cmd: actualCmd, episode_number: 1, season_id: 1 });
  assert.deepEqual(linkHarness.calls, [{ type: "series", action: "create_link", cmd: actualCmd }]);
  assert.equal(linked.observation.resolvedScheme, "https");
  assert.equal(linked.observation.wrapperPrefix, true);
  assert.equal(linked.observation.extraTransportHints, true);

  const missingCmd = harness(() => { throw new Error("must not request"); });
  const notLinked = await probeStalkerSeriesCreateLink(missingCmd.session, { id: "episode-without-command" });
  assert.equal(notLinked.observation.classification, "EVIDENCE_REQUIRED");
  assert.equal(missingCmd.calls.length, 0);

  const redacted = observeStalkerSeriesPayload({ data: [{ title: "see https://secret.example/a", token: "secret-token", url: "https://secret.example/b" }] });
  assert.equal(redacted.samplePrimitives.join(" ").includes("secret.example"), false);
  assert.equal(redacted.samplePrimitives.some((item) => item.startsWith("token=")), false);
  assert.equal(redacted.samplePrimitives.some((item) => item.startsWith("url=")), false);

  assert.equal(STALKER_SERIES_PROBE_LIMITS.maxEvidenceCandidates, 3);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.page, 1);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.maxSeasonSelections, 1);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.maxEpisodeSelections, 1);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.maxCreateLinks, 1);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.timeoutMs, 12_000);

  const probeSource = source("lib/stalkerSeriesProbe.ts");
  const panelSource = source("components/stalker/StalkerSeriesProbePanel.tsx");
  const productSource = source("components/product/ProductLiveSurface.tsx");
  for (const forbidden of ["get_all_channels", "get_all_movies", "get_all_series", "Promise.all", "while ("]) {
    assert.equal(probeSource.includes(forbidden), false, `Series probe must not contain ${forbidden}`);
  }
  assert.doesNotMatch(probeSource, /\bgenre\b|\bgenre_id\b/);
  assert.doesNotMatch(probeSource, /\.split\(\s*["']:["']\s*\)/, "raw Series IDs must never be split");
  assert.match(probeSource, /movie_id: item\.id, p: 1/);
  assert.match(probeSource, /type: "vod", action: "get_ordered_list", movie_id: item\.id, season_id: 0, episode_id: 0, p: 1/);
  assert.match(probeSource, /Candidate 3 is never invented/);
  assert.match(probeSource, /\{ type: "series", action: "create_link", cmd \}/);
  assert.doesNotMatch(probeSource, /disable_ad|download/);
  assert.match(probeSource, /linkedTimeoutSignal/);
  assert.match(probeSource, /SERIES_PROBE_REQUEST/);
  assert.match(probeSource, /SERIES_PROBE_RESPONSE/);
  const createLinkSource = probeSource.slice(probeSource.indexOf("export async function probeStalkerSeriesCreateLink"));
  assert.doesNotMatch(createLinkSource, /type: "vod"|type: "itv"/, "create_link must not fallback across media types");

  assert.match(panelSource, /R16-D2 Diagnostic only/);
  assert.match(panelSource, /BP1 · SERIES CATEGORIES/);
  assert.match(panelSource, /BP2 · SERIES LIST p=1/);
  assert.match(panelSource, /BP3 · DETAIL \/ SEASON DIALECT/);
  assert.match(panelSource, /BP4 EPISODES/);
  assert.match(panelSource, /BP5 · CREATE_LINK/);
  assert.match(panelSource, /raw id=\{selectedSeries\.id\}/);
  assert.doesNotMatch(panelSource, /NativeVideoPlayer/);
  assert.doesNotMatch(productSource, /section === "series"|setSection\("series"\)|label="Diziler"/);
  assert.match(productSource, /StalkerSeriesProbePanel/);

  const packageJson = source("package.json");
  assert.match(packageJson, /stalkerR16DSeriesProbeScenarios/);
  console.log("stalker R16-D2 bounded Series season/episode probe scenarios passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
