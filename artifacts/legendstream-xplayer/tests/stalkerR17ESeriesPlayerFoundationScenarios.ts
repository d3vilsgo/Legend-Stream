import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStalkerSeriesPlayableIntent,
  createStalkerSeriesProductController,
  stalkerSeriesEpisodeIdentity,
  stalkerSeriesEpisodeIdentityKey,
  StalkerSeriesPlaybackOwnership,
} from "../lib/stalkerSeriesProduct";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
type Params = Record<string, string | number | boolean | undefined>;

function seriesHarness(failCreateLink = false) {
  const calls: Params[] = [];
  return {
    calls,
    session: {
      async request(params: Params) {
        calls.push({ ...params });
        if (params.action === "get_ordered_list") {
          return {
            data: [{
              season_num: "2",
              name: "Season 2",
              series: ["1", "2"],
              cmd: "opaque-current-season-command",
            }],
          };
        }
        if (params.action === "create_link") {
          if (failCreateLink) throw new Error("current episode create_link failed");
          return { cmd: `ffmpeg https://fresh.example/episode/${String(params.series)}.m3u8` };
        }
        throw new Error(`unexpected request ${String(params.action)}`);
      },
    },
  };
}

async function main() {
  const harness = seriesHarness();
  const controller = createStalkerSeriesProductController(harness.session as any, "provider-A");
  const detail = await controller.loadDetail({ id: "series-88", title: "Series A", categoryId: "12" });
  const urlA = await controller.resolveEpisode("series-88", "2", "1");
  const urlB = await controller.resolveEpisode("series-88", "2", "2");
  assert.equal(urlA, "https://fresh.example/episode/1.m3u8");
  assert.equal(urlB, "https://fresh.example/episode/2.m3u8");
  assert.deepEqual(harness.calls.slice(1), [
    { type: "vod", action: "create_link", cmd: "opaque-current-season-command", series: "1" },
    { type: "vod", action: "create_link", cmd: "opaque-current-season-command", series: "2" },
  ]);

  const intent = buildStalkerSeriesPlayableIntent("provider-A", detail, "2", "2", urlB);
  assert.deepEqual(intent, {
    identity: {
      type: "stalker-episode",
      providerId: "provider-A",
      seriesId: "series-88",
      seasonId: "2",
      episodeId: "2",
    },
    url: "https://fresh.example/episode/2.m3u8",
    title: "Bölüm 2",
    subtitle: "Series A · Sezon 2",
    kind: "episode",
  });

  const identity = intent.identity;
  const serializedIdentity = JSON.stringify(identity);
  assert.doesNotMatch(serializedIdentity, /https?:|token|authorization|cookie|opaque-current/i);
  const key = (providerId: string, seriesId: string, seasonId: string, episodeId: string) =>
    stalkerSeriesEpisodeIdentityKey(stalkerSeriesEpisodeIdentity(providerId, seriesId, seasonId, episodeId));
  assert.notEqual(key("provider-A", "series-88", "2", "1"), key("provider-A", "series-88", "2", "2"));
  assert.notEqual(key("provider-A", "series-88", "2", "1"), key("provider-A", "series-99", "2", "1"));
  assert.notEqual(key("provider-A", "series-88", "1", "1"), key("provider-A", "series-88", "2", "1"));
  assert.notEqual(key("provider-A", "series-88", "2", "1"), key("provider-B", "series-88", "2", "1"));

  const ownership = new StalkerSeriesPlaybackOwnership("provider-A:runtime-1");
  const older = ownership.begin(key("provider-A", "series-88", "2", "1"));
  const latest = ownership.begin(key("provider-A", "series-88", "2", "2"));
  assert.equal(ownership.isCurrent(older), false);
  assert.equal(ownership.isCurrent(latest), true);
  ownership.invalidate();
  assert.equal(ownership.isCurrent(latest), false);

  const failedHarness = seriesHarness(true);
  const failedController = createStalkerSeriesProductController(failedHarness.session as any, "provider-A");
  await failedController.loadDetail({ id: "series-88", title: "Series A" });
  await assert.rejects(
    () => failedController.resolveEpisode("series-88", "2", "1"),
    /current episode create_link failed/,
  );

  const surface = source("components/stalker/StalkerSeriesProductSurface.tsx");
  const main = source("components/StalkerMainPage.tsx");
  const playerAlias = source("components/NativeVideoPlayer.tsx");
  assert.doesNotMatch(surface, /NativeVideoPlayer|CompatibilityVideoPlayer/);
  assert.match(surface, /readCurrentStalkerProductSession\(provider\)/);
  assert.match(surface, /createStalkerSeriesProductController\(session, provider\.id\)/);
  assert.match(surface, /controller\.resolveEpisode\(detail\.seriesId, seasonId, episodeId, request\.abort\.signal\)/);
  assert.match(surface, /if \(!currentRequest\(request\.sequence\) \|\| !ownership\.isCurrent\(ticket\)\) return;[\s\S]*?emitPlayable\(buildStalkerSeriesPlayableIntent/);
  assert.match(surface, /setPlaybackError\(visibleError\(caught, "Bölüm oynatma bağlantısı alınamadı\."\)\)/);
  assert.match(main, /const openSeriesEpisode = \(intent: StalkerSeriesPlayableIntent\)[\s\S]*?returnTo: "series"[\s\S]*?seriesIdentity: intent\.identity/);
  assert.match(main, /presentedView === "series"[\s\S]*?<StalkerSeriesProductSurface provider=\{provider\} onPlayable=\{openSeriesEpisode\}/);
  assert.match(main, /view === "player" && playable[\s\S]*?<NativeVideoPlayer[\s\S]*?mediaKind=\{playable\.kind\}/);
  assert.match(main, /onFullscreenExit=\{\(\) => \{[\s\S]*?setView\(playable\.returnTo\)[\s\S]*?setPlayable\(null\)/);
  assert.match(playerAlias, /CompatibilityVideoPlayer as NativeVideoPlayer/);
  const seriesOpenBlock = main.slice(main.indexOf("const openSeriesEpisode"), main.indexOf("const openProgress"));
  assert.doesNotMatch(seriesOpenBlock, /progressRef|stalker-episode.*saveProgress/);

  process.stdout.write("Stalker R17-E Series player foundation scenarios: 24/24 passed\n");
}

void main();
