import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const clientSource = fs.readFileSync(path.join(root, "lib/xtream/client.ts"), "utf8");
const facadeSource = fs.readFileSync(path.join(root, "lib/xtreamCatalog.ts"), "utf8");
const iptvSource = fs.readFileSync(path.join(root, "lib/iptv.ts"), "utf8");
const syncSource = fs.readFileSync(path.join(root, "context/CatalogSyncContext.tsx"), "utf8");
const apiSource = fs.readFileSync(path.resolve(root, "../api-server/src/routes/iptv.ts"), "utf8");

type Scenario = { name: string; run: () => void };
const scenarios: Scenario[] = [];
const scenario = (name: string, run: () => void) => scenarios.push({ name, run });

scenario("canonical client owns player_api request construction and auth omits action", () => {
  assert.match(clientSource, /new URL\("player_api\.php"/);
  assert.match(clientSource, /if \(action\) url\.searchParams\.set\("action", action\)/);
  assert.match(clientSource, /url\.searchParams\.set\("username", normalized\.username\)/);
  assert.match(clientSource, /url\.searchParams\.set\("password", normalized\.password\)/);
  assert.match(clientSource, /async authenticate\(signal\?: AbortSignal\) \{\s*return requireAuthenticatedPayload\(await request\(undefined, \{\}, signal\)\)/s);
});

scenario("auth is fail-closed before taxonomy fan-out", () => {
  const authIndex = facadeSource.indexOf("await client.authenticate(signal)");
  const taxonomyIndex = facadeSource.indexOf("const [live, vod, series] = await Promise.all");
  assert.ok(authIndex >= 0 && taxonomyIndex > authIndex);
  assert.match(clientSource, /const authenticated = authValue === 1 \|\| authValue === "1" \|\| authValue === true/);
  assert.match(clientSource, /\["disabled", "banned", "expired"\]\.includes\(status\)/);
});

scenario("all taxonomy completes before live content starts", () => {
  assert.match(facadeSource, /const taxonomy = await run\.taxonomy;\s*const streams = await run\.client\.getLiveStreams/s);
  assert.match(facadeSource, /client\.getLiveCategories\(signal\)[\s\S]*client\.getVodCategories\(signal\)[\s\S]*client\.getSeriesCategories\(signal\)/);
});

scenario("CatalogSync run reuses one prepared auth foundation", () => {
  assert.match(syncSource, /getVodCategories\(credentials, controller\.signal\)/);
  assert.match(syncSource, /getSeriesCategories\(credentials, controller\.signal\)/);
  assert.match(syncSource, /getVodStreams\([\s\S]*controller\.signal/s);
  assert.match(syncSource, /getSeries\([\s\S]*controller\.signal/s);
  assert.equal((facadeSource.match(/await client\.authenticate\(signal\)/g) ?? []).length, 1);
  assert.match(iptvSource, /loadXtreamLiveCatalogFromPreparedRun\(credentials\)/);
});

scenario("legacy Live streams-before-categories request chain is removed", () => {
  assert.doesNotMatch(iptvSource, /action", "get_live_streams"/);
  assert.doesNotMatch(iptvSource, /async function loadXtreamDirect/);
  assert.match(iptvSource, /loadXtreamLiveCatalogFromPreparedRun/);
});

scenario("VOD and Series remain bulk-first with category fallback", () => {
  const vodPlan = syncSource.match(/runCatalogFetchPlan<XtreamVodItem[\s\S]*?\n\s*\}\);/)?.[0] ?? "";
  const seriesPlan = syncSource.match(/runCatalogFetchPlan<XtreamSeriesItem[\s\S]*?\n\s*\}\);/)?.[0] ?? "";
  assert.match(vodPlan, /fetchBulk:[\s\S]*getVodStreams\([\s\S]*undefined/);
  assert.match(vodPlan, /fetchCategory:[\s\S]*getVodStreams\(credentials, category\.category_id/);
  assert.match(seriesPlan, /fetchBulk:[\s\S]*getSeries\([\s\S]*undefined/);
  assert.match(seriesPlan, /fetchCategory:[\s\S]*getSeries\(credentials, category\.category_id/);
});

scenario("detail endpoints remain lazy and outside catalog synchronization", () => {
  assert.doesNotMatch(syncSource, /\bgetVodInfo\b|\bgetSeriesInfo\b/);
  assert.match(clientSource, /async getVodInfo\(vodId:/);
  assert.match(clientSource, /async getSeriesInfo\(seriesId:/);
});

scenario("external cancellation is distinct from timeout and web stays proxied", () => {
  assert.match(clientSource, /external\?\.aborted[\s\S]*"CANCELLED"/);
  assert.match(clientSource, /timedOut \|\| name === "TimeoutError"[\s\S]*"TIMEOUT"/);
  assert.match(clientSource, /fetch\("\/api\/iptv\/xtream\/action"/);
  assert.doesNotMatch(clientSource, /console\./);
});

scenario("web proxy supports auth plus all catalog actions", () => {
  assert.match(apiSource, /"get_live_categories"/);
  assert.match(apiSource, /"get_live_streams"/);
  assert.match(apiSource, /body\.action === undefined/);
  assert.match(apiSource, /return action \? data : validateAuth\(data\)/);
});

let passed = 0;
for (const { name, run } of scenarios) {
  try {
    run();
    passed += 1;
  } catch (error) {
    console.error(`xtream request foundation failed: ${name}`);
    throw error;
  }
}

console.log(`xtream request foundation scenarios: ${passed}/${scenarios.length} passed`);
