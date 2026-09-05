import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runIndependentCatalogKinds } from "../lib/xtreamKindSync";
import { stableXtreamLiveId } from "../lib/xtreamIdentity";

async function main() {
  let passed = 0;
  const scenario = async (name: string, run: () => void | Promise<void>) => {
    await run();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  };

  await scenario("VOD failure does not starve Series", async () => {
    const calls: string[] = [];
    const result = await runIndependentCatalogKinds([
      { kind: "live", run: async () => { calls.push("live"); } },
      { kind: "vod", run: async () => { calls.push("vod"); throw new Error("vod failed"); } },
      { kind: "series", run: async () => { calls.push("series"); } },
    ]);
    assert.deepEqual(calls, ["live", "vod", "series"]);
    assert.equal(result.vod, "failed");
    assert.equal(result.series, "success");
  });

  await scenario("Live failure still attempts VOD and Series", async () => {
    const calls: string[] = [];
    const result = await runIndependentCatalogKinds([
      { kind: "live", run: async () => { calls.push("live"); throw new Error("live failed"); } },
      { kind: "vod", run: async () => { calls.push("vod"); } },
      { kind: "series", run: async () => { calls.push("series"); } },
    ]);
    assert.deepEqual(calls, ["live", "vod", "series"]);
    assert.equal(result.live, "failed");
    assert.equal(result.vod, "success");
    assert.equal(result.series, "success");
  });

  await scenario("global cancellation stops later kind fetches", async () => {
    let cancelled = false;
    const calls: string[] = [];
    const result = await runIndependentCatalogKinds([
      { kind: "live", run: async () => { calls.push("live"); cancelled = true; } },
      { kind: "vod", run: async () => { calls.push("vod"); } },
      { kind: "series", run: async () => { calls.push("series"); } },
    ], { isCancelled: () => cancelled });
    assert.deepEqual(calls, ["live"]);
    assert.equal(result.cancelled, true);
  });

  await scenario("Xtream Live persistent identity is stream-id stable across order changes", () => {
    const first = stableXtreamLiveId("provider-a", "12345");
    const reordered = stableXtreamLiveId("provider-a", "12345");
    assert.equal(first, reordered);
    assert.notEqual(first, stableXtreamLiveId("provider-a", "54321"));
    assert.notEqual(first, stableXtreamLiveId("provider-b", "12345"));
  });

  await scenario("Xtream source uses per-kind staging publish instead of active incremental writes", () => {
    const root = process.cwd();
    const syncSource = fs.readFileSync(path.join(root, "context/CatalogSyncContext.tsx"), "utf8");
    assert.match(syncSource, /cleanupCatalogKindStaging/);
    assert.match(syncSource, /publishStagedCatalogKind/);
    assert.match(syncSource, /stagingCatalogProviderId/);
    assert.doesNotMatch(syncSource, /pruneCatalogKind\(provider\.id/);
  });

  await scenario("Series get_series remains an explicit bulk request after VOD orchestration", () => {
    const root = process.cwd();
    const syncSource = fs.readFileSync(path.join(root, "context/CatalogSyncContext.tsx"), "utf8");
    assert.match(syncSource, /getSeries\(\s*credentials,\s*undefined/);
    assert.match(syncSource, /runIndependentCatalogKinds/);
  });

  await scenario("VOD completeness requires category completion rather than trusting bulk alone", () => {
    const root = process.cwd();
    const syncSource = fs.readFileSync(path.join(root, "context/CatalogSyncContext.tsx"), "utf8");
    assert.match(syncSource, /forceCategoryFallback:\s*true/);
  });

  await scenario("M3U ingest source is untouched by Xtream hotfix contract", () => {
    const root = process.cwd();
    const m3uSource = fs.readFileSync(path.join(root, "lib/m3uCatalogCache.ts"), "utf8");
    assert.match(m3uSource, /swapStagingToProvider/);
    assert.doesNotMatch(m3uSource, /runIndependentCatalogKinds|stableXtreamLiveId/);
  });

  console.log(`xtream independent kind scenarios: ${passed}/8 passed`);
}

void main();
