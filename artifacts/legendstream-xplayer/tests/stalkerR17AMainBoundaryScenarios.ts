import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testsDir, "..");
const source = (path: string) => readFileSync(resolve(packageRoot, path), "utf8");
const routeSource = source("app/(tabs)/index.tsx");
const stalkerMainSource = source("components/StalkerMainPage.tsx");
const stalkerMoviesSource = source("components/stalker/StalkerGoldenMoviesCatalog.tsx");
const stalkerMoviesControllerSource = source("hooks/useStalkerMoviesCatalog.ts");
const stalkerSeriesSource = source("components/stalker/StalkerSeriesProductSurface.tsx");
const goldenSource = source("components/OptimizedHomeScreenPaged.tsx");
const goldenCatalogSource = source("components/catalog/PagedCatalogViews.tsx");

function gitBlobSha(text: string) {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  process.stdout.write(`PASS ${name}\n`);
}

async function main() {
  await scenario("application routing selects the dedicated Stalker page before main-page runtime", () => {
    assert.match(routeSource, /import StalkerMainPage from "@\/components\/StalkerMainPage"/);
    assert.match(routeSource, /provider\?\.type === "stalker" \? <StalkerMainPage \/> : <OptimizedHomeScreenV6 \/>/);
  });

  await scenario("Xtream M3U and no-provider routing keep the existing golden page path", () => {
    assert.match(routeSource, /import OptimizedHomeScreenV6 from "@\/components\/OptimizedHomeScreenV6"/);
    assert.match(routeSource, /: <OptimizedHomeScreenV6 \/>/);
    assert.doesNotMatch(routeSource, /OptimizedHomeScreenPaged[^\n]*provider/);
  });

  await scenario("dedicated Stalker page routes Movies to its golden catalog and keeps Series migration explicit", () => {
    assert.match(stalkerMainSource, /view === "live"[\s\S]*?<PagedLiveCatalog/);
    assert.match(
      stalkerMainSource,
      /view === "movies"[\s\S]*?<StalkerProductErrorBoundary product="movies"[\s\S]*?<StalkerGoldenMoviesCatalog[\s\S]*?onPlayable=\{openMovie\}/,
    );
    assert.doesNotMatch(stalkerMainSource, /StalkerVodSurface/);
    assert.match(
      stalkerMainSource,
      /view === "series"[\s\S]*?<StalkerProductErrorBoundary product="series"[\s\S]*?<StalkerSeriesProductSurface provider=\{provider\}/,
    );
    assert.doesNotMatch(stalkerMainSource, /CatalogMigrationShell/);
  });

  await scenario("Stalker Movies resolves through its backend and hands playback to the page-level player", () => {
    assert.match(stalkerMainSource, /type Playable =/);
    assert.match(stalkerMainSource, /useState<Playable \| null>/);
    assert.match(stalkerMoviesControllerSource, /resolveStalkerVodLink\(session, item/);
    assert.match(stalkerMoviesControllerSource, /onPlayable\(\{/);
    assert.match(stalkerMainSource, /const openMovie = \(movie: StalkerMoviePlayable\)[\s\S]*?openResolvedPlayable\(\{[\s\S]*?returnTo: "movies"/);
    assert.match(stalkerMainSource, /if \(view === "player"\)/);
    assert.match(stalkerMainSource, /<NativeVideoPlayer/);
    assert.match(stalkerMainSource, /onFullscreenExit=\{\(\) => setView\(playable\.returnTo\)\}/);
  });

  await scenario("final Stalker Movies presentation owns no private player or legacy pager", () => {
    assert.doesNotMatch(stalkerMoviesSource, /NativeVideoPlayer/);
    assert.doesNotMatch(stalkerMoviesSource, /StalkerCategoryPager/);
    assert.doesNotMatch(stalkerMoviesSource, /StalkerVodSurface/);
    assert.match(stalkerMoviesSource, /useStalkerMoviesCatalog\(/);
  });

  await scenario("Series local playback remains a temporary R17-D seam and is not generalized", () => {
    assert.match(stalkerSeriesSource, /controller\.resolveEpisode\(detail\.seriesId, seasonId, episodeId/);
    assert.match(stalkerSeriesSource, /<NativeVideoPlayer source=\{player\.source\}/);
    assert.match(stalkerMainSource, /Series remains the explicit R17-D migration seam/);
  });

  await scenario("golden Xtream M3U main-page source remains byte-for-byte frozen", () => {
    assert.equal(gitBlobSha(goldenSource), "b51c5a09d203e02baa0e716c60749e419679fd1c");
  });

  await scenario("clone freezes golden navigation order and category identity seam", () => {
    const keys = ["home", "live", "movies", "series", "history", "downloads", "settings"];
    let cursor = -1;
    for (const key of keys) {
      const next = stalkerMainSource.indexOf(`key: "${key}" as const`, cursor + 1);
      assert.ok(next > cursor, `missing or out-of-order navigation key: ${key}`);
      cursor = next;
    }
    assert.match(stalkerMainSource, /type StalkerCategoryPresentation = \{[\s\S]*id: string;[\s\S]*name: string;[\s\S]*order: number;/);
  });

  await scenario("Stalker Movies mirrors golden catalog interactions without changing golden runtime", () => {
    for (const marker of ["CatalogHeader", "SortControl", "CategoryDrawer", "GridCard", "useCategoryDrawerSwipe"]) {
      assert.match(goldenCatalogSource, new RegExp(`function ${marker}|export function ${marker}`));
      assert.match(stalkerMoviesSource, new RegExp(`function ${marker}|export function ${marker}`));
    }
    assert.match(stalkerMoviesSource, /const columns = width >= 900 \? 5 : width >= 650 \? 4 : width >= 420 \? 3 : 2/);
    assert.match(stalkerMoviesSource, /onEndReachedThreshold=\{0\.55\}/);
  });

  await scenario("category labels and provider order remain separate from category ids", () => {
    assert.match(stalkerMoviesSource, /categories\.map\(\(category, order\) => \(\{[\s\S]*?id: category\.id,[\s\S]*?name: category\.id === "\*" \? t\("all"\) : category\.title,[\s\S]*?order,/);
    assert.doesNotMatch(stalkerMoviesSource, /categories\.sort/);
    assert.match(stalkerMoviesSource, /if \(sort === "default"\) return items;/);
  });

  assert.equal(passed, 10);
  process.stdout.write(`stalker R17-A main boundary scenarios: ${passed}/10 passed\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
