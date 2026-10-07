import assert from "node:assert/strict";
import { inspectStalkerEpgMapping as inspect } from "../lib/stalkerEpgMappingProbe";
import { StalkerEpgProbe } from "../lib/stalkerEpgProbe";
import { StalkerEpgObservability } from "../lib/stalkerEpgObservability";
import { redactSensitiveText } from "../lib/safeLog";

let passed = 0;
async function test(name: string, run: () => unknown | Promise<unknown>) {
  await run(); passed++; console.log(`ok ${passed} - ${name}`);
}
const identity = { portalId: "synthetic-channel", tvgId: "synthetic-tvg" };
const row = { ch_id: identity.portalId, real_id: "synthetic-other", id: "synthetic-programme-id", name: "Türkçe gizli başlık", start_timestamp: 1791000000, stop_timestamp: 1791001800 };
const payload = { [identity.portalId]: [row] };
async function main() {
  await test("direct selected group establishes separate key and row relations", () => {
    const v = inspect(payload, identity);
    assert.equal(v.container, "ROOT_OBJECT"); assert.equal(v.portalKey, "YES");
    assert.equal(v.selectedChId, "ALL"); assert.equal(v.selectedRealId, "NONE");
    assert.equal(v.portalChId, "YES"); assert.equal(v.portalRealId, "NO"); assert.equal(v.portalRowId, "NO");
  });
  await test("data wrapper is classified explicitly", () => { assert.equal(inspect({ data: payload }, identity).container, "DATA_OBJECT"); });
  await test("selected group beyond old eight-group sample is found directly", () => {
    const data = Object.fromEntries(Array.from({ length: 1100 }, (_, i) => [`synthetic-${i}`, []]));
    const v = inspect({ ...data, ...payload }, identity);
    assert.equal(v.portalKey, "YES"); assert.equal(v.selectedChId, "ALL");
    assert.equal(v.scanScope, "BOUNDED"); assert.equal(v.portalChId, "UNPROVEN");
  });
  await test("row identity can match while object key differs", () => {
    const v = inspect({ unrelated: [row] }, identity);
    assert.equal(v.portalKey, "NO"); assert.equal(v.portalChId, "YES");
  });
  await test("real_id and programme id are measured without assuming equivalence", () => {
    const v = inspect([{ ...row, ch_id: "other", real_id: identity.portalId, id: identity.portalId }], identity);
    assert.equal(v.portalChId, "NO"); assert.equal(v.portalRealId, "YES"); assert.equal(v.portalRowId, "YES");
  });
  await test("tvg identity is a separate hypothesis", () => {
    const v = inspect({ [identity.tvgId]: [{ ...row, ch_id: identity.tvgId }] }, identity);
    assert.equal(v.tvgKey, "YES"); assert.equal(v.tvgChId, "YES"); assert.equal(v.portalChId, "NO");
  });
  await test("missing canonical identity cannot produce a negative claim", () => {
    const v = inspect(payload, {}); assert.equal(v.portalKey, "UNKNOWN"); assert.equal(v.portalChId, "UNKNOWN");
  });
  await test("mixed selected identities cannot claim all rows match", () => {
    const v = inspect({ [identity.portalId]: [row, { ...row, ch_id: "other" }] }, identity);
    assert.equal(v.selectedChId, "SOME"); assert.equal(v.selectedComplete, "YES");
  });
  await test("selected group sampling reports incomplete after 256 rows", () => {
    const v = inspect({ [identity.portalId]: Array(257).fill(row) }, identity);
    assert.equal(v.selectedRows, 256); assert.equal(v.selectedComplete, "NO");
  });
  await test("row budget never turns unseen matches into NO", () => {
    const v = inspect([...Array(4096).fill({ ch_id: "other" }), row], identity);
    assert.equal(v.scannedRows, 4096); assert.equal(v.scanScope, "BOUNDED"); assert.equal(v.portalChId, "UNPROVEN");
  });
  await test("mixed nested structures stay unsupported without guessing wrappers", () => {
    const v = inspect({ nested: { data: [row] } }, identity);
    assert.equal(v.scanScope, "UNSUPPORTED"); assert.equal(v.portalChId, "UNPROVEN");
  });
  await test("only own keys and own identity fields count", () => {
    const v = inspect(Object.create(payload), identity); assert.equal(v.portalKey, "NO");
    assert.equal(inspect([Object.create(row)], identity).portalChId, "NO");
  });
  await test("safe integer identity preserves exact string semantics", () => {
    assert.equal(inspect([{ ch_id: 42 }], { portalId: "42" }).portalChId, "YES");
    assert.equal(inspect([{ ch_id: 42 }], { portalId: "042" }).portalChId, "NO");
    assert.equal(inspect([{ ch_id: Infinity }], { portalId: "Infinity" }).portalChId, "NO");
  });
  await test("screen and clipboard reject injected values and secrets", async () => {
    const screen = new StalkerEpgObservability();
    screen.observe("MAPPING", inspect(payload, identity));
    screen.observe("MAPPING", { portalKey: identity.portalId, container: row.name, selectedChId: row.id, scanScope: identity.tvgId });
    let copied = ""; await screen.copy(async (text) => { copied = text; });
    for (const raw of [identity.portalId, identity.tvgId, row.name, row.id, row.real_id]) assert.ok(!copied.includes(raw));
    assert.equal(redactSensitiveText(copied), copied);
    assert.doesNotMatch(copied, /https?:\/\/|(?:[a-f\d]{2}:){5}[a-f\d]{2}|Bearer\s|password=|token=|Cookie:/i);
    assert.match(screen.getSnapshot(), /MAPPING key=YES ch_id=YES real_id=NO/);
    assert.match(copied, /mapping.selectedGroup=ARRAY rows=1 complete=YES ch_id=ALL real_id=NONE/);
  });
  await test("existing bulk request emits mapping without another request or product result", async () => {
    const calls: unknown[] = []; const events: string[] = [];
    const frozen = Object.freeze({ [identity.portalId]: Object.freeze([Object.freeze({ ...row })]) });
    const result = await new StalkerEpgProbe().run({
      getSession: () => ({ isAuthenticated: () => true, request: async (params) => { calls.push(params); return frozen; } }),
      getIdentity: async () => identity, log: (event) => events.push(event),
    });
    assert.equal(result, undefined); assert.deepEqual(calls, [{ type: "itv", action: "get_epg_info" }]);
    assert.equal(events.filter((e) => e === "R18_E0P_MAPPING").length, 1);
    assert.ok(events.indexOf("R18_E0P_MAPPING") < events.indexOf("R18_E0P_RESULT"));
    assert.deepEqual(frozen, payload);
  });
  await test("abort discards late mapping evidence", async () => {
    let resolve!: (v: unknown) => void; let started!: () => void;
    const response = new Promise((done) => { resolve = done; });
    const begun = new Promise<void>((done) => { started = done; });
    const events: string[] = []; const owner = new StalkerEpgProbe();
    const work = owner.run({ getSession: () => ({ isAuthenticated: () => true, request: () => { started(); return response; } }), getIdentity: async () => identity, log: (event) => events.push(event) });
    await begun; owner.cancel(); resolve(payload); await work;
    assert.ok(!events.includes("R18_E0P_MAPPING"));
  });
  assert.equal(passed, 16);
  console.log(`R18-E1 mapping diagnostic scenarios: ${passed}/16 passed`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
