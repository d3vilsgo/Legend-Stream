import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  claimProgressForProvider,
  isMediaProgressV2PayloadSafe,
  mediaPlaybackRefMatchesProvider,
  parseMediaProgressV2Payload,
  samePlaybackRef,
  upsertMediaProgressByIdentity,
  type MediaPlaybackRef,
  type MediaProgressV2,
} from "../lib/mediaProgress";
import { resolveStalkerSeriesHistoryEpisode } from "../lib/stalkerSeriesProduct";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
type Params = Record<string, string | number | boolean | undefined>;

function replayHarness(options: { missingSeason?: boolean; missingEpisode?: boolean; failCreateLink?: boolean } = {}) {
  const calls: Params[] = [];
  let generation = 0;
  return {
    calls,
    session: {
      async request(params: Params) {
        calls.push({ ...params });
        if (params.type === "series" && params.action === "get_ordered_list") {
          if (options.missingSeason) return { data: [] };
          return {
            data: [{
              season_num: "2",
              name: "Season 2",
              series: options.missingEpisode ? ["1"] : ["1", "2"],
              cmd: `opaque-current-season-command-${++generation}`,
            }],
          };
        }
        if (params.type === "vod" && params.action === "create_link") {
          if (options.failCreateLink) throw new Error("current episode create_link failed");
          return { cmd: `ffmpeg https://fresh.example/${generation}/episode/${String(params.series)}.m3u8` };
        }
        throw new Error(`unexpected request ${String(params.type)}:${String(params.action)}`);
      },
    },
  };
}

const ref = (seriesId = "series-88", seasonId = "2", episodeId = "2"): MediaPlaybackRef => ({
  type: "stalker-episode",
  seriesId,
  seasonId,
  episodeId,
});

const entry = (
  providerId: string,
  playbackRef: MediaPlaybackRef,
  position: number,
  updatedAt: number,
): MediaProgressV2 => ({
  schemaVersion: 2,
  id: `${providerId}-${JSON.stringify(playbackRef)}`,
  providerId,
  kind: "episode",
  title: "Series A",
  subtitle: "Sezon 2 · Bölüm 2",
  playbackRef,
  position,
  duration: 1800,
  updatedAt,
});

async function main() {
  const cold = replayHarness();
  const first = await resolveStalkerSeriesHistoryEpisode(
    cold.session as any,
    "provider-A",
    { seriesId: "series-88", seasonId: "2", episodeId: "2" },
    "Series A",
  );
  assert.deepEqual(cold.calls, [
    { type: "series", action: "get_ordered_list", movie_id: "series-88", p: 1 },
    { type: "vod", action: "create_link", cmd: "opaque-current-season-command-1", series: "2" },
  ]);
  assert.equal(first.url, "https://fresh.example/1/episode/2.m3u8");
  assert.equal(first.title, "Series A");
  assert.equal(first.subtitle, "Sezon 2 · Bölüm 2");
  assert.deepEqual(first.identity, {
    type: "stalker-episode",
    providerId: "provider-A",
    seriesId: "series-88",
    seasonId: "2",
    episodeId: "2",
  });

  // A second cold reconstruction has no controller state to reuse and obtains
  // the season cmd and playable URL again from the current session.
  const second = await resolveStalkerSeriesHistoryEpisode(
    cold.session as any,
    "provider-A",
    { seriesId: "series-88", seasonId: "2", episodeId: "2" },
    "Series A",
  );
  assert.equal(second.url, "https://fresh.example/2/episode/2.m3u8");
  assert.equal(cold.calls.filter((call) => call.action === "get_ordered_list").length, 2);
  assert.equal(cold.calls.filter((call) => call.action === "create_link").length, 2);

  const durableRef = ref();
  assert.equal(mediaPlaybackRefMatchesProvider(durableRef, "stalker", "episode"), true);
  assert.equal(mediaPlaybackRefMatchesProvider(durableRef, "stalker", "movie"), false);
  assert.equal(mediaPlaybackRefMatchesProvider(durableRef, "xtream", "episode"), false);
  assert.doesNotMatch(JSON.stringify(durableRef), /https?:|cmd|token|session|authorization|credential|mac/i);

  const atFive = entry("provider-A", durableRef, 300, 1);
  assert.equal(isMediaProgressV2PayloadSafe([atFive], []), true);
  const reloaded = parseMediaProgressV2Payload(JSON.stringify([atFive]));
  assert.deepEqual(reloaded[0], atFive);
  assert.equal(claimProgressForProvider(reloaded, "provider-A", durableRef).entry?.position, 300);

  const atEight = { ...atFive, position: 480, updatedAt: 2 };
  const updated = upsertMediaProgressByIdentity(reloaded, atEight);
  assert.equal(updated.length, 1);
  assert.equal(updated[0]?.position, 480);
  assert.equal(claimProgressForProvider(updated, "provider-A", durableRef).entry?.position, 480);

  assert.equal(samePlaybackRef(durableRef, ref("series-88", "2", "1")), false);
  assert.equal(samePlaybackRef(durableRef, ref("series-88", "1", "2")), false);
  assert.equal(samePlaybackRef(durableRef, ref("series-99", "2", "2")), false);
  const separated = [
    entry("provider-A", ref("series-88", "2", "1"), 10, 3),
    entry("provider-A", ref("series-88", "1", "2"), 20, 4),
    entry("provider-A", ref("series-99", "2", "2"), 30, 5),
    entry("provider-B", durableRef, 40, 6),
  ].reduce((items, next) => upsertMediaProgressByIdentity(items, next), updated);
  assert.equal(separated.length, 5);

  const unsafeTransport = { ...atFive, playbackRef: { ...durableRef, url: "https://old.example/episode.m3u8" } } as unknown as MediaProgressV2;
  const unsafeSession = { ...atFive, playbackRef: { ...durableRef, sessionToken: "secret-session" } } as unknown as MediaProgressV2;
  const unsafeCmd = { ...atFive, playbackRef: { ...durableRef, cmd: "opaque-old-command" } } as unknown as MediaProgressV2;
  assert.equal(isMediaProgressV2PayloadSafe([unsafeTransport], []), false);
  assert.equal(isMediaProgressV2PayloadSafe([unsafeSession], []), false);
  assert.equal(isMediaProgressV2PayloadSafe([unsafeCmd], []), false);

  await assert.rejects(
    () => resolveStalkerSeriesHistoryEpisode(
      replayHarness({ missingSeason: true }).session as any,
      "provider-A",
      { seriesId: "series-88", seasonId: "2", episodeId: "2" },
      "Series A",
    ),
    /season is no longer available/i,
  );
  await assert.rejects(
    () => resolveStalkerSeriesHistoryEpisode(
      replayHarness({ missingEpisode: true }).session as any,
      "provider-A",
      { seriesId: "series-88", seasonId: "2", episodeId: "2" },
      "Series A",
    ),
    /episode is no longer available/i,
  );
  await assert.rejects(
    () => resolveStalkerSeriesHistoryEpisode(
      replayHarness({ failCreateLink: true }).session as any,
      "provider-A",
      { seriesId: "series-88", seasonId: "2", episodeId: "2" },
      "Series A",
    ),
    /current episode create_link failed/,
  );

  const mainSource = source("components/StalkerMainPage.tsx");
  const mediaSource = source("lib/mediaProgress.ts");
  const librarySource = source("context/MediaLibraryContext.tsx");
  const playerSource = source("components/CompatibilityVideoPlayerV2.tsx");
  const surfaceSource = source("components/stalker/StalkerSeriesProductSurface.tsx");
  const historyBlock = mainSource.slice(mainSource.indexOf("const openProgress"), mainSource.indexOf("const switchProvider"));
  assert.match(mainSource, /returnTo: "series"[\s\S]*?type: "stalker-episode"[\s\S]*?seriesId: intent\.identity\.seriesId/);
  assert.match(historyBlock, /item\.playbackRef\.type === "stalker-episode"[\s\S]*?resolveStalkerSeriesHistoryEpisode\([\s\S]*?readCurrentStalkerProductSession\(provider\)\.session/);
  assert.match(historyBlock, /returnTo: "history"[\s\S]*?progressRef: item\.playbackRef/);
  assert.match(historyBlock, /historyPlaybackAbortRef\.current\?\.abort\(\)[\s\S]*?\+\+historyPlaybackSequenceRef\.current/);
  assert.match(historyBlock, /abort\.signal\.aborted \|\| sequence !== historyPlaybackSequenceRef\.current/);
  assert.match(historyBlock, /catch \(caught\)[\s\S]*?setCatalogError\(redactSensitiveText/);
  assert.match(mediaSource, /type: "stalker-episode"; seriesId: string; seasonId: string; episodeId: string/);
  assert.match(librarySource, /entry\.playbackRef\.type === "stalker-vod" \|\| entry\.playbackRef\.type === "stalker-episode"/);
  assert.match(playerSource, /saveProgress\(\{[\s\S]*?subtitle: snapshot\.subtitle[\s\S]*?playbackRef: snapshot\.progressRef/);
  assert.match(playerSource, /getProgress\(snapshot\.source, snapshot\.progressRef\)/);
  assert.match(playerSource, /saved\.position > 5[\s\S]*?vlcRef\.current\?\.seek/);
  assert.match(librarySource, /item\.duration <= 0 \|\| item\.position < Math\.max\(0, item\.duration - 30\)/);
  assert.doesNotMatch(surfaceSource, /NativeVideoPlayer|CompatibilityVideoPlayer/);

  process.stdout.write("Stalker R17-F Episode History/Resume scenarios: 41/41 passed\n");
}

void main();
