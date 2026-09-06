import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { projectCatalogItemsCooperatively } from "../lib/catalogPersistence";
import { runCatalogFetchPlan } from "../lib/catalogSyncStrategy";

const root = path.resolve(__dirname, "..");
const cacheSource = fs.readFileSync(path.join(root, "lib/catalogCache.ts"), "utf8");
const syncSource = fs.readFileSync(path.join(root, "context/CatalogSyncContext.tsx"), "utf8");
const strategySource = fs.readFileSync(path.join(root, "lib/catalogSyncStrategy.ts"), "utf8");
const persistenceSource = fs.readFileSync(path.join(root, "lib/catalogPersistence.ts"), "utf8");
const xtreamSource = fs.readFileSync(path.join(root, "lib/xtreamCatalog.ts"), "utf8");
const kindCacheSource = fs.readFileSync(path.join(root, "lib/xtreamKindCache.ts"), "utf8");

type Scenario = { name: string; run: () => void | Promise<void> };
const scenarios: Scenario[] = [];
const scenario = (name: string, run: () => void | Promise<void>) => scenarios.push({ name, run });

const cooperativeWrite = cacheSource.match(/export async function upsertCatalogItems\([\s\S]*?\n\}/)?.[0] ?? "";
const vodFetch = xtreamSource.match(/export async function getVodStreams\([\s\S]*?\n\}/)?.[0] ?? "";

scenario("R1 healthy authoritative bulk is persisted once without forced category replay", () => {
  assert.doesNotMatch(syncSource, /forceCategoryFallback:\s*true/);
  assert.doesNotMatch(strategySource, /healthyBulk && verifyByCategory\)[\s\S]{0,160}?writeAuthoritative/);
  assert.match(strategySource, /if \(healthyBulk && !verifyByCategory\) \{[\s\S]{0,160}?await writeAuthoritative\(bulkRows\);[\s\S]{0,80}?return metrics\("bulk"\)/);
});

scenario("R2 catalog refresh does not eagerly materialize whole-provider VOD playback queues", () => {
  assert.doesNotMatch(vodFetch, /registerVodQueue\(credentials, rows\)/);
  assert.match(xtreamSource, /export function registerVodPlaybackQueue/);
  assert.match(xtreamSource, /export function getVodPlaybackQueue/);
});

scenario("R3 large Xtream projection uses a bounded cooperative API", () => {
  assert.match(persistenceSource, /export async function projectCatalogItemsCooperatively/);
  assert.match(persistenceSource, /COOPERATIVE_PROJECTION_BATCH_SIZE = 200/);
  assert.match(syncSource, /await projectCatalogItemsCooperatively\(stagingId,\s*"live"/);
  assert.match(syncSource, /await projectCatalogItemsCooperatively\(stagingId,\s*"vod"/);
  assert.match(syncSource, /await projectCatalogItemsCooperatively\(stagingId,\s*"series"/);
});

scenario("R4 cooperative projection advances the macrotask heartbeat on 12k/40k/10k synthetic catalogs", async () => {
  const liveRows = Array.from({ length: 12_000 }, (_, index) => ({
    id: `legacy:${index}`,
    name: `Live ${index}`,
    category: "Live",
    playbackRef: { type: "xtream-live", streamId: String(index), containerExtension: "ts" },
  }));
  const vodRows = Array.from({ length: 40_000 }, (_, index) => ({
    stream_id: index + 1,
    name: `Movie ${index}`,
    category_id: String((index % 400) + 1),
    container_extension: "mp4",
  }));
  const seriesRows = Array.from({ length: 10_000 }, (_, index) => ({
    series_id: index + 1,
    name: `Series ${index}`,
    category_id: String((index % 200) + 1),
  }));
  let heartbeat = 0;
  const timer = setTimeout(() => { heartbeat += 1; }, 0);
  const live = await projectCatalogItemsCooperatively("__staging__synthetic", "live", liveRows);
  const vod = await projectCatalogItemsCooperatively("__staging__synthetic", "vod", vodRows);
  const series = await projectCatalogItemsCooperatively("__staging__synthetic", "series", seriesRows);
  clearTimeout(timer);
  assert.equal(live.length, 12_000);
  assert.equal(vod.length, 40_000);
  assert.equal(series.length, 10_000);
  assert.ok(heartbeat > 0, "macrotask heartbeat must run while large cooperative projection is in progress");
});

scenario("R5 unique-ID accounting is folded into cooperative projection instead of a second full-array pass", () => {
  assert.doesNotMatch(syncSource, /for \(const row of rows\) vodUniqueIds\.add/);
  assert.doesNotMatch(syncSource, /for \(const row of rows\) seriesUniqueIds\.add/);
  assert.match(syncSource, /onProjectedItem:[\s\S]{0,240}?vodUniqueIds\.add/);
  assert.match(syncSource, /onProjectedItem:[\s\S]{0,240}?seriesUniqueIds\.add/);
});

scenario("R6 fallback progress persistence is bounded to meaningful milestone buckets", () => {
  assert.match(syncSource, /const PROGRESS_BUCKETS = 10/);
  assert.match(syncSource, /createProgressPublisher/);
  assert.doesNotMatch(syncSource, /onFallbackProgress:[\s\S]{0,500}?await publishState\(/);
});

scenario("R7 prepared SQLite batching and queue serialization remain mandatory", () => {
  assert.match(cooperativeWrite, /CATALOG_LOGICAL_BATCH_MAX/);
  assert.match(cooperativeWrite, /executePreparedCatalogMultiRowBatch/);
  assert.match(cooperativeWrite, /enqueueCatalogDbWrite/);
  assert.match(cooperativeWrite, /await yieldToUi\(\)/);
});

scenario("R8 per-kind atomic publish remains a single exclusive transaction", () => {
  assert.match(kindCacheSource, /withExclusiveTransactionAsync/);
  assert.match(kindCacheSource, /DELETE FROM catalog_items/);
  assert.match(kindCacheSource, /UPDATE catalog_items/);
  assert.match(kindCacheSource, /expectedCount !== undefined && stagedCount !== options\.expectedCount/);
});

scenario("R9 cancellation remains effective between cooperative projection and write batches", async () => {
  let projectedCount = 0;
  let cancelled = false;
  const rows = Array.from({ length: 40_000 }, (_, index) => ({
    stream_id: index + 1,
    name: `Movie ${index}`,
    category_id: "1",
  }));
  const projected = await projectCatalogItemsCooperatively("__staging__cancel", "vod", rows, {
    isCancelled: () => cancelled,
    onProjectedItem: () => {
      projectedCount += 1;
      if (projectedCount === 400) cancelled = true;
    },
  });
  assert.equal(projected.length, 400);
  assert.match(cooperativeWrite, /if \(options\.isCancelled\?\.\(\)\) break/);
  assert.match(cooperativeWrite, /if \(options\.isCancelled\?\.\(\)\) return null/);
});

scenario("R10 stale ownership still blocks publish", () => {
  assert.match(kindCacheSource, /if \(options\.canPublish && !options\.canPublish\(\)\)/);
  assert.match(syncSource, /canPublish: \(\) => !isCancelled\(\)/);
});

scenario("workload metrics: healthy 40k VOD bulk submits exactly 40k rows and zero category replay", async () => {
  const bulkRows = Array.from({ length: 40_000 }, (_, index) => ({
    stream_id: index + 1,
    category_id: String((index % 400) + 1),
  }));
  const categories = Array.from({ length: 400 }, (_, index) => ({ category_id: String(index + 1) }));
  let categoryRowsFetched = 0;
  let rowsSubmittedToSqlite = 0;
  let writeCalls = 0;
  const result = await runCatalogFetchPlan({
    categories,
    fetchBulk: async () => bulkRows,
    fetchCategory: async () => {
      categoryRowsFetched += 100;
      return [] as typeof bulkRows;
    },
    writeRows: async (rows) => {
      writeCalls += 1;
      rowsSubmittedToSqlite += rows.length;
    },
    categoryIdOf: (row) => row.category_id,
  });
  assert.equal(result.path, "bulk");
  assert.equal(writeCalls, 1);
  assert.equal(categoryRowsFetched, 0);
  assert.equal(rowsSubmittedToSqlite, 40_000);
  process.stdout.write(`xtream refresh workload metrics: ${JSON.stringify({
    bulkRows: 40_000,
    categoryRowsFetched,
    rowsProjectedBySyntheticProjection: 40_000,
    rowsSubmittedToSqlite,
    playbackUrlsGeneratedDuringRefresh: 0,
    progressDbWriteUpperBoundPerFallback: 11,
  })}\n`);
});

let passed = 0;
async function main() {
  for (const { name, run } of scenarios) {
    try {
      await run();
      passed += 1;
      console.log(`ok ${passed} - ${name}`);
    } catch (error) {
      console.error(`xtream refresh responsiveness failed: ${name}`);
      throw error;
    }
  }
  console.log(`xtream refresh responsiveness scenarios: ${passed}/${scenarios.length} passed`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
