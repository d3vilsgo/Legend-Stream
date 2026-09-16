import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStalkerVodHistoryLink } from "../lib/stalkerVod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

type Params = Record<string, string | number | boolean | undefined>;

function replayHarness(failCreateLink = false) {
  const calls: Params[] = [];
  return {
    calls,
    session: {
      async request(params: Params) {
        calls.push(params);
        if (params.action === "get_ordered_list" && params.p === 1) {
          return {
            total_items: 2,
            max_page_items: 1,
            cur_page: 1,
            data: [{ id: "other", name: "Other", cmd: "opaque-other", category_id: "7" }],
          };
        }
        if (params.action === "get_ordered_list" && params.p === 2) {
          return {
            total_items: 2,
            max_page_items: 1,
            cur_page: 2,
            data: [{ id: "501", name: "Film A", cmd: "opaque-current-command", category_id: "7" }],
          };
        }
        if (params.action === "create_link") {
          if (failCreateLink) throw new Error("current create_link failed");
          return { cmd: "ffmpeg https://fresh.example/movie/501.m3u8" };
        }
        throw new Error(`unexpected request ${String(params.action)}`);
      },
    },
  };
}

async function main() {
  const replay = replayHarness();
  const result = await resolveStalkerVodHistoryLink(
    replay.session,
    { itemId: "501", categoryId: "7" },
  );
  assert.equal(result.item.portalId, "501");
  assert.equal(result.url, "https://fresh.example/movie/501.m3u8");
  assert.deepEqual(replay.calls, [
    { type: "vod", action: "get_ordered_list", category: "7", p: 1 },
    { type: "vod", action: "get_ordered_list", category: "7", p: 2 },
    { type: "vod", action: "create_link", cmd: "opaque-current-command", disable_ad: 0, download: 0 },
  ]);

  const failed = replayHarness(true);
  await assert.rejects(
    () => resolveStalkerVodHistoryLink(failed.session, { itemId: "501", categoryId: "7" }),
    /current create_link failed/,
  );

  const main = source("components/StalkerMainPage.tsx");
  const player = source("components/CompatibilityVideoPlayerV2.tsx");
  const media = source("lib/mediaProgress.ts");
  const controller = source("hooks/useStalkerMoviesCatalog.ts");
  const series = source("components/stalker/StalkerSeriesProductSurface.tsx");

  assert.match(controller, /categoryId: item\.categoryId \?\? selectedCategoryId/);
  assert.match(main, /progressRef: \{[\s\S]*?type: "stalker-vod"[\s\S]*?itemId: movie\.itemId[\s\S]*?categoryId: movie\.categoryId/);
  assert.match(main, /item\.playbackRef\.type === "stalker-vod"[\s\S]*?resolveStalkerVodHistoryLink\([\s\S]*?readCurrentStalkerProductSession\(provider\)\.session/);
  assert.match(main, /returnTo: "history"[\s\S]*?progressRef: item\.playbackRef/);
  assert.match(main, /returnTo: "movies"[\s\S]*?progressRef:/);
  assert.match(main, /onFullscreenExit=\{\(\) => setView\(playable\.returnTo\)\}/);
  assert.match(main, /catch \(caught\)[\s\S]*?setCatalogError\(redactSensitiveText/);
  assert.match(player, /saveProgress\(\{[\s\S]*?playbackRef: snapshot\.progressRef/);
  assert.match(player, /getProgress\(snapshot\.source, snapshot\.progressRef\)/);
  assert.match(player, /normalizedDuration > 0[\s\S]*?saved\.position > 5[\s\S]*?vlcRef\.current\?\.seek/);
  assert.match(media, /\| \{ type: "stalker-vod"; itemId: string; categoryId: string \}/);
  assert.doesNotMatch(JSON.stringify({ type: "stalker-vod", itemId: "501", categoryId: "7" }), /https?:\/\//);
  assert.match(series, /<NativeVideoPlayer source=\{player\.source\}/);

  process.stdout.write("Stalker R17-D History/Resume scenarios: 14/14 passed\n");
}

void main();
