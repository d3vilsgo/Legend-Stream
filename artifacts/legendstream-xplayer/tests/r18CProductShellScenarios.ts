import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_VIEWS, deriveProductCapabilities } from "../lib/productContract";
import { selectTransitionalProductSurface } from "../components/ProductShell";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const indexSource = source("app/(tabs)/index.tsx");
const shellSource = source("components/ProductShell.tsx");
const contractSource = source("lib/productContract.ts");

const scenario = (name: string, run: () => void) => {
  run();
  console.log("PASS: " + name);
};

scenario("app root has one ProductShell boundary for every provider family", () => {
  assert.match(indexSource, /import ProductShell from "@\/components\/ProductShell"/);
  assert.match(indexSource, /return <ProductShell \/>/);
  assert.doesNotMatch(indexSource, /StalkerMainPage|OptimizedHomeScreenV6|provider\?\.type/);
});

scenario("shared ProductView retains every current product destination", () => {
  assert.deepEqual([...PRODUCT_VIEWS], ["home", "live", "movies", "series", "history", "downloads", "settings"]);
});

scenario("transitional delegation consumes product capability rather than provider identity", () => {
  assert.equal(selectTransitionalProductSurface(deriveProductCapabilities("xtream")), "paged");
  assert.equal(selectTransitionalProductSurface(deriveProductCapabilities("m3u")), "paged");
  assert.equal(selectTransitionalProductSurface(deriveProductCapabilities("stalker")), "stalker");
  assert.doesNotMatch(shellSource, /provider\.type\s*===|provider\?\.type\s*===/);
  assert.match(shellSource, /deriveProductCapabilities\(provider\.type\)/);
  assert.match(shellSource, /capabilities\.liveCategoryMode/);
});

scenario("provider switch remounts the delegated shell and cannot retain old shell player/view state", () => {
  assert.match(shellSource, /<StalkerMainPage key=\{provider\.id\}/);
  assert.match(shellSource, /<OptimizedHomeScreenV6 key=\{provider\.id\}/);
  assert.doesNotMatch(shellSource, /setActiveProvider|prepareProviderSwitchCache|tryBeginProviderSwitch/);
});

scenario("ProductShell owns no protocol runtime, catalog payload, or authentication authority", () => {
  for (const forbidden of [
    "create_link", "cmd", "mac", "session", "password", "username",
    "resolveCatalogPlaybackSource", "readCurrentStalkerProductSession",
    "CatalogSyncContext", "MediaLibraryContext", "AsyncStorage",
  ]) assert.equal(shellSource.includes(forbidden), false, "ProductShell leaked " + forbidden);
});

scenario("R18-B playback contract remains free of durable Stalker CMD/session authority", () => {
  for (const forbidden of ["cmd:", "mac:", "session:", "password:", "username:"]) {
    assert.equal(contractSource.toLowerCase().includes(forbidden), false, "product contract leaked " + forbidden);
  }
  assert.match(contractSource, /runtimeSource: string/);
  assert.match(contractSource, /liveIdentity\?: LiveChannelIdentity/);
  assert.match(contractSource, /vodIdentity\?: CatalogPlaybackIdentity/);
  assert.match(contractSource, /progressRef\?: MediaPlaybackRef/);
});

console.log("R18-C product shell scenarios passed.");
