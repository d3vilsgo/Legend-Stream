import assert from "node:assert/strict";
import { StalkerEpgProbe } from "../lib/stalkerEpgProbe";
import { StalkerEpgObservability } from "../lib/stalkerEpgObservability";

let passed = 0;
async function scenario(name: string, work: () => void | Promise<void>) { await work(); passed++; console.log(`ok ${passed} - ${name}`); }
const programme = { name: "SECRET_PROGRAMME", ch_id: "SECRET_ID", start: 1791000000, end: 1791001800 };
function setup(response: unknown = [programme], identity: { portalId?: string } = { portalId: "SECRET_ID" }) {
  const screen = new StalkerEpgObservability();
  const owner = new StalkerEpgProbe();
  let requests = 0;
  let timing: ((value: { fetchWaitMs: number; bodyReadWaitMs: number }) => void) | undefined;
  const options = { getSession: () => ({ isAuthenticated: () => true, request: async (_params: Record<string, string | number>, _signal?: AbortSignal, onTiming?: typeof timing) => { requests++; timing = onTiming; return response; } }), getIdentity: async () => identity, log: () => {} };
  return { screen, owner, options, get requests() { return requests; }, get timing() { return timing; } };
}
async function settled() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
async function main() {
  await scenario("NO_CHANNEL remains visible and no request starts", async () => { const f = setup(); f.screen.setReady(false); f.screen.press(false, f.owner, f.options); await settled(); assert.match(f.screen.getSnapshot(), /NO_CHANNEL$/); assert.equal(f.requests, 0); });
  await scenario("PRESSED is synchronous before session acquisition", async () => { const f = setup(); f.screen.press(true, f.owner, f.options); assert.equal(f.screen.getSnapshot(), "PRESSED"); await settled(); });
  await scenario("NO_PROBE_OWNER is visible", () => { const f = setup(); f.screen.press(true, null, f.options); assert.match(f.screen.getSnapshot(), /NO_PROBE_OWNER$/); });
  await scenario("success stages preserve request, response and result order", async () => { const f = setup(); f.screen.press(true, f.owner, f.options); await settled(); assert.deepEqual(f.screen.getSnapshot().split("\n"), ["PRESSED", "BEGIN auth=YES", "IDENTITY_OK", "PROBE_1_REQUEST_CALLED", "PROBE_1_RESPONSE array items=1 usable=YES", "MAPPING key=UNKNOWN ch_id=YES real_id=NO", "MAPPING scope=COMPLETE", "GROUP_RELATION scope=BOUNDED groups=0 rows=0", "RESULT_SUPPORTED_get_epg_info"]); assert.equal(f.requests, 1); });
  await scenario("no portal identity still probes first action once", async () => { const f = setup([], {}); f.screen.press(true, f.owner, f.options); await settled(); assert.match(f.screen.getSnapshot(), /IDENTITY_NO_PORTAL_ID[\s\S]*PROBE_1_REQUEST_CALLED[\s\S]*RESULT_INCONCLUSIVE_NO_CANONICAL_CHANNEL_IDENTITY/); assert.equal(f.requests, 1); });
  await scenario("timing marker appears only after observer is invoked", async () => { const f = setup(); f.screen.press(true, f.owner, f.options); await settled(); assert.ok(!f.screen.getSnapshot().includes("FETCH_DONE")); f.timing?.({ fetchWaitMs: 412, bodyReadWaitMs: 1 }); assert.match(f.screen.getSnapshot(), /PROBE_1_FETCH_DONE 412ms/); });
  await scenario("error class and status are sanitized", async () => { const f = setup(); f.options.getSession = () => ({ isAuthenticated: () => true, request: async () => { throw { code: "AUTH_FAILED", message: "SECRET_PROGRAMME", status: 401 }; } }); f.screen.press(true, f.owner, f.options); await settled(); assert.match(f.screen.getSnapshot(), /PROBE_1_ERROR_AUTH http=401[\s\S]*RESULT_FAILED_AUTH/); assert.ok(!f.screen.summary().includes("SECRET_PROGRAMME")); });
  for (const [code, expected, evidence] of [
    ["MISSING_MAC", "PRE_NETWORK_MISSING_MAC", "NO"],
    ["INVALID_URL", "PRE_NETWORK_INVALID_URL", "NO"],
    ["NETWORK_ERROR", "NETWORK", "UNPROVEN"],
    ["PORTAL_RATE_LIMITED_OR_ANTI_DDOS", "PORTAL_PROTECTION", "YES"],
  ] as const) {
    await scenario(`${code} is classified with network evidence`, async () => {
      const f = setup(); f.options.getSession = () => ({ isAuthenticated: () => true, request: async () => { throw { code, message: "SECRET_PROGRAMME" }; } });
      f.screen.press(true, f.owner, f.options); await settled();
      assert.ok(f.screen.getSnapshot().includes(`PROBE_1_ERROR_${expected} http=NOT_EXPOSED net=${evidence}`));
      assert.ok(f.screen.getSnapshot().includes(`RESULT_FAILED_${expected}`));
      assert.ok(!f.screen.summary().includes("SECRET_PROGRAMME"));
    });
  }
  await scenario("HTTP and invalid shape explicitly mark network evidence", () => { const f = setup(); for (const errorClass of ["HTTP", "INVALID_SHAPE"]) { f.screen.observe("ERROR", { probeId: 1, errorClass }); assert.match(f.screen.getSnapshot().split("\n").at(-1)!, /net=YES$/); } });
  await scenario("timeout and unknown errors do not assert network evidence", () => { const f = setup(); for (const errorClass of ["TIMEOUT", "UNKNOWN", "NETWORK"]) { f.screen.observe("ERROR", { probeId: 1, errorClass }); assert.match(f.screen.getSnapshot().split("\n").at(-1)!, /net=UNPROVEN$/); } });
  await scenario("copy confirmation follows clipboard resolution", async () => { const f = setup(); let finish!: () => void; const pending = new Promise<void>((resolve) => { finish = resolve; }); const work = f.screen.copy(async (content) => { assert.match(content, /R18_E0P/); await pending; }); let resolved = false; void work.then(() => { resolved = true; }); await settled(); assert.equal(resolved, false); finish(); assert.equal(await work, "KOPYALANDI"); });
  await scenario("copy failure is a fixed visible label", async () => { const f = setup(); assert.equal(await f.screen.copy(async () => { throw Error("SECRET_PROGRAMME"); }), "KOPYALAMA_BASARISIZ"); });
  await scenario("timeout and abort stage projection", () => { const f = setup(); f.screen.observe("TIMEOUT", {}); f.screen.observe("RESULT", { status: "FAILED", errorClass: "TIMEOUT" }); assert.match(f.screen.getSnapshot(), /TIMEOUT_65S\nRESULT_FAILED_TIMEOUT$/); f.screen.observe("RESULT", { status: "FAILED", errorClass: "ABORT" }); assert.match(f.screen.getSnapshot(), /ABORTED$/); });
  await scenario("repeated press stays single-flight", async () => { const f = setup(); f.screen.press(true, f.owner, f.options); f.screen.press(true, f.owner, f.options); assert.match(f.screen.getSnapshot(), /^PRESSED\nALREADY_RUNNING$/); await settled(); assert.equal(f.requests, 1); });
  await scenario("provider switch or unmount cancels pending request", async () => { const f = setup(); let signal: AbortSignal | undefined; let resolve!: (value: unknown) => void; const wait = new Promise<unknown>((done) => { resolve = done; }); f.options.getSession = () => ({ isAuthenticated: () => true, request: async (_: Record<string, string | number>, s?: AbortSignal) => { signal = s; return wait; } }); f.screen.press(true, f.owner, f.options); await settled(); f.screen.abort(); assert.equal(signal?.aborted, true); assert.match(f.screen.getSnapshot(), /ABORTED$/); resolve([programme]); await settled(); assert.ok(!f.screen.getSnapshot().includes("RESULT_SUPPORTED")); });
  await scenario("clipboard uses strict allowlists and never contains raw data", () => { const f = setup(); f.screen.observe("RESPONSE", { dataShape: "https://secret.example/token", itemCount: 1, fieldNames: ["name", "SECRET_ID"], textShape: "SECRET_PROGRAMME", responseMatchesPortalId: "SECRET_ID" }); f.screen.observe("FIELDS", { fieldTypes: [{ field: "name", types: ["string", "SECRET_MAC"] }] }); f.screen.observe("TIME", { field: "start", samples: [{ kind: "numeric_string", magnitude: "unix_seconds_candidate" }] }); const summary = f.screen.summary("1.4.43", 60, "59260750"); for (const secret of ["https://", "SECRET_ID", "SECRET_PROGRAMME", "SECRET_MAC", "token", "Cookie", "Authorization"]) assert.ok(!summary.includes(secret)); assert.match(summary, /dataShape=UNKNOWN itemCount=1 countScope=EXACT/); assert.match(summary, /fieldTypes=name:string/); assert.match(summary, /timeShape.start=numeric_string:unix_seconds_candidate/); });
  await scenario("history bounded and no product EPG state is accessed", () => { const f = setup(); for (let i = 0; i < 40; i++) f.screen.observe("BEGIN", { authenticatedAtStart: true }); assert.equal(f.screen.getSnapshot().split("\n").length, 20); assert.equal(Object.keys(f.screen).some((key) => /epg|programme/i.test(key)), false); });
  console.log(`R18-E0P observability scenarios: ${passed}/${passed} passed`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
