import assert from "node:assert/strict";
import { computePosterGridLayout } from "../lib/catalogGridLayout";

const portrait = computePosterGridLayout(393, 873);
const landscape = computePosterGridLayout(873, 393);
assert.ok(portrait.columns >= 2 && portrait.columns <= 4);
assert.ok(landscape.columns > portrait.columns, "landscape must expose more columns than portrait");
assert.ok(landscape.columnWidth <= 162, "landscape poster max width must remain bounded");
for (const [width, height, isTV] of [[360,780,false],[780,360,false],[844,390,false],[1920,1080,true]] as const) {
  const g=computePosterGridLayout(width,height,isTV);
  assert.ok(g.columns >= 2 && g.columns <= 9);
  assert.ok(Number.isFinite(g.columnWidth) && g.columnWidth > 0);
}
console.log("R18 premium catalog grid layout scenarios passed.");
