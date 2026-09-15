import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testsDir, "..");
const source = (path: string) => readFileSync(resolve(packageRoot, path), "utf8");
const routeSource = source("app/(tabs)/index.tsx");
const stalkerMainSource = source("components/StalkerMainPage.tsx");
const goldenSource = source("components/OptimizedHomeScreenPaged.tsx");

function gitBlobSha(text: string) {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  process.stdout.write(`PASS ${name}\n`);
}

await scenario("application routing selects the dedicated Stalker page before main-page runtime", () => {
  assert.match(routeSource, /import StalkerMainPage from "@\/components\/StalkerMainPage"/);
  assert.match(routeSource, /provider\?\.type === "stalker" \? <StalkerMainPage \/> : <OptimizedHomeScreenV6 \/>/);
});

await scenario("Xtream M3U and no-provider routing keep the existing golden page path", () => {
  assert.match(routeSource, /import OptimizedHomeScreenV6 from "@\/components\/OptimizedHomeScreenV6"/);
  assert.match(routeSource, /: <OptimizedHomeScreenV6 \/>/);
  assert.doesNotMatch(routeSource, /OptimizedHomeScreenPaged[^\n]*provider/);
});

await scenario("dedicated Stalker page does not own legacy Stalker presentation surfaces", () => {
  assert.doesNotMatch(stalkerMainSource, /StalkerCategoryPager/);
  assert.doesNotMatch(stalkerMainSource, /StalkerLiveCatalog/);
  assert.doesNotMatch(stalkerMainSource, /StalkerVodSurface/);
  assert.doesNotMatch(stalkerMainSource, /StalkerSeriesProductSurface/);
  assert.match(stalkerMainSource, /PagedLiveCatalog/);
});

await scenario("dedicated Stalker page owns normalized top-level player handoff", () => {
  assert.match(stalkerMainSource, /type Playable =/);
  assert.match(stalkerMainSource, /useState<Playable \| null>/);
  assert.match(stalkerMainSource, /if \(view === "player"\)/);
  assert.match(stalkerMainSource, /<NativeVideoPlayer/);
  assert.match(stalkerMainSource, /onFullscreenExit=\{\(\) => setView\(playable\.returnTo\)\}/);
});

await scenario("golden Xtream M3U main-page source remains byte-for-byte frozen", () => {
  assert.equal(gitBlobSha(goldenSource), "b51c5a09d203e02baa0e716c60749e419679fd1c");
});

await scenario("clone freezes golden navigation order and category identity seam", () => {
  const keys = ["home", "live", "movies", "series", "history", "downloads", "settings"];
  let cursor = -1;
  for (const key of keys) {
    const next = stalkerMainSource.indexOf(`key: "${key}" as const`, cursor + 1);
    assert.ok(next > cursor, `missing or out-of-order navigation key: ${key}`);
    cursor = next;
  }
  assert.match(stalkerMainSource, /type StalkerCategoryPresentation = \{[\s\S]*id: string;[\s\S]*name: string;[\s\S]*order: number;/);
});

assert.equal(passed, 6);
process.stdout.write(`stalker R17-A main boundary scenarios: ${passed}/6 passed\n`);
