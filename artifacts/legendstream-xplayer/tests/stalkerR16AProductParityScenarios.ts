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
  assert.equal(resolveStalkerCategorySwipe(-80, 8), "next", "left swipe must advance exactly one category");
  assert.equal(resolveStalkerCategorySwipe(80, 8), "previous", "right swipe must move to previous category");
  assert.equal(resolveStalkerCategorySwipe(30, 2), null, "small finger drift must not switch category");
  assert.equal(resolveStalkerCategorySwipe(-80, 90), null, "vertical intent must remain available to content scrolling");
  assert.equal(resolveStalkerCategorySwipe(-80, 8, true), null, "disabled pager must ignore swipe");
  assert.equal(isStalkerCategoryHorizontalIntent(20, 4), true);
  assert.equal(isStalkerCategoryHorizontalIntent(20, 18), false);
  assert.equal(adjacentStalkerCategoryIndex(1, 4, "next"), 2, "one gesture must not skip multiple categories");
  assert.equal(adjacentStalkerCategoryId(pagerCategories, "b", "next"), "c");
  assert.equal(adjacentStalkerCategoryId(pagerCategories, "b", "previous"), "a");
  assert.equal(adjacentStalkerCategoryId(pagerCategories, "a", "previous"), null, "first category must not wrap");
  assert.equal(adjacentStalkerCategoryId(pagerCategories, "d", "next"), null, "last category must not wrap");

  const channelRows = toProductChannelRows([
    { id: "501", title: "TRT Haber", cmd: "ffmpeg http://portal/live/501", logoUrl: "https://img/501.png", number: 12 },
  ]);
  assert.deepEqual(channelRows, [{ id: "501", title: "TRT Haber", logoUrl: "https://img/501.png", number: 12 }]);
  assert.equal("cmd" in channelRows[0]!, false, "presentation row must not expose playback command");

  const requests: Record<string, unknown>[] = [];
  const session: StalkerIsolatedSession = {
    async handshake() {
      return { authenticated: true as const };
    },
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

  const presentationSource = source("components/product/ProductLiveSurface.tsx");
  for (const forbidden of [
    "usePlayer",
    "useCatalogSync",
    "connectProvider",
    "useCatalogPage",
    "catalogPageRepository",
    "useStalkerLiveCatalogSync",
    "get_all_channels",
    "get_ordered_list",
    "create_link",
    "get_genres",
  ]) {
    assert.equal(presentationSource.includes(forbidden), false, `presentation shell must not own ${forbidden}`);
  }
  assert.match(presentationSource, /LEGEND/);
  assert.match(presentationSource, /Canlı TV/);
  assert.match(presentationSource, /screen === "categories"/);
  assert.match(presentationSource, /screen === "channels"/);
  assert.match(presentationSource, /channels\.map/);
  assert.match(presentationSource, /channel\.logoUrl/);

  const pagerSource = source("components/stalker/StalkerCategoryPager.tsx");
  assert.match(pagerSource, /PanResponder\.create/);
  assert.match(pagerSource, /onMoveShouldSetPanResponderCapture/);
  assert.match(pagerSource, /Platform\.isTV/);
  assert.match(pagerSource, /focusable/);
  assert.match(pagerSource, /adjacentStalkerCategoryId/);

  const livePagerSource = source("components/catalog/StalkerLiveCatalog.tsx");
  assert.match(livePagerSource, /StalkerCategoryPager/);
  assert.match(livePagerSource, /useCatalogPage/);
  assert.match(livePagerSource, /getCachedCatalogCategories/);
  assert.match(livePagerSource, /disabled=\{search\.trim\(\)\.length > 0\}/);
  assert.match(livePagerSource, /rememberCatalogCategorySelection/);

  const vodPagerSource = source("components/stalker/StalkerVodSurface.tsx");
  assert.match(vodPagerSource, /StalkerCategoryPager/);
  assert.match(vodPagerSource, /initialCategoryOpenedRef/);
  assert.match(vodPagerSource, /pageAbortRef\.current\?\.abort\(\)/);
  assert.match(vodPagerSource, /activeCategoryRef\.current !== category\.id/);
  assert.match(vodPagerSource, /setItems\(\[\]\)[\s\S]*setCurrentPage\(1\)/);
  assert.match(vodPagerSource, /disabled=\{view !== "list" \|\| searchQuery\.trim\(\)\.length > 0\}/);

  const seriesPagerSource = source("components/stalker/StalkerSeriesProductSurface.tsx");
  assert.match(seriesPagerSource, /StalkerCategoryPager/);
  assert.match(seriesPagerSource, /selectCategoryById/);
  assert.match(seriesPagerSource, /initialCategoryOpenedRef/);
  assert.match(seriesPagerSource, /requestAbort\.current\?\.abort\(\)/);
  assert.match(seriesPagerSource, /resetPaging\(\)/);
  assert.match(seriesPagerSource, /currentRequest\(request\.sequence\)/);
  assert.match(seriesPagerSource, /disabled=\{screen !== "list" \|\| searchQuery\.trim\(\)\.length > 0\}/);
  assert.match(seriesPagerSource, /showControls=\{screen === "list"\}/);

  const rootSource = source("components/OptimizedHomeScreenPaged.tsx");
  assert.match(rootSource, /STALKER_HOME_SCREEN/);
  assert.match(rootSource, /normalizeStalkerProductCategories/);
  assert.match(rootSource, /ProductLiveSurface/);
  assert.match(rootSource, /onOpenLive=\{openStalkerLiveSurface\}/);
  assert.match(rootSource, /onBackToHome=\{\(\) => setStalkerScreen\("STALKER_HOME_SCREEN"\)\}/);
  assert.match(rootSource, /onFullscreenExit=\{\(\) => setStalkerScreen\("STALKER_CHANNELS_SCREEN"\)\}/);
  assert.equal(rootSource.includes("GET_GENRES tamamlandı"), false);
  assert.equal(rootSource.includes("GET_ORDERED_LIST tamamlandı"), false);
  assert.equal(rootSource.includes("STALKER_CONNECTED"), false);
  assert.equal(rootSource.includes("Main info:"), false);

  const setupBlock = rootSource.slice(rootSource.indexOf("function ProviderSetup"), rootSource.indexOf("type HistorySectionRow"));
  for (const forbidden of ["replaceProviderCatalogAtomically", "rememberStalkerLiveCategories", "saveProviderSecrets"] ) {
    assert.equal(setupBlock.includes(forbidden), false, `isolated Stalker setup must not use ${forbidden}`);
  }
  assert.match(setupBlock, /if \(type === "stalker"\)[\s\S]*runIsolatedStalkerLogin/);
  assert.match(setupBlock, /if \(type === "stalker"\)[\s\S]*return;[\s\S]*await onSubmit/);

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
