import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  probeStalkerVodCategories,
  probeStalkerVodCreateLink,
  probeStalkerVodPage,
  type StalkerVodProbeItem,
} from "../lib/stalkerVodProbe";
import { runIsolatedStalkerLogin } from "../lib/stalkerIsolatedLogin";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const probeSource = source("lib/stalkerVodProbe.ts");
const panelSource = source("components/stalker/StalkerVodProbePanel.tsx");
const isolatedSource = source("lib/stalkerIsolatedLogin.ts");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

type Params = Record<string, string | number | boolean | undefined>;
function harness() {
  const calls: Params[] = [];
  return {
    calls,
    session: {
      async handshake() { calls.push({ action: "handshake" }); return { authenticated: true as const }; },
      async request(params: Params) {
        calls.push(params);
        if (params.action === "get_profile") return { name: "Demo", status: "active" };
        if (params.action === "get_main_info") return { tariff_plan: "Basic" };
        if (params.action === "get_categories") return { js: [{ id: "7", title: "Movies" }], total_items: 1 };
        if (params.action === "get_ordered_list") return { data: [{ id: "501", name: "Film A", cmd: "ffmpeg http://portal/item/501" }], total_items: 1, page: 1 };
        if (params.action === "create_link") return { cmd: "ffmpeg https://stream.example/vod/501.m3u8", headers: { hidden: true } };
        throw new Error(`unexpected ${String(params.action)}`);
      },
    },
  };
}

async function main() {
  await scenario("BP1 uses exact VOD categories request", async () => {
    const h = harness();
    const result = await probeStalkerVodCategories(h.session);
    assert.equal(result.observation.classification, "SUCCESS");
    assert.deepEqual(h.calls, [{ type: "vod", action: "get_categories" }]);
    assert.deepEqual(result.categories[0], { id: "7", title: "Movies", idField: "id", titleField: "title" });
  });

  await scenario("BP2 uses exact selected-category page request", async () => {
    const h = harness();
    const result = await probeStalkerVodPage(h.session, { id: "7", title: "Movies", idField: "id", titleField: "title" });
    assert.equal(result.observation.classification, "SUCCESS");
    assert.deepEqual(h.calls, [{ type: "vod", action: "get_ordered_list", category: "7", p: 1 }]);
  });

  await scenario("BP3 uses exact provider cmd and flags", async () => {
    const h = harness();
    const item: StalkerVodProbeItem = { id: "501", title: "Film A", cmd: "ffmpeg http://portal/item/501", idField: "id", titleField: "name", cmdField: "cmd" };
    const result = await probeStalkerVodCreateLink(h.session, item);
    assert.equal(result.observation.classification, "SUCCESS");
    assert.equal(result.observation.resolvedScheme, "https");
    assert.equal(result.observation.extraTransportHints, true);
    assert.deepEqual(h.calls, [{ type: "vod", action: "create_link", cmd: item.cmd, disable_ad: 0, download: 0 }]);
  });

  await scenario("Probe UI enforces BP1 to BP2 to BP3 gates", () => {
    assert.match(panelSource, /categoryObservation\?\.classification !== "SUCCESS"/);
    assert.match(panelSource, /pageObservation\?\.classification !== "SUCCESS"/);
    assert.match(panelSource, /!selectedItem\.cmd/);
    assert.match(panelSource, /categoryStarted\.current/);
    assert.match(panelSource, /pageStarted\.current/);
    assert.match(panelSource, /linkStarted\.current/);
  });

  await scenario("No genre dialect fallback exists in VOD probe", () => {
    assert.doesNotMatch(probeSource, /genre_id|\bgenre\s*:/);
    assert.match(probeSource, /category: category\.id, p: 1/);
  });

  await scenario("No ITV VOD fallback or Series path exists", () => {
    assert.doesNotMatch(probeSource, /type: "itv"|type: "series"/);
    assert.doesNotMatch(panelSource, /type: "itv"|type: "series"/);
  });

  await scenario("No aggregate or persistence path exists", () => {
    assert.doesNotMatch(probeSource, /get_all_channels|AsyncStorage|SecureStore|SQLite|replaceProviderCatalogAtomically|persist\(/);
    assert.doesNotMatch(panelSource, /get_all_channels|AsyncStorage|SecureStore|SQLite|replaceProviderCatalogAtomically|persist\(/);
  });

  await scenario("Sensitive resolved URL and cmd are not rendered", () => {
    assert.doesNotMatch(panelSource, /selectedItem\.cmd\}/);
    assert.doesNotMatch(panelSource, /resolvedSource|source\.url|full.*url/i);
    assert.match(panelSource, /resolved scheme=/);
    assert.match(probeSource, /redactSensitiveText/);
  });

  await scenario("Authenticated session is reused in memory only", async () => {
    const h = harness();
    const result = await runIsolatedStalkerLogin(
      { portalUrl: "https://portal.example", mac: "00:11:22:33:44:55" },
      { createSession: () => h.session },
    );
    assert.equal(result.state, "CONNECTED");
    assert.deepEqual(h.calls.map((call) => call.action), ["handshake", "get_profile", "get_main_info"]);
    assert.match(isolatedSource, /latestIsolatedStalkerSessionForProbe = session/);
    assert.doesNotMatch(isolatedSource, /AsyncStorage|SecureStore/);
  });

  await scenario("Live protocol contracts remain present and unchanged", () => {
    assert.match(isolatedSource, /\{ type: "itv", action: "get_genres" \}/);
    assert.match(isolatedSource, /\{ type: "itv", action: "get_ordered_list", genre, p: page \}/);
    assert.match(isolatedSource, /\{ type: "itv", action: "create_link", cmd \}/);
    assert.doesNotMatch(isolatedSource, /get_all_channels/);
  });

  await scenario("Probe remains diagnostic but is retired from normal product UI", () => {
    assert.match(panelSource, /Diagnostic only/);
    assert.match(panelSource, /Üretim VOD değildir/);
    const productSource = source("components/product/ProductLiveSurface.tsx");
    assert.doesNotMatch(productSource, /StalkerVodProbePanel/);
    assert.match(productSource, /label="Filmler"/);
    assert.match(productSource, /StalkerVodSurface/);
  });

  await scenario("R15 and R16-A regressions remain wired", () => {
    const packageJson = source("package.json");
    for (const name of ["stalkerR15AIsolatedLoginScenarios", "stalkerR15BIsolatedGenresScenarios", "stalkerR15CIsolatedChannelListScenarios", "stalkerR15DIsolatedPlaybackScenarios", "stalkerR16AProductParityScenarios"]) {
      assert.match(packageJson, new RegExp(name));
    }
  });

  await scenario("R16-BP probe test is wired into Stalker regression suite", () => {
    assert.match(source("package.json"), /stalkerR16BPVodProbeScenarios/);
  });

  console.log(`stalker R16-BP VOD probe scenarios passed: ${passed}/13`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
