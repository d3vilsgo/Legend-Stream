import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseM3UProviderSource } from "../lib/m3uCatalogRefs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playerSource = readFileSync(resolve(ROOT, "context/PlayerContext.tsx"), "utf8");
const transportSource = readFileSync(resolve(ROOT, "lib/m3uTransportRouting.ts"), "utf8");
const catalogSource = readFileSync(resolve(ROOT, "context/CatalogSyncContext.tsx"), "utf8");
const screenSource = readFileSync(resolve(ROOT, "components/OptimizedHomeScreenPaged.tsx"), "utf8");
const m3uCacheSource = readFileSync(resolve(ROOT, "lib/m3uCatalogCache.ts"), "utf8");

let passed = 0;
let failed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    passed += 1;
    console.log(`ok ${passed + failed} - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok ${passed + failed} - ${name}`);
    console.error(error);
  }
}

async function routingModule() {
  try {
    return await import("../lib/m3uTransportRouting");
  } catch {
    return null;
  }
}

const exampleProvider = {
  id: "synthetic-provider",
  name: "Synthetic",
  type: "xtream" as const,
  url: "https://example.test/get.php?username=alice&password=example-password&type=m3u_plus",
  createdAt: 1,
};

async function withProbe(
  reply: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
) {
  const previous = globalThis.fetch;
  globalThis.fetch = reply as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previous;
  }
}

async function main() {
  await scenario("get.php M3U source extracts Xtream credentials", () => {
    assert.deepEqual(
      parseM3UProviderSource(
        "https://panel.example/get.php?username=alice&password=swordfish&type=m3u_plus&output=ts",
      ),
      {
        baseUrl: "https://panel.example",
        username: "alice",
        password: "swordfish",
      },
    );
  });

  await scenario("path-based playlist/username/password/m3u source extracts Xtream credentials", () => {
    assert.deepEqual(
      parseM3UProviderSource("https://panel.example/playlist/alice/swordfish/m3u"),
      {
        baseUrl: "https://panel.example",
        username: "alice",
        password: "swordfish",
      },
    );
  });

  await scenario("successful player_api probe resolves declared M3U to Xtream transport", async () => {
    const routing = await routingModule();
    assert.ok(routing, "m3uTransportRouting module must exist");
    let requested = "";
    const result = await routing.resolveM3UTransport(
      "https://panel.example/get.php?username=alice&password=swordfish&type=m3u_plus",
      async (input: RequestInfo | URL) => {
        requested = String(input);
        return {
          ok: true,
          text: async () => JSON.stringify({ user_info: { auth: 1, status: "Active" } }),
        } as Response;
      },
    );
    assert.equal(result.declaredType, "m3u");
    assert.equal(result.transport, "xtream");
    assert.equal(result.reason, "probe-succeeded");
    assert.equal(result.credentials?.username, "alice");
    assert.equal(result.credentials?.password, "swordfish");
    const requestedUrl = new URL(requested);
    assert.equal(requestedUrl.pathname, "/player_api.php");
    assert.equal(requestedUrl.searchParams.get("username"), "alice");
    assert.equal(requestedUrl.searchParams.get("password"), "swordfish");
  });

  await scenario("unauthenticated player_api probe preserves M3U fallback transport", async () => {
    const routing = await routingModule();
    assert.ok(routing, "m3uTransportRouting module must exist");
    let requested = "";
    const result = await routing.resolveM3UTransport(
      "https://panel.example/playlist/alice/swordfish/m3u",
      async (input: RequestInfo | URL) => {
        requested = String(input);
        return {
          ok: true,
          text: async () => JSON.stringify({ user_info: { auth: 0, status: "Disabled" } }),
        } as Response;
      },
    );
    assert.equal(result.declaredType, "m3u");
    assert.equal(result.transport, "m3u");
    assert.equal(result.reason, "probe-failed");
    assert.equal(result.credentials?.username, "alice");
    assert.equal(result.credentials?.password, "swordfish");
    const requestedUrl = new URL(requested);
    assert.equal(requestedUrl.pathname, "/player_api.php");
    assert.equal(requestedUrl.searchParams.get("username"), "alice");
    assert.equal(requestedUrl.searchParams.get("password"), "swordfish");
  });

  await scenario("routing reason distinguishes uncredentialed sources from probe timeouts", async () => {
    const routing = await routingModule();
    assert.ok(routing, "m3uTransportRouting module must exist");
    let uncredentialedFetches = 0;
    const uncredentialed = await routing.resolveM3UTransport(
      "https://panel.example/playlist.m3u",
      async () => {
        uncredentialedFetches += 1;
        throw new Error("fetch must not run");
      },
    );
    assert.equal(uncredentialed.transport, "m3u");
    assert.equal(uncredentialed.reason, "url-not-credentialed");
    assert.equal(uncredentialedFetches, 0);

    const timeout = await routing.resolveM3UTransport(
      "https://panel.example/get.php?username=alice&password=swordfish&type=m3u_plus",
      async () => {
        const error = new Error("timed out");
        error.name = "TimeoutError";
        throw error;
      },
    );
    assert.equal(timeout.transport, "m3u");
    assert.equal(timeout.reason, "probe-timeout");
  });

  await scenario("provider model stores declaredType and transport separately", () => {
    assert.match(playerSource, /declaredType\??:\s*ProviderType/);
    assert.match(playerSource, /transport\??:\s*ProviderTransport/);
    assert.match(transportSource, /resolveM3UTransport/);
    assert.match(playerSource, /resolveProviderTransport/);
  });

  await scenario("Xtream-resolved M3U uses transport-aware Xtream catalog pipeline", () => {
    assert.match(catalogSource, /resolvedProviderTransport/);
    assert.match(catalogSource, /resolvedProviderTransport\(provider\)\s*!==\s*"xtream"/);
    assert.match(playerSource, /resolvedProviderTransport\(provider\)/);
  });

  await scenario("UI presentation remains declared M3U even when transport is Xtream", () => {
    assert.match(screenSource, /declaredType\s*\?\?\s*[^\n]*type/);
    assert.match(screenSource, /providerListPresentation\(\{[^}]*type:\s*[^}]*declaredType/s);
  });

  await scenario("saved M3U provider switch resolves transport before cache preparation", () => {
    assert.match(playerSource, /resolveProviderForSwitch:\s*\(providerId:\s*string\)\s*=>\s*Promise<ProviderConfig\s*\|\s*null>/);
    assert.match(playerSource, /const resolveProviderForSwitch = async \(providerId: string\)[\s\S]*await resolveProviderTransport\(fromProvider\(existing\)\)/);
    const switchStart = screenSource.indexOf("const switchProvider = async (id: string) =>");
    const switchEnd = screenSource.indexOf("const navigate =", switchStart);
    assert.ok(switchStart >= 0 && switchEnd > switchStart, "provider switch block must be captured");
    const switchBlock = screenSource.slice(switchStart, switchEnd);
    assert.match(switchBlock, /const routedTarget = await resolveProviderForSwitch\(id\)/);
    assert.match(switchBlock, /prepareProviderSwitchCache\(routedTarget\)/);
    assert.ok(
      switchBlock.indexOf("resolveProviderForSwitch(id)") < switchBlock.indexOf("prepareProviderSwitchCache(routedTarget)"),
      "transport resolution must occur before cache preparation",
    );
  });

  await scenario("transport diagnostics expose declared type transport and safe reason only", () => {
    const logStart = transportSource.indexOf("function logProviderTransport(");
    const logEnd = transportSource.indexOf("// Transport diagnostics above", logStart);
    assert.ok(logStart >= 0 && logEnd > logStart, "transport diagnostic function must be fully captured");
    const logBlock = transportSource.slice(logStart, logEnd);
    const payload = logBlock.match(/safeLog\.info\("LS_PROVIDER_TRANSPORT",\s*\{([\s\S]*?)\}\s*\);/);
    assert.ok(payload, "LS_PROVIDER_TRANSPORT payload must be present");
    const payloadFields = [...payload[1].matchAll(/^\s*([A-Za-z_$][\w$]*)(?:\s*:|\s*,)/gm)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(payloadFields, ["providerType", "resolutionReason", "resolvedTransport"]);
    assert.doesNotMatch(logBlock, /username|password|playlistUrl|\burl\s*:/i);
    assert.match(m3uCacheSource, /cleanupStagingCatalog/);
    assert.match(m3uCacheSource, /swapStagingToProvider/);
  });

  await scenario("declared Xtream get.php success preserves source, credentials and one probe", async () => {
    const routing = await routingModule();
    assert.ok(routing);
    let calls = 0;
    await withProbe(async (input, init) => {
      calls++;
      assert.equal(typeof input, "string");
      const request = new URL(String(input));
      assert.equal(request.pathname, "/player_api.php");
      assert.equal(request.searchParams.get("username"), "alice");
      assert.equal(request.searchParams.get("password"), "example-password");
      assert.deepEqual(init?.headers, { Accept: "application/json,*/*" });
      assert.ok(init?.signal instanceof AbortSignal);
      return { ok: true, text: async () => JSON.stringify({ user_info: { auth: "1" } }) } as Response;
    }, async () => {
      const result = await routing.resolveProviderTransport(exampleProvider);
      assert.deepEqual(result, {
        ...exampleProvider, declaredType: "xtream", transport: "xtream",
        username: "alice", password: "example-password",
      });
    });
    assert.equal(calls, 1);
    assert.match(transportSource, /const XTREAM_PROBE_TIMEOUT_MS = 7_000/);
    assert.match(transportSource, /signal: AbortSignal\.timeout\(XTREAM_PROBE_TIMEOUT_MS\)/);
  });

  await scenario("declared Xtream auth, HTTP and thrown failures retain M3U fallback", async () => {
    const routing = await routingModule();
    assert.ok(routing);
    const replies = [
      async () => ({ ok: true, text: async () => JSON.stringify({ user_info: { auth: 0 } }) } as Response),
      async () => ({ ok: false } as Response),
      async () => { throw new Error("synthetic failure"); },
    ];
    for (const reply of replies) {
      let calls = 0;
      await withProbe(async () => { calls++; return reply(); }, async () => {
        const result = await routing.resolveProviderTransport(exampleProvider);
        assert.deepEqual(result, {
          ...exampleProvider, type: "m3u", declaredType: "xtream", transport: "m3u",
          username: undefined, password: undefined,
        });
      });
      assert.equal(calls, 1);
    }
  });

  await scenario("ordinary, malformed and Stalker sources do not gain probes", async () => {
    const routing = await routingModule();
    assert.ok(routing);
    await withProbe(async () => { throw new Error("unexpected probe"); }, async () => {
      const ordinary = { ...exampleProvider, type: "m3u" as const, url: "https://example.test/list.m3u" };
      assert.deepEqual(await routing.resolveProviderTransport(ordinary), {
        ...ordinary, declaredType: "m3u", transport: "m3u", playlistUrl: ordinary.url,
        username: undefined, password: undefined,
      });
      const malformed = { ...exampleProvider, url: "invalid source" };
      assert.deepEqual(await routing.resolveProviderTransport(malformed), {
        ...malformed, declaredType: "xtream", transport: "xtream",
      });
      const stalker = { ...exampleProvider, type: "stalker" as const };
      assert.deepEqual(await routing.resolveProviderTransport(stalker), {
        ...stalker, declaredType: "stalker",
      });
    });
  });

  await scenario("get.php parsing retains exact acceptance and path semantics", async () => {
    const routing = await routingModule();
    assert.ok(routing);
    assert.deepEqual(routing.parseXtreamGetPhp(" https://example.test/sub/get.php?username=%20alice%20&password=example-password%20 "), {
      baseUrl: "https://example.test/sub", username: "alice", password: "example-password ",
    });
    assert.equal(routing.parseXtreamGetPhp("https://example.test/get.php?username=alice&password=x&type=wrong"), null);
    assert.equal(routing.parseXtreamGetPhp("not-a-url"), null);
  });

  if (failed > 0) {
    throw new Error(`m3u transport routing scenarios: ${passed}/14 passed, ${failed} failed`);
  }
  assert.equal(passed, 14);
  console.log("m3u transport routing scenarios: 14/14 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
