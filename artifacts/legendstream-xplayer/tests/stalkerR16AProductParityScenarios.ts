import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadIsolatedStalkerCategoryChannels,
  loadIsolatedStalkerGenres,
  resolveIsolatedStalkerChannelLink,
  type StalkerIsolatedSession,
} from "../lib/stalkerIsolatedLogin";
import {
  adjacentStalkerCategoryId,
  adjacentStalkerCategoryIndex,
  isStalkerCategoryHorizontalIntent,
  resolveStalkerCategorySwipe,
  STALKER_CATEGORY_SWIPE_THRESHOLD,
} from "../lib/stalkerCategoryPager";
import {
  normalizeStalkerProductCategories,
  toProductCategoryRows,
  toProductChannelRows,
} from "../lib/stalkerProductPresentation";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

async function main() {
  const categories = normalizeStalkerProductCategories([
    { id: "*", title: "ALL", order: 0 },
    { id: "10", title: "Haber", order: 1 },
    { id: "20", title: "Spor", order: 2 },
  ]);
  assert.deepEqual(categories.map((item) => item.id), ["10", "20"], "ALL pseudo-category must not be selectable");
  assert.deepEqual(toProductCategoryRows(categories), [
    { id: "10", title: "Haber" },
    { id: "20", title: "Spor" },
  ]);

  const pagerCategories = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
    { id: "c", title: "C" },
    { id: "d", title: "D" },
  ];
  assert.equal(STALKER_CATEGORY_SWIPE_THRESHOLD, 60);
  assert.equal(resolveStalkerCategorySwipe(-80, 8), "next");
  assert.equal(resolveStalkerCategorySwipe(80, 8), "previous");
  assert.equal(resolveStalkerCategorySwipe(30, 2), null);
  assert.equal(resolveStalkerCategorySwipe(-80, 90), null);
  assert.equal(resolveStalkerCategorySwipe(-80, 8, true), null);
  assert.equal(isStalkerCategoryHorizontalIntent(20, 4), true);
  assert.equal(isStalkerCategoryHorizontalIntent(20, 18), false);
  assert.equal(adjacentStalkerCategoryIndex(1, 4, "next"), 2);
  assert.equal(adjacentStalkerCategoryId(pagerCategories, "b", "next"), "c");
  assert.equal(adjacentStalkerCategoryId(pagerCategories, "b", "previous"), "a");
  assert.equal(adjacentStalkerCategoryId(pagerCategories, "a", "previous"), null);
  assert.equal(adjacentStalkerCategoryId(pagerCategories, "d", "next"), null);

  const channelRows = toProductChannelRows([
    { id: "501", title: "TRT Haber", cmd: "ffmpeg http://portal/live/501", logoUrl: "https://img/501.png", number: 12 },
  ]);
  assert.deepEqual(channelRows, [{ id: "501", title: "TRT Haber", logoUrl: "https://img/501.png", number: 12 }]);
  assert.equal("cmd" in channelRows[0]!, false);

  const requests: Record<string, unknown>[] = [];
  const session: StalkerIsolatedSession = {
    async handshake() { return { authenticated: true as const }; },
    async request(params) {
      requests.push({ ...params });
      if (params.action === "get_genres") return [{ id: "10", title: "Haber" }];
      if (params.action === "get_ordered_list") return [{ id: "501", name: "TRT Haber", cmd: "ffmpeg http://portal/live/501" }];
      if (params.action === "create_link") return { cmd: "ffmpeg https://cdn.example/live/501.m3u8" };
      throw new Error(`unexpected action ${String(params.action)}`);
    },
  };
  const loadedCategories = await loadIsolatedStalkerGenres(session);
  const loadedChannels = await loadIsolatedStalkerCategoryChannels(session, loadedCategories[0]!);
  const playable = await resolveIsolatedStalkerChannelLink(session, loadedChannels[0]!);
  assert.equal(playable, "https://cdn.example/live/501.m3u8");
  assert.deepEqual(requests, [
    { type: "itv", action: "get_genres" },
    { type: "itv", action: "get_ordered_list", genre: "10", p: 1 },
    { type: "itv", action: "create_link", cmd: "ffmpeg http://portal/live/501" },
  ]);
  assert.equal(requests.some((request) => request.action === "get_all_channels"), false);

  const pagerSource = source("components/stalker/StalkerCategoryPager.tsx");
  assert.match(pagerSource, /PanResponder\.create/);
  assert.match(pagerSource, /onMoveShouldSetPanResponderCapture/);
  assert.match(pagerSource, /Platform\.isTV/);
  assert.match(pagerSource, /focusable/);

  const livePagerSource = source("components/catalog/StalkerLiveCatalog.tsx");
  assert.match(livePagerSource, /StalkerCategoryPager/);
  assert.match(livePagerSource, /useCatalogPage/);
  assert.match(livePagerSource, /disabled=\{search\.trim\(\)\.length > 0\}/);

  const vodSource = source("components/stalker/StalkerVodSurface.tsx");
  const seriesSource = source("components/stalker/StalkerSeriesProductSurface.tsx");
  const productSessionSource = source("lib/stalkerProductSession.ts");
  for (const productSource of [vodSource, seriesSource, productSessionSource]) {
    assert.doesNotMatch(productSource, /readLatestIsolatedStalkerSessionForProbe|latestIsolatedStalkerSessionForProbe/);
  }
  assert.match(productSessionSource, /getOrCreateStalkerPortalSession/);
  assert.match(productSessionSource, /providerId:\s*provider\.id/);
  assert.match(productSessionSource, /portalUrl/);
  assert.match(productSessionSource, /provider\.mac/);
  assert.match(vodSource, /readCurrentStalkerProductSession\(provider\)/);
  assert.match(seriesSource, /readCurrentStalkerProductSession\(provider\)/);
  assert.match(vodSource, /isCurrentStalkerProductSession\(provider, session\)/);
  assert.match(seriesSource, /isCurrentStalkerProductSession\(provider, session\)/);

  const rootSource = source("components/OptimizedHomeScreenPaged.tsx");
  assert.doesNotMatch(rootSource, /runIsolatedStalkerLogin|ProductLiveSurface/);
  assert.match(rootSource, /const ok = await connectProvider\(config\)/);
  assert.match(rootSource, /view === "live" && provider\.type === "stalker"[\s\S]*StalkerLiveCatalog/);
  assert.match(rootSource, /view === "movies" && provider\.type === "stalker"[\s\S]*StalkerVodSurface/);
  assert.match(rootSource, /view === "series" && provider\.type === "stalker"[\s\S]*StalkerSeriesProductSurface/);
  for (const key of ["home", "live", "movies", "series", "history", "downloads", "settings"]) {
    assert.match(rootSource, new RegExp(`key: "${key}"`), `common shell must expose ${key}`);
  }
  assert.match(rootSource, /provider\?\.type === "stalker" \? \[\] : activeSnapshot\?\.movies/);
  assert.match(rootSource, /provider\?\.type === "stalker" \? \[\] : activeSnapshot\?\.series/);

  const setupBlock = rootSource.slice(rootSource.indexOf("function ProviderSetup"), rootSource.indexOf("type HistorySectionRow"));
  assert.doesNotMatch(setupBlock, /runIsolatedStalkerLogin|ProductLiveSurface/);
  assert.match(setupBlock, /if \(type === "stalker" && !mac\.trim\(\)\)/);
  assert.match(setupBlock, /await onSubmit\(/);

  const boundarySource = source("components/stalker/StalkerProductErrorBoundary.tsx");
  assert.match(boundarySource, /getDerivedStateFromError/);
  assert.match(boundarySource, /componentDidCatch/);
  assert.match(boundarySource, /sanitizeErrorForLog/);
  assert.match(boundarySource, /Tekrar dene/);
  assert.match(boundarySource, /Ana ekrana dön/);

  const seriesCatalogSource = source("components/stalker/StalkerSeriesProductCatalog.tsx");
  assert.match(seriesCatalogSource, /key="stalker-series-categories"/);
  assert.match(seriesCatalogSource, /key=\{`stalker-series-grid-\$\{screen\}`\}/);

  assert.match(rootSource, /view === "movies" && \(provider\.type === "m3u" \|\| provider\.type === "xtream"\)/);
  assert.match(rootSource, /view === "series" && \(provider\.type === "m3u" \|\| provider\.type === "xtream"\)/);

  const isolatedSource = source("lib/stalkerIsolatedLogin.ts");
  assert.equal(isolatedSource.includes('action: "get_all_channels"'), false);
  assert.equal(isolatedSource.includes('type: "vod"'), false);
  assert.equal(isolatedSource.includes('type: "series"'), false);

  console.log("stalker R16-A product parity scenarios passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
