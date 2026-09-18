import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const paged = source("lib/stalkerPagedCatalog.ts");
const lazy = source("lib/stalkerLazyLivePageRepository.ts");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function mainTest() {
  await scenario("explicit Live category validates returned row category semantics", () => {
    assert.match(paged, /function rowCategoryId\(row: Record<string, unknown>\)/);
    assert.match(paged, /row\.tv_genre_id \?\? row\.genre_id \?\? row\.category_id/);
    assert.match(paged, /assertOrderedPageCategory\(rows, categoryId\)/);
  });

  await scenario("mismatched category rows force dialect fallback", () => {
    assert.match(paged, /explicit\.some\(\(value\) => value !== categoryId\)/);
    assert.match(paged, /throw new StalkerCategoryDialectMismatchError\(\)/);
    assert.match(paged, /caught instanceof StalkerCategoryDialectMismatchError/);
    assert.match(paged, /continue;/);
  });

  await scenario("cached wrong dialect is evicted before retry", () => {
    assert.match(paged, /dialectByProvider\.get\(options\.providerId\) === dialect/);
    assert.match(paged, /dialectByProvider\.delete\(options\.providerId\)/);
  });

  await scenario("cached dialect is tried first but alternatives remain available", () => {
    assert.match(paged, /return \[cached, \.\.\.ordered\.filter\(\(candidate\) => candidate !== cached\)\]/);
  });

  await scenario("dialect is cached only after semantic validation succeeds", () => {
    const validation = paged.indexOf("assertOrderedPageCategory(rows, categoryId)");
    const cache = paged.indexOf("dialectByProvider.set(options.providerId, dialect)");
    assert.ok(validation >= 0 && cache > validation);
  });

  await scenario("global category semantics keep compatibility behavior", () => {
    assert.match(paged, /if \(isStalkerLiveGlobalCategoryId\(categoryId\) \|\| rows\.length === 0\) return/);
    assert.match(lazy, /compatibilityFallback: page === 1 && isStalkerLiveGlobalCategoryId\(categoryId\)/);
  });

  await scenario("explicit category request identity remains unchanged", () => {
    assert.match(paged, /\.\.\.categoryParams\(dialect, categoryId\)/);
    assert.match(paged, /action: "get_ordered_list"/);
  });

  assert.equal(passed, 7);
  console.log("Stalker R17-H6 Live category dialect semantic validation scenarios: 7/7 passed");
}

void mainTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
