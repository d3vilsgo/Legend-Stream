import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearCatalogCategoryMemoryForProvider,
  readCatalogCategorySelection,
  rememberCatalogCategorySelection,
  validateCatalogCategorySelection,
} from "../lib/catalogCategoryMemory";
import { normalizeStalkerLiveCategoryIntent } from "../lib/stalkerLiveCategoryIntent";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const views = source("components/catalog/PagedCatalogViews.tsx");
const legacyLive = source("components/catalog/StalkerLiveCatalog.tsx");
const pageHook = source("hooks/useCatalogPage.ts");
const repository = source("lib/stalkerLazyLivePageRepository.ts");
const intent = source("lib/stalkerLiveCategoryIntent.ts");
const main = source("components/StalkerMainPage.tsx");
const i18n = source("context/I18nContext.tsx");
const r17h = source("tests/stalkerR17AMainBoundaryScenarios.ts");
const liveTreatment = source("tests/stalkerLiveTreatmentScenarios.ts");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function mainTest() {
  await scenario("missing Stalker Live memory is NO_SELECTION instead of All", () => {
    clearCatalogCategoryMemoryForProvider("missing");
    assert.equal(readCatalogCategorySelection("missing", "live", null), null);
    assert.match(views, /explicitSelectionRequired[\s\S]*readCatalogCategorySelection\(providerId, "live", null\)/);
  });

  await scenario("initial Stalker Live request is gated on validated explicit intent", () => {
    assert.match(views, /const requestReady = !stalkerLive \|\| \(categoriesReady && requestCategory !== null\)/);
    assert.match(views, /enabled: stalkerLive \? requestReady : providerType !== null/);
    assert.match(pageHook, /const effectiveEnabled = enabled;/);
    assert.doesNotMatch(pageHook, /stalkerLive \? true : enabled/);
  });

  await scenario("missing category cannot normalize into category zero", () => {
    assert.equal(normalizeStalkerLiveCategoryIntent(undefined), null);
    assert.equal(normalizeStalkerLiveCategoryIntent("  "), null);
    assert.doesNotMatch(repository, /!value \|\| value === "__all__" \? "0"/);
  });

  await scenario("explicit concrete category preserves exact request identity", () => {
    clearCatalogCategoryMemoryForProvider("concrete");
    assert.equal(rememberCatalogCategorySelection("concrete", "live", "42"), "42");
    assert.equal(validateCatalogCategorySelection("concrete", "live", ["7", "42"], null), "42");
    assert.equal(normalizeStalkerLiveCategoryIntent("42"), "42");
  });

  await scenario("explicit synthetic All alone maps to canonical category zero", () => {
    clearCatalogCategoryMemoryForProvider("all");
    rememberCatalogCategorySelection("all", "live", "__all__");
    assert.equal(readCatalogCategorySelection("all", "live", null), "__all__");
    assert.equal(normalizeStalkerLiveCategoryIntent("__all__"), "0");
  });

  await scenario("provider-native global category keeps its own request id", () => {
    assert.match(views, /providerGlobal \? String\(providerGlobal\.category_id\) : "__all__"/);
    assert.match(views, /category === "__all__" && providerGlobal[\s\S]*String\(providerGlobal\.category_id\)/);
    assert.match(intent, /isStalkerLiveGlobalCategoryId\(id\) \|\| \/\^\(\?:all\|tümü\|tum\)\$\/i\.test\(name\)/);
  });

  await scenario("stale remembered category becomes NO_SELECTION", () => {
    clearCatalogCategoryMemoryForProvider("stale");
    rememberCatalogCategorySelection("stale", "live", "123");
    assert.equal(validateCatalogCategorySelection("stale", "live", ["7", "8"], null), null);
    assert.equal(readCatalogCategorySelection("stale", "live", null), null);
  });

  await scenario("valid remembered category restores exactly", () => {
    clearCatalogCategoryMemoryForProvider("valid");
    rememberCatalogCategorySelection("valid", "live", "123");
    assert.equal(validateCatalogCategorySelection("valid", "live", ["7", "123"], null), "123");
  });

  await scenario("category memory stays isolated by provider", () => {
    clearCatalogCategoryMemoryForProvider("provider-a");
    clearCatalogCategoryMemoryForProvider("provider-b");
    rememberCatalogCategorySelection("provider-a", "live", "11");
    assert.equal(readCatalogCategorySelection("provider-a", "live", null), "11");
    assert.equal(readCatalogCategorySelection("provider-b", "live", null), null);
  });

  await scenario("get_all_channels fallback is reachable only for an explicit global category", () => {
    assert.match(repository, /compatibilityFallback: page === 1 && isStalkerLiveGlobalCategoryId\(categoryId\)/);
    assert.match(repository, /action: "get_all_channels"/);
    assert.ok(repository.indexOf("normalizeStalkerLiveCategoryIntent(options.categoryId)") < repository.indexOf("const session = getOrCreateStalkerPortalSession"));
  });

  await scenario("category changes retain generation abort and replacement semantics", () => {
    assert.match(pageHook, /generationRef\.current \+= 1/);
    assert.match(pageHook, /stalkerRequestRef\.current\?\.abort\(\)/);
    assert.match(pageHook, /setState\(\{[\s\S]*\.\.\.emptyState/);
    assert.match(pageHook, /mode === "more"[\s\S]*mergeCatalogPageItems[\s\S]*: incomingItems/);
  });

  await scenario("NO_SELECTION renders deliberate guidance without a global count", () => {
    assert.match(views, /category === null[\s\S]*t\("categoryNotSelected"\)/);
    assert.match(views, /t\("selectCategory"\)/);
    assert.match(views, /t\("selectCategoryHint"\)/);
    assert.match(i18n, /categoryNotSelected: "Kategori seçilmedi"/);
    assert.match(i18n, /selectCategory: "Bir kategori seçin"/);
  });

  await scenario("search remains inactive until a category is selected", () => {
    assert.match(views, /searchEnabled=\{!stalkerLive \|\| category !== null\}/);
    assert.match(views, /editable=\{searchEnabled\}/);
    assert.match(views, /category === null && search[\s\S]*setSearch\(""\)/);
  });

  await scenario("global count is attached only to an explicit global selection", () => {
    assert.match(views, /requestCategory !== null[\s\S]*requestCategory === \(providerGlobal[\s\S]*\? snapshotCount[\s\S]*: undefined/);
    assert.match(main, /snapshotCount=\{\{ totalCount: liveCatalog\.totalCount, countKnown: liveCatalog\.countKnown \}\}/);
  });

  await scenario("duplicate provider All categories remain visually canonicalized", () => {
    assert.match(views, /categoryOptions\(categories, t\("all"\), stalkerLive\)/);
    assert.match(views, /return options\.filter\(\(item, index\) => index === 0 \|\| !isStalkerLiveGlobalCategory/);
  });

  await scenario("legacy Stalker Live path also refuses implicit requests", () => {
    assert.match(legacyLive, /readCatalogCategorySelection\(providerId, "live", null\)/);
    assert.match(legacyLive, /enabled: category !== null && sync\.categoriesReady/);
    assert.match(legacyLive, /categoryId: category \?\? undefined/);
  });

  await scenario("Live labels order and explicit playback handoff stay protected", () => {
    assert.match(liveTreatment, /Live category normalization keeps provider labels and provider order/);
    assert.match(main, /<PagedLiveCatalog[\s\S]*onOpen=\{openLive\}/);
    assert.match(main, /kind: "live"/);
  });

  await scenario("R17-H error count and global-category guards remain present", () => {
    assert.match(r17h, /Live history failures use a provider-scoped domain/);
    assert.match(r17h, /Stalker Home count contract distinguishes unknown verified empty and persisted totals/);
    assert.match(r17h, /Equivalent provider global categories collapse to one canonical visible option/);
  });

  await scenario("Movies Series History and player ownership are untouched by the Live gate", () => {
    assert.match(main, /<StalkerGoldenMoviesCatalog/);
    assert.match(main, /<StalkerSeriesProductSurface/);
    assert.match(main, /view === "player"/);
    assert.doesNotMatch(repository, /create_link|NativeVideoPlayer|MediaProgress/);
  });

  await scenario("M3U and Xtream keep their existing enabled contract", () => {
    assert.match(views, /enabled: stalkerLive \? requestReady : providerType !== null/);
    assert.match(views, /const providerType = pagedProviderType\(provider\.type\)/);
  });

  assert.equal(passed, 20);
  console.log("Stalker R17-H1 explicit Live category scenarios: 20/20 passed");
}

void mainTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
