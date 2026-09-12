import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createStalkerSeriesProductController,
  firstStalkerSeriesSeasonId,
  mergeStalkerSeriesItems,
  searchStalkerSeriesCatalog,
  sortStalkerSeriesSeasons,
  type StalkerSeriesProductCategory,
  type StalkerSeriesProductSeason,
} from "../lib/stalkerSeriesProduct";
import {
  mergeStalkerVodItems,
  searchStalkerVodCatalog,
  type StalkerVodCategory,
} from "../lib/stalkerVod";

const root = path.resolve(__dirname, "..");
const source = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

const seriesLib = source("lib/stalkerSeriesProduct.ts");
const seriesCatalog = source("components/stalker/StalkerSeriesProductCatalog.tsx");
const seriesSurface = source("components/stalker/StalkerSeriesProductSurface.tsx");
const vodSurface = source("components/stalker/StalkerVodSurface.tsx");
const productSurface = source("components/product/ProductLiveSurface.tsx");

const season = (id: string, count = 1): StalkerSeriesProductSeason => ({
  id,
  label: id === "0" ? "Özel Bölümler" : `Sezon ${id}`,
  episodeCount: count,
  episodes: Array.from({ length: count }, (_, index) => ({
    key: `${id}:${index + 1}`,
    id: String(index + 1),
    label: `Bölüm ${index + 1}`,
    seasonId: id,
  })),
});

async function main() {
  // A: canonical numeric season ordering is independent of provider row order.
  assert.deepEqual(sortStalkerSeriesSeasons([season("6"), season("5"), season("4"), season("3"), season("2"), season("1")]).map((item) => item.id), ["1", "2", "3", "4", "5", "6"]);
  assert.deepEqual(sortStalkerSeriesSeasons([season("4"), season("1"), season("3"), season("2")]).map((item) => item.id), ["1", "2", "3", "4"]);
  assert.deepEqual(sortStalkerSeriesSeasons([season("special"), season("2"), season("0"), season("1")]).map((item) => item.id), ["1", "2", "0", "special"]);
  assert.equal(firstStalkerSeriesSeasonId(sortStalkerSeriesSeasons([season("0"), season("3"), season("1")])), "1");

  // B: Kuruluş Osman physical ground-truth fixture remains lossless: 194 episodes.
  const osmanCounts = [
    ["1", 27],
    ["2", 37],
    ["3", 34],
    ["4", 32],
    ["5", 34],
    ["6", 30],
  ] as const;
  const osmanProviderRows = [...osmanCounts].reverse().map(([id, count]) => ({
    season_id: id,
    name: `Season ${id}`,
    cmd: `opaque-season-${id}`,
    series: Array.from({ length: count }, (_, index) => String(index + 1)),
  }));
  let seriesDetailCalls = 0;
  const seriesSession = {
    request: async (params: Record<string, unknown>) => {
      if (params.action === "get_categories") {
        return { data: Array.from({ length: 45 }, (_, index) => ({ id: String(index), title: index === 0 ? "All" : `Category ${index}` })) };
      }
      if (params.action === "get_ordered_list" && params.movie_id) {
        seriesDetailCalls += 1;
        return { data: osmanProviderRows };
      }
      throw new Error("unexpected Series fixture request");
    },
  } as any;
  const seriesController = createStalkerSeriesProductController(seriesSession, "provider-safe");
  const categories = await seriesController.loadCategories();
  assert.equal(categories.length, 45, "get_categories must preserve the full returned category array");
  const detail = await seriesController.loadDetail({ id: "22927:22927", title: "Kuruluş Osman" });
  assert.equal(seriesDetailCalls, 1);
  assert.deepEqual(detail.seasons.map((item) => item.id), ["1", "2", "3", "4", "5", "6"]);
  assert.deepEqual(detail.seasons.map((item) => item.episodeCount), [27, 37, 34, 32, 34, 30]);
  assert.equal(detail.seasons.reduce((sum, item) => sum + item.episodeCount, 0), 194);
  assert.equal(detail.hierarchyTruncated, false);

  // C/E: append is lossless and dedupes by exact raw Series identity.
  const seriesMerged = mergeStalkerSeriesItems(
    [{ id: "a:a", title: "A" }, { id: "b:b", title: "B" }],
    [{ id: "b:b", title: "B duplicate" }, { id: "c:c", title: "C" }],
  );
  assert.deepEqual(seriesMerged.map((item) => item.id), ["a:a", "b:b", "c:c"]);

  // G: global Series search must find an item outside p=1.
  const globalSeriesCategory: StalkerSeriesProductCategory[] = [{ id: "*", title: "All" }];
  const searchedSeriesPages: number[] = [];
  const fakeSeriesSearchController = {
    loadPage: async (_category: StalkerSeriesProductCategory, page: number) => {
      searchedSeriesPages.push(page);
      if (page === 1) return { items: [{ id: "1:1", title: "Initial Page" }], page: 1, currentPage: 1, totalItems: 2, maxPageItems: 1, hasNextPage: true };
      return { items: [{ id: "2:2", title: "Deep Target Series" }], page: 2, currentPage: 2, totalItems: 2, maxPageItems: 1, hasNextPage: false };
    },
  } as any;
  const seriesSearchResults = await searchStalkerSeriesCatalog(fakeSeriesSearchController, globalSeriesCategory, "deep target");
  assert.deepEqual(searchedSeriesPages, [1, 2]);
  assert.deepEqual(seriesSearchResults.map((item) => item.id), ["2:2"]);

  // F/G: VOD append/dedupe and global search also reach beyond p=1.
  const vodMerged = mergeStalkerVodItems(
    [{ portalId: "1", title: "One", cmd: "opaque-1" }],
    [{ portalId: "1", title: "One duplicate", cmd: "opaque-x" }, { portalId: "2", title: "Two", cmd: "opaque-2" }],
  );
  assert.deepEqual(vodMerged.map((item) => item.portalId), ["1", "2"]);
  const vodPages: number[] = [];
  const vodSession = {
    request: async (params: Record<string, unknown>) => {
      const page = Number(params.p);
      vodPages.push(page);
      if (page === 1) return { total_items: 2, max_page_items: 1, cur_page: 1, data: [{ id: "v1", name: "Initial Movie", cmd: "opaque-v1" }] };
      return { total_items: 2, max_page_items: 1, cur_page: 2, data: [{ id: "v2", name: "Deep Target Movie", cmd: "opaque-v2" }] };
    },
  } as any;
  const globalVodCategory: StalkerVodCategory[] = [{ id: "*", title: "All" }];
  const vodSearchResults = await searchStalkerVodCatalog(vodSession, globalVodCategory, "deep target");
  assert.deepEqual(vodPages, [1, 2]);
  assert.deepEqual(vodSearchResults.map((item) => item.portalId), ["v2"]);

  // UI/source contracts: virtualized category/list surfaces, horizontal season tabs, one selected season body.
  assert.match(seriesCatalog, /FlatList/);
  assert.match(seriesCatalog, /horizontal[\s\S]*?seasonTabs/);
  assert.match(seriesCatalog, /selectedSeason\.episodes\.map/);
  assert.doesNotMatch(seriesCatalog, /season\.episodes\.map/);
  assert.match(seriesCatalog, /onEndReached/);
  assert.match(seriesSurface, /mergeStalkerSeriesItems/);
  assert.match(seriesSurface, /AbortController/);
  assert.match(seriesSurface, /searchStalkerSeriesCatalog/);
  assert.match(seriesLib, /for \(const raw of rowsFromEnvelope\(payload\)\) \{/);

  // VOD uses the same bounded lazy/search discipline and canonical player path.
  assert.match(vodSurface, /FlatList/);
  assert.match(vodSurface, /onEndReached/);
  assert.match(vodSurface, /mergeStalkerVodItems/);
  assert.match(vodSurface, /searchStalkerVodCatalog/);
  assert.match(vodSurface, /pageAbortRef\.current\?\.abort\(\)/);
  assert.match(vodSurface, /sessionStillCurrent/);
  assert.match(vodSurface, /<NativeVideoPlayer[\s\S]*?mediaKind="movie"[\s\S]*?autoFullscreen/);
  assert.match(productSurface, /!vodPlayerActive/);
  assert.match(productSurface, /section === "movies" \? <StalkerVodSurface/);
  assert.match(productSurface, /onPlayerActiveChange=\{setVodPlayerActive\}/);

  // Regression guards: exact Series create_link dialect and no alternate fallback remain intact.
  assert.match(seriesLib, /type:\s*"vod"[\s\S]*?action:\s*"create_link"[\s\S]*?cmd:\s*ref\.cmd[\s\S]*?series:\s*episodeId/);
  assert.equal((seriesLib.match(/action:\s*"create_link"/g) ?? []).length, 1);
  assert.doesNotMatch(seriesLib, /get_episodes|get_series_info|get_all_series/);

  console.log("R16-D9 catalog completeness/search/season/player scenarios: PASS");
}

void main();
