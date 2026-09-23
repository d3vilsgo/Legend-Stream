import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isCatalogRuntimeSource,
  normalizePersistedCatalogPayload,
  projectCatalogItems,
  type PersistedLiveCatalogItem,
  type PersistedVodCatalogItem,
} from "../lib/catalogPersistence";

let passed = 0;
const expect = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  passed += 1;
};

const providerId = "provider-safe-1";
const liveSecret = "https://iptv.example/live/alice/super-secret/991.ts";
const live = {
  id: "provider-safe-1:0:991",
  providerId,
  name: "News",
  streamUrl: liveSecret,
  logoUrl: "https://images.example/news.png",
  category: "News",
  tvgId: "news-1",
  streamType: "xtream",
  contentType: "live" as const,
  token: "must-not-persist",
};
const projectedLive = projectCatalogItems(providerId, "live", [live])[0] as PersistedLiveCatalogItem;
const liveJson = JSON.stringify(projectedLive);
expect(
  projectedLive.playbackRef.type === "xtream-live" &&
  projectedLive.playbackRef.streamId === "991" &&
  !liveJson.includes("alice") && !liveJson.includes("super-secret") && !liveJson.includes("streamUrl") && !liveJson.includes("must-not-persist"),
  "live projection must retain only a safe playback reference",
);

const directVod = {
  stream_id: 44,
  name: "Movie",
  container_extension: "mkv",
  category_id: "7",
  direct_source: "https://cdn.example/watch?token=secret-token",
  stream_icon: "https://images.example/movie.jpg",
  playback_url: "https://evil.example/secret",
  password: "not-allowed",
};
const projectedDirect = projectCatalogItems(providerId, "vod", [directVod as any])[0] as PersistedVodCatalogItem;
const directJson = JSON.stringify(projectedDirect);
assert.equal(projectedDirect.playbackRef.type, "xtream-vod");
expect(
  projectedDirect.playbackRef.sourceMode === "direct" &&
  !directJson.includes("direct_source") && !directJson.includes("secret-token") &&
  !directJson.includes("playback_url") && !directJson.includes("not-allowed"),
  "direct VOD projection must drop all source/secret extras",
);

const canonicalVod = projectCatalogItems(providerId, "vod", [{
  stream_id: "55",
  name: "Canonical",
  container_extension: "mp4",
  category_id: 9,
} as any])[0] as PersistedVodCatalogItem;
assert.equal(canonicalVod.playbackRef.type, "xtream-vod");
expect(
  canonicalVod.playbackRef.sourceMode === "canonical" && canonicalVod.playbackRef.streamId === "55",
  "canonical VOD must preserve credential-free identity",
);

const series = projectCatalogItems(providerId, "series", [{
  series_id: 77,
  name: "Series",
  cover: "https://images.example/series.jpg",
  backdrop_path: ["https://images.example/backdrop.jpg"],
  source: "https://evil.example/source",
  token: "drop-me",
} as any])[0];
const seriesJson = JSON.stringify(series);
expect(
  Boolean(series) && !seriesJson.includes('"source"') && !seriesJson.includes("drop-me") && seriesJson.includes("backdrop.jpg"),
  "series projection must be whitelist-only while retaining artwork metadata",
);

const normalizedLegacy = normalizePersistedCatalogPayload(providerId, "live", live, {
  id: providerId,
  type: "xtream",
  url: "https://iptv.example",
}) as PersistedLiveCatalogItem;
expect(
  normalizedLegacy.playbackRef.type === "xtream-live" && !JSON.stringify(normalizedLegacy).includes("super-secret"),
  "legacy live payload must normalize through the same whitelist",
);

const opaqueDirectLive = projectCatalogItems(providerId, "live", [{
  ...live,
  streamUrl: "https://cdn.example/opaque/channel",
  playbackStreamId: "123",
  playbackContainerExtension: "ts",
}] as any)[0] as PersistedLiveCatalogItem;
assert.deepEqual(opaqueDirectLive.playbackRef, {
  type: "xtream-live",
  streamId: "123",
  containerExtension: "ts",
});

const m3uProvider = {
  id: "m3u-safe",
  type: "m3u",
  url: "https://iptv.invalid/get.php?username=test-user&password=test-pass&type=m3u_plus&output=ts",
};
const legacyM3ULive = normalizePersistedCatalogPayload("m3u-safe", "live", {
  schemaVersion: 1,
  catalogKind: "live",
  id: "legacy-live",
  providerId: "m3u-safe",
  name: "Legacy live",
  category: "Live",
  streamUrl: "https://iptv.invalid/live/test-user/test-pass/701.ts",
}, m3uProvider) as PersistedLiveCatalogItem;
assert.deepEqual(legacyM3ULive.playbackRef, {
  type: "m3u-path",
  kind: "live",
  streamId: "701",
  containerExtension: "ts",
});
assert.notEqual(legacyM3ULive.playbackRef.type, "xtream-live");
assert.doesNotMatch(JSON.stringify(legacyM3ULive), /test-user|test-pass|streamUrl|https:\/\//);

const legacyM3UVod = normalizePersistedCatalogPayload("m3u-safe", "vod", {
  id: "legacy-vod",
  providerId: "m3u-safe",
  name: "Legacy movie",
  category: "Movies",
  streamUrl: "https://iptv.invalid/movie/test-user/test-pass/702.mp4",
}, m3uProvider) as PersistedVodCatalogItem;
assert.deepEqual(legacyM3UVod.playbackRef, {
  type: "m3u-path",
  kind: "movie",
  streamId: "702",
  containerExtension: "mp4",
});
assert.doesNotMatch(JSON.stringify(legacyM3UVod), /test-user|test-pass|streamUrl|https:\/\//);

const legacyM3USeries = normalizePersistedCatalogPayload("m3u-safe", "series", {
  id: "legacy-series",
  providerId: "m3u-safe",
  name: "Legacy Series",
  category: "Drama",
  seasons: {
    "1": [
      {
        id: "episode-a",
        title: "Episode A",
        category: "Drama",
        season: 1,
        episode: 1,
        streamUrl: "https://iptv.invalid/series/test-user/test-pass/801.mkv",
      },
      {
        id: "episode-b",
        title: "Episode B",
        category: "Drama",
        season: 1,
        episode: 2,
        streamUrl: "https://iptv.invalid/series/test-user/test-pass/802.mkv",
      },
    ],
  },
}, m3uProvider);
assert.equal(legacyM3USeries?.catalogKind, "series");
assert.deepEqual(
  legacyM3USeries?.catalogKind === "series"
    ? legacyM3USeries.m3uEpisodes?.map((episode) => episode.playbackRef)
    : [],
  [
    { type: "m3u-path", kind: "series", streamId: "801", containerExtension: "mkv" },
    { type: "m3u-path", kind: "series", streamId: "802", containerExtension: "mkv" },
  ],
);

const unresolved = normalizePersistedCatalogPayload(providerId, "live", {
  id: "legacy-unresolved",
  providerId,
  name: "Legacy",
  streamUrl: "opaque-command-without-xtream-path",
  category: "Legacy",
}) as PersistedLiveCatalogItem;
expect(
  unresolved.playbackRef.type === "unresolved",
  "unparseable legacy live source must remain metadata-only",
);

const packageRoot = process.cwd();
const cacheSource = fs.readFileSync(path.join(packageRoot, "lib/catalogCache.ts"), "utf8");
expect(
  cacheSource.includes("items: PersistedCatalogItem[]") &&
  cacheSource.includes("JSON.stringify(persisted)") &&
  !cacheSource.includes("Array<Channel | XtreamVodItem | XtreamSeriesItem>"),
  "catalog cache write API must accept only persisted DTOs",
);

const syncSource = fs.readFileSync(path.join(packageRoot, "context/CatalogSyncContext.tsx"), "utf8");
expect(
  syncSource.includes('projectCatalogItemsCooperatively(stagingId, "live", liveRows') &&
  syncSource.includes('projectCatalogItemsCooperatively(stagingId, "vod", rows') &&
  syncSource.includes('projectCatalogItemsCooperatively(stagingId, "series", rows') &&
  syncSource.includes("onProjectedItem:") &&
  syncSource.includes("stableXtreamLiveId(provider.id, item.playbackRef.streamId)") &&
  syncSource.includes("isCancelled,"),
  "all Xtream catalog sync writers must cooperatively project runtime rows into generation-scoped staging with cancellation and stable Live identity",
);

const runtimeDirect = `legendstream-catalog://xtream/movie/${encodeURIComponent(providerId)}/44?ext=mkv`;
expect(isCatalogRuntimeSource(runtimeDirect), "direct-source runtime reference must be credential-free and recognizable");

const runtimeSource = fs.readFileSync(path.join(packageRoot, "lib/catalogRuntime.ts"), "utf8");
const iptvSource = fs.readFileSync(path.join(packageRoot, "lib/iptv.ts"), "utf8");
const pageSource = fs.readFileSync(path.join(packageRoot, "lib/catalogPageRepository.ts"), "utf8");
const hookSource = fs.readFileSync(path.join(packageRoot, "hooks/useCatalogPage.ts"), "utf8");
const screenSource = fs.readFileSync(path.join(packageRoot, "components/OptimizedHomeScreenPaged.tsx"), "utf8");
expect(
  runtimeSource.includes("normalizeCatalogRuntimeBaseUrl") &&
  runtimeSource.includes("get\\.php") &&
  runtimeSource.includes("baseUrl: normalizeCatalogRuntimeBaseUrl(source)"),
  "cached live runtime must strip get.php before rebuilding the canonical stream URL",
);


assert.match(iptvSource, /playbackStreamId: streamId/);
assert.match(iptvSource, /playbackContainerExtension: extension/);
assert.match(pageSource, /safePayload\(provider, row\)/);
assert.match(pageSource, /normalizePersistedCatalogPayload\(provider\.id, "live", JSON\.parse\(row\.payload\), provider\)/);
assert.match(hookSource, /catalogRevision <= observedCatalogRevisionRef\.current[\s\S]*reload\(\)/);
assert.match(runtimeSource, /getVodInfo\(credentials, ref\.streamId, signal\)/);
assert.match(runtimeSource, /xtream-vod-canonical-fallback/);
assert.match(runtimeSource, /buildVodStreamUrl\(credentials,[\s\S]*stream_id: ref\.streamId/);
assert.match(runtimeSource, /export async function resolveCatalogPlaybackSource/);
assert.match(runtimeSource, /buildM3UStreamUrl\(provider\.url \|\| provider\.playlistUrl/);
assert.match(screenSource, /resolveCatalogPlaybackSource\(\{ kind: "live", item: channel \}, provider\)/);
assert.match(screenSource, /resolveCatalogPlaybackSource\(\{ kind: "movie", item \}, provider\)/);
assert.match(screenSource, /resolveCatalogPlaybackSource\(\{ kind: "episode", item: episode \}, provider\)/);
assert.match(screenSource, /if \(provider\.type === "stalker"\)[\s\S]*url: channel\.streamUrl/);
assert.doesNotMatch(JSON.stringify(opaqueDirectLive), /opaque\/channel|streamUrl|direct_source/);

process.stdout.write(`catalog persistence scenarios: ${passed}/10 passed\n`);
