import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { buildCatalogPageSql, type CatalogPageRequest } from "../lib/catalogPaging";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const screenSource = source("components/OptimizedHomeScreenPaged.tsx");
const viewsSource = source("components/catalog/PagedCatalogViews.tsx");
const homeSource = source("components/home/HomeDiscovery.tsx");
const repositorySource = source("lib/catalogPageRepository.ts");
const pagingSource = source("lib/catalogPaging.ts");

let passed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function turkishSearchFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE catalog_items (
      provider_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      item_id TEXT NOT NULL,
      category_id TEXT,
      name TEXT NOT NULL,
      image_url TEXT,
      payload TEXT NOT NULL,
      added_at INTEGER NOT NULL DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      is_new INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provider_id, kind, item_id)
    );
  `);
  const insert = db.prepare(`
    INSERT INTO catalog_items (
      provider_id, kind, item_id, category_id, name, image_url, payload,
      added_at, first_seen_at, last_seen_at, is_new
    ) VALUES ('provider-tr', 'vod', ?, NULL, ?, NULL, '{}', 0, 1, 1, 0)
  `);
  ["İSTANBUL", "IĞDIR", "İzmir", "istanbul", "ığdır", "izmir"].forEach((name, index) => {
    insert.run(String(index + 1), name);
  });
  return db;
}

async function main() {
  await scenario("M3U no-groups hint is bounded and provider-specific", () => {
    assert.match(repositorySource, /EXISTS\([\s\S]*kind = 'live'[\s\S]*LIMIT 1[\s\S]*meaningful_live_groups/);
    assert.match(viewsSource, /provider\.type === "m3u" && page\.countKnown && hasMeaningfulM3ULiveGroups === false/);
    assert.match(viewsSource, /t\("m3uNoGroups"\)/);
    assert.doesNotMatch(viewsSource, /provider\.type !== "m3u"[\s\S]*m3uNoGroups/);
  });

  await scenario("password visibility control restores baseline accessibility props", () => {
    assert.match(screenSource, /accessibilityRole="button"/);
    assert.match(screenSource, /accessibilityLabel=\{passwordVisible \? "Şifreyi gizle" : "Şifreyi göster"\}/);
    assert.match(screenSource, /hitSlop=\{8\}[\s\S]*setPasswordVisible/);
  });

  await scenario("Home unknown-total fallback uses bounded category metadata as categories", () => {
    assert.match(repositorySource, /SELECT COUNT\(\*\) FROM catalog_categories WHERE provider_id = \? AND kind = 'vod'/);
    assert.match(repositorySource, /SELECT COUNT\(\*\) FROM catalog_categories WHERE provider_id = \? AND kind = 'series'/);
    assert.match(screenSource, /vodCategories=\{categoryMetadata\?\.providerId === provider\.id \? categoryMetadata\.vodCategories : 0\}/);
    assert.match(screenSource, /seriesCategories=\{categoryMetadata\?\.providerId === provider\.id \? categoryMetadata\.seriesCategories : 0\}/);
    assert.match(homeSource, /vod === null[\s\S]*t\("categoryCount"/);
    assert.match(homeSource, /series === null[\s\S]*t\("categoryCount"/);
    assert.doesNotMatch(homeSource, /vodCategories\.toLocaleString\(\)[\s\S]*t\("titles"/);
  });

  await scenario("SQLite paging search covers Turkish dotted and dotless I without JS catalog filtering", () => {
    const db = turkishSearchFixture();
    const pairs = [
      ["istanbul", "İSTANBUL"],
      ["ığdır", "IĞDIR"],
      ["izmir", "İzmir"],
      ["İSTANBUL", "istanbul"],
      ["IĞDIR", "ığdır"],
      ["İzmir", "izmir"],
    ] as const;
    for (const [search, expectedName] of pairs) {
      const request: CatalogPageRequest = {
        providerId: "provider-tr",
        providerType: "m3u",
        kind: "vod",
        search,
        sort: "default",
        limit: 100,
      };
      const plan = buildCatalogPageSql(request);
      const rows = db.prepare(plan.pageSql).all(...plan.pageArgs) as Array<{ name: string }>;
      assert.ok(rows.some((row) => row.name === expectedName), `${search} must find ${expectedName}`);
    }
    assert.match(pagingSource, /TURKISH_SEARCH_NAME_SQL/);
    assert.match(pagingSource, /normalizeCatalogSearchText/);
    assert.doesNotMatch(viewsSource, /items\.filter\(/);
    assert.doesNotMatch(screenSource, /getM3UCatalog|hydrateM3UProviderKindCache/);
  });

  assert.equal(passed, 4);
  console.log("paged catalog remediation scenarios: 4/4 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
