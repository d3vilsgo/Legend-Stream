import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { inspectStalkerCatalogBridge as inspect, retainStalkerCatalogBridge as retain, snapshotStalkerCatalogBridge as snapshot } from "../lib/stalkerEpgCatalogBridge";
import { normalizeStalkerLivePage, projectStalkerLiveItem } from "../lib/stalkerLiveCatalog";
import { inspectStalkerEpgMapping } from "../lib/stalkerEpgMappingProbe";
import { inspectStalkerEpgGroupRelations } from "../lib/stalkerEpgGroupRelations";
import { StalkerEpgProbe } from "../lib/stalkerEpgProbe";
import { StalkerEpgObservability } from "../lib/stalkerEpgObservability";
import { redactSensitiveText } from "../lib/safeLog";

type Row = Record<string, unknown>;
let passed = 0;
async function test(name: string, run: () => unknown | Promise<unknown>) { await run(); passed++; console.log(`ok ${passed} - ${name}`); }
function fixture(rows: Row[] = [{ id: "playback-a", ch_id: "epg-a" }]) {
  const session = {};
  const raw = rows.map((row) => ({ cmd: "synthetic-command", name: "Gizli program", ...row }));
  const channels = normalizeStalkerLivePage({ data: raw }, "synthetic-provider", 1).items;
  retain(session, "synthetic-provider", raw, channels);
  const sample = snapshot(session, "synthetic-provider", channels[0]?.id ?? "");
  const run = (payload: unknown = { data: { "epg-a": [{ ch_id: "epg-a" }] } }) => inspect(payload, sample, channels[0]?.portalId);
  return { session, raw, channels, sample, run };
}
async function main() {
  await test("catalog id only", () => { const v = fixture([{ id: "playback-a" }]).run().selected; assert.equal(v.id_present, "YES"); assert.equal(v.ch_id_present, "NO"); assert.equal(v.portalId_source, "ID"); });
  await test("catalog ch_id only", () => { const v = fixture([{ ch_id: "epg-a" }]).run().selected; assert.equal(v.id_present, "NO"); assert.equal(v.portalId_source, "CH_ID"); assert.equal(v.portalId_eq_ch_id, "YES"); });
  await test("both equal", () => { assert.equal(fixture([{ id: "same", ch_id: "same" }]).run().selected.id_eq_ch_id, "YES"); });
  await test("both different preserve playback identity", () => { const v = fixture().run().selected; assert.equal(v.id_eq_ch_id, "NO"); assert.equal(v.portalId_eq_id, "YES"); assert.equal(v.portalId_eq_ch_id, "NO"); });
  await test("stream_id fallback", () => { const v = fixture([{ stream_id: "stream-a" }]).run().selected; assert.equal(v.portalId_source, "STREAM_ID"); assert.equal(v.portalId_eq_stream_id, "YES"); });
  await test("source follows actual nullish precedence", () => { const v = fixture([{ id: null, ch_id: "ch-a", stream_id: "stream-a" }]).run().selected; assert.equal(v.portalId_source, "CH_ID"); assert.equal(v.ch_id_eq_stream_id, "NO"); });
  await test("catalog id matches EPG key", () => { assert.equal(fixture().run({ "playback-a": [] }).selected.catalog_id_is_epg_key, "YES"); });
  await test("catalog ch_id matches EPG key", () => { assert.equal(fixture().run().selected.catalog_ch_id_is_epg_key, "YES"); });
  await test("portalId matches EPG key independently", () => { const v = fixture().run({ "playback-a": [] }).selected; assert.equal(v.portalId_is_epg_key, "YES"); assert.equal(v.catalog_ch_id_is_epg_key, "NO"); });
  await test("ch_id matches row.ch_id in the exact candidate group", () => { assert.equal(fixture().run().selected.catalog_ch_id_eq_epg_ch_id, "YES"); });
  await test("missing key does not imply global absence among EPG rows", () => { const v = fixture().run({ elsewhere: [{ ch_id: "epg-a" }] }).selected; assert.equal(v.catalog_ch_id_is_epg_key, "NO"); assert.equal(v.catalog_ch_id_eq_epg_ch_id, "UNKNOWN"); });
  await test("missing raw identity is UNKNOWN, never a guessed selected channel", () => { const v = inspect({}, { rows: [] }, "missing"); assert.equal(v.channels, 0); assert.equal(v.selected.id_present, "UNKNOWN"); assert.equal(v.selected.portalId_source, "UNKNOWN"); });
  await test("multiple ch_id matches are bounded observations", () => {
    const f = fixture([{ id: "playback-a", ch_id: "epg-a" }, { id: "playback-b", ch_id: "epg-b" }]);
    const v = f.run({ "epg-a": [], "epg-b": [] });
    assert.deepEqual(v.aggregates.catalog_ch_id_is_epg_key, { YES: 2, NO: 0, UNKNOWN: 0, confidence: "BOUNDED_ALL_OBSERVED" });
  });
  await test("multi-channel mixed evidence", () => {
    const v = fixture([{ id: "playback-a", ch_id: "epg-a" }, { id: "playback-b", ch_id: "epg-b" }]).run();
    assert.equal(v.aggregates.catalog_ch_id_is_epg_key.confidence, "MIXED");
  });
  await test("32 channel ceiling", () => {
    const v = fixture(Array.from({ length: 40 }, (_, i) => ({ id: `synthetic-${i}` }))).run(); assert.equal(v.channels, 32); assert.equal(v.scope, "BOUNDED");
  });
  await test("returned evidence contains no raw values or programme text", () => {
    const f = fixture(); const text = JSON.stringify(f.run());
    for (const value of ["playback-a", "epg-a", "synthetic-provider", "synthetic-command", "Gizli program"]) assert.ok(!text.includes(value));
    assert.equal(redactSensitiveText(text), text);
  });
  await test("all returned leaves are fixed labels or counts, no identifier hashes", () => {
    const allowed = new Set(["YES", "NO", "UNKNOWN", "ID", "CH_ID", "STREAM_ID", "BOUNDED", "EXACT_CANDIDATE_GROUP_FIRST_64", "BOUNDED_ALL_OBSERVED", "BOUNDED_NONE_OBSERVED", "MIXED"]);
    const visit = (value: unknown) => { if (value && typeof value === "object") Object.values(value).forEach(visit); else assert.ok(typeof value === "number" || allowed.has(String(value))); };
    visit(fixture().run());
  });
  await test("observability blocks injected raw fields and classifications", () => {
    const screen = new StalkerEpgObservability(); screen.observe("CATALOG_BRIDGE", { channels: "secret-id", selected: { id_present: "secret-id", portalId_source: "secret-id" }, aggregates: { id_present: { YES: "secret-id", confidence: "secret-id" } } });
    assert.ok(!screen.summary().includes("secret-id")); assert.match(screen.summary(), /catalog.id_present=UNKNOWN/);
    assert.equal(redactSensitiveText(screen.summary()), screen.summary());
  });
  await test("existing MAPPING output preserved", () => {
    const f = fixture(); const screen = new StalkerEpgObservability(); screen.observe("MAPPING", inspectStalkerEpgMapping({}, { portalId: f.channels[0].portalId }));
    const lines = () => screen.summary().split("\n").filter((line) => /^(MAPPING|mapping\.)/.test(line)); const before = lines();
    screen.observe("CATALOG_BRIDGE", f.run()); assert.deepEqual(lines(), before);
  });
  await test("existing GROUP_RELATION output preserved", () => {
    const screen = new StalkerEpgObservability(); screen.observe("GROUP_RELATION", inspectStalkerEpgGroupRelations({ epg: [{ ch_id: "epg" }] }));
    const lines = () => screen.summary().split("\n").filter((line) => /^(GROUP_RELATION|group\.)/.test(line)); const before = lines();
    screen.observe("CATALOG_BRIDGE", fixture().run()); assert.deepEqual(lines(), before);
  });
  await test("touch path stays synchronous and single-flight", async () => {
    const screen = new StalkerEpgObservability(); const probe = new StalkerEpgProbe(); const f = fixture(); let calls = 0;
    const options = { getSession: () => ({ isAuthenticated: () => true, request: async () => { calls++; return { "epg-a": [{ ch_id: "epg-a", name: "synthetic", start: 1791000000, end: 1791001800 }] }; } }), getIdentity: async () => ({ portalId: "playback-a" }), getCatalogEvidence: () => f.sample, log: () => {} };
    screen.touch("PRESS"); screen.press(true, probe, options); assert.match(screen.getSnapshot(), /PRESS\nPRESSED$/);
    screen.press(true, probe, options); assert.match(screen.getSnapshot(), /ALREADY_RUNNING$/);
    for (let i = 0; i < 12; i++) await Promise.resolve(); assert.equal(calls, 1); assert.match(screen.summary(), /BRIDGE_SAMPLE channels=1/);
  });
  await test("one bulk request returns no product data and orders bridge after group", async () => {
    const f = fixture(); const calls: unknown[] = []; const events: string[] = [];
    const result = await new StalkerEpgProbe().run({ getSession: () => ({ isAuthenticated: () => true, request: async (params) => { calls.push(params); return { "epg-a": [{ name: "synthetic", start: 1791000000, end: 1791001800 }] }; } }), getIdentity: async () => ({ portalId: "playback-a" }), getCatalogEvidence: () => f.sample, log: (event) => { events.push(event); } });
    assert.equal(result, undefined); assert.deepEqual(calls, [{ type: "itv", action: "get_epg_info" }]);
    assert.deepEqual(events.filter((e) => /GROUP_RELATION|CATALOG_BRIDGE|RESULT/.test(e)), ["R18_E0P_GROUP_RELATION", "R18_E0P_CATALOG_BRIDGE", "R18_E0P_RESULT"]);
  });
  await test("session and provider isolation", () => {
    const f = fixture(); assert.equal(snapshot({}, "synthetic-provider", f.channels[0].id).rows.length, 0);
    assert.equal(snapshot(f.session, "other-provider", f.channels[0].id).rows.length, 0);
    assert.equal(inspect({}, f.sample, "wrong-portal").selected.portalId_source, "UNKNOWN");
  });
  await test("page replacement does not mutate a running snapshot", () => {
    const f = fixture(); retain(f.session, "synthetic-provider", [], []);
    assert.equal(f.sample.rows.length, 1); assert.equal(snapshot(f.session, "synthetic-provider", "").rows.length, 0);
  });
  await test("get_all_channels fallback is excluded", () => {
    const f = fixture(); retain(f.session, "synthetic-provider", f.raw, f.channels, false);
    assert.equal(snapshot(f.session, "synthetic-provider", "").rows.length, 0);
  });
  await test("duplicate catalog identity is not accepted as unique evidence", () => {
    const f = fixture([{ id: "same", ch_id: "one" }, { id: "same", ch_id: "two" }]); assert.equal(f.sample.rows.length, 0);
  });
  await test("abort suppresses late bridge publication", async () => {
    let resolve!: (value: unknown) => void; let started!: () => void;
    const response = new Promise((done) => { resolve = done; }); const begun = new Promise<void>((done) => { started = done; });
    const events: string[] = []; const probe = new StalkerEpgProbe();
    const work = probe.run({ getSession: () => ({ isAuthenticated: () => true, request: () => { started(); return response; } }), getIdentity: async () => ({}), getCatalogEvidence: () => fixture().sample, log: (event) => { events.push(event); } });
    await begun; probe.cancel(); resolve({}); await work; assert.ok(!events.includes("R18_E0P_CATALOG_BRIDGE"));
  });
  await test("capture validates pairing and product DTO remains unchanged", () => {
    const f = fixture(); const before = JSON.stringify(f.channels.map((row) => projectStalkerLiveItem("synthetic-provider", row)));
    retain(f.session, "synthetic-provider", f.raw, [{ ...f.channels[0], portalId: "mismatch" }]);
    assert.equal(snapshot(f.session, "synthetic-provider", "").rows.length, 0);
    assert.equal(JSON.stringify(f.channels.map((row) => projectStalkerLiveItem("synthetic-provider", row))), before);
    assert.ok(!before.includes("epg-a"));
  });
  await test("actual Live path captures only after persistence and cancellation check", () => {
    const source = readFileSync(new NodeURL("../lib/stalkerLazyLivePageRepository.ts", import.meta.url), "utf8");
    const capture = source.lastIndexOf("retainStalkerCatalogBridge(session");
    assert.ok(capture > source.indexOf("await upsertCatalogItems"));
    assert.ok(capture > source.lastIndexOf("if (signal?.aborted)"));
    assert.match(source.slice(capture), /ordered.rows, normalized.items, !ordered.compatibilityFallback/);
    const control = readFileSync(new NodeURL("../components/catalog/StalkerEpgProbeControl.tsx", import.meta.url), "utf8");
    assert.match(control, /getCatalogEvidence: \(session\) => snapshotStalkerCatalogBridge\(session, provider.id, channel\?\.id/);
  });
  assert.equal(passed, 29);
  console.log(`R18-E1C catalog bridge scenarios: ${passed}/29 passed`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
