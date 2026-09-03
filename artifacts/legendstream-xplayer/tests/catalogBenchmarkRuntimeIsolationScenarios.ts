import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProductionQueryClient,
  resolveCatalogAppRuntime,
  resolveCatalogBenchmarkEntry,
} from "../lib/catalogBenchmarkEntry";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const layoutSource = readFileSync(resolve(ROOT, "app/_layout.tsx"), "utf8");
const indexSource = readFileSync(resolve(ROOT, "app/(tabs)/index.tsx"), "utf8");
const benchmarkRootSource = layoutSource.match(
  /if \(appRuntime\.kind === "benchmark"\) \{([\s\S]*?)\n  \}\n\n  if \(!queryClient\)/,
)?.[1];

assert.ok(benchmarkRootSource, "benchmark root branch must remain explicit and inspectable");

let passed = 0;
function scenario(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

scenario("flag off selects the production runtime", () => {
  assert.equal(resolveCatalogAppRuntime(undefined).kind, "production");
  assert.equal(resolveCatalogAppRuntime("0").kind, "production");
});

scenario("flag on selects the benchmark runtime", () => {
  const runtime = resolveCatalogAppRuntime("1");
  let allocations = 0;
  assert.equal(runtime.kind, "benchmark");
  assert.equal(createProductionQueryClient(runtime, () => { allocations += 1; return {}; }), null);
  assert.equal(allocations, 0);
  assert.match(layoutSource, /createProductionQueryClient\(appRuntime, \(\) => new QueryClient\(\)\)/);
});

scenario("benchmark runtime does not mount PlayerProvider", () => {
  assert.equal(resolveCatalogAppRuntime("1").mountPlayerProvider, false);
  assert.doesNotMatch(benchmarkRootSource, /<PlayerProvider>/);
});

scenario("benchmark runtime does not mount CatalogSyncProvider", () => {
  assert.equal(resolveCatalogAppRuntime("1").mountCatalogSyncProvider, false);
  assert.doesNotMatch(benchmarkRootSource, /<CatalogSyncProvider>/);
});

scenario("benchmark runtime does not mount MediaLibraryProvider", () => {
  assert.equal(resolveCatalogAppRuntime("1").mountMediaLibraryProvider, false);
  assert.doesNotMatch(benchmarkRootSource, /<MediaLibraryProvider>/);
});

scenario("benchmark startup disables production backup cleanup", () => {
  assert.equal(resolveCatalogAppRuntime("1").runBackupTempCleanup, false);
  assert.match(layoutSource, /if \(appRuntime\.runBackupTempCleanup\) \{/);
  assert.doesNotMatch(layoutSource, /void cleanupProviderBackupTempFiles[\s\S]*?const appRuntime/);
  assert.doesNotMatch(benchmarkRootSource, /QueryClientProvider|I18nProvider|cleanupProviderBackupTempFiles/);
});

scenario("flag on makes the benchmark route reachable", () => {
  assert.equal(resolveCatalogAppRuntime("1").benchmarkRoute, "/catalog-benchmark");
  assert.equal(resolveCatalogBenchmarkEntry("1"), "/catalog-benchmark");
});

scenario("flag off makes the benchmark route unreachable", () => {
  assert.equal(resolveCatalogAppRuntime(undefined).benchmarkRoute, null);
  assert.equal(resolveCatalogBenchmarkEntry(undefined), null);
});

scenario("normal production Home and provider runtime contract is preserved", () => {
  const runtime = resolveCatalogAppRuntime(undefined);
  assert.deepEqual(
    {
      query: runtime.mountQueryClientProvider,
      i18n: runtime.mountI18nProvider,
      player: runtime.mountPlayerProvider,
      catalog: runtime.mountCatalogSyncProvider,
      media: runtime.mountMediaLibraryProvider,
      cleanup: runtime.runBackupTempCleanup,
    },
    { query: true, i18n: true, player: true, catalog: true, media: true, cleanup: true },
  );
  assert.match(layoutSource, /<QueryClientProvider[\s\S]*?<I18nProvider>[\s\S]*?<PlayerProvider>[\s\S]*?<CatalogSyncProvider>[\s\S]*?<MediaLibraryProvider>[\s\S]*?<RootLayoutNav/);
  assert.match(indexSource, /return <OptimizedHomeScreenV6 \/>/);
});

assert.equal(passed, 9);
console.log("catalog benchmark runtime isolation scenarios: 9/9 passed");
