import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createStalkerSeriesProductController,
  sortStalkerSeriesItems,
} from "../lib/stalkerSeriesProduct";
import { normalizeStalkerVodCategories } from "../lib/stalkerVod";
import { historySecondaryText, visibleProgressRatio } from "../lib/historyPresentation";
import { parseStalkerProductCounts, writeStalkerProductCount } from "../lib/stalkerProductCounts";

const testsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testsDir, "..");
const source = (path: string) => readFileSync(resolve(packageRoot, path), "utf8");
const routeSource = source("app/(tabs)/index.tsx");
const productShellSource = source("components/ProductShell.tsx");
const stalkerMainSource = source("components/StalkerMainPage.tsx");
const stalkerMoviesSource = source("components/stalker/StalkerGoldenMoviesCatalog.tsx");
const stalkerMoviesControllerSource = source("hooks/useStalkerMoviesCatalog.ts");
const stalkerSeriesSource = source("components/stalker/StalkerSeriesProductSurface.tsx");
const goldenSource = source("components/OptimizedHomeScreenPaged.tsx");
const goldenCatalogSource = source("components/catalog/PagedCatalogViews.tsx");
const playerContextSource = source("context/PlayerContext.tsx");
const mediaLibrarySource = source("context/MediaLibraryContext.tsx");
const homeSource = source("components/home/HomeDiscovery.tsx");
const historySource = source("components/ContinueWatchingView.tsx");
const vlcSource = source("components/player/VlcPlaybackSurface.tsx");
const bridgeSource = source("components/catalog/StalkerPostActivationCatalogBridge.tsx");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  process.stdout.write(`PASS ${name}\n`);
}

async function main() {
  await scenario("application routing enters ProductShell before the dedicated Stalker page", () => {
    assert.match(routeSource, /import ProductShell from "@\\/components\\/ProductShell"/);
    assert.match(routeSource, /return <ProductShell \\/>/);
    assert.doesNotMatch(routeSource, /StalkerMainPage|OptimizedHomeScreenV6|provider\\?\\.type/);
    assert.match(productShellSource, /import StalkerMainPage from "@\\/components\\/StalkerMainPage"/);
    assert.match(productShellSource, /<StalkerMainPage key=\\{provider\\.id\\}/);
  });

  await scenario("Xtream M3U and no-provider routing keep the existing golden page below ProductShell", () => {
    assert.match(productShellSource, /import OptimizedHomeScreenV6 from "@\\/components\\/OptimizedHomeScreenV6"/);
    assert.match(productShellSource, /<OptimizedHomeScreenV6 key=\\{provider\\.id\\}/);
    assert.match(productShellSource, /if \\(!provider\\) \\{[\\s\\S]*?return <OptimizedHomeScreenV6 \\/>/);
    assert.doesNotMatch(routeSource, /OptimizedHomeScreenPaged[^\\n]*provider/);
  });

  await scenario("dedicated Stalker page routes Movies to its golden catalog and keeps Series migration explicit", () => {
    assert.match(stalkerMainSource, /presentedView === "live"[\s\S]*?<PagedLiveCatalog/);
    assert.match(
      stalkerMainSource,
      /presentedView === "movies"[\s\S]*?<StalkerProductErrorBoundary product="movies"[\s\S]*?<StalkerGoldenMoviesCatalog[\s\S]*?onPlayable=\{openMovie\}/,
    );
    assert.doesNotMatch(stalkerMainSource, /StalkerVodSurface/);
    assert.match(
      stalkerMainSource,
      /presentedView === "series"[\s\S]*?<StalkerProductErrorBoundary product="series"[\s\S]*?<StalkerSeriesProductSurface provider=\{provider\} onPlayable=\{openSeriesEpisode\}/,
    );
    assert.doesNotMatch(stalkerMainSource, /CatalogMigrationShell/);
  });

  await scenario("Stalker Movies resolves through its backend and hands playback to the page-level player", () => {
    assert.match(stalkerMainSource, /type Playable =/);
    assert.match(stalkerMainSource, /useState<Playable \| null>/);
    assert.match(stalkerMoviesControllerSource, /resolveStalkerVodLink\(session, item/);
    assert.match(stalkerMoviesControllerSource, /onPlayable\(\{/);
    assert.match(stalkerMainSource, /const openMovie = \(movie: StalkerMoviePlayable\)[\s\S]*?openResolvedPlayable\(\{[\s\S]*?returnTo: "movies"/);
    assert.match(stalkerMainSource, /view === "player" && playable/);
    assert.match(stalkerMainSource, /<NativeVideoPlayer/);
    assert.match(stalkerMainSource, /onFullscreenExit=\{\(\) => \{[\s\S]*?setView\(playable\.returnTo\)/);
  });

  await scenario("Stalker History re-resolves durable movie identity and preserves origin-aware player return", () => {
    assert.match(stalkerMainSource, /item\.playbackRef\.type === "stalker-vod"/);
    assert.match(stalkerMainSource, /resolveStalkerVodHistoryLink/);
    assert.match(stalkerMainSource, /returnTo: "history"/);
    assert.match(stalkerMainSource, /progressRef=\{playable\.progressRef\}/);
    assert.doesNotMatch(stalkerMainSource, /url:\s*item\.source[\s\S]*?playbackRef\.type === "stalker-vod"/);
  });

  await scenario("final Stalker Movies presentation owns no private player or legacy pager", () => {
    assert.doesNotMatch(stalkerMoviesSource, /NativeVideoPlayer/);
    assert.doesNotMatch(stalkerMoviesSource, /StalkerCategoryPager/);
    assert.doesNotMatch(stalkerMoviesSource, /StalkerVodSurface/);
    assert.match(stalkerMoviesSource, /useStalkerMoviesCatalog\(/);
  });

  await scenario("Series emits episode intent to the page-level player and owns no private player", () => {
    assert.match(stalkerSeriesSource, /controller\.resolveEpisode\(detail\.seriesId, seasonId, episodeId/);
    assert.match(stalkerSeriesSource, /emitPlayable\(buildStalkerSeriesPlayableIntent/);
    assert.doesNotMatch(stalkerSeriesSource, /NativeVideoPlayer/);
    assert.match(stalkerMainSource, /const openSeriesEpisode = \(intent: StalkerSeriesPlayableIntent\)[\s\S]*?returnTo: "series"/);
    assert.match(stalkerMainSource, /Series adapts protocol data into the shared Golden Series catalog/);
  });

  await scenario("Xtream M3U and Stalker share one Golden Series presentation boundary", () => {
    assert.match(goldenSource, /<PagedSeriesCatalog/);
    assert.match(goldenCatalogSource, /export function GoldenSeriesCatalog/);
    assert.match(goldenCatalogSource, /export function PagedSeriesCatalog[\s\S]*?<GoldenSeriesCatalog/);
    assert.match(stalkerSeriesSource, /GoldenSeriesCatalog/);
    assert.match(stalkerSeriesSource, /return <GoldenSeriesCatalog/);
    assert.doesNotMatch(stalkerSeriesSource, /StalkerSeriesProductCatalog|StalkerCategoryPager/);
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
    assert.match(stalkerMoviesSource, /shouldUseWholeCatalogLoadingSkeleton\(catalog\.loadingInitial, catalog\.visibleItems\.length, catalog\.search\)/);
    assert.match(stalkerMoviesSource, /ListEmptyComponent=\{catalog\.loadingInitial \|\| catalog\.searching[\s\S]*?<CatalogLoadingSkeleton text=\{t\("loadingMovies"\)\} \/>[\s\S]*?: <View style=\{s\.emptyGrid\}><Text>—<\/Text><\/View>\}/);
  });

  await scenario("Stalker Movies locks golden card geometry and removes provider-only pending decoration", () => {
    const cardSource = stalkerMoviesSource.slice(
      stalkerMoviesSource.indexOf("function GridCard"),
      stalkerMoviesSource.indexOf("function PageFooter"),
    );
    assert.match(cardSource, /function GridCard\(\{ title, image, onPress \}/);
    assert.match(cardSource, /<Pressable onPress=\{onPress\} style=\{s\.card\}>/);
    assert.match(cardSource, /fontWeight: "700", padding: 9/);
    assert.doesNotMatch(cardSource, /loading|disabled=|ActivityIndicator|cardTitleRow|minHeight/);
    assert.doesNotMatch(stalkerMoviesSource, /cardTitleRow|resolvingItemId ===/);
  });

  await scenario("Stalker Movies locks golden drawer gestures and page-level error presentation", () => {
    assert.match(stalkerMoviesSource, /gesture\.dx > 18 && Math\.abs\(gesture\.dx\) > Math\.abs\(gesture\.dy\) \* 1\.35/);
    assert.match(stalkerMoviesSource, /gesture\.dx > 55\) onOpen\(\)/);
    assert.match(stalkerMoviesSource, /onPanResponderTerminate: \(\) => undefined/);
    assert.match(stalkerMoviesSource, /onStartShouldSetPanResponder: \(\) => false/);
    assert.match(stalkerMoviesSource, /gesture\.dx < -18 && Math\.abs\(gesture\.dx\) > Math\.abs\(gesture\.dy\) \* 1\.5/);
    assert.match(stalkerMoviesSource, /gesture\.dx < -45\) closeAnimated\(\)/);
    assert.match(stalkerMoviesSource, /onPanResponderTerminationRequest: \(\) => true/);
    assert.match(stalkerMoviesSource, /duration: 190/);
    assert.match(stalkerMoviesSource, /duration: 170/);
    assert.match(stalkerMainSource, /onError=\{setCatalogError\}/);
    assert.match(stalkerMoviesSource, /onError\(catalog\.error\)/);
    assert.doesNotMatch(stalkerMoviesSource, /CatalogHeader[\s\S]*?error=\{catalog\.error\}/);
    assert.doesNotMatch(stalkerMoviesSource, /s\.error|error: \{ borderWidth/);
  });

  await scenario("category labels and provider order remain separate from category ids", () => {
    assert.match(stalkerMoviesSource, /categories\.map\(\(category, order\) => \(\{[\s\S]*?id: category\.id,[\s\S]*?name: category\.id === "\*" \? t\("all"\) : category\.title,[\s\S]*?order,/);
    assert.doesNotMatch(stalkerMoviesSource, /categories\.sort/);
    assert.match(stalkerMoviesSource, /if \(sort === "default"\) return items;/);
  });

  await scenario("Stalker Series preserves provider category labels and ordering for the Golden drawer", async () => {
    const session = {
      async request() {
        return { data: [
          { id: "229", title: "DE | SKY SPORT" },
          { id: "234", title: "TR | ULUSAL" },
          { id: "*", title: "ALL" },
        ] };
      },
    };
    const categories = await createStalkerSeriesProductController(session as any, "provider-A").loadCategories();
    assert.deepEqual(categories.map(({ id, title }) => [id, title]), [
      ["229", "DE | SKY SPORT"],
      ["234", "TR | ULUSAL"],
      ["*", "ALL"],
    ]);
    assert.match(stalkerSeriesSource, /name: category\.id === globalCategory\?\.id \? t\("all"\) : category\.title/);
    assert.doesNotMatch(stalkerSeriesSource, /name:\s*category\.id\s*[,}]/);
  });

  await scenario("Stalker Series defaults to provider order and reuses Golden interaction geometry", () => {
    const providerItems = [
      { id: "20", title: "Zulu" },
      { id: "3", title: "Alpha" },
    ];
    assert.deepEqual(sortStalkerSeriesItems(providerItems, "default").map((item) => item.id), ["20", "3"]);
    assert.deepEqual(sortStalkerSeriesItems(providerItems, "alphaAsc").map((item) => item.id), ["3", "20"]);
    assert.match(goldenCatalogSource, /const columns = width >= 900 \? 5 : width >= 650 \? 4 : width >= 420 \? 3 : 2/);
    assert.match(goldenCatalogSource, /<CategoryDrawer visible=\{drawerOpen\}/);
    assert.match(goldenCatalogSource, /onEndReachedThreshold=\{0\.55\}/);
    assert.match(stalkerMainSource, /onDrawerVisibilityChange=\{setCatalogDrawerOpen\}/);
  });

  await scenario("Live history failures use a provider-scoped domain and never reuse product resolver errors", () => {
    assert.match(playerContextSource, /domain: "live-history";[\s\S]*?providerId: string;[\s\S]*?messageKey: "historySaveFailed"/);
    assert.match(playerContextSource, /setScopedError\(\{ domain: "live-history", providerId, messageKey: "historySaveFailed" \}\)/);
    assert.doesNotMatch(playerContextSource, /setError\("Live TV history could not be saved\."\)/);
    assert.match(stalkerMainSource, /presentedView === "live" && scopedError\?\.domain === "live-history"/);
    assert.match(stalkerMainSource, /if \(target !== "live"\) clearScopedError\("live-history"\)/);
    assert.doesNotMatch(mediaLibrarySource, /setScopedError|setError\("Live TV history/);
  });

  await scenario("A later successful Live history write clears only the matching scoped error", () => {
    assert.match(playerContextSource, /setScopedError\(\(current\) => current\?\.domain === "live-history" && current\.providerId === providerId \? null : current\)/);
    assert.match(stalkerMainSource, /clearScopedError\(\); setCatalogError\(null\)/);
  });

  await scenario("Stalker Home count contract distinguishes unknown verified empty and persisted totals", async () => {
    assert.deepEqual(parseStalkerProductCounts(null), { vod: null, series: null });
    assert.deepEqual(parseStalkerProductCounts('{"vod":0,"series":12004}'), { vod: 0, series: 12004 });
    const values = new Map<string, string>();
    const storage = {
      async getItem(key: string) { return values.get(key) ?? null; },
      async setItem(key: string, value: string) { values.set(key, value); },
    };
    await Promise.all([
      writeStalkerProductCount("provider-A", "vod", 58079, storage as any),
      writeStalkerProductCount("provider-A", "series", 12004, storage as any),
    ]);
    const persisted = [...values.values()].map((value) => JSON.parse(value))[0];
    assert.deepEqual(persisted, { vod: 58079, series: 12004 });
    assert.match(stalkerMainSource, /live=\{liveCatalog\.countKnown \? liveCatalog\.totalCount : null\}/);
    assert.match(stalkerMainSource, /vod=\{productCounts\.vod\}[\s\S]*?series=\{productCounts\.series\}/);
    assert.match(homeSource, /live === null \? null : live\.toLocaleString\(\)/);
  });

  await scenario("History cards preserve episode context and clamp only meaningful progress", () => {
    assert.equal(historySecondaryText("episode", "Sezon 2 · Bölüm 4", "Filmler", "Bölüm"), "Sezon 2 · Bölüm 4");
    assert.equal(historySecondaryText("movie", undefined, "Filmler", "Bölüm"), "Filmler");
    assert.equal(visibleProgressRatio(2, 100), null);
    assert.equal(visibleProgressRatio(50, 100), 0.5);
    assert.equal(visibleProgressRatio(120, 100), 1);
    assert.match(historySource, /historySecondaryText\(item\.kind, item\.subtitle/);
    assert.match(homeSource, /homeProgressTrack: \{ height: 5/);
    assert.match(historySource, /track: \{ height: 6/);
  });

  await scenario("Player startup feedback is layered above the native surface and clears on readiness", () => {
    assert.match(vlcSource, /const \[firstFramePending, setFirstFramePending\] = useState\(true\)/);
    assert.match(vlcSource, /firstFramePending \? <View style=\{styles\.loadingOverlay\}/);
    assert.match(vlcSource, /Akış hazırlanıyor…/);
    assert.match(vlcSource, /loadingOverlay: \{[\s\S]*?zIndex: 30,[\s\S]*?elevation: 30/);
    assert.match(vlcSource, /handlePlaying[\s\S]*?setFirstFramePending\(false\)/);
  });

  await scenario("Foreground Live preparation notice stops once a usable snapshot exists", () => {
    assert.match(bridgeSource, /const usableLiveCatalog = snapshot\.providerId === provider\.id/);
    assert.match(bridgeSource, /\(phase === "preparing" \|\| phase === "syncing"\) && !usableLiveCatalog/);
  });

  await scenario("Equivalent provider global categories collapse to one canonical visible option", async () => {
    const vod = normalizeStalkerVodCategories({ data: [
      { id: "*", title: "ALL" },
      { id: "0", title: "Tümü" },
      { id: "9", title: "Drama" },
    ] });
    assert.deepEqual(vod.map((item) => item.id), ["*", "9"]);
    const series = await createStalkerSeriesProductController({ async request() {
      return { data: [{ id: "*", title: "ALL" }, { id: "0", title: "Tümü" }, { id: "5", title: "Komedi" }] };
    } } as any, "provider-A").loadCategories();
    assert.deepEqual(series.map((item) => item.id), ["*", "5"]);
    assert.match(goldenCatalogSource, /return options\.filter\(\(item, index\) => index === 0 \|\| !isStalkerLiveGlobalCategory/);
  });

  await scenario("Filtered Stalker Movies and Series retain a provider-visible active category label", () => {
    assert.match(stalkerMoviesSource, /activeCategoryLabel=\{activeCategoryLabel\}/);
    assert.match(stalkerSeriesSource, /activeCategoryLabel=\{selectedCategory && selectedCategory\.id !== globalCategory\?\.id \? selectedCategory\.title : undefined\}/);
    assert.match(goldenCatalogSource, /activeCategoryChip/);
    assert.doesNotMatch(stalkerMoviesSource, /activeCategoryLabel=\{catalog\.selectedCategoryId\}/);
  });

  assert.equal(passed, 23);
  process.stdout.write(`stalker R17-A main boundary scenarios: ${passed}/23 passed\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
