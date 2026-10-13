import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CATALOG_REFRESH_POLICY,
  lastSuccessfulCatalogRefresh,
  parseCatalogRefreshPolicy,
  shouldRefreshCatalogAutomatically,
  shouldStartCatalogRefresh,
} from "../lib/catalogRefreshPolicy";

const hour = 60 * 60 * 1000;
assert.deepEqual(parseCatalogRefreshPolicy(null), DEFAULT_CATALOG_REFRESH_POLICY);
assert.deepEqual(parseCatalogRefreshPolicy({ version: 1, automaticRefreshEnabled: true, refreshIntervalHours: 72 }), {
  version: 1, automaticRefreshEnabled: true, refreshIntervalHours: 72,
});
assert.equal(shouldRefreshCatalogAutomatically({ policy: DEFAULT_CATALOG_REFRESH_POLICY, hasUsableCache: true, lastSuccessfulAt: 10_000, now: 10_000 + 24 * hour - 1 }), false);
assert.equal(shouldRefreshCatalogAutomatically({ policy: DEFAULT_CATALOG_REFRESH_POLICY, hasUsableCache: true, lastSuccessfulAt: 10_000, now: 10_000 + 24 * hour }), true);
assert.equal(shouldRefreshCatalogAutomatically({ policy: { ...DEFAULT_CATALOG_REFRESH_POLICY, refreshIntervalHours: 72 }, hasUsableCache: true, lastSuccessfulAt: 10_000, now: 10_000 + 72 * hour }), true);
assert.equal(shouldRefreshCatalogAutomatically({ policy: { ...DEFAULT_CATALOG_REFRESH_POLICY, automaticRefreshEnabled: false }, hasUsableCache: true, lastSuccessfulAt: null, now: 100_000 }), false);
assert.equal(shouldRefreshCatalogAutomatically({ policy: DEFAULT_CATALOG_REFRESH_POLICY, hasUsableCache: false, lastSuccessfulAt: null, now: 100_000 }), false);
assert.equal(shouldRefreshCatalogAutomatically({ policy: DEFAULT_CATALOG_REFRESH_POLICY, hasUsableCache: true, lastSuccessfulAt: null, now: 100_000 }), true);
assert.equal(shouldRefreshCatalogAutomatically({ policy: DEFAULT_CATALOG_REFRESH_POLICY, hasUsableCache: true, lastSuccessfulAt: 20_000, now: 10_000 }), false);
assert.equal(lastSuccessfulCatalogRefresh(10, 30), 30);
assert.equal(lastSuccessfulCatalogRefresh(null, undefined), null);
assert.equal(shouldStartCatalogRefresh({ mode: "manual", hasUsableCache: true, policy: { ...DEFAULT_CATALOG_REFRESH_POLICY, automaticRefreshEnabled: false }, lastSuccessfulAt: 10_000, now: 10_001 }), true);
assert.equal(shouldStartCatalogRefresh({ mode: "initial", hasUsableCache: false, policy: { ...DEFAULT_CATALOG_REFRESH_POLICY, automaticRefreshEnabled: false }, lastSuccessfulAt: null, now: 10_001 }), true);
assert.equal(shouldStartCatalogRefresh({ mode: "initial", hasUsableCache: true, policy: DEFAULT_CATALOG_REFRESH_POLICY, lastSuccessfulAt: null, now: 10_001 }), false);
assert.equal(shouldStartCatalogRefresh({ mode: "automatic", hasUsableCache: true, policy: { ...DEFAULT_CATALOG_REFRESH_POLICY, automaticRefreshEnabled: false }, lastSuccessfulAt: null, now: 10_001 }), false);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playerContext = readFileSync(resolve(root, "context/PlayerContext.tsx"), "utf8");
const catalogContext = readFileSync(resolve(root, "context/CatalogSyncContext.tsx"), "utf8");
assert.match(playerContext, /const refreshProviderInBackground = async/);
assert.doesNotMatch(playerContext, /M3U_BACKGROUND_REFRESH_DELAY_MS|consumeM3UCacheActivation/);
assert.match(catalogContext, /resolvedProviderTransport\(provider\) === "m3u"\) await runM3URefresh\("manual"\)/);
assert.match(catalogContext, /activeTransport === "m3u"\) void runM3URefresh\("background"\)/);
console.log("catalog refresh policy scenarios passed.");
