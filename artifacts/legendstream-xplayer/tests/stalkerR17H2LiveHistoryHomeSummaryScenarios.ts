import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIVE_HISTORY_V2_STORAGE_KEY,
  clearLiveHistoryProvider,
  commitLiveHistoryV2,
  emptyLiveHistoryV2,
  migrateLiveHistoryV1,
  parseLiveHistoryV2Payload,
  providerIdFromChannelId,
  recordLiveHistory,
  removeLiveHistory,
  type LiveHistoryStorageAdapter,
} from "../lib/liveHistory";
import {
  STALKER_HOME_PREVIEW_LIMIT,
  parseStalkerHomeSummary,
  readStalkerHomeSummary,
  writeStalkerMovieHomePreview,
  writeStalkerSeriesHomePreview,
} from "../lib/stalkerHomeSummary";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const playerContext = source("context/PlayerContext.tsx");
const main = source("components/StalkerMainPage.tsx");
const home = source("components/home/HomeDiscovery.tsx");
const movieController = source("hooks/useStalkerMoviesCatalog.ts");
const seriesSurface = source("components/stalker/StalkerSeriesProductSurface.tsx");
const summaryHelper = source("lib/stalkerHomeSummary.ts");
const summaryHook = source("hooks/useStalkerHomeSummary.ts");
const liveSummaryHook = source("hooks/useStalkerLiveCatalogSync.ts");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

class MemoryStorage implements LiveHistoryStorageAdapter {
  values = new Map<string, string>();
  failWrites = false;
  getCalls = 0;
  setCalls = 0;
  async getItem(key: string) {
    this.getCalls += 1;
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.setCalls += 1;
    if (this.failWrites) throw new Error("synthetic storage failure");
    this.values.set(key, value);
  }
}

const stalker = (provider: string, portalId: string) => `${provider}:stalker:${portalId}`;

async function mainTest() {
  await scenario("canonical Stalker Live marker resolves provider scope", () => {
    assert.equal(providerIdFromChannelId(stalker("provider-A", "123")), "provider-A");
  });

  await scenario("numeric legacy and xtream-live markers stay accepted", () => {
    assert.equal(providerIdFromChannelId("provider-A:17:123"), "provider-A");
    assert.equal(providerIdFromChannelId("provider-A:xtream-live:123"), "provider-A");
  });

  await scenario("arbitrary Live identity markers stay rejected", () => {
    assert.equal(providerIdFromChannelId("provider-A:other:123"), null);
    assert.equal(providerIdFromChannelId("provider-A::123"), null);
  });

  await scenario("Stalker Live write passes canonical commit and exact read-back", async () => {
    const storage = new MemoryStorage();
    const id = stalker("provider-A", "101");
    const verified = await commitLiveHistoryV2(
      storage,
      recordLiveHistory(emptyLiveHistoryV2(), "provider-A", id),
    );
    assert.deepEqual(verified.byProvider["provider-A"], [id]);
    assert.deepEqual(parseLiveHistoryV2Payload(storage.values.get(LIVE_HISTORY_V2_STORAGE_KEY)!), verified);
  });

  await scenario("duplicate Stalker channel moves to front without duplication", () => {
    const one = stalker("provider-A", "101");
    const two = stalker("provider-A", "202");
    let history = recordLiveHistory(emptyLiveHistoryV2(), "provider-A", one);
    history = recordLiveHistory(history, "provider-A", two);
    history = recordLiveHistory(history, "provider-A", one);
    assert.deepEqual(history.byProvider["provider-A"], [one, two]);
  });

  await scenario("Stalker remove and provider clear retain canonical validation", () => {
    const one = stalker("provider-A", "101");
    const two = stalker("provider-A", "202");
    let history = recordLiveHistory(emptyLiveHistoryV2(), "provider-A", one);
    history = recordLiveHistory(history, "provider-A", two);
    assert.deepEqual(removeLiveHistory(history, "provider-A", one).byProvider["provider-A"], [two]);
    assert.deepEqual(clearLiveHistoryProvider(history, "provider-A").byProvider["provider-A"], []);
  });

  await scenario("same Stalker portal id remains isolated across providers", () => {
    let history = recordLiveHistory(emptyLiveHistoryV2(), "provider-A", stalker("provider-A", "101"));
    history = recordLiveHistory(history, "provider-B", stalker("provider-B", "101"));
    assert.deepEqual(history.byProvider["provider-A"], [stalker("provider-A", "101")]);
    assert.deepEqual(history.byProvider["provider-B"], [stalker("provider-B", "101")]);
  });

  await scenario("legacy migration classifies canonical Stalker ids into provider buckets", () => {
    const migrated = migrateLiveHistoryV1([stalker("provider-A", "101"), "unscoped-old-id"]);
    assert.deepEqual(migrated.byProvider["provider-A"], [stalker("provider-A", "101")]);
    assert.deepEqual(migrated.unscoped, ["unscoped-old-id"]);
  });

  await scenario("Live History persists identity only and no transport data", async () => {
    const storage = new MemoryStorage();
    await commitLiveHistoryV2(
      storage,
      recordLiveHistory(emptyLiveHistoryV2(), "provider-A", stalker("provider-A", "101")),
    );
    const raw = storage.values.get(LIVE_HISTORY_V2_STORAGE_KEY)!;
    assert.doesNotMatch(raw, /https?:|create_link|cmd|token|cookie|mac|password/i);
  });

  await scenario("successful Live save clears only matching scoped error", () => {
    assert.match(playerContext, /setScopedError\(\(current\) => current\?\.domain === "live-history" && current\.providerId === providerId \? null : current\)/);
  });

  await scenario("real Live storage failure still emits scoped error", () => {
    assert.match(playerContext, /LS_LIVE_HISTORY_PERSIST_FAILED/);
    assert.match(playerContext, /setScopedError\(\{ domain: "live-history", providerId, messageKey: "historySaveFailed" \}\)/);
  });

  await scenario("unknown Stalker Home summary is provider-scoped and empty", () => {
    assert.deepEqual(parseStalkerHomeSummary(null, "provider-A"), {
      schemaVersion: 1, providerId: "provider-A", movies: [], series: [],
    });
  });

  await scenario("movie preview is bounded and keeps safe presentation metadata", async () => {
    const storage = new MemoryStorage();
    const items = Array.from({ length: 12 }, (_, index) => ({
      portalId: String(index), title: `Movie ${index}`, cmd: `ffmpeg http://secret/${index}`,
      posterUrl: `https://images.example/${index}.jpg`, genre: "Drama", year: "2026", rating: "8.0",
    }));
    const written = await writeStalkerMovieHomePreview("provider-A", items, storage as any);
    assert.equal(written.movies.length, STALKER_HOME_PREVIEW_LIMIT);
    assert.deepEqual(written.movies[0], {
      id: "0", title: "Movie 0", image: "https://images.example/0.jpg", category: "Drama", year: "2026", rating: "8.0",
    });
  });

  await scenario("series preview is bounded and preserves the existing movie preview", async () => {
    const storage = new MemoryStorage();
    await writeStalkerMovieHomePreview("provider-A", [{ portalId: "m1", title: "Movie", cmd: "secret" }], storage as any);
    const written = await writeStalkerSeriesHomePreview("provider-A", Array.from({ length: 10 }, (_, index) => ({
      id: `s${index}`, title: `Series ${index}`, posterUrl: `https://images.example/s${index}.jpg`,
    })), storage as any);
    assert.equal(written.movies[0]?.id, "m1");
    assert.equal(written.series.length, STALKER_HOME_PREVIEW_LIMIT);
  });

  await scenario("Home preview payload excludes runtime cmd transport and credentials", async () => {
    const storage = new MemoryStorage();
    await writeStalkerMovieHomePreview("provider-A", [{
      portalId: "m1", title: "Movie", cmd: "ffmpeg http://secret/movie.m3u8",
      description: "token=secret password=secret", posterUrl: "https://images.example/m1.jpg",
    }], storage as any);
    const raw = [...storage.values.values()][0]!;
    assert.doesNotMatch(raw, /cmd|movie\.m3u8|token|password|session|cookie|mac/i);
    assert.match(raw, /images\.example/);
  });

  await scenario("summary parser rejects cross-provider and unknown transport fields", () => {
    const validShape = { schemaVersion: 1, providerId: "provider-A", movies: [], series: [] };
    assert.deepEqual(parseStalkerHomeSummary(JSON.stringify(validShape), "provider-B").movies, []);
    const unsafe = { ...validShape, movies: [{ id: "1", title: "Movie", cmd: "secret" }] };
    assert.deepEqual(parseStalkerHomeSummary(JSON.stringify(unsafe), "provider-A").movies, []);
  });

  await scenario("summary read performs one provider-scoped persisted read", async () => {
    const storage = new MemoryStorage();
    await readStalkerHomeSummary("provider-A", storage as any);
    assert.equal(storage.getCalls, 1);
    assert.equal(storage.setCalls, 0);
  });

  await scenario("successful canonical page results feed the Stalker Home preview cache", () => {
    assert.match(movieController, /writeStalkerMovieHomePreview\(provider\.id, result\.items\)/);
    assert.match(seriesSurface, /writeStalkerSeriesHomePreview\(provider\.id, result\.items\)/);
    assert.match(movieController, /page === 1 && \(isStalkerVodGlobalCategory\(category\) \|\| previewCategory\.id === category\.id\)/);
    assert.match(seriesSurface, /page === 1 && \(globalCategory\?\.id === category\.id \|\| previewCategory\?\.id === category\.id\)/);
  });

  await scenario("Stalker Home consumes persisted movie and series previews", () => {
    assert.match(main, /useStalkerHomeSummary\(provider\?\.type === "stalker" \? provider\.id : undefined\)/);
    assert.match(main, /movies=\{homeSummary\.movies\}/);
    assert.match(main, /seriesItems=\{homeSummary\.series\}/);
  });

  await scenario("Stalker Home Live preview uses the bounded persisted catalog snapshot", () => {
    assert.match(liveSummaryHook, /channels: matches \? snapshot\.live\.slice\(0, 8\) : \[\]/);
    assert.match(main, /channels=\{liveCatalog\.channels\}/);
  });

  await scenario("provider switch clears stale summary before the new provider read resolves", () => {
    assert.match(summaryHook, /setSummary\(emptyStalkerHomeSummary\(providerId \?\? ""\)\)/);
    assert.match(summaryHook, /summary\.providerId === \(providerId \?\? ""\)/);
    assert.match(summaryHook, /\}, \[providerId\]\)/);
  });

  await scenario("Home global counts remain independent of catalog category selections", () => {
    assert.match(main, /live=\{liveCatalog\.countKnown \? liveCatalog\.totalCount : null\}/);
    assert.match(main, /vod=\{productCounts\.vod\}/);
    assert.match(main, /series=\{productCounts\.series\}/);
    assert.doesNotMatch(main, /vod=\{[^}]*selectedCategory/);
  });

  await scenario("unknown counts render loading skeletons instead of zero or dash", () => {
    assert.match(home, /const liveValue = live === null \? null : live\.toLocaleString\(\)/);
    assert.match(home, /value === null[\s\S]*homeSkeletonLine/);
    assert.doesNotMatch(home, /live === null \? "0"/);
  });

  await scenario("verified empty kinds render localized deliberate empty states", () => {
    assert.match(home, /live === 0 \? copy\.noLive/);
    assert.match(home, /vod === 0 \? copy\.noMovies/);
    assert.match(home, /series === 0 \? copy\.noSeries/);
    assert.match(home, /Canlı yayın bulunamadı/);
  });

  await scenario("Live Movies and Series summary previews are bounded to six cards", () => {
    assert.match(home, /homeChannels\.slice\(0, 6\)/);
    assert.match(home, /homeMovies\.slice\(0, 6\)/);
    assert.match(home, /homeSeries\.slice\(0, 6\)/);
  });

  await scenario("missing artwork keeps resilient card layout with a safe fallback", () => {
    assert.match(home, /if \(!normalized \|\| failed\)/);
    assert.match(home, /fallbackIcon/);
  });

  await scenario("summary sections retain existing top-level navigation actions", () => {
    assert.match(home, /onSeeAll=\{\(\) => onNavigate\("live"\)\}/);
    assert.match(home, /onSeeAll=\{\(\) => onNavigate\("movies"\)\}/);
    assert.match(home, /onSeeAll=\{\(\) => onNavigate\("series"\)\}/);
  });

  await scenario("Home summary persistence has no resolver network or create_link path", () => {
    assert.doesNotMatch(summaryHelper, /create_link|handshake|get_ordered_list|fetch\(|session\.request/);
    assert.doesNotMatch(summaryHook, /create_link|handshake|get_ordered_list|fetch\(|session\.request/);
  });

  await scenario("Home preview reads are bounded and avoid per-card persisted queries", () => {
    assert.match(summaryHelper, /STALKER_HOME_PREVIEW_LIMIT = 8/);
    assert.match(summaryHelper, /storage\.getItem\(`/);
    assert.doesNotMatch(summaryHelper, /for \([^)]*\)[\s\S]{0,160}storage\.getItem/);
  });

  assert.equal(passed, 29);
  console.log(`Stalker R17-H2 Live History and Home summary scenarios: ${passed}/29 passed`);
}

void mainTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
