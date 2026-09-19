import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogPageQueryKey } from "../lib/catalogPaging";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const pageHook = source("hooks/useCatalogPage.ts");
const live = source("components/catalog/StalkerLiveCatalog.tsx");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function mainTest() {
  await scenario("category identity is part of the paging query key", () => {
    const a = catalogPageQueryKey({
      providerId: "provider",
      providerType: "stalker",
      kind: "live",
      categoryId: "2298",
      search: "",
      sort: "default",
      limit: 100,
    });
    const b = catalogPageQueryKey({
      providerId: "provider",
      providerType: "stalker",
      kind: "live",
      categoryId: "77",
      search: "",
      sort: "default",
      limit: 100,
    });
    assert.notEqual(a, b);
  });

  await scenario("active query ref tracks the current enabled query synchronously", () => {
    assert.match(pageHook, /activeQueryKeyRef = useRef<string \| null>\(null\)/);
    assert.match(pageHook, /activeQueryKeyRef\.current = effectiveEnabled \? queryKey : null/);
  });

  await scenario("loadMore refuses a cursor whose state query differs from current query", () => {
    assert.match(pageHook, /state\.queryKey !== queryKey/);
    assert.match(pageHook, /activeQueryKeyRef\.current !== queryKey/);
  });

  await scenario("stale loadPage closures cannot start under a replacement category query", () => {
    assert.match(pageHook, /const requestQueryKey = queryKey/);
    assert.match(pageHook, /if \(activeQueryKeyRef\.current !== requestQueryKey\) return/);
  });

  await scenario("in-flight stale category responses cannot commit after category replacement", () => {
    assert.match(
      pageHook,
      /generationRef\.current !== generation[\s\S]*stalkerController\?\.signal\.aborted[\s\S]*activeQueryKeyRef\.current !== requestQueryKey/,
    );
  });

  await scenario("category changes still abort, clear flight guards and reset paging state", () => {
    assert.match(pageHook, /generationRef\.current \+= 1/);
    assert.match(pageHook, /stalkerRequestRef\.current\?\.abort\(\)/);
    assert.match(pageHook, /flightGuardRef\.current\.clear\(\)/);
    assert.match(pageHook, /setState\(\{[\s\S]*\.\.\.emptyState/);
  });

  await scenario("reload also refuses stale query ownership", () => {
    assert.match(
      pageHook,
      /!effectiveEnabled \|\| !provider \|\| !baseRequest \|\| !queryKey \|\| activeQueryKeyRef\.current !== queryKey/,
    );
  });

  await scenario("explicit Live category and no-selection contracts remain unchanged", () => {
    assert.match(live, /categoryId: category \?\? undefined/);
    assert.match(live, /enabled: category !== null && sync\.categoriesReady/);
    assert.match(live, /setCategoryState\(rememberCatalogCategorySelection\(providerId, "live", id\)\)/);
  });

  assert.equal(passed, 8);
  console.log("Stalker R17-H5 Live category paging isolation scenarios: 8/8 passed");
}

void mainTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
