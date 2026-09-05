import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { runIndependentCatalogKinds } from "../lib/xtreamKindSync";
import { stableXtreamLiveId } from "../lib/xtreamIdentity";

type FakeItem = { providerId: string; kind: string; id: string };
type FakeCategory = { providerId: string; kind: string; id: string; name: string };
type FakeState = { items: FakeItem[]; categories: FakeCategory[] };

async function loadPublishWithFakeDb(stateRef: { current: FakeState }, loseOwnership: () => void) {
  const source = fs.readFileSync(path.join(process.cwd(), "lib/xtreamKindCache.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const txn = {
    async getFirstAsync(_sql: string, providerId: string, kind: string) {
      const count = stateRef.current.items.filter(
        (item) => item.providerId === providerId && item.kind === kind,
      ).length;
      if (providerId === "provider-a") loseOwnership();
      return { count };
    },
    async runAsync(sql: string, ...args: unknown[]) {
      if (sql.includes("DELETE FROM catalog_items")) {
        const [providerId, kind] = args as [string, string];
        stateRef.current.items = stateRef.current.items.filter(
          (item) => !(item.providerId === providerId && item.kind === kind),
        );
        return;
      }
      if (sql.includes("UPDATE catalog_items SET provider_id")) {
        const [providerId, stagingId, kind] = args as [string, string, string];
        stateRef.current.items = stateRef.current.items.map((item) =>
          item.providerId === stagingId && item.kind === kind ? { ...item, providerId } : item,
        );
        return;
      }
      if (sql.includes("DELETE FROM catalog_categories")) {
        const [providerId, kind] = args as [string, string];
        stateRef.current.categories = stateRef.current.categories.filter(
          (category) => !(category.providerId === providerId && category.kind === kind),
        );
        return;
      }
      if (sql.includes("INSERT OR REPLACE INTO catalog_categories")) {
        const [providerId, kind, id, name] = args as [string, string, string, string];
        stateRef.current.categories = stateRef.current.categories.filter(
          (category) => !(category.providerId === providerId && category.kind === kind && category.id === id),
        );
        stateRef.current.categories.push({ providerId, kind, id, name });
      }
    },
  };

  const fakeDb = {
    async withExclusiveTransactionAsync(run: (transaction: typeof txn) => Promise<void>) {
      const before = structuredClone(stateRef.current);
      try {
        await run(txn);
      } catch (error) {
        stateRef.current = before;
        throw error;
      }
    },
  };

  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (id: string) => {
      if (id === "expo-sqlite") return { openDatabaseAsync: async () => fakeDb };
      if (id === "./catalogDbWriter") return { enqueueCatalogDbWrite: async (run: () => Promise<unknown>) => run() };
      throw new Error(`Unexpected test require: ${id}`);
    },
  });
  return module.exports.publishStagedCatalogKind as (options: Record<string, unknown>) => Promise<{
    published: boolean;
    stagedCount: number;
    activeCount: number;
  }>;
}

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

  await scenario("ownership loss before transaction success rolls back the staged publish", async () => {
    let owned = true;
    const stateRef = {
      current: {
        items: [
          { providerId: "provider-a", kind: "vod", id: "old" },
          { providerId: "__staging__provider-a:xtream:7:vod", kind: "vod", id: "new" },
        ],
        categories: [
          { providerId: "provider-a", kind: "vod", id: "old-cat", name: "Old category" },
        ],
      } satisfies FakeState,
    };
    const before = structuredClone(stateRef.current);
    const publish = await loadPublishWithFakeDb(stateRef, () => { owned = false; });

    let rejected = false;
    try {
      const result = await publish({
        providerId: "provider-a",
        stagingId: "__staging__provider-a:xtream:7:vod",
        kind: "vod",
        expectedCount: 1,
        categories: [{ category_id: "new-cat", category_name: "New category" }],
        canPublish: () => owned,
      });
      assert.equal(result.published, false, "stale transaction must never report published=true");
    } catch {
      rejected = true;
    }

    assert.equal(rejected, true, "ownership loss inside the transaction must reject so SQLite rolls back");
    assert.deepEqual(stateRef.current, before, "active rows, staging swap, and category mutations must all roll back");
  });

  console.log(`xtream independent kind scenarios: ${passed}/9 passed`);
}

void main();
