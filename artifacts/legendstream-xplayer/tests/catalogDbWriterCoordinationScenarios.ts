import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enqueueCatalogDbWrite } from "../lib/catalogDbWriter";
import { buildM3UCacheWriteProjection } from "../lib/m3uCacheWriteProjection";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogCacheSource = readFileSync(resolve(ROOT, "lib/catalogCache.ts"), "utf8");
const catalogWriteBatchSource = readFileSync(resolve(ROOT, "lib/catalogWriteBatch.ts"), "utf8");
const m3uCatalogCacheSource = readFileSync(resolve(ROOT, "lib/m3uCatalogCache.ts"), "utf8");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function functionSource(name: string, nextName?: string) {
  const start = catalogCacheSource.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} export must exist`);
  const end = nextName
    ? catalogCacheSource.indexOf(`export async function ${nextName}`, start)
    : catalogCacheSource.length;
  return catalogCacheSource.slice(start, end >= 0 ? end : catalogCacheSource.length);
}

function movie(providerId: string, id: string, streamId: string) {
  return {
    id,
    providerId,
    name: `Movie ${streamId}`,
    streamUrl: `https://iptv.example:8080/movie/alice/swordfish/${streamId}.mp4`,
    category: "Movies",
    contentType: "movie" as const,
  };
}

async function main() {
  await scenario("shared writer serializes concurrent Xtream and M3U style mutations", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const xtream = enqueueCatalogDbWrite(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push("xtream-start");
      await firstGate;
      order.push("xtream-end");
      active -= 1;
    });
    const m3u = enqueueCatalogDbWrite(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push("m3u-start");
      order.push("m3u-end");
      active -= 1;
    });

    await Promise.resolve();
    assert.deepEqual(order, ["xtream-start"]);
    releaseFirst();
    await Promise.all([xtream, m3u]);
    assert.equal(maxActive, 1);
    assert.deepEqual(order, ["xtream-start", "xtream-end", "m3u-start", "m3u-end"]);
  });

  await scenario("every exported catalog mutation crosses the shared coordinator", () => {
    const mutations: Array<[string, string | undefined]> = [
      ["setCatalogSyncState", "getCatalogSyncState"],
      ["replaceCatalogCategories", "getCachedCategories"],
      ["upsertCatalogItems", "replaceCatalogKind"],
      ["replaceCatalogKind", "pruneCatalogKind"],
      ["pruneCatalogKind", "replaceProviderCatalogAtomically"],
      ["replaceProviderCatalogAtomically", "cleanupStagingCatalog"],
      ["cleanupStagingCatalog", "swapStagingToProvider"],
      ["swapStagingToProvider", "getCachedPersistedItems"],
      ["clearNewCatalogFlags", "deleteProviderCatalog"],
      ["deleteProviderCatalog", undefined],
    ];
    for (const [name, next] of mutations) {
      assert.match(functionSource(name, next), /enqueueCatalogDbWrite/, `${name} must use shared writer`);
    }
    assert.doesNotMatch(catalogCacheSource, /withTransactionAsync\(/);
    assert.match(catalogCacheSource, /withExclusiveTransactionAsync\(/);
  });

  await scenario("stable M3U VOD keys prevent row growth when runtime parser IDs change", () => {
    const provider = {
      id: "m3u-provider",
      type: "m3u" as const,
      url: "https://iptv.example:8080/get.php?username=alice&password=swordfish&type=m3u_plus&output=ts",
      createdAt: 1,
    };
    const first = buildM3UCacheWriteProjection(provider, {
      channels: [],
      liveChannels: [],
      movieItems: [movie(provider.id, "m3u-provider:10:Movie-101", "101"), movie(provider.id, "m3u-provider:11:Movie-202", "202")],
      seriesGroups: [],
    });
    const second = buildM3UCacheWriteProjection(provider, {
      channels: [],
      liveChannels: [],
      movieItems: [movie(provider.id, "m3u-provider:98:Movie-202", "202"), movie(provider.id, "m3u-provider:99:Movie-101", "101")],
      seriesGroups: [],
    });
    assert.ok(first && second);
    const firstIds = first.movieRows.map((row) => row.stream_id).sort();
    const secondIds = second.movieRows.map((row) => row.stream_id).sort();
    assert.deepEqual(firstIds, ["101", "202"]);
    assert.deepEqual(secondIds, firstIds);
    assert.equal(new Set([...firstIds, ...secondIds]).size, firstIds.length);
  });

  await scenario("M3U staging swap keeps delete move categories and ready state in one rollback boundary", () => {
    const source = functionSource("swapStagingToProvider", "getCachedPersistedItems");
    const transactionStart = source.indexOf("withExclusiveTransactionAsync");
    const deleteItems = source.indexOf("DELETE FROM catalog_items", transactionStart);
    const updateItems = source.indexOf("UPDATE catalog_items SET provider_id", deleteItems);
    const categories = source.indexOf("await replaceCategories", updateItems);
    const ready = source.indexOf('"ready"', categories);
    const transactionEnd = source.indexOf("});", ready);
    const committedCallback = source.indexOf("options.onBatchCommitted?.", transactionEnd);
    assert.ok(transactionStart >= 0 && deleteItems > transactionStart);
    assert.ok(updateItems > deleteItems);
    assert.ok(categories > updateItems);
    assert.ok(ready > categories);
    assert.ok(transactionEnd > ready);
    assert.ok(committedCallback > transactionEnd, "committed telemetry must publish only after swap commit");
    assert.doesNotMatch(source.slice(transactionStart, transactionEnd), /INSERT INTO catalog_items/);
  });

  await scenario("batch size and INSERT conflict contract remain unchanged", () => {
    assert.match(catalogCacheSource, /const WRITE_BATCH_SIZE = 200;/);
    assert.match(catalogCacheSource, /await db\.runAsync\(/, "production remains row-by-row runAsync");
    assert.match(catalogCacheSource, /CATALOG_SINGLE_ROW_UPSERT_SQL/);
    assert.doesNotMatch(catalogCacheSource, /executePreparedCatalogMultiRowBatch/);
    assert.match(catalogWriteBatchSource, /INSERT INTO catalog_items/);
    assert.match(catalogWriteBatchSource, /ON CONFLICT\(provider_id, kind, item_id\) DO UPDATE SET/);
  });

  await scenario("M3U success path stages sequential batches before the final swap", () => {
    const start = m3uCatalogCacheSource.indexOf("export async function persistM3UProviderCache");
    const source = m3uCatalogCacheSource.slice(start);
    assert.match(source, /__staging__/);
    assert.match(source, /await cleanupStagingCatalog\(provider\.id\)/);
    const liveWrite = source.indexOf('await upsertCatalogItems(stagingProviderId, "live"');
    const vodWrite = source.indexOf('await upsertCatalogItems(stagingProviderId, "vod"');
    const seriesWrite = source.indexOf('await upsertCatalogItems(stagingProviderId, "series"');
    const swap = source.indexOf("await swapStagingToProvider");
    assert.ok(liveWrite >= 0 && vodWrite > liveWrite && seriesWrite > vodWrite && swap > seriesWrite);
    assert.doesNotMatch(source, /replaceProviderCatalogAtomically/);
    assert.doesNotMatch(source, /await replaceCatalogCategories/);
    assert.doesNotMatch(source, /await Promise\.all\(\[\s*pruneCatalogKind/);
  });

  await scenario("M3U persist success path uses staging namespace and never inserts directly into provider_id", () => {
    const start = m3uCatalogCacheSource.indexOf("export async function persistM3UProviderCache");
    const source = m3uCatalogCacheSource.slice(start);
    assert.match(source, /__staging__/);
    assert.match(source, /upsertCatalogItems\(stagingProviderId/);
    assert.doesNotMatch(source, /replaceProviderCatalogAtomically/);
  });

  await scenario("staging swap transaction contains DELETE and UPDATE but no catalog item INSERT", () => {
    const source = functionSource("swapStagingToProvider", "getCachedPersistedItems");
    assert.match(source, /DELETE FROM catalog_items/);
    assert.match(source, /UPDATE catalog_items SET provider_id/);
    assert.doesNotMatch(source, /INSERT INTO catalog_items/);
  });

  assert.equal(passed, 8);
  console.log("catalog DB writer coordination scenarios: 8/8 passed");
}

void main();
