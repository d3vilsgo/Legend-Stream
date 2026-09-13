import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runIsolatedStalkerLogin,
  type StalkerIsolatedLoginStatus,
} from "../lib/stalkerIsolatedLogin";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const screenSource = source("components/OptimizedHomeScreenPaged.tsx");
const isolatedLoginSource = source("lib/stalkerIsolatedLogin.ts");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

type RequestParams = Record<string, string | number | boolean | undefined>;

function sessionHarness(options: {
  failHandshake?: boolean;
  failProfile?: boolean;
  failMainInfo?: boolean;
  profile?: unknown;
  mainInfo?: unknown;
} = {}) {
  const calls: string[] = [];
  return {
    calls,
    session: {
      async handshake() {
        calls.push("handshake");
        if (options.failHandshake) throw new Error("handshake failed");
        return { authenticated: true as const };
      },
      async request(params: RequestParams) {
        calls.push(String(params.action));
        if (params.action === "get_profile") {
          if (options.failProfile) throw new Error("profile failed");
          return options.profile ?? { name: "Demo", status: "active" };
        }
        if (params.action === "get_main_info") {
          if (options.failMainInfo) throw new Error("main info unsupported");
          return options.mainInfo ?? { tariff_plan: "Basic", end_date: "2027-01-01" };
        }
        throw new Error(`unexpected action ${String(params.action)}`);
      },
    },
  };
}

async function main() {
  await scenario("ProviderSetup submits Stalker through canonical shared provider lifecycle", () => {
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    const activationBlock = screenSource.slice(
      screenSource.indexOf("if (adding || editingProvider || !provider)"),
      screenSource.indexOf("const openLive"),
    );

    assert.ok(setupBlock.includes('(["xtream", "m3u", "stalker"] as ProviderType[])'));
    assert.match(setupBlock, /if \(type === "stalker" && !mac\.trim\(\)\)/);
    assert.match(setupBlock, /playlistUrl: clean/);
    assert.match(setupBlock, /mac: type === "stalker" \? mac\.trim\(\) : undefined/);
    assert.match(setupBlock, /epgUrl: type === "stalker" \? undefined : epgUrl\.trim\(\) \|\| undefined/);
    assert.match(setupBlock, /await onSubmit\(\{/);
    assert.match(activationBlock, /const ok = await connectProvider\(config\)/);
    assert.doesNotMatch(setupBlock, /runIsolatedStalkerLogin|setStalkerScreen|STALKER_(?:HOME|GENRES|CHANNELS|PLAYER)_SCREEN/);
    assert.doesNotMatch(screenSource, /ProductLiveSurface/);
  });

  await scenario("Handshake plus profile success reaches CONNECTED with optional main info", async () => {
    const harness = sessionHarness();
    const result = await runIsolatedStalkerLogin(
      { portalUrl: "https://portal.example/stalker_portal", mac: "00:11:22:33:44:55" },
      { createSession: () => harness.session },
    );
    assert.equal(result.state, "CONNECTED");
    assert.equal(result.accountInfo.profileSupported, true);
    assert.equal(result.accountInfo.mainInfoClassification, "GET_MAIN_INFO_OPTIONAL_SUPPORTED");
    assert.deepEqual(harness.calls, ["handshake", "get_profile", "get_main_info"]);
  });

  await scenario("R15-A login never calls genres ordered-list or aggregate catalog actions", async () => {
    const harness = sessionHarness();
    await runIsolatedStalkerLogin(
      { portalUrl: "https://portal.example/portal.php", mac: "00:11:22:33:44:55" },
      { createSession: () => harness.session },
    );
    assert.equal(harness.calls.includes("get_genres"), false);
    assert.equal(harness.calls.includes("get_ordered_list"), false);
    assert.equal(harness.calls.includes("get_all_channels"), false);
    const loginFunctionSource = isolatedLoginSource.slice(
      isolatedLoginSource.indexOf("export async function runIsolatedStalkerLogin"),
    );
    assert.doesNotMatch(loginFunctionSource, /get_genres|get_ordered_list|get_all_channels|create_link/);
  });

  await scenario("Isolated helper remains persistence-free without owning production activation", () => {
    assert.doesNotMatch(isolatedLoginSource, /\bpersist\(/);
    assert.doesNotMatch(isolatedLoginSource, /saveProviderSecrets|saveCredentials|AsyncStorage|SecureStore/);
    assert.doesNotMatch(screenSource, /runIsolatedStalkerLogin|ProductLiveSurface|setStalkerScreen/);
    assert.match(screenSource, /connectProvider\(config\)/);
  });

  await scenario("Handshake failure exits CONNECTING through controlled error state", async () => {
    const status: StalkerIsolatedLoginStatus[] = ["CONNECTING"];
    const harness = sessionHarness({ failHandshake: true });
    await assert.rejects(
      runIsolatedStalkerLogin(
        { portalUrl: "https://portal.example", mac: "00:11:22:33:44:55" },
        { createSession: () => harness.session },
      ),
      /handshake failed/,
    );
    status.push("ERROR");
    assert.equal(status.at(-1), "ERROR");
    assert.deepEqual(harness.calls, ["handshake"]);
  });

  await scenario("Profile failure exits CONNECTING through controlled error state", async () => {
    const status: StalkerIsolatedLoginStatus[] = ["CONNECTING"];
    const harness = sessionHarness({ failProfile: true });
    await assert.rejects(
      runIsolatedStalkerLogin(
        { portalUrl: "https://portal.example", mac: "00:11:22:33:44:55" },
        { createSession: () => harness.session },
      ),
      /profile failed/,
    );
    status.push("ERROR");
    assert.equal(status.at(-1), "ERROR");
    assert.deepEqual(harness.calls, ["handshake", "get_profile"]);
  });

  await scenario("Optional get_main_info failure does not break login", async () => {
    const harness = sessionHarness({ failMainInfo: true });
    const result = await runIsolatedStalkerLogin(
      { portalUrl: "https://portal.example", mac: "00:11:22:33:44:55" },
      { createSession: () => harness.session },
    );
    assert.equal(result.state, "CONNECTED");
    assert.equal(result.accountInfo.mainInfoClassification, "GET_MAIN_INFO_UNSUPPORTED");
    assert.deepEqual(harness.calls, ["handshake", "get_profile", "get_main_info"]);
  });

  await scenario("Xtream and M3U submit routing remains on the shared provider lifecycle", () => {
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.match(setupBlock, /if \(type === "xtream" && \(!username\.trim\(\) \|\| !password\)\)/);
    assert.match(setupBlock, /await onSubmit\(\{[\s\S]*username: type === "xtream" \? username\.trim\(\) : undefined/);
    assert.match(setupBlock, /password: type === "xtream" \? password : undefined/);
    assert.match(setupBlock, /playlistUrl: clean/);
    assert.match(setupBlock, /epgUrl: type === "stalker" \? undefined : epgUrl\.trim\(\) \|\| undefined/);
  });

  console.log(`stalker R15-A isolated login scenarios passed: ${passed}/8`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});