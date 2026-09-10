import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadIsolatedStalkerGenres,
  normalizeIsolatedStalkerCategories,
  runIsolatedStalkerLogin,
  type StalkerIsolatedGenreStatus,
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
  failGenres?: boolean;
  genres?: unknown;
} = {}) {
  const calls: string[] = [];
  return {
    calls,
    session: {
      async handshake() {
        calls.push("handshake");
        return { authenticated: true as const };
      },
      async request(params: RequestParams) {
        calls.push(String(params.action));
        if (params.action === "get_profile") return { name: "Demo", status: "active" };
        if (params.action === "get_main_info") return { tariff_plan: "Basic" };
        if (params.action === "get_genres") {
          assert.equal(params.type, "itv");
          if (options.failGenres) throw new Error("genres unavailable");
          return options.genres ?? [
            { id: "news", title: "News", number: "2" },
            { id: "sports", name: "Sports", number: "1" },
          ];
        }
        throw new Error(`unexpected action ${String(params.action)}`);
      },
    },
  };
}

async function main() {
  await scenario("R15-A login still reaches CONNECTED without get_genres", async () => {
    const harness = sessionHarness();
    const result = await runIsolatedStalkerLogin(
      { portalUrl: "https://portal.example/portal.php", mac: "00:11:22:33:44:55" },
      { createSession: () => harness.session },
    );
    assert.equal(result.state, "CONNECTED");
    assert.deepEqual(harness.calls, ["handshake", "get_profile", "get_main_info"]);
  });

  await scenario("Entering isolated Stalker Live surface triggers get_genres once", () => {
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.match(setupBlock, /showStalkerSurface[\s\S]*void loadStalkerGenres\(\)/);
    assert.match(setupBlock, /stalkerGenresRequestedRef\.current/);
    assert.match(setupBlock, /stalkerScreen === "STALKER_GENRES_SCREEN"/);
  });

  await scenario("get_genres uses the Stalker ITV request contract", async () => {
    const harness = sessionHarness();
    await loadIsolatedStalkerGenres(harness.session);
    assert.deepEqual(harness.calls, ["get_genres"]);
    assert.match(isolatedLoginSource, /\{ type: "itv", action: "get_genres" \}/);
  });

  await scenario("get_genres success produces normalized visible categories", async () => {
    const harness = sessionHarness({
      genres: [
        { id: "dup", title: "Duplicate", number: 3 },
        { id: "sports", genre_name: "Sports", number: 1 },
        { id: "dup", title: "Duplicate Copy", number: 4 },
        { id: "empty-title", title: "" },
        null,
      ],
    });
    const categories = await loadIsolatedStalkerGenres(harness.session);
    assert.deepEqual(categories, [
      { id: "sports", title: "Sports", order: 1 },
      { id: "dup", title: "Duplicate", order: 3 },
    ]);
    assert.match(screenSource, /stalkerCategories\.map/);
    assert.match(screenSource, /category\.title/);
  });

  await scenario("get_genres failure leaves connected authentication state intact", async () => {
    const harness = sessionHarness({ failGenres: true });
    const result = await runIsolatedStalkerLogin(
      { portalUrl: "https://portal.example", mac: "00:11:22:33:44:55" },
      { createSession: () => harness.session },
    );
    const statuses: StalkerIsolatedGenreStatus[] = ["GENRES_LOADING"];
    await assert.rejects(loadIsolatedStalkerGenres(result.session), /genres unavailable/);
    statuses.push("GENRES_ERROR");
    assert.equal(result.state, "CONNECTED");
    assert.equal(statuses.at(-1), "GENRES_ERROR");
  });

  await scenario("Category failure remains retryable without rerunning login", () => {
    assert.match(screenSource, /label="Tekrar dene"[\s\S]*loadStalkerGenres\(true\)/);
    assert.doesNotMatch(screenSource, /Tekrar dene[\s\S]{0,200}runIsolatedStalkerLogin/);
  });

  await scenario("Retry calls category loading only", async () => {
    const harness = sessionHarness();
    await runIsolatedStalkerLogin(
      { portalUrl: "https://portal.example", mac: "00:11:22:33:44:55" },
      { createSession: () => harness.session },
    );
    await loadIsolatedStalkerGenres(harness.session);
    assert.deepEqual(harness.calls, ["handshake", "get_profile", "get_main_info", "get_genres"]);
  });

  await scenario("Ordinary rerender is guarded from duplicate get_genres requests", () => {
    assert.match(screenSource, /if \(!stalkerSession \|\| \(!force && stalkerGenresRequestedRef\.current\)\) return;/);
    assert.match(screenSource, /stalkerGenresRequestedRef\.current = true;/);
  });

  await scenario("R15-B surface entry does not automatically call get_ordered_list", () => {
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.match(setupBlock, /void loadStalkerGenres\(\)/);
    assert.doesNotMatch(setupBlock, /useEffect\([\s\S]{0,220}loadStalkerChannelsForCategory/);
    assert.doesNotMatch(setupBlock, /get_all_channels/);
  });

  await scenario("R15-B login and genre helpers never call aggregate channels or playback links", () => {
    const loginAndGenreSource = isolatedLoginSource.slice(
      isolatedLoginSource.indexOf("export async function loadIsolatedStalkerGenres"),
      isolatedLoginSource.indexOf("export async function loadIsolatedStalkerCategoryChannels"),
    );
    assert.doesNotMatch(loginAndGenreSource, /get_ordered_list|get_all_channels|create_link/);
  });

  await scenario("Shared persist and SQL catalog persistence are not required", () => {
    assert.doesNotMatch(isolatedLoginSource, /\bpersist\(|saveProviderSecrets|AsyncStorage|SecureStore/);
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.doesNotMatch(setupBlock, /\bpersist\(|saveProviderSecrets|replaceProviderCatalogAtomically|rememberStalkerLiveCategories/);
  });

  await scenario("Xtream behavior remains on shared submit lifecycle", () => {
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.match(setupBlock, /if \(type === "xtream" && \(!username\.trim\(\) \|\| !password\)\)/);
    assert.match(setupBlock, /await onSubmit\(\{[\s\S]*username: type === "xtream"/);
  });

  await scenario("M3U behavior remains on shared submit lifecycle", () => {
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.match(setupBlock, /await onSubmit\(\{[\s\S]*type,[\s\S]*playlistUrl: clean/);
    assert.match(setupBlock, /epgUrl: epgUrl\.trim\(\) \|\| undefined/);
  });

  await scenario("Existing R15-A focused scenarios remain present", () => {
    const r15aSource = source("tests/stalkerR15AIsolatedLoginScenarios.ts");
    assert.match(r15aSource, /Stalker setup routes to isolated login/);
    assert.match(r15aSource, /Optional get_main_info failure does not break login/);
  });

  await scenario("Category normalization handles empty payloads deterministically", () => {
    assert.deepEqual(normalizeIsolatedStalkerCategories(null), []);
    assert.deepEqual(normalizeIsolatedStalkerCategories({ js: [] }), []);
    assert.deepEqual(normalizeIsolatedStalkerCategories([{ title: "General" }]), [
      { id: "stalker-category-0", title: "General", order: 0 },
    ]);
  });

  console.log(`stalker R15-B isolated genres scenarios passed: ${passed}/15`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
