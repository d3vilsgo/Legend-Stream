import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginManualEpg, endManualEpg, getManualEpgSnapshot, manualEpgDiagnosticLines,
  recordAutoEpgStart, recordManualEpgHeartbeat, selectManualEpgProvider,
} from "../lib/manualEpgMode";
import {
  getXtreamEpgDiagnosticSnapshot, recordXtreamEpgCpuStage, recordXtreamEpgParseYield,
  resetXtreamEpgDiagnosticRun, xtreamEpgDiagnosticLines,
} from "../lib/xtreamEpgDiagnostics";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
const context = source("context/PlayerContext.tsx");
const list = source("components/catalog/PagedCatalogViews.tsx");
const player = source("components/CompatibilityVideoPlayerV2.tsx");
const control = source("components/catalog/ManualEpgControl.tsx");
const iptv = source("lib/iptv.ts");
const stalker = source("components/catalog/StalkerLiveCatalog.tsx");
const xtreamDiag = source("lib/xtreamEpgDiagnostics.ts");
let passed = 0;
const scenario = (label: string, run: () => void) => {
  run();
  passed += 1;
  process.stdout.write(`ok ${passed} - ${label}\n`);
};

scenario("restore has no M3U or Xtream automatic EPG effect", () => {
  assert.doesNotMatch(context, /boundedAutoEpgTriggerKey/);
  assert.match(context, /loadEpgManually = useCallback/);
  assert.match(context, /provider\.type !== "m3u" && provider\.type !== "xtream"/);
});
scenario("Live page registers bounded EPG seeds without fetching", () => {
  assert.match(list, /registerEpgChannels\(provider\.id, seed\)/);
  assert.doesNotMatch(list, /refreshEpg\(provider\.id\)/);
});
scenario("Live player reads cache without auto EPG network work", () => {
  assert.match(player, /registerEpgChannels\(provider\.id, \[currentLive\]\)/);
  assert.doesNotMatch(player, /refreshEpg\(provider\.id, currentLive\.id\)/);
  assert.match(player, /epgNow=\{currentEpg\.now\}/);
});
scenario("single manual press starts one owned attempt and duplicate press is ignored", () => {
  selectManualEpgProvider("a");
  assert.equal(beginManualEpg("a"), true);
  assert.equal(beginManualEpg("a"), false);
  assert.equal(getManualEpgSnapshot().manualPressCount, 1);
  assert.match(context, /await refreshEpg\(providerId, undefined, true\)/);
  assert.match(context, /await bulkEpgPromiseRef\.current\.get\(providerId\)/);
});
scenario("underlying completion ends attempt and allows a later refresh", () => {
  endManualEpg("a", "success");
  assert.equal(getManualEpgSnapshot().manualActive, false);
  assert.equal(beginManualEpg("a"), true);
  assert.equal(getManualEpgSnapshot().manualPressCount, 2);
  endManualEpg("a", "empty");
});
scenario("manual failure remains local to the control", () => {
  beginManualEpg("a");
  endManualEpg("a", "failure");
  assert.match(control, /EPG yüklenemedi/);
  assert.match(control, /disabled=\{loading \|\| !enabled\}/);
  assert.doesNotMatch(list, /disabled=\{epgLoading\}/);
});
scenario("provider switch clears previous provider diagnostic state", () => {
  selectManualEpgProvider("b");
  const state = getManualEpgSnapshot();
  assert.equal(state.providerId, "b");
  assert.equal(state.manualPressCount, 0);
  assert.equal(state.manualActive, false);
  endManualEpg("a", "success");
  assert.equal(getManualEpgSnapshot().providerId, "b");
});
scenario("heartbeat drift is visible during both A and B", () => {
  recordManualEpgHeartbeat("b", 35.4);
  recordManualEpgHeartbeat("b", 10);
  assert.equal(getManualEpgSnapshot().heartbeatDriftMaxMs, 35);
  assert.match(control, /const drift = Date\.now\(\) - expected;[\s\S]*?recordManualEpgHeartbeat\(providerId, drift\);[\s\S]*?recordXtreamEpgHeartbeat\(drift\);/);
});
scenario("no automatic starts and no secrets in diagnostic report", () => {
  const report = manualEpgDiagnosticLines().join("\n");
  assert.match(report, /EPG_TRIGGER_MODE=manual/);
  assert.match(report, /EPG_MANUAL_PRESS_COUNT=0/);
  assert.match(report, /EPG_AUTO_START_COUNT=0/);
  assert.doesNotMatch(report, /password|username|token|cookie|https?:\/\//i);
  assert.match(context, /if \(boundedProvider && !force\) recordAutoEpgStart\(resolvedProviderId\)/);
  recordAutoEpgStart("b");
  assert.equal(getManualEpgSnapshot().autoStartCount, 1);
  selectManualEpgProvider("c");
  assert.match(manualEpgDiagnosticLines().join("\n"), /EPG_AUTO_START_COUNT=0/);
});
scenario("stale publication and work lifetime guards survive", () => {
  assert.match(context, /epgAttemptGenerationRef\.current\.isCurrent\(resolvedProviderId, generation\)/);
  assert.match(context, /EPG_UNDERLYING_SETTLED/);
  assert.match(context, /EPG_RETRY_BACKOFF_MS/);
});
scenario("Xtream and M3U EPG mechanisms remain unchanged", () => {
  assert.match(iptv, /get_short_epg&stream_id=/);
  assert.match(iptv, /parseXmltvAsync\(text, channels, Date\.now\(\), options\.signal, diagnosticXtream\)/);
  assert.match(context, /xmltv\.php\?username=/);
});
scenario("Stalker Live old EPG registration is unchanged", () => {
  assert.match(stalker, /registerEpgChannels\(provider\.id, seed\)/);
  assert.match(stalker, /void refreshEpg\(provider\.id\)/);
});
process.stdout.write(`manual EPG isolation scenarios: ${passed}/${passed} passed\n`);

scenario("Z3C2 diagnostic modes preserve phase isolation and sanitized source-kind reporting", () => {
  assert.match(xtreamDiag, /"FETCH_ONLY"/);
  assert.match(xtreamDiag, /"FETCH_BODY_ONLY"/);
  assert.match(xtreamDiag, /"PARSE_NO_PUBLICATION"/);
  assert.match(xtreamDiag, /"FULL_PIPELINE"/);
  assert.match(iptv, /mode === "FETCH_ONLY"\) return \[\]/);
  assert.match(iptv, /mode === "FETCH_BODY_ONLY"\) return \[\]/);
  assert.match(context, /suppressPublication = provider\.type === "xtream" && xtreamMode !== "FULL_PIPELINE"/);
  assert.match(xtreamDiag, /XTREAM_EPG_DIAGNOSTIC_MODE=/);
  assert.match(xtreamDiag, /XTREAM_EPG_SOURCE_KIND=/);
  assert.match(xtreamDiag, /XTREAM_EPG_MAX_OBSERVED_HEARTBEAT_DRIFT_MS=/);
  assert.doesNotMatch(xtreamDiag, /username|password|token|mac|https?:\/\//i);
});
scenario("Z3C2 source kind distinguishes short EPG and XMLTV without exposing URLs", () => {
  assert.match(iptv, /setXtreamEpgSourceKind\("xmltv"\)/);
  assert.match(iptv, /setXtreamEpgSourceKind\("short_epg"\)/);
  assert.match(iptv, /recordXtreamEpgHeadersReceived\(\)/);
  assert.match(xtreamDiag, /bodyBytes|bodyChars/);
});
scenario("Z3C2 diagnostic mode does not touch playback identity", () => {
  assert.doesNotMatch(xtreamDiag, /streamUrl|playbackStreamId|playbackContainerExtension|create_link/);
});
scenario("Z3C3 separates XML scanning, extraction, channel matching, and bounded normalization", () => {
  resetXtreamEpgDiagnosticRun(48);
  recordXtreamEpgCpuStage("XML_SCAN", 9, 5, 120);
  recordXtreamEpgCpuStage("XML_SCAN", 6, 4, 120);
  recordXtreamEpgCpuStage("CHANNEL_MATCH", 2, 1, 120);
  recordXtreamEpgCpuStage("PARSE_CHUNK", 10, 10, 1);
  recordXtreamEpgParseYield();
  const snapshot = getXtreamEpgDiagnosticSnapshot();
  assert.deepEqual(snapshot.cpu.XML_SCAN, { totalMs: 15, maxSyncMs: 5, workUnits: 240 });
  assert.equal(snapshot.cpu.CHANNEL_MATCH.workUnits, 120);
  assert.equal(snapshot.cpu.PARSE_CHUNK.maxSyncMs, 10);
  assert.equal(snapshot.parseYieldCount, 1);
  assert.match(xtreamEpgDiagnosticLines(snapshot).join("\n"), /XTREAM_EPG_XML_SCAN_MAX_SYNC_MS=5/);
  assert.match(iptv, /scanned % 120 === 0[\s\S]*?measure\("PARSE_CHUNK", chunkStart\);[\s\S]*?recordXtreamEpgParseYield\(\);[\s\S]*?await yieldToUi\(\)/);
  assert.match(context, /start \+= 250[\s\S]*?recordXtreamEpgCpuStage\("NORMALIZE_MAP", elapsed, elapsed, end - start\)/);
  assert.match(context, /recordXtreamEpgCpuStage\("SORT_OR_GROUP", elapsed, elapsed, normalized\.length\)/);
  resetXtreamEpgDiagnosticRun(12);
  assert.equal(getXtreamEpgDiagnosticSnapshot().cpu.XML_SCAN.workUnits, 0);
  assert.equal(getXtreamEpgDiagnosticSnapshot().parseYieldCount, 0);
});
