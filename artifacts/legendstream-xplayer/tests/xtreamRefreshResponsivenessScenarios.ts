import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const cacheSource = fs.readFileSync(path.join(root, "lib/catalogCache.ts"), "utf8");
const syncSource = fs.readFileSync(path.join(root, "context/CatalogSyncContext.tsx"), "utf8");
const kindCacheSource = fs.readFileSync(path.join(root, "lib/xtreamKindCache.ts"), "utf8");

type Scenario = { name: string; run: () => void };
const scenarios: Scenario[] = [];
const scenario = (name: string, run: () => void) => scenarios.push({ name, run });

const cooperative = cacheSource.match(/export async function upsertCatalogItems\([\s\S]*?\n\}/)?.[0] ?? "";

scenario("R1 Xtream large staging writes use prepared multi-row batches", () => {
  assert.match(cooperative, /CATALOG_LOGICAL_BATCH_MAX/);
  assert.match(cooperative, /executePreparedCatalogMultiRowBatch/);
  assert.doesNotMatch(cooperative, /insertRows\(/);
});

scenario("R2 cooperative writes yield between logical batches", () => {
  const enqueueIndex = cooperative.indexOf("await enqueueCatalogDbWrite");
  const yieldIndex = cooperative.indexOf("await yieldToUi()");
  assert.ok(enqueueIndex >= 0, "each logical batch must cross the global writer queue");
  assert.ok(yieldIndex > enqueueIndex, "a macrotask/UI yield must occur after each queued batch");
  assert.doesNotMatch(cooperative, /return enqueueCatalogDbWrite\(async \(\) => \{[\s\S]*for \(let start/);
});

scenario("R3 Xtream siblings use the cooperative staging writer without bypassing serialization", () => {
  const uses = syncSource.match(/await upsertCatalogItems\(stagingId,\s*"(live|vod|series)"/g) ?? [];
  assert.equal(uses.length, 3, "Live VOD and Series must all use the cooperative staging writer");
  assert.match(cooperative, /enqueueCatalogDbWrite/);
  assert.ok((syncSource.match(/isCancelled,/g) ?? []).length >= 3);
});

scenario("R4 successful kind publishes do not trigger three full snapshot refreshes", () => {
  const start = syncSource.indexOf("const outcomes = await runIndependentCatalogKinds([");
  const end = syncSource.indexOf("if (outcomes.cancelled || isCancelled())", start);
  assert.ok(start >= 0 && end > start);
  const siblingBlock = syncSource.slice(start, end);
  assert.doesNotMatch(siblingBlock, /await refreshSnapshotFor\(provider, ownership\)/);
  const finalReady = syncSource.slice(end);
  assert.match(finalReady, /"Catalog cache ready"[\s\S]*await refreshSnapshotFor\(provider, ownership\)/);
});

scenario("R5 manual refresh UI state stays bounded while progress remains visible", () => {
  const start = syncSource.indexOf("const outcomes = await runIndependentCatalogKinds([");
  const end = syncSource.indexOf("if (outcomes.cancelled || isCancelled())", start);
  const siblingBlock = syncSource.slice(start, end);
  assert.match(siblingBlock, /Live TV · published/);
  assert.match(siblingBlock, /Movies · published/);
  assert.match(siblingBlock, /Series · published/);
  assert.equal((siblingBlock.match(/refreshSnapshotFor\(provider, ownership\)/g) ?? []).length, 0);
});

scenario("R6 atomic publish and cancellation ownership guards remain mandatory", () => {
  assert.match(kindCacheSource, /withExclusiveTransactionAsync/);
  assert.match(kindCacheSource, /expectedCount !== undefined && stagedCount !== options\.expectedCount/);
  assert.match(kindCacheSource, /if \(options\.canPublish && !options\.canPublish\(\)\)/);
  assert.match(syncSource, /canPublish: \(\) => !isCancelled\(\)/);
  assert.match(cooperative, /if \(options\.isCancelled\?\.\(\)\) break/);
  assert.match(cooperative, /if \(options\.isCancelled\?\.\(\)\) return null/);
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
