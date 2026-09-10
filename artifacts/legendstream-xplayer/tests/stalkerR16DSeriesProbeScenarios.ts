import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverStalkerSeriesDetails,
  inspectStalkerSeriesNestedContainers,
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

function harness(handler: (params: Params) => unknown) {
  const calls: Params[] = [];
  return {
    calls,
    session: {
      async handshake() { return { authenticated: true as const }; },
      async request(params: Params) {
        calls.push({ ...params });
        return handler(params);
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
    total_items: 1,
    max_page_items: 14,
    cur_page: 1,
    data: [{ id: "700", name: "Series A", arbitrary_field: "observed" }],
  }));
  const page = await probeStalkerSeriesPage(pageHarness.session, { id: "21", title: "Series Category" });
  assert.deepEqual(pageHarness.calls, [{ type: "series", action: "get_ordered_list", category: "21", p: 1 }]);
  assert.equal(page.items[0]?.id, "700");
  assert.equal(page.observation.fieldNames.includes("arbitrary_field"), true);

  const nested = inspectStalkerSeriesNestedContainers({ bucket: [{ label: "one", children: [{ value: 2 }] }] });
  assert.equal(nested.some((item) => item.path === "bucket"), true);
  assert.equal(nested.some((item) => item.path === "bucket.children"), false, "array rows are bounded and not recursively swept");

  const directItem: StalkerSeriesProbeItem = {
    id: "700",
    title: "Series A",
    raw: { id: "700", bundle: [{ marker: "row" }] },
  };
  const noNetwork = harness(() => { throw new Error("must not request"); });
  const direct = await discoverStalkerSeriesDetails(noNetwork.session, directItem);
  assert.equal(direct.source, "SELECTED_ROW");
  assert.equal(direct.candidateCount, 0);
  assert.equal(noNetwork.calls.length, 0);

  const candidateItem: StalkerSeriesProbeItem = {
    id: "701",
    title: "Series B",
    raw: {
      first: { type: "series", action: "get_candidate_one", item: "701" },
      second: { type: "series", action: "get_candidate_two", item: "701" },
      third: { type: "series", action: "get_candidate_three", item: "701" },
      fourth: { type: "series", action: "get_candidate_four", item: "701" },
    },
  };
  const candidateHarness = harness(() => ({ note: "no nested rows" }));
  const discovery = await discoverStalkerSeriesDetails(candidateHarness.session, candidateItem);
  assert.equal(discovery.classification, "EVIDENCE_REQUIRED");
  assert.equal(candidateHarness.calls.length, 3);
  assert.equal(discovery.candidateCount, 3);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.maxEvidenceCandidates, 3);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.page, 1);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.maxCreateLinks, 1);
  assert.equal(STALKER_SERIES_PROBE_LIMITS.timeoutMs > 0, true);

  const linkHarness = harness(() => ({ cmd: "ffmpeg https://stream.example/episode.m3u8", headers: null }));
  const linked = await probeStalkerSeriesCreateLink(linkHarness.session, { cmd: "ffmpeg http://portal/episode/1" });
  assert.deepEqual(linkHarness.calls, [{ type: "series", action: "create_link", cmd: "ffmpeg http://portal/episode/1" }]);
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

  const probeSource = source("lib/stalkerSeriesProbe.ts");
  const panelSource = source("components/stalker/StalkerSeriesProbePanel.tsx");
  const productSource = source("components/product/ProductLiveSurface.tsx");
  for (const forbidden of ["get_all_channels", "get_all_movies", "get_all_series", "genre_id", "category_id", "Promise.all", "while ("]) {
    assert.equal(probeSource.includes(forbidden), false, `Series probe must not contain ${forbidden}`);
  }
  assert.match(probeSource, /\{ type: "series", action: "get_categories" \}/);
  assert.match(probeSource, /\{ type: "series", action: "get_ordered_list", category: category\.id, p: 1 \}/);
  assert.match(probeSource, /\{ type: "series", action: "create_link", cmd \}/);
  assert.match(probeSource, /SERIES_PROBE_REQUEST/);
  assert.match(probeSource, /SERIES_PROBE_RESPONSE/);
  assert.match(probeSource, /linkedTimeoutSignal/);
  assert.match(panelSource, /Diagnostic only/);
  assert.doesNotMatch(panelSource, /NativeVideoPlayer/);
  assert.doesNotMatch(productSource, /section === "series"|setSection\("series"\)|label="Diziler"/);
  assert.match(productSource, /StalkerSeriesProbePanel/);

  const packageJson = source("package.json");
  assert.match(packageJson, /stalkerR16DSeriesProbeScenarios/);
  console.log("stalker R16-D bounded Series probe scenarios passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
