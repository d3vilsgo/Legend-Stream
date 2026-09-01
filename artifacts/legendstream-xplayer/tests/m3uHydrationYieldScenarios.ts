import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenSource = readFileSync(resolve(ROOT, "components/OptimizedHomeScreenV6.tsx"), "utf8");
const iptvSource = readFileSync(resolve(ROOT, "lib/iptv.ts"), "utf8");
const m3uCacheSource = readFileSync(resolve(ROOT, "lib/m3uCatalogCache.ts"), "utf8");
const projectionSource = readFileSync(resolve(ROOT, "lib/m3uCacheWriteProjection.ts"), "utf8");

let passed = 0;
let failed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    passed += 1;
    console.log(`ok ${passed + failed} - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok ${passed + failed} - ${name}`);
    console.error(error);
  }
}

function extractUseEffectBodyContaining(source: string, marker: string) {
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, `provider preparation marker not found: ${marker}`);
  const effectStart = source.lastIndexOf("useEffect(() => {", markerIndex);
  assert.ok(effectStart >= 0, "provider preparation useEffect start must exist");
  const openBrace = source.indexOf("{", effectStart);
  assert.ok(openBrace >= 0 && openBrace < markerIndex, "provider preparation useEffect body must open before marker");

  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace + 1, index);
    }
  }

  throw new Error("provider preparation useEffect body is not balanced");
}

function topLevelStatements(body: string) {
  const statements: string[] = [];
  let start = 0;
  let curlyDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") curlyDepth += 1;
    else if (char === "}") curlyDepth -= 1;
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth -= 1;
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth -= 1;
    else if (char === ";" && curlyDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      statements.push(body.slice(start, index + 1));
      start = index + 1;
    }
  }

  return statements.map((statement) => statement.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function assertSingleUnconditionalStatement(effectBody: string, statements: string[], setter: string, expected: string) {
  const calls = effectBody.match(new RegExp(`\\b${setter}\\s*\\(`, "g")) ?? [];
  assert.equal(calls.length, 1, `${setter} must occur exactly once in the provider preparation effect`);
  const normalizedExpected = expected.replace(/\s+/g, " ").trim();
  assert.ok(
    statements.includes(normalizedExpected),
    `${setter} must be a top-level unconditional statement using the null-safe prepared snapshot`,
  );
}

async function main() {
  const hydration = await import("../lib/m3uCatalogHydration") as any;
  assert.equal(
    typeof hydration.buildM3UDirectHydrationCooperatively,
    "function",
    "runtime M3U hydration must expose a cooperative chunked implementation",
  );

  const provider = {
    id: "provider-large",
    url: "https://panel.example/get.php?username=alice&password=swordfish&type=m3u_plus&output=ts",
  };

  await scenario("8,001 live rows yield exactly between 200-row hydration batches", async () => {
    const liveRows = Array.from({ length: 8_001 }, (_, index) => ({
      schemaVersion: 1,
      catalogKind: "live",
      id: `live-${index}`,
      providerId: provider.id,
      name: `Live ${index}`,
      category: "Live",
      playbackRef: {
        type: "m3u-path",
        kind: "live",
        streamId: String(index + 1),
        containerExtension: "ts",
      },
    }));

    let yieldCount = 0;
    const result = await hydration.buildM3UDirectHydrationCooperatively(
      provider,
      liveRows,
      [],
      [],
      {
        batchSize: 200,
        yieldFn: async () => {
          yieldCount += 1;
        },
      },
    );

    assert.equal(result.counts.live, 8_001);
    assert.equal(result.counts.vod, 0);
    assert.equal(result.counts.series, 0);
    assert.equal(
      yieldCount,
      40,
      "8,001 rows at batchSize=200 must yield exactly between the 41 batches",
    );
  });

  await scenario("15,994 VOD rows complete every hydration batch before unconditional UI publication", async () => {
    const vodRows = Array.from({ length: 15_994 }, (_, index) => ({
      schemaVersion: 1,
      catalogKind: "vod",
      id: `vod-${index}`,
      providerId: provider.id,
      stream_id: String(index + 1),
      name: `Movie ${index}`,
      stream_icon: undefined,
      category_id: "Movies",
      container_extension: "mp4",
      playbackRef: {
        type: "m3u-path",
        kind: "movie",
        streamId: String(index + 1),
        containerExtension: "mp4",
      },
    }));

    let yieldCount = 0;
    const result = await hydration.buildM3UDirectHydrationCooperatively(
      provider,
      [],
      vodRows,
      [],
      {
        batchSize: 200,
        yieldFn: async () => {
          yieldCount += 1;
        },
      },
    );

    assert.equal(result.counts.vod, 15_994);
    assert.equal(result.movies.length, 15_994);
    assert.equal(
      yieldCount,
      158,
      "15,994 VOD rows are traversed in two 80-batch cooperative passes and must yield 79 times per pass",
    );

    const preparationEffect = extractUseEffectBodyContaining(
      screenSource,
      "const prepared = provider && preparedSwitchRef.current?.snapshot.providerId === provider.id",
    );
    const preparationStatements = topLevelStatements(preparationEffect);
    const preparedSnapshotDeclaration = "const preparedSnapshot = prepared?.snapshot ?? null;";
    assert.ok(
      preparationStatements.includes(preparedSnapshotDeclaration),
      "provider preparation effect must create its null-safe prepared snapshot at top level",
    );

    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setVod",
      "setVod(preparedSnapshot?.movies ?? []);",
    );
    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setVodCats",
      "setVodCats(prepared?.vodCategories ?? []);",
    );
    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setVodCache",
      "setVodCache(preparedSnapshot?.movies.length ? { __all__: preparedSnapshot.movies } : {});",
    );
    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setVodLoaded",
      "setVodLoaded(Boolean(preparedSnapshot && (preparedSnapshot.ready || preparedSnapshot.counts.vod > 0)));",
    );
    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setVodLoading",
      "setVodLoading(false);",
    );
    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setSeries",
      "setSeries(preparedSnapshot?.series ?? []);",
    );
    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setSeriesCats",
      "setSeriesCats(prepared?.seriesCategories ?? []);",
    );
    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setSeriesCache",
      "setSeriesCache(preparedSnapshot?.series.length ? { __all__: preparedSnapshot.series } : {});",
    );
    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setSeriesLoaded",
      "setSeriesLoaded(Boolean(preparedSnapshot && (preparedSnapshot.ready || preparedSnapshot.counts.series > 0)));",
    );
    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setSeriesLoading",
      "setSeriesLoading(false);",
    );
    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setHomeVodCount",
      "setHomeVodCount(preparedSnapshot?.counts.vod ?? null);",
    );
    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setHomeSeriesCount",
      "setHomeSeriesCount(preparedSnapshot?.counts.series ?? null);",
    );
    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setHomeCatalogProbeLoading",
      "setHomeCatalogProbeLoading(false);",
    );
    assertSingleUnconditionalStatement(
      preparationEffect,
      preparationStatements,
      "setCachedLive",
      "setCachedLive(prepared?.live ?? []);",
    );
  });

  await scenario("post-first-paint M3U background refresh keeps catalog build and cache projection cooperative", () => {
    assert.match(iptvSource, /async function buildM3UCatalogCooperatively\(/);
    assert.match(iptvSource, /await buildM3UCatalogCooperatively\(entries, providerId,[\s\S]*batchSize:\s*200[\s\S]*yieldFn:\s*yieldToUi/);
    assert.match(projectionSource, /export async function buildM3UCacheWriteProjectionCooperatively\(/);
    assert.match(m3uCacheSource, /await buildM3UCacheWriteProjectionCooperatively\(provider, loaded,[\s\S]*batchSize:\s*200[\s\S]*yieldFn:\s*yieldToUi/);
  });

  await scenario("full M3U Movies and Series tab materialization yields in 200-row batches", () => {
    const vodStart = screenSource.indexOf("const applyLocalVod = async () =>");
    const seriesStart = screenSource.indexOf("const applyLocalSeries = async () =>");
    assert.ok(vodStart >= 0 && seriesStart > vodStart, "async local M3U catalog materializers must exist");
    const vodBlock = screenSource.slice(vodStart, seriesStart);
    const seriesEnd = screenSource.indexOf("const tryCatalogFallbackToM3U", seriesStart);
    assert.ok(seriesEnd > seriesStart, "series materializer block must be captured");
    const seriesBlock = screenSource.slice(seriesStart, seriesEnd);
    assert.match(vodBlock, /await mapInBatches\([\s\S]*local\.movieItems[\s\S]*200/);
    assert.match(seriesBlock, /await mapInBatches\([\s\S]*local\.seriesGroups[\s\S]*200/);
  });

  if (failed > 0) {
    throw new Error(`m3u hydration yield scenarios: ${passed}/4 passed, ${failed} failed`);
  }
  assert.equal(passed, 4);
  console.log("m3u hydration yield scenarios: 4/4 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
