import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { loadStalkerProductEpg, normalizeStalkerProductEpg, normalizeStalkerProductEpgDetailed } from "../lib/stalkerProductEpg";
import { stableStalkerLiveChannelId } from "../lib/stalkerLiveCatalog";
import { mergeEpgPrograms, selectProgramsAt } from "../lib/epgRuntime";
import { clearStalkerTraceEntries, formatStalkerTrace } from "../lib/stalkerPlaybackTrace";

const source = (path: string) => readFileSync(new NodeURL(path, import.meta.url), "utf8");

export async function runStalkerProductEpgScenarios() {
  const providerId = "stalker-product";
  const channel = (portalId: string) => ({
    id: stableStalkerLiveChannelId(providerId, portalId),
    providerId,
  });
  const channels = [channel("101"), channel("102"), channel("103"), channel("104")];
  const TEST_NOW_MS = 1790999000000;
  const row = (name: string, start: unknown, stop: unknown, extra: Record<string, unknown> = {}) => ({
    id: "ignored-row-id",
    ch_id: "ignored-row-ch-id",
    name,
    descr: "Açıklama şğüİ",
    start_timestamp: start,
    stop_timestamp: stop,
    ...extra,
  });
  let passed = 0;
  const scenario = (name: string, run: () => void | Promise<void>) => {
    const result = run();
    passed += 1;
    console.log(`ok stalker epg ${passed} - ${name}`);
    return result;
  };

  await scenario("bulk object maps only exact known group keys through canonical channel ids", () => {
    const programs = normalizeStalkerProductEpg({
      "101": [row("Haber Türkçe", "1791000000", "1791001800")],
      "999": [row("Unknown", "1791000000", "1791001800")],
    }, providerId, channels as any, TEST_NOW_MS);
    assert.equal(programs.length, 1);
    assert.equal(programs[0].channelId, stableStalkerLiveChannelId(providerId, "101"));
    assert.equal(programs[0].title, "Haber Türkçe");
    assert.equal(programs[0].description, "Açıklama şğüİ");
  });

  await scenario("nested data bulk object is accepted without inventing identities", () => {
    const programs = normalizeStalkerProductEpg({ data: {
      "102": [row("Program", 1791000000, 1791003600)],
    } }, providerId, channels as any, TEST_NOW_MS);
    assert.equal(programs.length, 1);
    assert.equal(programs[0].channelId, stableStalkerLiveChannelId(providerId, "102"));
  });

  await scenario("11 matched and 3 missing channels is legitimate partial coverage", () => {
    const sampleChannels = Array.from({ length: 14 }, (_, index) => channel(String(index + 1)));
    const payload = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [
        String(index + 1),
        [row(`P${index + 1}`, 1791000000 + index * 60, 1791000060 + index * 60)],
      ]),
    );
    const programs = normalizeStalkerProductEpg(payload, providerId, sampleChannels as any, TEST_NOW_MS);
    assert.equal(new Set(programs.map((program) => program.channelId)).size, 11);
    for (const missing of ["12", "13", "14"]) {
      assert.ok(!programs.some((program) => program.channelId === stableStalkerLiveChannelId(providerId, missing)));
    }
  });

  await scenario("multiple channels and programmes normalize seconds to milliseconds and sort", () => {
    const programs = normalizeStalkerProductEpg({
      "101": [
        row("Later", "1791001800", "1791003600"),
        row("Earlier", "1791000000", "1791001800"),
      ],
      "102": [row("Other", "1791000900", "1791002700")],
    }, providerId, channels as any, TEST_NOW_MS);
    assert.deepEqual(programs.map((program) => program.title), ["Earlier", "Other", "Later"]);
    assert.equal(programs[0].start, 1791000000000);
    assert.equal(programs[0].end, 1791001800000);
  });

  await scenario("malformed, non-finite, out-of-range and reversed timestamps are ignored", () => {
    const programs = normalizeStalkerProductEpg({
      "101": [
        row("NaN", "not-a-number", "1791001800"),
        row("Infinity", Infinity, 1791001800),
        row("TooOld", 1, 2),
        row("Reverse", 1791001800, 1791000000),
        row("Equal", 1791000000, 1791000000),
      ],
    }, providerId, channels as any, TEST_NOW_MS);
    assert.equal(programs.length, 0);
  });

  await scenario("missing title follows shared Untitled program contract and exact duplicates dedupe", () => {
    const duplicate = row("", 1791000000, 1791001800, { descr: "" });
    const programs = normalizeStalkerProductEpg({ "101": [duplicate, { ...duplicate }] }, providerId, channels as any, TEST_NOW_MS);
    assert.equal(programs.length, 1);
    assert.equal(programs[0].title, "Untitled program");
  });

  await scenario("repeated refresh replacement does not accumulate duplicates", () => {
    const incoming = normalizeStalkerProductEpg({
      "101": [row("Same", 1791000000, 1791001800)],
    }, providerId, channels as any, TEST_NOW_MS);
    const ids = new Set(channels.map((item) => item.id));
    const first = mergeEpgPrograms([], ids, incoming);
    const second = mergeEpgPrograms(first, ids, incoming);
    assert.equal(second.length, 1);
  });

  await scenario("current programme selector consumes Stalker millisecond contract", () => {
    const programs = normalizeStalkerProductEpg({
      "101": [row("Current", 1791000000, 1791001800)],
    }, providerId, channels as any, TEST_NOW_MS);
    assert.equal(selectProgramsAt(programs, 1791000900000).now?.title, "Current");
  });

  await scenario("expired rows before a current programme cannot consume the channel ceiling", () => {
    const expired = Array.from({ length: 30 }, (_, index) => row(`Old ${index}`, 1790990000 + index * 60, 1790990060 + index * 60));
    const programs = normalizeStalkerProductEpg({
      "101": [...expired, row("Current survives", 1791000000, 1791001800)],
    }, providerId, channels as any, 1791000900000);
    assert.deepEqual(programs.map((program) => program.title), ["Current survives"]);
  });

  await scenario("expired rows before future programmes cannot consume the channel ceiling", () => {
    const expired = Array.from({ length: 30 }, (_, index) => row(`Old ${index}`, 1790990000 + index * 60, 1790990060 + index * 60));
    const future = Array.from({ length: 3 }, (_, index) => row(`Future ${index}`, 1791003600 + index * 1800, 1791005400 + index * 1800));
    const programs = normalizeStalkerProductEpg({ "101": [...expired, ...future] }, providerId, channels as any, 1791000000000);
    assert.deepEqual(programs.map((program) => program.title), ["Future 0", "Future 1", "Future 2"]);
  });

  await scenario("arbitrary portal row order is sorted before applying the channel ceiling", () => {
    const rows = Array.from({ length: 16 }, (_, index) => row(`P${index}`, 1791000000 + index * 60, 1791000060 + index * 60)).reverse();
    const programs = normalizeStalkerProductEpg({ "101": rows }, providerId, channels as any, 1790999000000);
    assert.equal(programs.length, 12);
    assert.deepEqual(programs.slice(0, 3).map((program) => program.title), ["P0", "P1", "P2"]);
    assert.equal(programs.at(-1)?.title, "P11");
  });

  await scenario("all rows expired is an EMPTY product result rather than failure", () => {
    const result = normalizeStalkerProductEpgDetailed({
      "101": [row("Old", 1791000000, 1791001800)],
    }, providerId, channels as any, 1791003600000);
    assert.equal(result.programs.length, 0);
    assert.equal(result.diagnostics.request, "SUCCESS");
    assert.equal(result.diagnostics.result, "EMPTY");
    assert.equal(result.diagnostics.validRows, 1);
    assert.equal(result.diagnostics.expiredRows, 1);
  });

  await scenario("malformed rows do not block valid current rows in the same group", () => {
    const programs = normalizeStalkerProductEpg({
      "101": [
        row("Bad", "invalid", 1791001800),
        { name: "Not an object array entry" },
        row("Good", 1791000000, 1791001800),
      ],
    }, providerId, channels as any, 1791000900000);
    assert.deepEqual(programs.map((program) => program.title), ["Good"]);
  });

  await scenario("sanitized product counters contain no identifiers or programme text", () => {
    const result = normalizeStalkerProductEpgDetailed({
      "101": [row("Gizli Başlık", 1791000000, 1791001800, { descr: "Gizli açıklama" })],
    }, providerId, channels as any, 1790999000000);
    assert.equal(result.diagnostics.result, "SUCCESS");
    const serialized = JSON.stringify(result.diagnostics);
    assert.equal(serialized.includes("101"), false);
    assert.equal(serialized.includes("Gizli"), false);
    assert.equal(serialized.includes("Açıklama"), false);
  });

  await scenario("product trace publishes sanitized SUCCESS counters for physical diagnosis", async () => {
    clearStalkerTraceEntries();
    let requestCount = 0;
    const programs = await loadStalkerProductEpg(
      { id: providerId, url: "https://portal.invalid", mac: "00:11:22:33:44:55" },
      channels as any,
      undefined,
      () => ({ request: async (params: unknown) => {
        requestCount += 1;
        assert.deepEqual(params, { type: "itv", action: "get_epg_info" });
        return { "101": [row("Trace Title", 1891000000, 1891001800)] };
      } } as any),
    );
    const trace = formatStalkerTrace();
    assert.equal(requestCount, 1);
    assert.equal(programs.length, 1);
    assert.match(trace, /STALKER_PRODUCT_EPG/);
    assert.match(trace, /"request":"SUCCESS"/);
    assert.match(trace, /"publishedPrograms":1/);
    assert.equal(trace.includes("101"), false);
    assert.equal(trace.includes("Trace Title"), false);
    assert.equal(trace.includes("portal.invalid"), false);
    assert.equal(trace.includes("00:11:22:33:44:55"), false);
  });

  await scenario("request failure is classified as FAILURE and does not hide as empty", async () => {
    clearStalkerTraceEntries();
    await assert.rejects(
      () => loadStalkerProductEpg(
        { id: providerId, url: "https://portal.invalid" },
        channels as any,
        undefined,
        () => ({ request: async () => { throw new Error("network failed"); } } as any),
      ),
      /network failed/,
    );
    const trace = formatStalkerTrace();
    assert.match(trace, /STALKER_PRODUCT_EPG/);
    assert.match(trace, /"request":"FAILURE"/);
    assert.match(trace, /"result":"FAILURE"/);
  });

  await scenario("product source uses one bulk get_epg_info request and existing session authority only", () => {
    const adapter = source("../lib/stalkerProductEpg.ts");
    assert.match(adapter, /getOrCreateStalkerPortalSession/);
    assert.match(adapter, /\{ type: "itv", action: "get_epg_info" \}/);
    assert.equal((adapter.match(/session\.request\(/g) ?? []).length, 1);
    assert.doesNotMatch(adapter, /get_short_epg|get_epg"|ch_link_id|server\/api|fetch\(/);
  });

  await scenario("shared lifecycle enables Stalker manual load and bounded stale protection", () => {
    const player = source("../context/PlayerContext.tsx");
    assert.match(player, /provider\.type === "m3u" \|\| provider\.type === "xtream" \|\| provider\.type === "stalker"/);
    assert.match(player, /provider\.type !== "m3u" && provider\.type !== "xtream" && provider\.type !== "stalker"/);
    assert.match(player, /loadStalkerProductEpg\(provider, channels, signal\)/);
    assert.match(player, /ownedEpgAttemptsRef\.current\.isCurrent\(ownedAttempt\)/);
    assert.match(player, /epgAttemptGenerationRef\.current\.isCurrent\(resolvedProviderId/);
    assert.match(player, /previous\.provider\?\.id !== resolvedProviderId/);
  });

  await scenario("normal product control remains shared and Stalker surface wiring remains isolated", () => {
    const manual = source("../components/catalog/ManualEpgControl.tsx");
    const paged = source("../components/catalog/PagedCatalogViews.tsx");
    const main = source("../components/StalkerMainPage.tsx");
    assert.match(manual, /loadEpgManually\(providerId\)/);
    assert.match(manual, /EPG Yükleniyor/);
    assert.match(paged, /<ManualEpgControl providerId=\{provider\.id\} enabled=\{page\.items\.length > 0\} \/>/);
    assert.doesNotMatch(paged, /renderDiagnostic|StalkerEpgProbeControl|EPG Yükle · E0P|E0P tanısını kopyala/);
    assert.doesNotMatch(main, /renderDiagnostic|StalkerEpgProbeControl|EPG Yükle · E0P|E0P tanısını kopyala/);
    assert.doesNotMatch(manual, /get_epg_info|get_short_epg|StalkerEpgProbe/);
  });

  await scenario("M3U and Xtream network branches remain untouched by Stalker adapter", () => {
    const adapter = source("../lib/stalkerProductEpg.ts");
    assert.doesNotMatch(adapter, /xmltv|player_api|m3u|xtream/i);
  });

  assert.equal(passed, 20);
  console.log("Stalker product EPG scenarios: 20/20 passed");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runStalkerProductEpgScenarios().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
