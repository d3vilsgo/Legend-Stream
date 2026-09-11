import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createStalkerSeriesProductController,
  STALKER_SERIES_PRODUCT_LIMITS,
} from "../lib/stalkerSeriesProduct";

type Params = Record<string, string | number | boolean | undefined>;
type Handler = (params: Params, signal?: AbortSignal) => unknown | Promise<unknown>;

function harness(handler: Handler) {
  const calls: Params[] = [];
  return {
    calls,
    session: {
      async handshake() { return { authenticated: true as const }; },
      async request(params: Params, signal?: AbortSignal) {
        calls.push({ ...params });
        return handler(params, signal);
      },
    },
  };
}

async function main() {
  const h = harness((params) => {
    if (params.action === "get_categories") {
      return { js: { data: [{ id: "10", title: "Drama" }] } };
    }
    if (params.action === "get_ordered_list" && params.category === "10") {
      const p = Number(params.p);
      if (p === 1) {
        return {
          js: {
            total_items: 20,
            max_page_items: 14,
            cur_page: 1,
            data: [{
              id: "22927:22927",
              name: "Reacher",
              category_id: "10",
              screenshot_uri: "https://images.invalid/reacher.jpg",
              description: "List description",
              year: "2026",
              genre: "Action",
              rating: "8.1",
              director: "Director",
              actors: "Actor A, Actor B",
            }],
          },
        };
      }
      return {
        js: {
          total_items: 20,
          max_page_items: 14,
          cur_page: 2,
          data: [{ id: "23000:23000", name: "Second Page" }],
        },
      };
    }
    if (params.action === "get_ordered_list" && params.movie_id === "22927:22927") {
      return {
        js: {
          total_items: 1,
          max_page_items: 14,
          cur_page: 1,
          data: [{
            season_num: 1,
            name: "Season 1",
            description: "Detail description",
            series: [1, 2],
            cmd: "season-one-cmd",
          }],
        },
      };
    }
    if (params.action === "create_link") {
      return { js: { cmd: "ffmpeg http://example.invalid/episode.mkv?token=signed%2Bquery&x=1" } };
    }
    throw new Error(`unexpected request: ${JSON.stringify(params)}`);
  });

  const controller = createStalkerSeriesProductController(h.session, "provider-a");
  const categories = await controller.loadCategories();
  assert.deepEqual(categories, [{ id: "10", title: "Drama" }]);

  const page1 = await controller.loadPage(categories[0]!, 1);
  assert.equal(page1.currentPage, 1);
  assert.equal(page1.page, 1);
  assert.equal(page1.totalItems, 20);
  assert.equal(page1.maxPageItems, 14);
  assert.equal(page1.hasNextPage, true);
  assert.equal(page1.items[0]!.id, "22927:22927");
  assert.equal(page1.items[0]!.posterUrl, "https://images.invalid/reacher.jpg");
  assert.equal(page1.items[0]!.description, "List description");
  assert.equal(page1.items[0]!.year, "2026");
  assert.equal(page1.items[0]!.genre, "Action");
  assert.equal(page1.items[0]!.rating, "8.1");
  assert.equal(page1.items[0]!.director, "Director");
  assert.equal(page1.items[0]!.actors, "Actor A, Actor B");
  assert.deepEqual(h.calls.at(-1), { type: "series", action: "get_ordered_list", category: "10", p: 1 });

  const page2 = await controller.loadPage(categories[0]!, 2);
  assert.equal(page2.currentPage, 2);
  assert.equal(page2.totalItems, 20);
  assert.equal(page2.maxPageItems, 14);
  assert.equal(page2.hasNextPage, false);
  assert.deepEqual(h.calls.at(-1), { type: "series", action: "get_ordered_list", category: "10", p: 2 });

  await assert.rejects(() => controller.loadPage(categories[0]!, 0));
  await assert.rejects(() => controller.loadPage(categories[0]!, STALKER_SERIES_PRODUCT_LIMITS.maxPage + 1));

  const detail = await controller.loadDetail(page1.items[0]!);
  assert.equal(detail.seriesId, "22927:22927");
  assert.equal(detail.posterUrl, "https://images.invalid/reacher.jpg");
  assert.equal(detail.description, "List description");
  assert.equal(detail.year, "2026");
  assert.equal(detail.seasons.length, 1);
  assert.deepEqual(detail.seasons[0]!.episodes.map((episode) => episode.id), ["1", "2"]);
  assert.equal(JSON.stringify(detail).includes("season-one-cmd"), false);

  const beforePlayback = h.calls.length;
  const source = await controller.resolveEpisode("22927:22927", "1", "2");
  assert.equal(h.calls.length - beforePlayback, 1);
  assert.deepEqual(h.calls.at(-1), {
    type: "vod",
    action: "create_link",
    cmd: "season-one-cmd",
    series: "2",
  });
  assert.equal(source, "http://example.invalid/episode.mkv?token=signed%2Bquery&x=1");

  const root = path.resolve(__dirname, "..");
  const catalogSource = fs.readFileSync(path.join(root, "components/stalker/StalkerSeriesProductCatalog.tsx"), "utf8");
  const surfaceSource = fs.readFileSync(path.join(root, "components/stalker/StalkerSeriesProductSurface.tsx"), "utf8");
  assert.match(catalogSource, /Poster item=\{item\}/);
  assert.match(catalogSource, /detail\.description/);
  assert.match(catalogSource, /label="Önceki"/);
  assert.match(catalogSource, /label="Sonraki"/);
  assert.match(surfaceSource, /currentPage \+ 1/);
  assert.match(surfaceSource, /currentPage - 1/);
  assert.match(surfaceSource, /onFullscreenExit=\{\(\) => setPlayer\(null\)\}/);

  assert.equal(STALKER_SERIES_PRODUCT_LIMITS.maxCreateLinksPerSelection, 1);
  assert.equal(STALKER_SERIES_PRODUCT_LIMITS.fallbackDialects, 0);

  console.log("R16-D8 Series catalog + metadata + VOD-parity scenarios: PASS");
}

void main();
