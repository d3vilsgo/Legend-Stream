import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { runCatalogFetchPlan } from "../lib/catalogSyncStrategy";
import { runIndependentCatalogKinds } from "../lib/xtreamKindSync";
import { stableXtreamLiveId } from "../lib/xtreamIdentity";

type FakeItem = { providerId: string; kind: string; id: string };
type FakeCategory = { providerId: string; kind: string; id: string; name: string };
type FakeState = { items: FakeItem[]; categories: FakeCategory[] };
type Category = { category_id: string; category_name: string };
type VodRow = { stream_id: number; category_id?: string | null };

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

  await scenario("slow VOD does not delay Series completion", async () => {
    let resolveVod!: () => void;
    const vodGate = new Promise<void>((resolve) => { resolveVod = resolve; });
    const events: string[] = [];
    const run = runIndependentCatalogKinds([
      { kind: "live", run: async () => { events.push("live-done"); } },
      { kind: "vod", run: async () => { events.push("vod-start"); await vodGate; events.push("vod-done"); } },
      { kind: "series", run: async () => { events.push("series-start"); events.push("series-done"); } },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(events.includes("series-done"), "Series must complete while VOD is still deferred");
    assert.ok(!events.includes("vod-done"), "VOD must still be pending at the Series completion checkpoint");
    resolveVod();
    const result = await run;
    assert.equal(result.series, "success");
    assert.equal(result.vod, "success");
  });

  await scenario("slow Series does not delay VOD completion", async () => {
    let resolveSeries!: () => void;
    const seriesGate = new Promise<void>((resolve) => { resolveSeries = resolve; });
    const events: string[] = [];
    const run = runIndependentCatalogKinds([
      { kind: "live", run: async () => undefined },
      { kind: "vod", run: async () => { events.push("vod-done"); } },
      { kind: "series", run: async () => { events.push("series-start"); await seriesGate; events.push("series-done"); } },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(events.includes("vod-done"), "VOD must complete while Series is still deferred");
    assert.ok(!events.includes("series-done"), "Series must still be pending at the VOD completion checkpoint");
    resolveSeries();
    await run;
  });

  await scenario("healthy VOD bulk survives final category verification failure", async () => {
    const categories: Category[] = [
      { category_id: "1", category_name: "One" },
      { category_id: "2", category_name: "Two" },
      { category_id: "3", category_name: "Three" },
      { category_id: "4", category_name: "Four" },
    ];
    const staging = new Map<number, VodRow>();
    const attempts = new Map<string, number>();
    const result = await runCatalogFetchPlan<VodRow, Category>({
      categories,
      fetchBulk: async () => [
        { stream_id: 1, category_id: "1" },
        { stream_id: 2, category_id: "2" },
        { stream_id: 3, category_id: "3" },
        { stream_id: 4, category_id: null },
      ],
      fetchCategory: async (category) => {
        const attempt = (attempts.get(category.category_id) ?? 0) + 1;
        attempts.set(category.category_id, attempt);
        if (category.category_id === "4") throw new Error("verification unavailable");
        return [{ stream_id: Number(category.category_id), category_id: category.category_id }];
      },
      writeRows: async (rows) => { for (const row of rows) staging.set(row.stream_id, row); },
      categoryIdOf: (row) => row.category_id ?? undefined,
      forceCategoryFallback: true,
      allowHealthyBulkOnCategoryFailure: true,
    });
    assert.equal(result.degradedToHealthyBulk, true);
    assert.deepEqual([...staging.keys()].sort((a, b) => a - b), [1, 2, 3, 4]);
    assert.equal(attempts.get("4"), 2, "failed category receives one parallel attempt plus one serial retry");
    assert.equal(attempts.get("1"), 1, "successful parallel categories must not be fetched again serially");
  });

  await scenario("suspicious VOD bulk plus failed recovery rejects instead of publishing partial staging", async () => {
    const categories: Category[] = [
      { category_id: "1", category_name: "One" },
      { category_id: "2", category_name: "Two" },
      { category_id: "3", category_name: "Three" },
      { category_id: "4", category_name: "Four" },
    ];
    let rejected = false;
    try {
      await runCatalogFetchPlan<VodRow, Category>({
        categories,
        fetchBulk: async () => [],
        fetchCategory: async (category) => {
          if (category.category_id === "2") throw new Error("required recovery failed");
          return [{ stream_id: Number(category.category_id), category_id: category.category_id }];
        },
        writeRows: async () => undefined,
        categoryIdOf: (row) => row.category_id ?? undefined,
        forceCategoryFallback: true,
        allowHealthyBulkOnCategoryFailure: true,
      });
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true);
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

  console.log(`xtream independent kind scenarios: ${passed}/13 passed`);
}

void main();