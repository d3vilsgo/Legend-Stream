import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chooseProviderSwitchPath,
  clearProviderSwitchSnapshot,
  peekProviderSwitchSnapshot,
  primeProviderSwitchSnapshot,
  safeProviderSwitchError,
  shouldPreserveProviderSwitchSnapshot,
  tryBeginProviderSwitch,
} from "../lib/providerSwitchUx";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playerSource = readFileSync(resolve(ROOT, "context/PlayerContext.tsx"), "utf8");
const catalogSource = readFileSync(resolve(ROOT, "context/CatalogSyncContext.tsx"), "utf8");
const screenSource = readFileSync(resolve(ROOT, "components/OptimizedHomeScreenV6.tsx"), "utf8");
const cacheSource = readFileSync(resolve(ROOT, "lib/providerSwitchCache.ts"), "utf8");

let passed = 0;
const scenario = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
};

scenario("usable target cache selects cache path before blocking provider refetch", () => {
  assert.equal(
    chooseProviderSwitchPath({ hasInMemoryChannels: false, hasUsableCatalogCache: true }),
    "cache",
  );
  assert.match(cacheSource, /if \(!hasUsableCatalogCache\(counts\)\) return null;/);
  const cacheBranch = playerSource.indexOf('switchPath === "memory" || switchPath === "cache"');
  const refetch = playerSource.indexOf("loadProviderSmart(fromProvider(existing))", cacheBranch);
  assert.ok(cacheBranch >= 0 && refetch > cacheBranch, "cache branch must precede blocking refetch");
});

scenario("empty target cache preserves existing network switch path", () => {
  assert.equal(
    chooseProviderSwitchPath({ hasInMemoryChannels: false, hasUsableCatalogCache: false }),
    "network",
  );
  assert.match(playerSource, /const smart = await loadProviderSmart\(fromProvider\(existing\)\);/);
  assert.match(catalogSource, /if \(!usable && state\?\.phase !== "ready"\) \{\s*await runSync\("initial"\);/s);
});

scenario("a second provider tap cannot start another switch", () => {
  const first = tryBeginProviderSwitch(null, "provider-b");
  assert.equal(first.started, true);
  const second = tryBeginProviderSwitch(first.providerId, "provider-c");
  assert.equal(second.started, false);
  assert.equal(second.providerId, "provider-b");
  assert.match(screenSource, /tryBeginProviderSwitch\(switchingProviderRef\.current, id\)/);
  assert.match(screenSource, /switchingProviderRef\.current = id;/);
});

scenario("provider switch failure is visible but credential-safe", () => {
  const safe = safeProviderSwitchError(
    new Error("GET https://secret.example/get.php?username=alice&password=swordfish failed"),
  );
  assert.doesNotMatch(safe, /alice|swordfish|secret\.example|get\.php|username=|password=/i);
  assert.match(playerSource, /setError\(safeProviderSwitchError\(caught\)\);/);
  assert.match(screenSource, /visibleErrorText\(error \|\| catalogError\)/);
});

scenario("active account marker follows the committed provider id", () => {
  assert.match(screenSource, /const active = item\.id === provider\.id;/);
  assert.match(screenSource, /const switching = switchingProviderId === item\.id;/);
  assert.match(screenSource, /active \? <Feather name="check-circle"/);
  assert.match(screenSource, /switching \? <ActivityIndicator/);
});

scenario("cached provider handoff never publishes an empty snapshot first", () => {
  const snapshot = {
    providerId: "provider-b",
    ready: true,
    counts: { live: 3, vod: 2, series: 1 },
    live: [{ id: "live-1" }],
    movies: [{ stream_id: 1 }],
    series: [{ series_id: 1 }],
  };
  primeProviderSwitchSnapshot("provider-b", snapshot);
  assert.deepEqual(peekProviderSwitchSnapshot("provider-b"), snapshot);
  assert.equal(
    shouldPreserveProviderSwitchSnapshot({
      snapshotProviderId: "provider-b",
      targetProviderId: "provider-b",
      hasUsableCache: true,
    }),
    true,
  );
  clearProviderSwitchSnapshot("provider-b");
  assert.equal(peekProviderSwitchSnapshot("provider-b"), null);
  assert.match(catalogSource, /if \(primedSnapshot\) \{\s*setSnapshot\(primedSnapshot\);\s*setHasUsableCache\(true\);\s*\} else \{\s*setSnapshot\(EMPTY_SNAPSHOT\);/s);
  assert.match(screenSource, /if \(prepared\) \{\s*setVod\(prepared\.snapshot\.movies\);/s);
});

assert.equal(passed, 6);
console.log("provider switch UX scenarios: 6/6 passed");
