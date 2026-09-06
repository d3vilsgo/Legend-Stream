import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const cacheSource = fs.readFileSync(path.join(root, "lib/catalogCache.ts"), "utf8");
const syncSource = fs.readFileSync(path.join(root, "context/CatalogSyncContext.tsx"), "utf8");
const strategySource = fs.readFileSync(path.join(root, "lib/catalogSyncStrategy.ts"), "utf8");
const persistenceSource = fs.readFileSync(path.join(root, "lib/catalogPersistence.ts"), "utf8");
const xtreamSource = fs.readFileSync(path.join(root, "lib/xtreamCatalog.ts"), "utf8");
const kindCacheSource = fs.readFileSync(path.join(root, "lib/xtreamKindCache.ts"), "utf8");

type Scenario = { name: string; run: () => void };
const scenarios: Scenario[] = [];
const scenario = (name: string, run: () => void) => scenarios.push({ name, run });

const cooperativeWrite = cacheSource.match(/export async function upsertCatalogItems\([\s\S]*?\n\}/)?.[0] ?? "";
const vodFetch = xtreamSource.match(/export async function getVodStreams\([\s\S]*?\n\}/)?.[0] ?? "";

scenario("R1 healthy authoritative bulk is persisted once without forced category replay", () => {
  assert.doesNotMatch(syncSource, /forceCategoryFallback:\s*true/);
  assert.doesNotMatch(strategySource, /if \(healthyBulk && verifyByCategory\) await write\(bulkRows\)/);
  assert.match(strategySource, /if \(healthyBulk[^)]*\)[\s\S]*await write\(bulkRows\)[\s\S]*return metrics\("bulk"\)/);
});

scenario("R2 catalog refresh does not eagerly materialize whole-provider VOD playback queues", () => {
  assert.doesNotMatch(vodFetch, /registerVodQueue\(credentials, rows\)/);
  assert.match(xtreamSource, /export function registerVodPlaybackQueue/);
  assert.match(xtreamSource, /export function getVodPlaybackQueue/);
});

scenario("R3 large Xtream projection uses a bounded cooperative API", () => {
  assert.match(persistenceSource, /export async function projectCatalogItemsCooperatively/);
  assert.match(persistenceSource, /await yieldToUi\(\)/);
  assert.match(syncSource, /await projectCatalogItemsCooperatively\(stagingId,\s*"(live|vod|series)"/);
});

scenario("R4 cooperative projection yields to the macrotask queue between bounded slices", () => {
  const cooperativeProjection = persistenceSource.match(/export async function projectCatalogItemsCooperatively\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(cooperativeProjection, /for \(let start = 0; start < values\.length; start \+=/);
  assert.match(cooperativeProjection, /await yieldToUi\(\)/);
  assert.match(cooperativeProjection, /isCancelled\?\.\(\)/);
});

scenario("R5 unique-ID accounting is folded into cooperative projection instead of a second full-array pass", () => {
  assert.doesNotMatch(syncSource, /for \(const row of rows\) vodUniqueIds\.add/);
  assert.doesNotMatch(syncSource, /for \(const row of rows\) seriesUniqueIds\.add/);
  assert.match(syncSource, /onProjectedItem:/);
});

scenario("R6 fallback progress persistence is coalesced instead of writing every category batch", () => {
  assert.match(syncSource, /createProgressPublisher|publishProgress/);
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

scenario("R9 cancellation remains effective between cooperative projection and write batches", () => {
  assert.match(persistenceSource, /projectCatalogItemsCooperatively[\s\S]*isCancelled/);
  assert.match(cooperativeWrite, /if \(options\.isCancelled\?\.\(\)\) break/);
  assert.match(cooperativeWrite, /if \(options\.isCancelled\?\.\(\)\) return null/);
});

scenario("R10 stale ownership still blocks publish", () => {
  assert.match(kindCacheSource, /if \(options\.canPublish && !options\.canPublish\(\)\)/);
  assert.match(syncSource, /canPublish: \(\) => !isCancelled\(\)/);
});

let passed = 0;
for (const { name, run } of scenarios) {
  try {
    run();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    console.error(`xtream refresh responsiveness failed: ${name}`);
    throw error;
  }
}

console.log(`xtream refresh responsiveness scenarios: ${passed}/${scenarios.length} passed`);
