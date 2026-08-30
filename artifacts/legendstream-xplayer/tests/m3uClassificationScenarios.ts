import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyM3UContentTypeWithSource } from "../lib/m3uShapeDiagnostics";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iptvSource = readFileSync(resolve(ROOT, "lib/iptv.ts"), "utf8");

let passed = 0;
const scenario = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
};

function main() {
  scenario("three segments without kind or extension classify as live", () => {
    assert.deepEqual(
      classifyM3UContentTypeWithSource("https://panel.example/alice/secret/1001", "General"),
      { contentType: "live", source: "structural-live" },
    );
  });

  scenario("structural live beats SINEMA group heuristic", () => {
    assert.deepEqual(
      classifyM3UContentTypeWithSource("https://panel.example/alice/secret/1001", "TR: SINEMA"),
      { contentType: "live", source: "structural-live" },
    );
  });

  scenario("movie path beats CINEMA group heuristic", () => {
    assert.deepEqual(
      classifyM3UContentTypeWithSource("https://panel.example/movie/alice/secret/2001", "TR: CINEMA"),
      { contentType: "movie", source: "path-movie" },
    );
  });

  scenario("movie path keeps priority for four-segment mkv URLs", () => {
    assert.deepEqual(
      classifyM3UContentTypeWithSource("https://panel.example/movie/alice/secret/2002.mkv", "Live"),
      { contentType: "movie", source: "path-movie" },
    );
  });

  scenario("series path keeps priority over mp4 extension", () => {
    assert.deepEqual(
      classifyM3UContentTypeWithSource("https://panel.example/series/alice/secret/3001.mp4", "Movies"),
      { contentType: "series", source: "path-series" },
    );
  });

  scenario("Xtream routing remains outside M3U classification", () => {
    assert.match(iptvSource, /if \(provider\.type === "xtream"\) return loadXtream\(provider\);/);
    assert.match(iptvSource, /action", "get_live_streams"/);
    assert.doesNotMatch(iptvSource, /m3uStructuralClassification/);
  });

  assert.equal(passed, 6);
  console.log("m3u classification scenarios: 6/6 passed");
}

main();
