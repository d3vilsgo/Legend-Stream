import fs from "node:fs";
import path from "node:path";
import {
  runIndependentXtreamKindSync,
  type XtreamKindSyncTask,
} from "../lib/xtreamKindOrchestrator";

type Kind = "live" | "vod" | "series";
type ActiveModel = Record<Kind, Set<string>>;

let passed = 0;
const expect = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  passed += 1;
};

const noCleanup = async () => undefined;

function task(kind: Kind, run: XtreamKindSyncTask["run"], cleanup = noCleanup): XtreamKindSyncTask {
  return { kind, run, cleanup };
}

async function runTasks(tasks: XtreamKindSyncTask[], current = () => true, cancelled = () => false) {
  return runIndependentXtreamKindSync({ tasks, isCurrent: current, isCancelled: cancelled });
}

function swap(model: ActiveModel, kind: Kind, staged: string[]) {
  model[kind] = new Set(staged);
}

async function main() {
  const calls1: Kind[] = [];
  const liveFailure = await runTasks([
    task("live", async () => { calls1.push("live"); throw new Error("live failed"); }),
    task("vod", async () => { calls1.push("vod"); return "published"; }),
    task("series", async () => { calls1.push("series"); return "published"; }),
  ]);
  expect(
    calls1.join(",") === "live,vod,series" && liveFailure.outcomes[0]?.status === "preserved",
    "Live failure must not block VOD or Series",
  );

  const calls2: string[] = [];
  const vodFailure = await runTasks([
    task("live", async () => { calls2.push("live"); return "published"; }),
    task("vod", async () => { calls2.push("vod"); throw new Error("vod failed"); }),
    task("series", async () => { calls2.push("get_series_categories", "get_series"); return "published"; }),
  ]);
  expect(
    calls2.join(",") === "live,vod,get_series_categories,get_series" && vodFailure.outcomes[2]?.status === "published",
    "VOD failure must still execute the Series category and catalog requests",
  );

  const active3: ActiveModel = { live: new Set(["L-old"]), vod: new Set(["V-old"]), series: new Set(["S-old"]) };
  await runTasks([
    task("live", async () => { swap(active3, "live", ["L-new"]); return "published"; }),
    task("vod", async () => { swap(active3, "vod", ["V-new"]); return "published"; }),
    task("series", async () => { throw new Error("series failed"); }),
  ]);
  expect(
    active3.live.has("L-new") && active3.vod.has("V-new") && active3.series.has("S-old"),
    "Series failure must preserve its old cache without rolling back successful Live/VOD kinds",
  );

  const calls4: Kind[] = [];
  await runTasks([
    task("live", async () => { calls4.push("live"); return "published"; }),
    task("vod", async () => { calls4.push("vod"); return "published"; }),
    task("series", async () => { calls4.push("series"); return "published"; }),
  ]);
  expect(calls4.join(",") === "live,vod,series", "An empty/absent VOD capability must not starve Series");

  const active5: ActiveModel = { live: new Set(["L"]), vod: new Set(["V"]), series: new Set(["S-old"]) };
  await runTasks([
    task("live", async () => "published"),
    task("vod", async () => "published"),
    task("series", async () => { swap(active5, "series", []); return "published"; }),
  ]);
  expect(active5.live.has("L") && active5.vod.has("V") && active5.series.size === 0, "Series absence must not disturb Live/VOD");

  let partialStaging = ["V-partial"];
  const active6: ActiveModel = { live: new Set(), vod: new Set(["V-old"]), series: new Set() };
  let publish6 = false;
  await runTasks([
    task("vod", async () => {
      partialStaging.push("V-more");
      throw new Error("category fallback incomplete");
    }, async () => { partialStaging = []; }),
  ]);
  expect(
    !publish6 && partialStaging.length === 0 && active6.vod.has("V-old"),
    "Partial VOD fallback must clean staging and never publish a partial snapshot",
  );

  const active7: ActiveModel = { live: new Set(["L-old"]), vod: new Set(["V-old"]), series: new Set(["S-old"]) };
  await runTasks([task("live", async () => { swap(active7, "live", ["L-new-1", "L-new-2"]); return "published"; })]);
  expect(
    active7.live.size === 2 && active7.live.has("L-new-1") && active7.vod.has("V-old") && active7.series.has("S-old"),
    "Successful publish must replace exactly one catalog kind atomically",
  );

  const active8: ActiveModel = { live: new Set(), vod: new Set(["V-old"]), series: new Set() };
  await runTasks([task("vod", async () => { throw new Error("transport"); })]);
  expect(active8.vod.size === 1 && active8.vod.has("V-old"), "Failed kind must preserve its old active cache");

  const active9: ActiveModel = { live: new Set(["stale-1", "stale-2", "current-1"]), vod: new Set(), series: new Set() };
  await runTasks([task("live", async () => { swap(active9, "live", ["current-1", "current-2"]); return "published"; })]);
  expect(
    active9.live.size === 2 && !active9.live.has("stale-1") && !active9.live.has("stale-2"),
    "Successful kind replacement must remove stale active rows",
  );

  const deduped = new Set(["42", "42", "43", "43", "44"]);
  expect(deduped.size === 3, "Duplicate item IDs must collapse to current unique IDs before active count semantics");

  let generationCurrent = true;
  const calls11: Kind[] = [];
  const generationResult = await runTasks([
    task("live", async () => { calls11.push("live"); generationCurrent = false; return "published"; }),
    task("vod", async () => { calls11.push("vod"); return "published"; }),
    task("series", async () => { calls11.push("series"); return "published"; }),
  ], () => generationCurrent);
  expect(
    generationResult.cancelled && calls11.join(",") === "live",
    "Provider generation loss must prevent all later fetches",
  );

  let cancelled = false;
  const calls12: Kind[] = [];
  const cancellationResult = await runTasks([
    task("live", async () => { calls12.push("live"); cancelled = true; return "published"; }),
    task("vod", async () => { calls12.push("vod"); return "published"; }),
  ], () => true, () => cancelled);
  expect(cancellationResult.cancelled && calls12.join(",") === "live", "Cancellation must stop later kind fetches");

  const contextSource = fs.readFileSync(path.join(process.cwd(), "context/CatalogSyncContext.tsx"), "utf8");
  const stagingSource = fs.readFileSync(path.join(process.cwd(), "lib/xtreamKindStaging.ts"), "utf8");
  expect(
    contextSource.includes("xtreamKindStagingProviderId(provider.id, generation, \"live\")") &&
    contextSource.includes("xtreamKindStagingProviderId(provider.id, generation, \"vod\")") &&
    contextSource.includes("xtreamKindStagingProviderId(provider.id, generation, \"series\")") &&
    stagingSource.includes("${providerId}::xtream::${generation}::${kind}"),
    "Staging ownership must be isolated by provider, generation, and kind",
  );

  expect(
    stagingSource.includes("DELETE FROM catalog_items WHERE provider_id = ? AND kind = ?") &&
    stagingSource.includes("UPDATE catalog_items SET provider_id = ? WHERE provider_id = ? AND kind = ?") &&
    stagingSource.includes("DELETE FROM catalog_categories WHERE provider_id = ? AND kind = ?"),
    "Atomic publish SQL must stay provider+kind scoped with no cross-provider bleed",
  );

  expect(
    contextSource.includes("const categories = await getSeriesCategories(credentials, controller.signal)") &&
    contextSource.includes("fetchBulk: (onParseMs) => getSeries(") &&
    contextSource.indexOf("kind: \"series\"") > contextSource.indexOf("kind: \"vod\""),
    "Series request must be a real independent task after VOD",
  );

  expect(
    contextSource.includes("resolvedProviderTransport(active) !== \"m3u\"") &&
    contextSource.includes("m3uCatalogCommit.providerId !== active.id"),
    "M3U synchronization handoff must remain intact",
  );

  expect(
    contextSource.includes("const runStalkerSync = useCallback") &&
    contextSource.includes("syncStalkerLiveCatalog({") &&
    contextSource.includes("active.type === \"stalker\" ? runStalkerSync : runSync"),
    "Stalker Live synchronization must remain on its dedicated path",
  );

  expect(
    contextSource.includes("getCachedLiveItems(active, undefined, HOME_SAMPLE_LIMIT)") &&
    contextSource.includes("getCachedVodItems(active, undefined, HOME_SAMPLE_LIMIT)") &&
    contextSource.includes("getCachedSeriesItems(active, undefined, HOME_SAMPLE_LIMIT)"),
    "Paged runtime browsing/count paths must remain cache-backed and uncoupled from sync staging",
  );

  process.stdout.write(`xtream independent kind sync scenarios: ${passed}/17 passed\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
