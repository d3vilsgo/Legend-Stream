import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  removeLegacyStalkerCatalogChannels,
  syncStalkerCatalogForLifecycle,
} from "../lib/stalkerLiveCatalogRouting";

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const provider = {
  id: "r8-stalker",
  type: "stalker" as const,
  url: " http://portal.invalid/stalker_portal/ ",
  mac: " 00:1A:79:12:34:56 ",
};

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function blockBetween(text: string, start: string, end: string) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return text.slice(from, to);
}

async function main() {
  await scenario("non-Stalker lifecycle route never invokes canonical Stalker sync", async () => {
    let calls = 0;
    const result = await syncStalkerCatalogForLifecycle(
      { ...provider, type: "m3u" },
      {},
      (async () => { calls += 1; return {} as never; }) as any,
    );
    assert.equal(result, null);
    assert.equal(calls, 0);
  });

  await scenario("Stalker lifecycle route rejects a missing portal URL before network", async () => {
    let calls = 0;
    await assert.rejects(
      syncStalkerCatalogForLifecycle(
        { ...provider, url: " " },
        {},
        (async () => { calls += 1; return {} as never; }) as any,
      ),
      /credentials are incomplete/i,
    );
    assert.equal(calls, 0);
  });

  await scenario("Stalker lifecycle route rejects a missing MAC before network", async () => {
    let calls = 0;
    await assert.rejects(
      syncStalkerCatalogForLifecycle(
        { ...provider, mac: " " },
        {},
        (async () => { calls += 1; return {} as never; }) as any,
      ),
      /credentials are incomplete/i,
    );
    assert.equal(calls, 0);
  });

  await scenario("Stalker lifecycle route delegates exactly once to canonical R5 sync", async () => {
    const seen: any[] = [];
    const result = await syncStalkerCatalogForLifecycle(
      provider,
      {},
      (async (options: unknown) => {
        seen.push(options);
        return { persisted: 37 } as any;
      }) as any,
    );
    assert.equal(seen.length, 1);
    assert.equal(result?.persisted, 37);
    assert.deepEqual(seen[0].provider, {
      id: provider.id,
      url: "http://portal.invalid/stalker_portal/",
      mac: "00:1A:79:12:34:56",
    });
  });

  await scenario("lifecycle route forwards cancellation signal to canonical sync", async () => {
    const controller = new AbortController();
    let forwarded: AbortSignal | undefined;
    await syncStalkerCatalogForLifecycle(
      provider,
      { signal: controller.signal },
      (async (options: any) => {
        forwarded = options.signal;
        return { persisted: 1 } as any;
      }) as any,
    );
    assert.equal(forwarded, controller.signal);
  });

  await scenario("lifecycle route forwards stale-ownership predicate to canonical sync", async () => {
    const isCurrent = () => true;
    let forwarded: (() => boolean) | undefined;
    await syncStalkerCatalogForLifecycle(
      provider,
      { isCurrent },
      (async (options: any) => {
        forwarded = options.isCurrent;
        return { persisted: 1 } as any;
      }) as any,
    );
    assert.equal(forwarded, isCurrent);
  });

  await scenario("Stalker activation strips only the target provider legacy in-memory rows", () => {
    const channels = [
      { id: "a", providerId: "r8-stalker" },
      { id: "b", providerId: "other" },
      { id: "c", providerId: "r8-stalker" },
    ] as any;
    assert.deepEqual(
      removeLegacyStalkerCatalogChannels(channels, "r8-stalker").map((item) => item.id),
      ["b"],
    );
  });

  const player = source("../context/PlayerContext.tsx");
  const iptv = source("../lib/iptv.ts");
  const stalkerCatalog = source("../components/catalog/StalkerLiveCatalog.tsx");
  const home = source("../components/OptimizedHomeScreenPaged.tsx");
  const sync = source("../lib/stalkerLiveSync.ts");

  await scenario("PlayerContext gates Stalker before generic legacy loadProvider routing", () => {
    const smart = blockBetween(player, "async function loadProviderSmart(", "function xtreamBaseUrl(");
    assert.ok(smart.indexOf('provider.type === "stalker"') < smart.indexOf("resolvedProviderTransport(provider)"));
  });

  await scenario("PlayerContext Stalker smart-load branch invokes only canonical lifecycle sync", () => {
    const smart = blockBetween(player, 'if (provider.type === "stalker") {', 'if (resolvedProviderTransport(provider) !== "xtream")');
    assert.match(smart, /syncStalkerCatalogForLifecycle\(provider/);
    assert.doesNotMatch(smart, /loadProvider\(/);
    assert.doesNotMatch(smart, /get_ordered_list/);
  });

  await scenario("Stalker connect metadata uses canonical persisted cardinality rather than legacy row count", () => {
    const connect = blockBetween(player, "const connectProvider = async", "const refreshProvider = async");
    assert.match(connect, /channelCount:\s*smart\.catalogCount/);
  });

  await scenario("Stalker refresh supplies current-provider ownership to canonical sync", () => {
    const refresh = blockBetween(player, "const refreshProvider = async", "const recoverLegacyCatalogFallback = async");
    assert.match(refresh, /isCurrent:\s*existing\.type === "stalker"/);
    assert.match(refresh, /isCurrentProviderLoad\(ownership\)/);
  });

  await scenario("Stalker provider activation bypasses generic memory and network catalog ownership", () => {
    const activation = blockBetween(player, "const setActiveProvider = async", "const disconnectProvider = async");
    const stalker = blockBetween(activation, 'if (existing.type === "stalker") {', "const switchPath = chooseProviderSwitchPath");
    assert.match(stalker, /removeLegacyStalkerCatalogChannels\(current\.channels, providerId\)/);
    assert.doesNotMatch(stalker, /loadProviderSmart\(/);
    assert.doesNotMatch(stalker, /loadProvider\(/);
  });

  await scenario("legacy direct p=1 implementation is isolated behind the now-bypassed iptv Stalker loader", () => {
    const legacy = blockBetween(iptv, "async function loadStalker", "export async function loadProvider");
    assert.match(legacy, /action:\s*"get_ordered_list"/);
    assert.match(legacy, /p:\s*1/);
    const smart = blockBetween(player, 'if (provider.type === "stalker") {', 'if (resolvedProviderTransport(provider) !== "xtream")');
    assert.doesNotMatch(smart, /loadProvider\(/);
  });

  await scenario("mounted Stalker Live manual refresh remains the canonical R5 sync hook", () => {
    assert.match(stalkerCatalog, /onRefresh=\{sync\.refresh\}/);
    assert.match(stalkerCatalog, /onRefresh:\s*_onRefresh/);
  });

  await scenario("R6 Home keeps Stalker legacy channel fallback disabled", () => {
    assert.match(home, /homeIdentityFallbackChannels = provider\?\.type === "stalker" \? \[\] : playerLiveChannels/);
    assert.match(home, /selectHomeLiveSource\(/);
  });

  await scenario("Home Stalker refresh entry remains routed through PlayerContext refreshProvider", () => {
    const refresh = blockBetween(home, "const refreshPagedCatalog = async", "const switchProvider = async");
    assert.match(refresh, /provider\.type === "stalker"/);
    assert.match(refresh, /await refreshProvider\(\)/);
  });

  await scenario("R7 publish revision remains downstream of successful canonical commit only", () => {
    assert.match(sync, /await dependencies\.commitStaging\(/);
    assert.match(sync, /dependencies\.notePublishSuccess\?\.\(providerId, "live"\)/);
    assert.ok(sync.indexOf("await dependencies.commitStaging(") < sync.indexOf('dependencies.notePublishSuccess?.(providerId, "live")'));
  });

  console.log(`stalker R8 legacy catalog routing scenarios: ${passed}/${passed} passed`);
}

main();
