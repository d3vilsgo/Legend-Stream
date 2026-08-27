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

const normalizedLegacy = normalizePersistedCatalogPayload(providerId, "live", live) as PersistedLiveCatalogItem;
expect(
  normalizedLegacy.playbackRef.type === "xtream-live" && !JSON.stringify(normalizedLegacy).includes("super-secret"),
  "legacy live payload must normalize through the same whitelist",
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
  syncSource.includes('projectCatalogItems(provider.id, "live", liveRows)') &&
  syncSource.includes('projectCatalogItems(provider.id, "vod", rows)') &&
  syncSource.includes('projectCatalogItems(provider.id, "series", rows)'),
  "all catalog sync writers must project runtime rows before persistence",
);

const runtimeDirect = `legendstream-catalog://xtream/movie/${encodeURIComponent(providerId)}/44?ext=mkv`;
expect(isCatalogRuntimeSource(runtimeDirect), "direct-source runtime reference must be credential-free and recognizable");

process.stdout.write(`catalog persistence scenarios: ${passed}/9 passed\n`);
