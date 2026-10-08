import assert from "node:assert/strict";
import { inspectStalkerEpgGroupRelations as inspect, GROUP_RELATIONS } from "../lib/stalkerEpgGroupRelations";
import { inspectStalkerEpgMapping } from "../lib/stalkerEpgMappingProbe";
import { StalkerEpgObservability } from "../lib/stalkerEpgObservability";
import { StalkerEpgProbe } from "../lib/stalkerEpgProbe";
import { redactSensitiveText } from "../lib/safeLog";

let passed = 0;
async function test(name: string, run: () => unknown | Promise<unknown>) { await run(); passed++; console.log(`ok ${passed} - ${name}`); }
const row = { ch_id: "synthetic-group", real_id: "synthetic-group", id: "synthetic-group", name: "Gizli Türkçe program", start_timestamp: 1791000000, stop_timestamp: 1791001800 };
const group = (...rows: unknown[]) => ({ data: { "synthetic-group": rows } });
async function main() {
  for (const field of ["key_vs_ch_id", "key_vs_real_id", "key_vs_row_id"] as const) {
    await test(`${field} ALL`, () => { const v = inspect(group(row)).relations[field]; assert.equal(v.ALL, 1); assert.equal(v.classification, "GLOBAL_ALL_OBSERVED"); });
  }
  await test("mixed comparable rows are SOME", () => { assert.equal(inspect(group(row, { ...row, ch_id: "different" })).relations.key_vs_ch_id.SOME, 1); });
  await test("no comparable match is NONE", () => { const r = inspect(group({ ch_id: "different" })).relations.key_vs_ch_id; assert.equal(r.NONE, 1); assert.equal(r.classification, "GLOBAL_NONE_OBSERVED"); });
  await test("constant ch_id", () => { assert.equal(inspect(group(row, row)).constants.ch_id.YES, 1); });
  await test("varying ch_id", () => { assert.equal(inspect(group(row, { ...row, ch_id: "different" })).constants.ch_id.NO, 1); });
  await test("constant real_id", () => { assert.equal(inspect(group(row, row)).constants.real_id.YES, 1); });
  await test("varying row id", () => { assert.equal(inspect(group(row, { ...row, id: "different" })).constants.row_id.NO, 1); });
  await test("missing values are UNKNOWN and do not dilute comparable ALL", () => {
    const empty = inspect(group({}, null));
    for (const field of GROUP_RELATIONS) { assert.equal(empty.relations[field].UNKNOWN, 1); assert.equal(empty.relations[field].classification, "UNKNOWN"); }
    assert.equal(empty.constants.ch_id.UNKNOWN, 1);
    assert.equal(inspect(group(row, {})).relations.key_vs_ch_id.ALL, 1);
  });
  await test("empty arrays are safely counted", () => { const v = inspect(group()); assert.equal(v.groups, 1); assert.equal(v.rows, 0); assert.equal(v.scope, "COMPLETE"); assert.equal(v.relations.key_vs_ch_id.UNKNOWN, 1); });
  await test("non-array groups cannot imply complete inspection", () => { const v = inspect({ unexpected: { nested: [row] } }); assert.equal(v.scope, "BOUNDED"); assert.equal(v.relations.key_vs_ch_id.UNKNOWN, 1); });
  await test("group ceiling", () => { const v = inspect(Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [`group-${i}`, []]))); assert.equal(v.groups, 1024); assert.equal(v.scope, "BOUNDED"); });
  await test("total row ceiling", () => { const v = inspect(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`group-${i}`, Array(256).fill(row)]))); assert.equal(v.rows, 4096); assert.equal(v.groups, 16); assert.equal(v.scope, "BOUNDED"); });
  await test("exact ceilings are complete if nothing was omitted", () => {
    assert.equal(inspect(Object.fromEntries(Array.from({ length: 1024 }, (_, i) => [`group-${i}`, []]))).scope, "COMPLETE");
    assert.equal(inspect(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`group-${i}`, Array(256).fill(row)]))).scope, "COMPLETE");
  });
  await test("per-group truncation controls confidence", () => {
    const v = inspect(group(...Array(257).fill(row))); assert.equal(v.rows, 256); assert.equal(v.scope, "BOUNDED"); assert.equal(v.relations.key_vs_ch_id.classification, "BOUNDED_ALL_OBSERVED");
    assert.equal(inspect(group(...Array(257).fill({ ch_id: "other" }))).relations.key_vs_ch_id.classification, "BOUNDED_NONE_OBSERVED");
  });
  await test("returned aggregate never contains input values or hashes", () => {
    const output = JSON.stringify(inspect(group(row)));
    for (const secret of Object.values(row).filter((v) => typeof v === "string")) assert.ok(!output.includes(secret));
    assert.equal(redactSensitiveText(output), output);
    assert.doesNotMatch(output, /https?:\/\/|(?:[a-f\d]{2}:){5}[a-f\d]{2}|Bearer\s|token=|Cookie:/i);
  });
  await test("observability rejects arbitrary keys, classifications and count strings", async () => {
    const screen = new StalkerEpgObservability();
    screen.observe("GROUP_RELATION", { ...inspect(group(row)), groups: row.ch_id, relations: { key_vs_ch_id: { ALL: row.id, classification: row.name }, [row.id]: row.name } });
    let copy = ""; await screen.copy(async (text) => { copy = text; });
    for (const secret of [row.ch_id, row.name]) assert.ok(!copy.includes(secret));
    assert.match(copy, /group.key_vs_ch_id=UNKNOWN ALL=0 SOME=0 NONE=0 UNKNOWN=0/);
    assert.equal(redactSensitiveText(copy), copy);
  });
  await test("existing MAPPING output and selected-group absence are preserved", () => {
    const evidence = inspectStalkerEpgMapping(group(row), { portalId: "missing" });
    assert.equal(evidence.selectedGroup, "ABSENT"); assert.equal(evidence.portalKey, "NO");
    const screen = new StalkerEpgObservability(); screen.observe("MAPPING", evidence);
    const before = screen.summary().split("\n").filter((line) => /^(MAPPING|mapping\.)/.test(line));
    screen.observe("GROUP_RELATION", inspect(group(row)));
    assert.deepEqual(screen.summary().split("\n").filter((line) => /^(MAPPING|mapping\.)/.test(line)), before);
  });
  await test("six relations aggregate mixed groups independently", () => {
    const all = inspect(group(row)); for (const field of GROUP_RELATIONS) assert.equal(all.relations[field].ALL, 1);
    const v = inspect({ a: [{ ch_id: "a", real_id: "b", id: "c" }], b: [{ ch_id: "c", real_id: "c", id: "c" }] });
    assert.equal(v.relations.key_vs_ch_id.classification, "MIXED");
    assert.equal(v.relations.ch_id_vs_real_id.classification, "MIXED");
    assert.equal(v.relations.ch_id_vs_row_id.classification, "MIXED");
    assert.equal(v.relations.real_id_vs_row_id.classification, "MIXED");
  });
  await test("only own string identities compare without transformations", () => {
    assert.equal(inspect(group(Object.create(row))).relations.key_vs_ch_id.UNKNOWN, 1);
    assert.equal(inspect({ "42": [{ ch_id: 42 }] }).relations.key_vs_ch_id.UNKNOWN, 1);
    assert.equal(inspect({ "042": [{ ch_id: "42" }] }).relations.key_vs_ch_id.NONE, 1);
    assert.equal(inspect(group({ ch_id: "" })).constants.ch_id.UNKNOWN, 1);
  });
  await test("same bulk request emits one ordered family and no product result", async () => {
    const events: string[] = []; const calls: unknown[] = [];
    const result = await new StalkerEpgProbe().run({ getSession: () => ({ isAuthenticated: () => true, request: async (params) => { calls.push(params); return group(row); } }), getIdentity: async () => ({}), log: (event) => { events.push(event); } });
    assert.equal(result, undefined); assert.deepEqual(calls, [{ type: "itv", action: "get_epg_info" }]);
    assert.deepEqual(events.filter((event) => /MAPPING|GROUP_RELATION|RESULT/.test(event)), ["R18_E0P_MAPPING", "R18_E0P_GROUP_RELATION", "R18_E0P_RESULT"]);
  });
  await test("cancelled late response emits no group relation", async () => {
    let resolve!: (value: unknown) => void; let started!: () => void;
    const response = new Promise((done) => { resolve = done; }); const begun = new Promise<void>((done) => { started = done; });
    const events: string[] = []; const probe = new StalkerEpgProbe();
    const work = probe.run({ getSession: () => ({ isAuthenticated: () => true, request: () => { started(); return response; } }), getIdentity: async () => ({}), log: (event) => { events.push(event); } });
    await begun; probe.cancel(); resolve(group(row)); await work;
    assert.ok(!events.includes("R18_E0P_GROUP_RELATION"));
  });
  await test("new attempt clears previous relation summary synchronously", async () => {
    const screen = new StalkerEpgObservability(); screen.observe("GROUP_RELATION", inspect(group(row)));
    const probe = new StalkerEpgProbe();
    screen.press(true, probe, { getSession: () => ({ isAuthenticated: () => true, request: async () => group(row) }), getIdentity: async () => ({}), log: () => {} });
    assert.ok(!screen.summary().includes("group.key_vs")); screen.abort();
    await Promise.resolve();
  });
  assert.equal(passed, 24);
  console.log(`R18-E1B group relation scenarios: ${passed}/24 passed`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
