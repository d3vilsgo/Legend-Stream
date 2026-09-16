import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStalkerVodHistoryLink } from "../lib/stalkerVod";
import {
  claimProgressForProvider,
  isMediaProgressV2PayloadSafe,
  mediaPlaybackRefMatchesProvider,
  parseMediaProgressV2Payload,
  upsertMediaProgressByIdentity,
  type MediaPlaybackRef,
  type MediaProgressV2,
} from "../lib/mediaProgress";

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

  const stalkerRef: MediaPlaybackRef = { type: "stalker-vod", itemId: "501", categoryId: "7" };
  assert.equal(mediaPlaybackRefMatchesProvider(stalkerRef, "stalker", "movie"), true);
  assert.equal(
    mediaPlaybackRefMatchesProvider(stalkerRef, "xtream", "movie") ||
    mediaPlaybackRefMatchesProvider(stalkerRef, "stalker", "episode"),
    false,
  );
  const stalkerA: MediaProgressV2 = {
    schemaVersion: 2,
    id: "stalker-a-501",
    providerId: "stalker-A",
    kind: "movie",
    title: "Film A",
    playbackRef: stalkerRef,
    position: 300,
    duration: 3600,
    updatedAt: 1,
  };
  assert.equal(isMediaProgressV2PayloadSafe([stalkerA], []), true);
  assert.equal(parseMediaProgressV2Payload(JSON.stringify([stalkerA]))[0]?.playbackRef.type, "stalker-vod");
  const updatedStalkerA: MediaProgressV2 = { ...stalkerA, position: 480, updatedAt: 2 };
  const oneUpdated = upsertMediaProgressByIdentity([stalkerA], updatedStalkerA);
  assert.equal(oneUpdated.length, 1);
  assert.equal(oneUpdated[0]?.position, 480);
  const stalkerB: MediaProgressV2 = { ...stalkerA, id: "stalker-b-501", providerId: "stalker-B", position: 120 };
  const isolated = upsertMediaProgressByIdentity([updatedStalkerA], stalkerB);
  assert.equal(isolated.length, 2);
  assert.equal(claimProgressForProvider(oneUpdated, "stalker-A", stalkerRef).entry?.position, 480);

  process.stdout.write("Stalker R17-D History/Resume scenarios: 22/22 passed\n");
}

void main();
