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
const liveCatalogSource = source("components/catalog/StalkerLiveCatalog.tsx");

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

  await scenario("Canonical Stalker Live surface is shell-routed and provider-gated", () => {
    const routeBlock = screenSource.slice(
      screenSource.indexOf('{view === "live" && provider.type === "stalker"'),
      screenSource.indexOf('{view === "movies"'),
    );
    assert.match(routeBlock, /<StalkerLiveCatalog/);
    assert.match(routeBlock, /providerId=\{provider\.id\}/);
    assert.match(routeBlock, /onOpen=\{openLive\}/);
    assert.match(routeBlock, /onFavorite=\{\(id\) => void toggleFavorite\(id\)\}/);
    assert.match(liveCatalogSource, /useStalkerLiveCatalogSync\([\s\S]*provider\?\.id === providerId && provider\.type === "stalker" \? provider : null/);
    assert.match(liveCatalogSource, /if \(!provider \|\| provider\.id !== providerId \|\| provider\.type !== "stalker"\) return null;/);
    assert.doesNotMatch(screenSource, /ProductLiveSurface|openStalkerLiveSurface|STALKER_GENRES_SCREEN/);
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
    assert.match(liveCatalogSource, /<StalkerCategoryPager[\s\S]*categories=\{categories\}[\s\S]*activeId=\{category\}[\s\S]*onSelect=\{setCategory\}/);
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

  await scenario("Canonical Live refresh retries sync and page without rerunning isolated login", () => {
    const refreshBlock = liveCatalogSource.slice(
      liveCatalogSource.indexOf("onPress={() => {"),
      liveCatalogSource.indexOf("style={[styles.refreshButton"),
    );
    assert.match(refreshBlock, /Promise\.resolve\(sync\.refresh\(\)\)\.finally/);
    assert.match(refreshBlock, /loadCategories\(\)/);
    assert.match(refreshBlock, /page\.reload\(\)/);
    assert.doesNotMatch(refreshBlock, /runIsolatedStalkerLogin|loadIsolatedStalkerGenres/);
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

  await scenario("Category cache refresh is generation-guarded", () => {
    const loadBlock = liveCatalogSource.slice(
      liveCatalogSource.indexOf("const loadCategories = useCallback"),
      liveCatalogSource.indexOf("const setCategory = useCallback"),
    );
    assert.match(loadBlock, /const generation = \+\+categoryGeneration\.current/);
    assert.match(loadBlock, /if \(categoryGeneration\.current !== generation\) return;/);
    assert.match(liveCatalogSource, /if \(sync\.categoriesReady\) loadCategories\(\)/);
  });

  await scenario("Stalker Live entry does not invoke isolated ordered-list or playback helpers directly", () => {
    assert.doesNotMatch(liveCatalogSource, /loadIsolatedStalkerCategoryChannels|get_ordered_list|get_all_channels|create_link|resolveIsolatedStalkerChannelLink/);
    assert.match(liveCatalogSource, /if \(!sync\.categoriesReady\)/);
  });

  await scenario("R15-B login and genre helpers never call aggregate channels or playback links", () => {
    const loginAndGenreSource = isolatedLoginSource.slice(
      isolatedLoginSource.indexOf("export async function loadIsolatedStalkerGenres"),
      isolatedLoginSource.indexOf("export async function loadIsolatedStalkerCategoryChannels"),
    );
    assert.doesNotMatch(loginAndGenreSource, /get_ordered_list|get_all_channels|create_link/);
  });

  await scenario("Isolated helper remains persistence-free while production Live uses canonical page repository", () => {
    assert.doesNotMatch(isolatedLoginSource, /\bpersist\(|saveProviderSecrets|AsyncStorage|SecureStore/);
    assert.match(liveCatalogSource, /getCachedCatalogCategories\(providerId, "live"\)/);
    assert.match(liveCatalogSource, /const page = useCatalogPage\(\{/);
    assert.doesNotMatch(screenSource, /ProductLiveSurface|stalkerGenresRequestedRef/);
  });

  await scenario("Xtream behavior remains on shared submit lifecycle", () => {
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.match(setupBlock, /if \(type === "xtream" && \(!username\.trim\(\) \|\| !password\)\)/);
    assert.match(setupBlock, /await onSubmit\(\{[\s\S]*username: type === "xtream" \? username\.trim\(\) : undefined/);
  });

  await scenario("M3U behavior remains on shared submit lifecycle", () => {
    const setupBlock = screenSource.slice(
      screenSource.indexOf("function ProviderSetup"),
      screenSource.indexOf("type HistorySectionRow"),
    );
    assert.match(setupBlock, /await onSubmit\(\{[\s\S]*type,[\s\S]*playlistUrl: clean/);
    assert.match(setupBlock, /epgUrl: type === "stalker" \? undefined : epgUrl\.trim\(\) \|\| undefined/);
  });

  await scenario("Existing R15-A focused scenarios remain present", () => {
    const r15aSource = source("tests/stalkerR15AIsolatedLoginScenarios.ts");
    assert.match(r15aSource, /ProviderSetup submits Stalker through canonical shared provider lifecycle/);
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