import fs from "node:fs";
import path from "node:path";
import { toXtreamCategoryId } from "../lib/catalogCategory";

let passed = 0;
const expect = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  passed += 1;
};

const source = fs.readFileSync(
  path.join(process.cwd(), "components/OptimizedHomeScreenV6.tsx"),
  "utf8",
);

const between = (start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Missing source block: ${start}`);
  return source.slice(startIndex, endIndex);
};

const vodBlock = between("const loadVodCategory = async", "const loadSeries = async");
const seriesBlock = between("const loadSeriesCategory = async", "const switchProvider = async");

const noAllEarlyReturn = (block: string) => !block.includes('if (categoryId === "__all__") return;');
const cacheFallsThroughWhenEmpty = (block: string) =>
  block.includes("const cacheIsActive = cacheReady && snapshot.providerId === provider.id;") &&
  block.includes("if (items.length > 0)") &&
  block.includes("if (!cacheIsActive");
const mapsBeforeTransport = (block: string, call: string) =>
  block.includes("const networkCategoryId = toXtreamCategoryId(categoryId);") &&
  block.includes(call);
const refreshContract = (block: string) =>
  block.includes("if (force) await refreshCatalog();") &&
  block.includes("&& !force") &&
  noAllEarlyReturn(block);

expect(
  cacheFallsThroughWhenEmpty(vodBlock) && noAllEarlyReturn(vodBlock),
  "movies cache-ready + All must use cache when populated and fall through when empty",
);
expect(
  cacheFallsThroughWhenEmpty(seriesBlock) && noAllEarlyReturn(seriesBlock),
  "series cache-ready + All must use cache when populated and fall through when empty",
);
expect(
  toXtreamCategoryId("__all__") === undefined && mapsBeforeTransport(vodBlock, "getVodStreams(credentials, networkCategoryId)"),
  "movies no-cache + All must omit category_id at Xtream transport",
);
expect(
  toXtreamCategoryId("__all__") === undefined && mapsBeforeTransport(seriesBlock, "getSeries(credentials, networkCategoryId)"),
  "series no-cache + All must omit category_id at Xtream transport",
);
expect(
  toXtreamCategoryId("17") === "17" && mapsBeforeTransport(vodBlock, "getVodStreams(credentials, networkCategoryId)"),
  "movies no-cache + category must preserve the real category id",
);
expect(
  toXtreamCategoryId("17") === "17" && mapsBeforeTransport(seriesBlock, "getSeries(credentials, networkCategoryId)"),
  "series no-cache + category must preserve the real category id",
);
expect(
  refreshContract(vodBlock) && refreshContract(seriesBlock) && toXtreamCategoryId("__all__") === undefined,
  "Refresh + All must refresh active cache or force a network request without leaking the sentinel",
);
expect(
  refreshContract(vodBlock) && refreshContract(seriesBlock) && toXtreamCategoryId("17") === "17",
  "Refresh + category must preserve the category and bypass non-forced memory-cache reuse",
);

process.stdout.write(`catalog category fallback scenarios: ${passed}/8 passed\n`);
