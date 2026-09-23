import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const views = source("components/catalog/PagedCatalogViews.tsx");
const intent = source("lib/stalkerLiveCategoryIntent.ts");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function mainTest() {
  await scenario("Stalker Live defaults missing validated memory to provider global All", () => {
    assert.match(
      views,
      /const valid = explicitSelectionRequired && validated === null[\s\S]*rememberCatalogCategorySelection\(providerId, "live", providerGlobalCategoryId \?\? "__all__"\)/,
    );
  });

  await scenario("provider-native wildcard remains the preferred global request identity", () => {
    assert.match(views, /findStalkerLiveProviderGlobalCategory\(categories\)/);
    assert.match(views, /providerGlobal \? String\(providerGlobal\.category_id\) : "__all__"/);
    assert.match(intent, /value === "0" \|\| value === "\*" \|\| value === "__all__"/);
  });

  await scenario("Live waits for category metadata instead of flashing select-category guidance", () => {
    assert.match(views, /if \(stalkerLive && !categoriesReady\) return <CatalogLoadingSkeleton/);
  });

  await scenario("initial Stalker Live request remains exactly page one through empty cursor ownership", () => {
    assert.match(views, /categoryId: requestCategory \?\? undefined/);
    assert.match(views, /enabled: stalkerLive \? requestReady : providerType !== null/);
  });

  await scenario("automatic onEndReached cannot prefetch page two before user scroll", () => {
    assert.match(views, /const liveUserScrolledRef = useRef\(false\)/);
    assert.match(views, /onScrollBeginDrag=\{\(\) => \{[\s\S]*liveUserScrolledRef\.current = true/);
    assert.match(views, /onEndReached=\{\(\) => \{[\s\S]*if \(liveUserScrolledRef\.current\) page\.loadMore\(\)/);
  });

  await scenario("category or search changes reset the load-more user intent gate", () => {
    assert.match(
      views,
      /useEffect\(\(\) => \{[\s\S]*liveUserScrolledRef\.current = false;[\s\S]*setEpgClock\(Date\.now\(\)\);[\s\S]*\}, \[category, search\]\)/,
    );
  });

  await scenario("explicit category selection still owns subsequent Live requests", () => {
    assert.match(views, /onSelect=\{setCategory\}/);
    assert.match(views, /setCategoryState\(rememberCatalogCategorySelection\(providerId, "live", categoryId\)\)/);
  });

  await scenario("H8 does not remove H7 provider-global category canonicalization", () => {
    assert.match(views, /categoryOptions\(categories, t\("all"\), stalkerLive\)/);
    assert.match(views, /return options\.filter\(\(item, index\) => index === 0 \|\| !isStalkerLiveGlobalCategory/);
  });

  assert.equal(passed, 8);
  console.log("Stalker R17-H8 default Live All page-one scenarios: 8/8 passed");
}

void mainTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
