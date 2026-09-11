import assert from "node:assert/strict";
import {
  buildStalkerSeriesPlayerHandoff,
  createStalkerSeriesProductController,
  stalkerSeriesEpisodeIdentity,
  StalkerSeriesPlaybackOwnership,
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
    if (params.action === "get_categories") return [{ id: "10", title: "Drama" }];
    if (params.action === "get_ordered_list" && params.category === "10") {
      return { data: [{ id: "22927:22927", name: "Reacher" }] };
    }
    if (params.action === "get_ordered_list" && params.movie_id === "22927:22927") {
      return { data: [
        { season_num: 1, name: "Season 1", series: [1, 1, 2, null, {}, ["nested"]], cmd: "season-one-cmd" },
        { season_num: 2, name: "Season 2", series: [1, "2"], cmd: "season-two-cmd" },
      ] };
    }
    if (params.action === "create_link") {
      return { cmd: "ffmpeg http://example.invalid/episode.mkv?token=signed%2Bquery&x=1" };
    }
    throw new Error("unexpected request");
  });
  const controller = createStalkerSeriesProductController(h.session, "provider-a");

  const categories = await controller.loadCategories();
  assert.deepEqual(categories, [{ id: "10", title: "Drama" }]);
  assert.deepEqual(h.calls[0], { type: "series", action: "get_categories" });

  const page = await controller.loadPage(categories[0]!);
  assert.equal(page.page, 1);
  assert.equal(page.items[0]!.id, "22927:22927");
  assert.deepEqual(h.calls[1], { type: "series", action: "get_ordered_list", category: "10", p: 1 });

  const detail = await controller.loadDetail(page.items[0]!);
  assert.deepEqual(h.calls[2], { type: "series", action: "get_ordered_list", movie_id: "22927:22927", p: 1 });
  assert.equal(detail.seriesId, "22927:22927");
  assert.deepEqual(detail.seasons.map((season) => season.episodes.map((episode) => episode.id)), [["1", "2"], ["1", "2"]]);
  assert.notEqual(detail.seasons[0]!.episodes[0]!.key, detail.seasons[1]!.episodes[0]!.key);
  assert.equal(detail.seasons[0]!.episodes[0]!.key, stalkerSeriesEpisodeIdentity("provider-a", "22927:22927", "1", "1"));
  const serializedDetail = JSON.stringify(detail);
  assert.equal(serializedDetail.includes("season-one-cmd"), false);
  assert.equal(serializedDetail.includes("http://example.invalid"), false);

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
  const handoff = buildStalkerSeriesPlayerHandoff(detail, "1", "2", source);
  assert.deepEqual(handoff, {
    source: "http://example.invalid/episode.mkv?token=signed%2Bquery&x=1",
    title: "Bölüm 2",
    subtitle: "Reacher · Season 1",
    mediaKind: "episode",
  });

  const failed = harness((params) => {
    if (params.action === "get_ordered_list") {
      return { data: [{ season_num: 1, name: "Season 1", series: [1], cmd: "opaque-cmd" }] };
    }
    if (params.action === "create_link") return {};
    return [];
  });
  const failedController = createStalkerSeriesProductController(failed.session, "provider-a");
  const failedDetail = await failedController.loadDetail({ id: "raw:series:id", title: "Series" });
  const beforeFailure = failed.calls.length;
  await assert.rejects(() => failedController.resolveEpisode("raw:series:id", "1", "1"));
  assert.equal(failed.calls.length - beforeFailure, 1);
  assert.equal(failed.calls.filter((call) => call.action === "create_link").length, 1);
  assert.equal(failedDetail.seasons[0]!.episodes.length, 1);

  const ownership = new StalkerSeriesPlaybackOwnership("provider-a");
  const a = ownership.begin(stalkerSeriesEpisodeIdentity("provider-a", "s", "1", "1"));
  const b = ownership.begin(stalkerSeriesEpisodeIdentity("provider-a", "s", "1", "2"));
  assert.equal(ownership.isCurrent(a), false);
  assert.equal(ownership.isCurrent(b), true);
  ownership.switchProvider("provider-b");
  assert.equal(ownership.isCurrent(b), false);
  const c = ownership.begin(stalkerSeriesEpisodeIdentity("provider-b", "s", "1", "1"));
  assert.equal(ownership.isCurrent(c), true);
  ownership.invalidate();
  assert.equal(ownership.isCurrent(c), false);

  assert.equal(STALKER_SERIES_PRODUCT_LIMITS.page, 1);
  assert.equal(STALKER_SERIES_PRODUCT_LIMITS.maxCreateLinksPerSelection, 1);
  assert.equal(STALKER_SERIES_PRODUCT_LIMITS.fallbackDialects, 0);

  console.log("R16-D7 product Series scenarios: PASS");
}

void main();
