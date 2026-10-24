import assert from "node:assert/strict";
import {
  createEliteHomeItems,
  createEliteHomeSections,
} from "../lib/eliteV4HomeModel";
import {
  isEliteV4FocusNodeVisible,
  resolveEliteV4Target,
  type EliteV4FocusNode,
} from "../lib/eliteV4Focus";
import type { Channel } from "../lib/iptv";
import type { XtreamSeriesItem, XtreamVodItem } from "../lib/xtreamCatalog";
import {
  mediaProgressForProvider,
  type MediaProgressV2,
} from "../lib/mediaProgress";

let checks = 0;
function check(name: string, run: () => void) {
  run();
  checks += 1;
  console.log(`PASS ${name}`);
}

const movieA: XtreamVodItem = {
  stream_id: 501,
  name: "Örnek Film",
  stream_icon: "https://img.example/poster.jpg",
  genre: "Dram",
  releaseDate: "2025",
};
const movieB: XtreamVodItem = {
  stream_id: 502,
  name: "İkinci Film",
  stream_icon: "https://img.example/second.jpg",
};
const live: Channel = {
  id: "live-1",
  providerId: "provider-1",
  name: "TRT Haber",
  streamUrl: "https://stream.example/live.m3u8",
  category: "Haber",
};
const series: XtreamSeriesItem = {
  series_id: "series-22",
  name: "Dizi",
  cover: "https://img.example/series.jpg",
  genre: "Drama",
  releaseDate: "2024",
};
const movieProgress: MediaProgressV2 = {
  schemaVersion: 2,
  id: "progress-501",
  providerId: "provider-1",
  kind: "movie",
  title: movieA.name,
  playbackRef: {
    type: "xtream-vod",
    streamId: "501",
    containerExtension: "mp4",
    sourceMode: "canonical",
  },
  position: 300,
  duration: 1000,
  updatedAt: 20,
};
const nodes: Record<string, EliteV4FocusNode> = {
  sidebar: {
    id: "sidebar-home",
    region: "sidebar",
    neighbors: { right: "hero" },
  },
  hero: {
    id: "hero",
    region: "content",
    neighbors: { left: "sidebar-home", down: "rail-0" },
  },
  rail: {
    id: "rail-0",
    region: "content",
    neighbors: { left: "sidebar-home", up: "hero", right: "rail-1" },
  },
  rail2: {
    id: "rail-1",
    region: "content",
    neighbors: { left: "rail-0", up: "hero" },
  },
};

check(
  "Home model binds real provider movie DTOs and preserves playable identity",
  () => {
    const items = createEliteHomeItems([movieA, movieB], [live]);
    assert.equal(items.length, 2);
    assert.equal(items[0]?.id, "movie-501");
    assert.equal(items[0]?.title, movieA.name);
    assert.equal(items[0]?.image, movieA.stream_icon);
    assert.equal(items[0]?.movie, movieA);
    assert.equal(items[0]?.kind, "movie");
  },
);
check("Home model uses provider live items when movie catalog is empty", () => {
  const items = createEliteHomeItems([], [live]);
  assert.equal(items[0]?.id, "live-live-1");
  assert.equal(items[0]?.channel, live);
  assert.equal(items[0]?.kind, "live");
});
check(
  "Home model returns an empty state without inventing fixture content",
  () => {
    assert.deepEqual(createEliteHomeItems([], []), []);
  },
);
check("Sidebar RIGHT enters the explicit Home hero target", () => {
  assert.equal(resolveEliteV4Target(nodes.sidebar, "right"), "hero");
});
check("Home content LEFT returns to the explicit sidebar target", () => {
  assert.equal(resolveEliteV4Target(nodes.hero, "left"), "sidebar-home");
  assert.equal(resolveEliteV4Target(nodes.rail, "left"), "sidebar-home");
});
check("Hero DOWN opens the first content rail target", () => {
  assert.equal(resolveEliteV4Target(nodes.hero, "down"), "rail-0");
});
check("Rail navigation has bounded left/right neighbors", () => {
  assert.equal(resolveEliteV4Target(nodes.rail, "right"), "rail-1");
  assert.equal(resolveEliteV4Target(nodes.rail2, "right"), null);
  assert.equal(resolveEliteV4Target(nodes.rail2, "left"), "rail-0");
});
check("Rail UP returns to Hero", () => {
  assert.equal(resolveEliteV4Target(nodes.rail, "up"), "hero");
});
check(
  "Focus registry rejects missing targets instead of trapping navigation",
  () => {
    assert.equal(
      isEliteV4FocusNodeVisible("hero", new Set(["hero", "rail-0"])),
      true,
    );
    assert.equal(
      isEliteV4FocusNodeVisible("sidebar-home", new Set(["hero", "rail-0"])),
      false,
    );
  },
);
check("Unknown or directionless transitions resolve safely", () => {
  assert.equal(resolveEliteV4Target(undefined, "left"), null);
  assert.equal(resolveEliteV4Target(nodes.hero, "up"), null);
});

check(
  "Home sections retain real movie, series, live identities and separate categories",
  () => {
    const sections = createEliteHomeSections(
      [movieA, movieB],
      [live],
      [series],
      [movieB],
      [movieProgress],
    );
    assert.deepEqual(
      sections.featured.map((item) => item.id),
      ["movie-502"],
    );
    assert.equal(sections.movies[0]?.movie, movieA);
    assert.equal(sections.live[0]?.channel, live);
    assert.equal(sections.series[0]?.series, series);
    assert.equal(sections.continueWatching[0]?.movie, movieA);
    assert.equal(sections.continueWatching[0]?.progressFraction, 0.3);
  },
);
check(
  "Home hides stale and near-complete progress instead of inventing matches",
  () => {
    const stale = {
      ...movieProgress,
      playbackRef: { ...movieProgress.playbackRef, streamId: "999" },
    };
    const foreign = { ...movieProgress, providerId: "other-provider" };
    const done = { ...movieProgress, position: 990 };
    const scoped = mediaProgressForProvider(
      [stale, foreign, done],
      "provider-1",
    );
    const sections = createEliteHomeSections([movieA], [live], [], [], scoped);
    assert.deepEqual(sections.continueWatching, []);
    assert.deepEqual(sections.featured, []);
  },
);
check("Home hides empty shelves when provider categories have no items", () => {
  const sections = createEliteHomeSections([], [], [], [], []);
  assert.deepEqual(Object.values(sections), [[], [], [], [], []]);
});
assert.equal(checks, 13);
console.log(`Elite V4 Home/Focus production scenarios: ${checks}/13 passed`);
