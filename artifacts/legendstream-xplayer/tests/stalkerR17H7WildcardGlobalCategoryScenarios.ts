import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findStalkerLiveProviderGlobalCategory,
  isStalkerLiveGlobalCategory,
  isStalkerLiveGlobalCategoryId,
  normalizeStalkerLiveCategoryIntent,
} from "../lib/stalkerLiveCategoryIntent";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const paged = source("lib/stalkerPagedCatalog.ts");
const lazy = source("lib/stalkerLazyLivePageRepository.ts");
const views = source("components/catalog/PagedCatalogViews.tsx");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function mainTest() {
  await scenario("provider wildcard id is recognized as global", () => {
    assert.equal(isStalkerLiveGlobalCategoryId("*"), true);
    assert.equal(isStalkerLiveGlobalCategory({ category_id: "*", category_name: "All" }), true);
    assert.equal(findStalkerLiveProviderGlobalCategory([
      { category_id: "229", category_name: "TR | ULUSAL" },
      { category_id: "*", category_name: "All" },
    ])?.category_id, "*");
  });

  await scenario("synthetic All remains canonical zero while provider wildcard is preserved", () => {
    assert.equal(normalizeStalkerLiveCategoryIntent("__all__"), "0");
    assert.equal(normalizeStalkerLiveCategoryIntent("*"), "*");
  });

  await scenario("wildcard global rows are not rejected for carrying real per-channel category ids", () => {
    assert.match(paged, /isStalkerLiveGlobalCategoryId\(categoryId\) \|\| rows\.length === 0/);
  });

  await scenario("wildcard All never probes genre_id star first", () => {
    assert.match(
      paged,
      /categoryId === "\*"\s*\? \["genre", "dual"\]\s*: \["genre_id", "genre", "dual"\]/,
    );
  });

  await scenario("wildcard global fallback may use get_all_channels on page one", () => {
    assert.match(lazy, /page === 1 && isStalkerLiveGlobalCategoryId\(categoryId\)/);
    assert.match(lazy, /action: "get_all_channels"/);
  });

  await scenario("provider-native wildcard remains the visible canonical All option", () => {
    assert.match(views, /providerGlobal \? String\(providerGlobal\.category_id\) : "__all__"/);
    assert.match(views, /findStalkerLiveProviderGlobalCategory\(categories\)/);
  });

  await scenario("ordinary explicit categories keep H6 semantic validation", () => {
    assert.match(paged, /explicit\.some\(\(value\) => value !== categoryId\)/);
    assert.match(paged, /throw new StalkerCategoryDialectMismatchError\(\)/);
  });

  assert.equal(passed, 7);
  console.log("Stalker R17-H7 wildcard global category scenarios: 7/7 passed");
}

void mainTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
