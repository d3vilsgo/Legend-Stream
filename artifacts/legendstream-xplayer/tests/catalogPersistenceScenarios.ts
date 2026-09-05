import fs from "node:fs";
import path from "node:path";
import {
  catalogItemRowToPersisted,
  isCatalogRuntimeSource,
  persistedCatalogItemToRuntime,
  projectCatalogItems,
} from "../lib/catalogPersistence";
import type { XtreamSeriesItem, XtreamVodItem } from "../lib/xtreamCatalog";
import type { Channel } from "../lib/iptv";

let passed = 0;
function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  passed += 1;
}

const providerId = "provider-persistence";
const live: Channel = {
  id: "12",
  name: "TR News",
  url: "https://iptv.example/live/user/pass/12.ts",
  categoryId: "live-news",
  logo: "https://img.example/news.png",
  epgChannelId: "news.tr",
};
const vod: XtreamVodItem = {
  stream_id: 44,
  name: "Film",
  stream_icon: "https://img.example/film.jpg",
  category_id: "vod-1",
  container_extension: "mkv",
  added: "1700000000",
  rating: "8.1",
};
const series: XtreamSeriesItem = {
  series_id: 77,
  name: "Series",
  cover: "https://img.example/series.jpg",
  category_id: "series-1",
  last_modified: "1700000100",
  rating: "7.4",
};

const projectedLive = projectCatalogItems(providerId, "live", [live]);
expect(projectedLive.length === 1, "live projection must produce one persisted row");
expect(projectedLive[0]?.providerId === providerId, "live projection must preserve provider scope");
expect(projectedLive[0]?.kind === "live", "live projection must preserve kind");
expect(!projectedLive[0]?.payloadJson.includes("pass"), "live persisted payload must not contain credentials");
expect(projectedLive[0]?.playbackRef.type === "xtream-live", "live projection must persist a credential-free Xtream playback ref");

const projectedVod = projectCatalogItems(providerId, "vod", [vod]);
expect(projectedVod[0]?.playbackRef.type === "xtream-vod", "VOD projection must persist Xtream playback metadata");
expect(projectedVod[0]?.playbackRef.type !== "xtream-vod" || projectedVod[0].playbackRef.extension === "mkv", "VOD extension must survive projection");

const projectedSeries = projectCatalogItems(providerId, "series", [series]);
expect(projectedSeries[0]?.playbackRef.type === "xtream-series", "series projection must persist Xtream series metadata");

const liveRow = {
  provider_id: providerId,
  kind: "live" as const,
  item_id: projectedLive[0]!.itemId,
  name: projectedLive[0]!.name,
  image: projectedLive[0]!.image,
  category_id: projectedLive[0]!.categoryId,
  payload_json: JSON.stringify(projectedLive[0]),
  first_seen_at: 1,
  last_seen_at: 2,
  is_new: 0,
};
const persisted = catalogItemRowToPersisted(liveRow);
expect(persisted?.playbackRef.type === "xtream-live", "SQLite row must decode to persisted live metadata");
const runtime = persisted ? persistedCatalogItemToRuntime(persisted, {
  id: providerId,
  type: "xtream",
  url: "https://iptv.example",
  playlistUrl: "https://iptv.example/get.php",
  username: "user",
  password: "pass",
}) : null;
expect(Boolean(runtime && "url" in runtime && runtime.url.includes("/live/user/pass/12.ts")), "runtime hydration must reconstruct live URL from current provider credentials");

const unresolvedRow = {
  ...liveRow,
  payload_json: JSON.stringify({
    ...projectedLive[0],
    playbackRef: { type: "unresolved", reason: "legacy-live-source" },
  }),
};
const unresolved = catalogItemRowToPersisted(unresolvedRow)!;
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
  syncSource.includes("projectCatalogItems(\n          stagingId,\n          kind,") &&
  syncSource.includes('await upsertCatalogItems(stagingId, "live", projected, options)') &&
  syncSource.includes('await upsertCatalogItems(stagingId, "vod", projected, options)') &&
  syncSource.includes('await upsertCatalogItems(stagingId, "series", projected, options)'),
  "all Xtream catalog sync writers must project runtime rows into the owned staging namespace before persistence",
);

const runtimeDirect = `legendstream-catalog://xtream/movie/${encodeURIComponent(providerId)}/44?ext=mkv`;
expect(isCatalogRuntimeSource(runtimeDirect), "direct-source runtime reference must be credential-free and recognizable");

const runtimeSource = fs.readFileSync(path.join(packageRoot, "lib/catalogRuntime.ts"), "utf8");
expect(
  runtimeSource.includes("getCatalogPage(") &&
  runtimeSource.includes("searchCatalogItems(") &&
  runtimeSource.includes("getCatalogItemsByIds("),
  "runtime catalog access must remain page/search/id backed",
);

process.stdout.write(`catalog persistence scenarios: ${passed}/10 passed\n`);
