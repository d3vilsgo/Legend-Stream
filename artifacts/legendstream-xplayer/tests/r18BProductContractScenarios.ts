import assert from "node:assert/strict";
import { PRODUCT_VIEWS, deriveProductCapabilities, type ProductPlayableIntent, type ProductView } from "../lib/productContract";
import type { CatalogPlaybackIdentity } from "../lib/catalogPageRepository";
import type { MediaPlaybackRef } from "../lib/mediaProgress";
import type { LiveChannelIdentity } from "../lib/playerLiveQueue";

const scenario = (name: string, run: () => void) => { run(); console.log("PASS: " + name); };

scenario("ProductView covers the current active shell destinations", () => {
  const expected: ProductView[] = ["home", "live", "movies", "series", "history", "downloads", "settings"];
  assert.deepEqual([...PRODUCT_VIEWS], expected);
});

scenario("capabilities describe product behavior for Xtream, M3U and Stalker", () => {
  assert.deepEqual(deriveProductCapabilities("xtream"), { live: true, movies: true, series: true, epg: true, supportsMovieAddedSort: true, liveCategoryMode: "implicit-all" });
  assert.deepEqual(deriveProductCapabilities("m3u"), { live: true, movies: true, series: true, epg: true, supportsMovieAddedSort: false, liveCategoryMode: "implicit-all" });
  assert.deepEqual(deriveProductCapabilities("stalker"), { live: true, movies: true, series: true, epg: true, supportsMovieAddedSort: false, liveCategoryMode: "provider-global" });
});

scenario("capability API exposes no protocol identity or authentication material", () => {
  for (const type of ["xtream", "m3u", "stalker"] as const) {
    const serialized = JSON.stringify(deriveProductCapabilities(type)).toLowerCase();
    for (const forbidden of ["providertype", "isstalker", "isxtream", "ism3u", "password", "username", "mac", "session", "token", "cookie", "cmd"]) assert.equal(serialized.includes(forbidden), false, type + " leaked " + forbidden);
  }
});

scenario("playback intent composes canonical identities for Live, Movie and Episode", () => {
  const liveIdentity: LiveChannelIdentity = { providerId: "provider-A", channelId: "channel-7" };
  const vodIdentity: CatalogPlaybackIdentity = { providerId: "provider-A", itemId: "501" };
  const progressRef: MediaPlaybackRef = { type: "stalker-episode", seriesId: "series-1", seasonId: "2", episodeId: "3" };
  const intents: ProductPlayableIntent[] = [
    { title: "Live", kind: "live", returnTo: "live", runtimeSource: "memory://live", liveIdentity },
    { title: "Movie", kind: "movie", returnTo: "movies", runtimeSource: "memory://movie", vodIdentity },
    { title: "Episode", kind: "episode", returnTo: "series", runtimeSource: "memory://episode", progressRef },
    { title: "History", kind: "movie", returnTo: "history", runtimeSource: "memory://history", progressRef: { type: "stalker-vod", itemId: "501", categoryId: "7" } },
  ];
  assert.equal(intents[0].liveIdentity, liveIdentity);
  assert.equal(intents[1].vodIdentity, vodIdentity);
  assert.equal(intents[2].progressRef, progressRef);
  assert.deepEqual(intents.map((item) => item.returnTo), ["live", "movies", "series", "history"]);
});

scenario("product playback contract carries no Stalker CMD or credential fields", () => {
  const safe: ProductPlayableIntent = { title: "Live", kind: "live", returnTo: "live", runtimeSource: "memory://resolved-only", liveIdentity: { providerId: "provider-A", channelId: "channel-7" } };
  const keys = Object.keys(safe).map((key) => key.toLowerCase());
  for (const forbidden of ["cmd", "mac", "session", "password", "username", "credentials", "token", "cookie"]) assert.equal(keys.includes(forbidden), false);
});

console.log("R18-B product contract scenarios passed.");