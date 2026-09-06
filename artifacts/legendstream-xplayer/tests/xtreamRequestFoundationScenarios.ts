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
  const authIndex = facadeSource.indexOf("await client.authenticate(requestSignal)");
  const liveTaxonomyIndex = facadeSource.indexOf("client.getLiveCategories(requestSignal)");
  const vodTaxonomyIndex = facadeSource.indexOf("client.getVodCategories(requestSignal)");
  const seriesTaxonomyIndex = facadeSource.indexOf("client.getSeriesCategories(requestSignal)");
  assert.ok(authIndex >= 0);
  assert.ok(liveTaxonomyIndex > authIndex && vodTaxonomyIndex > authIndex && seriesTaxonomyIndex > authIndex);
  assert.match(clientSource, /const authenticated = authValue === 1 \|\| authValue === "1" \|\| authValue === true/);
  assert.match(clientSource, /\["disabled", "banned", "expired"\]\.includes\(status\)/);
});

scenario("taxonomy siblings are independent after one shared auth", () => {
  assert.match(facadeSource, /type PreparedRun = \{[\s\S]*auth: Promise<void>;[\s\S]*liveTaxonomy: Promise<XtreamCategory\[\]>;[\s\S]*vodTaxonomy: Promise<XtreamCategory\[\]>;[\s\S]*seriesTaxonomy: Promise<XtreamCategory\[\]>;/);
  assert.doesNotMatch(facadeSource, /taxonomy: Promise<PreparedTaxonomy>/);
  assert.doesNotMatch(facadeSource, /const \[live, vod, series\] = await Promise\.all/);
  assert.doesNotMatch(facadeSource, /await run\.taxonomy/);
  assert.match(syncSource, /runIndependentCatalogKinds\(\[/);
  assert.match(syncSource, /kind: "live"[\s\S]*kind: "vod"[\s\S]*kind: "series"/);
});

scenario("CatalogSync lifecycle seeds and releases one controller-backed prepared run", () => {
  const seedIndex = syncSource.indexOf("beginXtreamCatalogRun(credentials, controller.signal)");
  const kindsIndex = syncSource.indexOf("runIndependentCatalogKinds([");
  const releaseIndex = syncSource.indexOf("releaseXtreamCatalogRun(credentials, controller.signal)");
  assert.ok(seedIndex >= 0 && kindsIndex > seedIndex, "prepared run must be seeded before sibling tasks start");
  assert.ok(releaseIndex > kindsIndex, "prepared run must be released after sibling orchestration");
  assert.match(syncSource, /finally \{[\s\S]*releaseXtreamCatalogRun\(credentials, controller\.signal\)/);
});

scenario("Live-first provisional run adopts CatalogSync cancellation without re-auth", () => {
  assert.match(facadeSource, /options: \{ provisional\?: boolean \} = \{\}/);
  assert.match(facadeSource, /existing\.provisional && existing\.externalSignal === undefined && signal/);
  assert.match(facadeSource, /linkExternalAbort\(signal, existing\.requestController\)/);
  assert.match(facadeSource, /beginXtreamCatalogRun\(credentials, undefined, \{ provisional: true \}\)/);
  assert.equal((facadeSource.match(/await client\.authenticate\(requestSignal\)/g) ?? []).length, 1);
});

scenario("content requests are auth-gated without replaying failed taxonomy", () => {
  const liveStreams = facadeSource.match(/export async function getLiveStreams\([\s\S]*?\n\}/)?.[0] ?? "";
  const vodStreams = facadeSource.match(/export async function getVodStreams\([\s\S]*?\n\}/)?.[0] ?? "";
  const series = facadeSource.match(/export async function getSeries\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(liveStreams, /await run\.auth/);
  assert.match(vodStreams, /await run\.auth/);
  assert.match(series, /await run\.auth/);
  assert.doesNotMatch(vodStreams, /await run\.vodTaxonomy/);
  assert.doesNotMatch(series, /await run\.seriesTaxonomy/);
  assert.match(syncSource, /catch \(caught\) \{[\s\S]*CATEGORY_METADATA_UNAVAILABLE[\s\S]*fallback=bulk-baseline-probe/);
});

scenario("CatalogSync kinds share controller-backed prepared auth", () => {
  assert.match(syncSource, /getVodCategories\(credentials, controller\.signal\)/);
  assert.match(syncSource, /getSeriesCategories\(credentials, controller\.signal\)/);
  assert.match(syncSource, /getVodStreams\([\s\S]*controller\.signal/s);
  assert.match(syncSource, /getSeries\([\s\S]*controller\.signal/s);
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
  assert.match(vodPlan, /allowHealthyBulkOnCategoryFailure: true/);
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

scenario("A1-A5 legacy Live compatibility keeps categories fail-open and streams/auth fail-closed", () => {
  const legacyRoute = apiSource.slice(apiSource.indexOf('router.post("/xtream",'));
  assert.match(legacyRoute, /const auth = await executeXtreamRequest\(credentials\)/);
  assert.match(legacyRoute, /let categories: unknown\[\] = \[\];[\s\S]*try \{[\s\S]*get_live_categories[\s\S]*categories = Array\.isArray\(categoryData\) \? categoryData : \[\];[\s\S]*\} catch \{[\s\S]*\}/);
  assert.match(legacyRoute, /const streams = await executeXtreamRequest\(credentials, "get_live_streams"\);[\s\S]*if \(!Array\.isArray\(streams\)\)[\s\S]*NO_LIVE_STREAMS/);
  const authIndex = legacyRoute.indexOf("const auth = await executeXtreamRequest(credentials)");
  const categoryIndex = legacyRoute.indexOf('"get_live_categories"');
  const streamsIndex = legacyRoute.indexOf('"get_live_streams"');
  assert.ok(authIndex >= 0 && categoryIndex > authIndex && streamsIndex > authIndex);
});

scenario("P1-P7 web proxy errors map to native canonical semantic classes", () => {
  assert.match(clientSource, /function mapProxyError[\s\S]*INVALID_CREDENTIALS[\s\S]*"AUTHENTICATION"/);
  assert.match(clientSource, /function mapProxyError[\s\S]*PROVIDER_TIMEOUT[\s\S]*"TIMEOUT"/);
  assert.match(clientSource, /function mapProxyError[\s\S]*PROVIDER_UNREACHABLE[\s\S]*"UNREACHABLE"/);
  assert.match(clientSource, /function mapProxyError[\s\S]*INVALID_PROVIDER_RESPONSE[\s\S]*"INVALID_RESPONSE"/);
  assert.match(clientSource, /function mapProxyError[\s\S]*PROVIDER_HTTP_ERROR[\s\S]*"HTTP_ERROR"/);
  assert.match(clientSource, /if \(external\?\.aborted\)[\s\S]*"CANCELLED"/);
  assert.match(clientSource, /if \(timedOut \|\| name === "TimeoutError"\)[\s\S]*"TIMEOUT"/);
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
