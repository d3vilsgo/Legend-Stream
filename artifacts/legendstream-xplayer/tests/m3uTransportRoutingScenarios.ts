import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseM3UProviderSource } from "../lib/m3uCatalogRefs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playerSource = readFileSync(resolve(ROOT, "context/PlayerContext.tsx"), "utf8");
const catalogSource = readFileSync(resolve(ROOT, "context/CatalogSyncContext.tsx"), "utf8");
const screenSource = readFileSync(resolve(ROOT, "components/OptimizedHomeScreenV6.tsx"), "utf8");
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
    assert.match(playerSource, /resolveM3UTransport/);
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

  await scenario("transport diagnostics expose declared type transport and safe reason only", () => {
    const logStart = playerSource.indexOf("function logProviderTransport(");
    const logEnd = playerSource.indexOf("// Transport diagnostics above", logStart);
    assert.ok(logStart >= 0 && logEnd > logStart, "transport diagnostic function must be fully captured");
    const logBlock = playerSource.slice(logStart, logEnd);
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

  if (failed > 0) {
    throw new Error(`m3u transport routing scenarios: ${passed}/9 passed, ${failed} failed`);
  }
  assert.equal(passed, 9);
  console.log("m3u transport routing scenarios: 9/9 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
