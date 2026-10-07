import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { normalizeStalkerProductEpg } from "../lib/stalkerProductEpg";
import { stableStalkerLiveChannelId } from "../lib/stalkerLiveCatalog";
import { mergeEpgPrograms, selectProgramsAt } from "../lib/epgRuntime";

const source = (path: string) => readFileSync(new NodeURL(path, import.meta.url), "utf8");

export async function runStalkerProductEpgScenarios() {
  const providerId = "stalker-product";
  const channel = (portalId: string) => ({
    id: stableStalkerLiveChannelId(providerId, portalId),
    providerId,
  });
  const channels = [channel("101"), channel("102"), channel("103"), channel("104")];
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
    }, providerId, channels as any);
    assert.equal(programs.length, 1);
    assert.equal(programs[0].channelId, stableStalkerLiveChannelId(providerId, "101"));
    assert.equal(programs[0].title, "Haber Türkçe");
    assert.equal(programs[0].description, "Açıklama şğüİ");
  });

  await scenario("nested data bulk object is accepted without inventing identities", () => {
    const programs = normalizeStalkerProductEpg({ data: {
      "102": [row("Program", 1791000000, 1791003600)],
    } }, providerId, channels as any);
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
    const programs = normalizeStalkerProductEpg(payload, providerId, sampleChannels as any);
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
    }, providerId, channels as any);
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
    }, providerId, channels as any);
    assert.equal(programs.length, 0);
  });

  await scenario("missing title follows shared Untitled program contract and exact duplicates dedupe", () => {
    const duplicate = row("", 1791000000, 1791001800, { descr: "" });
    const programs = normalizeStalkerProductEpg({ "101": [duplicate, { ...duplicate }] }, providerId, channels as any);
    assert.equal(programs.length, 1);
    assert.equal(programs[0].title, "Untitled program");
  });

  await scenario("repeated refresh replacement does not accumulate duplicates", () => {
    const incoming = normalizeStalkerProductEpg({
      "101": [row("Same", 1791000000, 1791001800)],
    }, providerId, channels as any);
    const ids = new Set(channels.map((item) => item.id));
    const first = mergeEpgPrograms([], ids, incoming);
    const second = mergeEpgPrograms(first, ids, incoming);
    assert.equal(second.length, 1);
  });

  await scenario("current programme selector consumes Stalker millisecond contract", () => {
    const programs = normalizeStalkerProductEpg({
      "101": [row("Current", 1791000000, 1791001800)],
    }, providerId, channels as any);
    assert.equal(selectProgramsAt(programs, 1791000900000).now?.title, "Current");
  });

  await scenario("product source uses one bulk get_epg_info request and existing session authority only", () => {
    const adapter = source("../lib/stalkerProductEpg.ts");
    assert.match(adapter, /getOrCreateStalkerPortalSession\(/);
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
    const probe = source("../components/catalog/StalkerEpgProbeControl.tsx");
    assert.match(manual, /loadEpgManually\(providerId\)/);
    assert.match(manual, /EPG Yükleniyor/);
    assert.match(paged, /<ManualEpgControl providerId=\{provider\.id\} enabled=\{page\.items\.length > 0\} \/>/);
    assert.match(probe, /StalkerEpgObservability/);
    assert.doesNotMatch(manual, /get_epg_info|get_short_epg|StalkerEpgProbe/);
  });

  await scenario("M3U and Xtream network branches remain untouched by Stalker adapter", () => {
    const adapter = source("../lib/stalkerProductEpg.ts");
    assert.doesNotMatch(adapter, /xmltv|player_api|m3u|xtream/i);
  });

  assert.equal(passed, 12);
  console.log("Stalker product EPG scenarios: 12/12 passed");
}
