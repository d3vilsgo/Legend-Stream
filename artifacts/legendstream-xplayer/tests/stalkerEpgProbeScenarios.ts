import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { mock } from "node:test";
import { StalkerEpgProbe, inspectEpgProbeResponse, epgProbeTimeShape } from "../lib/stalkerEpgProbe";
import { getOrCreateStalkerPortalSession, releaseStalkerPortalSession } from "../lib/stalkerPortalRuntime";
import { sanitizeLogValue } from "../lib/safeLog";

const programme = { id: "synthetic-programme", ch_id: "101", name: "Synthetic programme", start_timestamp: "1791000000", stop_timestamp: "1791001800" };
type Log = { event: string; fields: Record<string, unknown> };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
function fixture(respond: (params: Record<string, string | number>, signal?: AbortSignal) => Promise<unknown>, identity = { portalId: "101", tvgId: "synthetic-tvg" }) {
  const calls: Record<string, string | number>[] = [];
  const logs: Log[] = [];
  const session = { isAuthenticated: () => true, request: async (params: Record<string, string | number>, signal?: AbortSignal) => { calls.push(params); return respond(params, signal); } };
  const options = { getSession: () => session, getIdentity: async () => identity, log: (event: string, fields: Record<string, unknown>) => { logs.push({ event, fields }); } };
  return { owner: new StalkerEpgProbe(), options, calls, logs };
}
let passed = 0;
async function scenario(name: string, work: () => unknown | Promise<unknown>) {
  await work(); passed++; console.log(`ok ${passed} - ${name}`);
}
async function main() {
  await scenario("bulk success uses one request and returns no product data", async () => {
    const f = fixture(async () => ({ data: { "101": [programme] } }));
    assert.equal(await f.owner.run(f.options), undefined);
    assert.deepEqual(f.calls, [{ type: "itv", action: "get_epg_info" }]);
    assert.equal(f.logs.at(-1)?.fields.capability, "get_epg_info");
    assert.equal(f.logs.at(-1)?.fields.status, "SUPPORTED_SHAPE");
  });
  await scenario("empty bulk permits exactly one canonical channel fallback", async () => {
    const f = fixture(async (p) => p.action === "get_epg_info" ? { data: [] } : [programme]);
    await f.owner.run(f.options);
    assert.deepEqual(f.calls, [{ type: "itv", action: "get_epg_info" }, { type: "itv", action: "get_short_epg", ch_id: "101" }]);
  });
  await scenario("unsupported HTTP permits bounded fallback; empty fallback stays inconclusive", async () => {
    const f = fixture(async (p) => { if (p.action === "get_epg_info") throw { code: "HTTP_ERROR", status: 404 }; return []; });
    await f.owner.run(f.options);
    assert.equal(f.calls.length, 2);
    assert.equal(f.logs.at(-1)?.fields.status, "INCONCLUSIVE");
  });
  await scenario("missing portal identity never substitutes tvgId or enumerates channels", async () => {
    const f = fixture(async () => null, { portalId: "", tvgId: "synthetic-tvg" });
    await f.owner.run(f.options);
    assert.equal(f.calls.length, 1);
    assert.equal(f.logs.at(-1)?.fields.reason, "NO_CANONICAL_CHANNEL_IDENTITY");
  });
  await scenario("auth, timeout and server failures are best effort without retry/fallback", async () => {
    for (const code of ["AUTH_FAILED", "TIMEOUT", "HTTP_ERROR", "UNKNOWN"]) {
      const f = fixture(async () => { throw { code, status: 503, message: "synthetic-sensitive-error" }; });
      await assert.doesNotReject(f.owner.run(f.options));
      assert.equal(f.calls.length, 1);
      assert.equal(f.logs.at(-1)?.fields.status, "FAILED");
      assert.ok(!JSON.stringify(f.logs).includes("synthetic-sensitive-error"));
    }
  });
  await scenario("invalid response permits only one short fallback", async () => {
    const f = fixture(async () => { throw { code: "INVALID_RESPONSE" }; });
    await f.owner.run(f.options);
    assert.equal(f.calls.length, 2);
  });
  await scenario("repeated taps share one in-flight attempt; later explicit tap is allowed", async () => {
    const wait = deferred<unknown>();
    const started = deferred<void>();
    const f = fixture(async () => { started.resolve(); return wait.promise; });
    const first = f.owner.run(f.options);
    assert.equal(f.owner.run(f.options), first);
    await started.promise;
    assert.equal(f.calls.length, 1);
    wait.resolve([programme]); await first;
    await f.owner.run(f.options);
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.logs.filter((l) => l.event === "R18_E0P_BEGIN").map((l) => l.fields.attempt), [1, 2]);
  });
  await scenario("provider cancellation aborts signal and discards late success without fallback", async () => {
    const wait = deferred<unknown>(); const started = deferred<void>();
    let observed: AbortSignal | undefined;
    const f = fixture(async (_, signal) => { observed = signal; started.resolve(); return wait.promise; });
    const work = f.owner.run(f.options); await started.promise;
    f.owner.cancel(); assert.equal(observed?.aborted, true);
    wait.resolve([programme]); await work;
    assert.equal(f.calls.length, 1);
    assert.ok(!f.logs.some((l) => l.event === "R18_E0P_RESPONSE"));
    assert.equal(f.logs.at(-1)?.fields.errorClass, "ABORT");
  });
  await scenario("cancel during identity lookup starts no network request", async () => {
    const wait = deferred<{ portalId: string; tvgId: string }>();
    const entered = deferred<void>(); const f = fixture(async () => []);
    const work = f.owner.run({ ...f.options, getIdentity: () => { entered.resolve(); return wait.promise; } });
    await entered.promise; f.owner.cancel(); wait.resolve({ portalId: "101", tvgId: "" }); await work;
    assert.equal(f.calls.length, 0);
  });
  await scenario("diagnostic deadline aborts the existing request and remains best effort", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const started = deferred<void>();
      const f = fixture(async (_, signal) => new Promise((_, reject) => {
        signal!.addEventListener("abort", () => reject({ code: "CANCELLED" }), { once: true });
        started.resolve();
      }));
      const work = f.owner.run(f.options); await started.promise;
      mock.timers.tick(65_000); await work;
      assert.equal(f.calls.length, 1);
      assert.equal(f.logs.at(-1)?.fields.errorClass, "ABORT");
    } finally { mock.timers.reset(); }
  });
  await scenario("closed schema handles array, data, keyed bulk, null and malformed shapes", () => {
    for (const body of [[programme], { data: [programme] }, { data: { "101": [programme] } }, programme]) {
      assert.equal(inspectEpgProbeResponse(body).usableShape, true);
    }
    for (const body of [null, undefined, "bad", 0, [], {}, { error: "bad" }, [{ name: "missing times" }]]) {
      assert.equal(inspectEpgProbeResponse(body).usableShape, false);
    }
    const large = inspectEpgProbeResponse({ data: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i, [programme]])) });
    assert.ok(large.sampledRows <= 3); assert.ok(large.sampledGroups <= 8);
    assert.equal(large.countScope, "SAMPLED_GROUPS");
  });
  await scenario("time classification makes no conversion or timezone claims", () => {
    assert.equal(epgProbeTimeShape("1791000000").magnitude, "unix_seconds_candidate");
    assert.equal(epgProbeTimeShape(1791000000000).magnitude, "unix_milliseconds_candidate");
    assert.equal(epgProbeTimeShape("2026-10-03T01:02:03Z").kind, "ISO_like_string");
    assert.equal(epgProbeTimeShape("2026-10-03 01:02:03").kind, "datetime_string");
    const input = Object.freeze({ ...programme }); const before = JSON.stringify(input);
    const result = inspectEpgProbeResponse([input]);
    assert.equal(result.timeSemantics, "AMBIGUOUS"); assert.equal(JSON.stringify(input), before);
  });
  await scenario("identity evidence records relations only, never identifiers", () => {
    const out = inspectEpgProbeResponse({ data: { "101": [programme] } }, { portalId: "101", tvgId: "other" });
    assert.equal(out.selectedPortalKeyPresent, true); assert.equal(out.responseMatchesPortalId, "YES");
    assert.equal(out.responseMatchesTvgId, "NO"); assert.equal(out.mappingStatus, "UNCONFIRMED");
    assert.ok(!JSON.stringify(out).includes('"101"'));
  });
  await scenario("secret-bearing values, dictionary keys, field names and errors never reach logger", async () => {
    const secrets = ["https://synthetic.invalid/private?password=synthetic-pwd", "00:00:00:00:00:09", "synthetic-token", "synthetic-cookie", "synthetic-user", "synthetic-password", "synthetic-cmd", "synthetic-device"];
    const body = { data: { [secrets[0]]: [{ ...programme, name: secrets.join(" "), description: secrets.join(" "), ch_id: secrets[1], token: secrets[2], cookie: secrets[3], username: secrets[4], password: secrets[5], cmd: secrets[6], [secrets[7]]: secrets }] } };
    const f = fixture(async () => body); await f.owner.run(f.options);
    const serialized = JSON.stringify(f.logs);
    const sanitized = JSON.stringify(sanitizeLogValue(f.logs));
    for (const secret of secrets) { assert.ok(!serialized.includes(secret)); assert.ok(!sanitized.includes(secret)); }
    assert.ok(!serialized.includes('"token"')); assert.ok(!serialized.includes('"cmd"'));
  });
  await scenario("logger failure cannot break probe or leave single flight locked", async () => {
    const f = fixture(async () => [programme]);
    const options = { ...f.options, log: () => { throw Error("synthetic-sink-failure"); } };
    await assert.doesNotReject(f.owner.run(options)); await assert.doesNotReject(f.owner.run(options));
    assert.equal(f.calls.length, 2);
  });
  await scenario("real existing runtime reuses authenticated session and unwraps js without a second auth path", async () => {
    const actions: string[] = [];
    const identity = { providerId: "e0p-synthetic", portalUrl: "https://epg.invalid", mac: "00:00:00:00:00:08", fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const action = url.searchParams.get("action")!; actions.push(action);
      assert.ok(init?.signal);
      return new Response(JSON.stringify({ js: action === "handshake" ? { token: "synthetic-session" } : [programme] }));
    } };
    const session = getOrCreateStalkerPortalSession(identity);
    await session.request({ type: "itv", action: "get_genres" });
    const f = fixture(async () => assert.fail("fake session must not be used"));
    await f.owner.run({ ...f.options, getSession: () => getOrCreateStalkerPortalSession(identity) });
    assert.equal(session, getOrCreateStalkerPortalSession(identity));
    assert.deepEqual(actions, ["handshake", "get_genres", "get_epg_info"]);
    assert.equal(f.logs.at(-1)?.fields.status, "SUPPORTED_SHAPE");
    releaseStalkerPortalSession(identity.providerId);
  });
  await scenario("UI wiring is Stalker-only and has no product publication or network bypass", () => {
    // Wiring checks supplement the executable request/race tests above.
    const source = readFileSync(new NodeURL("../components/catalog/StalkerEpgProbeControl.tsx", import.meta.url), "utf8");
    assert.match(source, /provider\.type !== "stalker"/);
    assert.match(source, /getOrCreateStalkerPortalSession\(/);
    assert.match(source, /getPersistedStalkerLivePlaybackRef\(provider\.id, channel\.id\)/);
    assert.match(source, /probe\.cancel\(\)/);
    assert.match(source, /generation\.current === current/);
    assert.doesNotMatch(source, /refreshEpg|epgByChannel|setEpg|fetch\(|handshake\(|Authorization|Cookie/);
    for (const path of ["../context/PlayerContext.tsx", "../components/catalog/ManualEpgControl.tsx", "../components/catalog/PagedCatalogViews.tsx"]) {
      assert.doesNotMatch(readFileSync(new NodeURL(path, import.meta.url), "utf8"), /StalkerEpgProbe|R18_E0P/);
    }
  });
  console.log(`R18-E0P diagnostic scenarios: ${passed}/${passed} passed`);
}
main().catch(() => { console.error("R18-E0P diagnostic scenario failed (details suppressed)"); process.exitCode = 1; });
