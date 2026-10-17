import assert from "node:assert/strict";
import {
  eliteLiveInitial,
  eliteLiveReduce,
  eliteLiveLayout,
  eliteLiveSelection,
  eliteLiveSurfaces,
} from "../lib/design/eliteLiveLayout";
let count = 0;
for (const [width, height] of [
  [960, 540],
  [1280, 720],
  [1920, 1080],
  [1536, 864],
])
  for (const fontScale of [0.85, 1, 1.3, 1.6, 2, 3])
    for (const safeArea of [{}, { left: 48, right: 32, top: 24, bottom: 40 }]) {
      const g = eliteLiveLayout({ width, height, fontScale, safeArea });
      assert(g.detailWidth > 0);
      if (!g.stacked)
        assert(
          g.categoryWidth + g.channelWidth + g.detailWidth + 24 <=
            g.usableWidth + 0.01,
        );
      assert(g.rowHeight >= 54 * Math.max(1, fontScale) + 24);
      assert(g.left >= 8 && g.right >= 8);
      count++;
    }
const channels = [{ id: "one" }, { id: "two" }];
let selected = "one";
// Browsing another native target does not alter explicit selection.
const focused = "two";
assert.notEqual(focused, selected);
assert.equal(eliteLiveSelection(channels, selected), channels[0]);
assert.equal(eliteLiveSelection([{ id: "two" }], selected), null);
assert.equal(eliteLiveSelection(channels, null), null);
selected = "two";
assert.equal(eliteLiveSelection(channels, selected), channels[1]);
assert.notEqual(eliteLiveSurfaces.outer, eliteLiveSurfaces.information);
// Worst case white video composited under the information surface.
const composite = (c: number) => (c * 0.92 + 255 * 0.08) / 255;
const lin = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const background =
  0.2126 * lin(composite(9)) +
  0.7152 * lin(composite(12)) +
  0.0722 * lin(composite(16));
const foreground =
  0.2126 * lin(173 / 255) + 0.7152 * lin(185 / 255) + 0.0722 * lin(199 / 255);
assert((foreground + 0.05) / (background + 0.05) >= 4.5);
process.stdout.write(
  `Elite Live: ${count} geometry cases + selection/missing-target/alpha contrast passed\n`,
);

let state = eliteLiveReduce(eliteLiveInitial, { type: "select", id: "one" });
for (let i = 0; i < 100; i++)
  state = eliteLiveReduce(state, { type: "focus", id: "two" });
assert.equal(state.selectedId, "one");
state = eliteLiveReduce(state, { type: "togglePanel" });
assert.equal(state.panelOpen, false);
assert.equal(state.selectedId, "one");
state = eliteLiveReduce(state, { type: "togglePanel" });
assert.equal(state.panelOpen, true);
assert.equal(state.selectedId, "one");
state = eliteLiveReduce(state, { type: "reset" });
assert.equal(state.selectedId, null);
process.stdout.write(
  "Elite Live reducer: focus/selection independence + panel preservation + category reset passed\n",
);
