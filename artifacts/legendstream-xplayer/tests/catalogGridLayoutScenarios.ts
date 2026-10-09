import assert from "node:assert/strict";
import { computePosterGridLayout } from "../lib/catalogGridLayout";

const expected = new Map<number, number>([
  [360, 2],
  [390, 2],
  [420, 2],
  [430, 2],
  [700, 4],
  [800, 4],
  [900, 5],
  [1024, 5],
  [1200, 6],
  [1500, 7],
]);

for (const [width, columns] of expected) {
  const layout = computePosterGridLayout(width);
  assert.equal(layout.columns, columns, `unexpected columns at ${width}`);
  assert.ok(layout.columnWidth > 0, `column width must stay positive at ${width}`);
  assert.ok(layout.columnWidth <= 210, `column width must stay bounded at ${width}`);
  assert.ok(layout.columns >= 2 && layout.columns <= 7, `column count must stay bounded at ${width}`);
  const usable = layout.contentWidth - layout.outerPadding * 2;
  assert.ok(Math.abs(layout.columnWidth * layout.columns - usable) < 0.001, `layout must remain symmetric at ${width}`);
}

for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  const layout = computePosterGridLayout(width);
  assert.equal(layout.columns, 2);
  assert.ok(Number.isFinite(layout.columnWidth));
}

const capped = computePosterGridLayout(2400);
assert.equal(capped.contentWidth, 1500);
assert.equal(capped.columns, 7);
assert.ok(capped.columnWidth <= 210);

console.log("R18-F1 catalog grid layout scenarios passed.");
