import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadStalkerVodCategories,
  loadStalkerVodPage,
  normalizeStalkerVodCategories,
  normalizeStalkerVodPage,
  normalizeStalkerVodResolvedUrl,
  resolveStalkerVodLink,
  type StalkerVodItem,
} from "../lib/stalkerVod";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const vodSource = source("lib/stalkerVod.ts");
const surfaceSource = source("components/stalker/StalkerVodSurface.tsx");
const productSource = source("components/product/ProductLiveSurface.tsx");
const isolatedSource = source("lib/stalkerIsolatedLogin.ts");

type Params = Record<string, string | number | boolean | undefined>;
function harness() {
  const calls: Params[] = [];
  return {
    calls,
    session: {
      async handshake() { return { authenticated: true as const }; },
      async request(params: Params) {
        calls.push(params);
        if (params.action === "get_categories") {
          return { js: [
            { id: "*", title: "All", alias: "all", censored: 0 },
            { id: "7", title: "Movies", alias: "movies", censored: 0 },
            { id: "7", title: "Duplicate" },
            { id: "", title: "Invalid" },
          ] };
        }
        if (params.action === "get_ordered_list") {
          return {
            total_items: 28,
            max_page_items: 14,
            cur_page: Number(params.p),
            selected_item: 0,
            data: [{
              id: "501",
              name: "Film A",
              cmd: "ffmpeg http://portal/item/501",
              category_id: String(params.category),
              screenshot_uri: "https://images.example/501.jpg",
              description: "Description",
              year: "2026",
              genre: "Drama",
              rating: "8.1",
              director: "Director",
              actors: "Actor A, Actor B",
            }],
          };
        }
        if (params.action === "create_link") {
          return { cmd: "ffmpeg http://stream.example/vod/501.m3u8" };
        }
        throw new Error(`unexpected ${String(params.action)}`);
      },
    },
  };
}

async function main() {
  const categories = normalizeStalkerVodCategories({ js: [
    { id: "*", title: "All" },
    { id: "7", title: "Movies" },
    { id: "7", title: "Duplicate" },
    { id: "", title: "Invalid" },
    { id: "8", title: "" },
  ] });
  assert.deepEqual(categories, [{ id: "*", title: "All" }, { id: "7", title: "Movies" }]);

  const h1 = harness();
  const loadedCategories = await loadStalkerVodCategories(h1.session);
  assert.deepEqual(h1.calls, [{ type: "vod", action: "get_categories" }]);
  assert.equal(loadedCategories[0]?.id, "*");

  const h2 = harness();
  const first = await loadStalkerVodPage(h2.session, { id: "*", title: "All" }, 1);
  assert.deepEqual(h2.calls, [{ type: "vod", action: "get_ordered_list", category: "*", p: 1 }]);
  assert.equal(first.currentPage, 1);
  assert.equal(first.totalItems, 28);
  assert.equal(first.maxPageItems, 14);
  assert.equal(first.hasNextPage, true);

  const h3 = harness();
  const second = await loadStalkerVodPage(h3.session, { id: "7", title: "Movies" }, 2);
  assert.deepEqual(h3.calls, [{ type: "vod", action: "get_ordered_list", category: "7", p: 2 }]);
  assert.equal(second.currentPage, 2);
  assert.equal(second.hasNextPage, false);

  const normalized = normalizeStalkerVodPage({
    total_items: 14,
    max_page_items: 14,
    cur_page: 1,
    data: [{
      id: "501",
      name: "Film A",
      cmd: "ffmpeg http://portal/item/501",
      category_id: "7",
      screenshot_uri: "https://images.example/501.jpg",
      description: "Description",
      year: "2026",
      genre: "Drama",
      rating: "8.1",
      director: "Director",
      actors: "Actor A",
    }],
  }, 1);
  assert.deepEqual(normalized.items[0], {
    portalId: "501",
    title: "Film A",
    cmd: "ffmpeg http://portal/item/501",
    categoryId: "7",
    posterUrl: "https://images.example/501.jpg",
    description: "Description",
    year: "2026",
    genre: "Drama",
    rating: "8.1",
    director: "Director",
    actors: "Actor A",
  });

  const h4 = harness();
  const item: StalkerVodItem = normalized.items[0]!;
  const playable = await resolveStalkerVodLink(h4.session, item);
  assert.equal(playable, "http://stream.example/vod/501.m3u8");
  assert.deepEqual(h4.calls, [{
    type: "vod",
    action: "create_link",
    cmd: item.cmd,
    disable_ad: 0,
    download: 0,
  }]);
  assert.equal(normalizeStalkerVodResolvedUrl("ffmpeg http://stream.example/movie.ts"), "http://stream.example/movie.ts");
  assert.throws(() => normalizeStalkerVodResolvedUrl("ffmpeg file:///tmp/movie.ts"));

  assert.match(productSource, /label="Filmler"/);
  assert.match(productSource, /StalkerVodSurface/);
  assert.doesNotMatch(productSource, /StalkerVodProbePanel/);
  assert.match(surfaceSource, /<NativeVideoPlayer/);
  assert.match(surfaceSource, /mediaKind="movie"/);
  assert.match(surfaceSource, /onFullscreenExit=\{\(\) => setView\("details"\)\}/);
  assert.match(surfaceSource, /category\.id === "\*" \? "Tümü"/);
  assert.match(surfaceSource, /currentPage \+ 1/);
  assert.match(surfaceSource, /currentPage - 1/);
  assert.match(surfaceSource, /pageRequestRef/);
  assert.match(surfaceSource, /activeCategoryRef/);
  assert.match(surfaceSource, /playbackRequestRef/);
  assert.match(surfaceSource, /categoryRequestRef/);
  assert.match(surfaceSource, /pageRequestRef\.current\.sequence !== sequence/);
  assert.match(surfaceSource, /activeCategoryRef\.current !== category\.id/);
  assert.match(surfaceSource, /playbackRequestRef\.current\.sequence !== sequence/);
  assert.match(surfaceSource, /setView\("details"\)/);
  assert.match(surfaceSource, /setView\("list"\)/);

  for (const forbidden of [
    "get_all_channels",
    'type: "series"',
    "genre_id",
    "buildVodStreamUrl",
    "replaceProviderCatalogAtomically",
    "catalogPageRepository",
    "useCatalogSync",
    "AsyncStorage",
    "SecureStore",
    "SQLite",
  ]) {
    assert.equal(vodSource.includes(forbidden), false, `production Stalker VOD must not contain ${forbidden}`);
    assert.equal(surfaceSource.includes(forbidden), false, `production Stalker VOD surface must not contain ${forbidden}`);
  }
  assert.doesNotMatch(vodSource, /\bgenre\s*:/);
  assert.doesNotMatch(vodSource, /for\s*\([^)]*page|while\s*\(|Promise\.all/);
  assert.doesNotMatch(surfaceSource, /StalkerVodProbe|Diagnostic only|Üretim VOD değildir/);
  assert.doesNotMatch(surfaceSource, /\.cmd\}/);
  assert.doesNotMatch(surfaceSource, /playableUrl\}/);
  assert.match(surfaceSource, /redactSensitiveText/);

  assert.match(isolatedSource, /\{ type: "itv", action: "get_genres" \}/);
  assert.match(isolatedSource, /\{ type: "itv", action: "get_ordered_list", genre, p: page \}/);
  assert.match(isolatedSource, /\{ type: "itv", action: "create_link", cmd \}/);
  assert.doesNotMatch(isolatedSource, /get_all_channels/);

  const packageJson = source("package.json");
  for (const name of [
    "stalkerR15AIsolatedLoginScenarios",
    "stalkerR15BIsolatedGenresScenarios",
    "stalkerR15CIsolatedChannelListScenarios",
    "stalkerR15DIsolatedPlaybackScenarios",
    "stalkerR16AProductParityScenarios",
    "stalkerR16BPVodProbeScenarios",
    "stalkerR16CProductionVodScenarios",
  ]) {
    assert.match(packageJson, new RegExp(name));
  }

  console.log("stalker R16-C production VOD scenarios passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
