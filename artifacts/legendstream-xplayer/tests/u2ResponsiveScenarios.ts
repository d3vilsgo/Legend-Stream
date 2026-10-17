import assert from "node:assert/strict";
import {
  computePosterGridLayout,
  catalogAnchorRow,
} from "../lib/catalogGridLayout";
import { responsiveHomeHeroLayout } from "../lib/homeHeroLayout";
import {
  createTVPreviewFocusController,
  type TVPreviewFocusEntry,
} from "../lib/tvPreviewFocus";

async function main() {
  let count = 0;
  for (const [width, height] of [
    [320, 568],
    [393, 873],
    [873, 393],
    [600, 960],
    [800, 1280],
    [1280, 800],
    [1920, 1080],
  ]) {
    for (const tvPreview of [false, true])
      for (const fontScale of [1, 1.3, 2])
        for (const fraction of [1, 0.55]) {
          const containerWidth = width * fraction;
          const grid = computePosterGridLayout(width, height, false, {
            tvPreview,
            fontScale,
            containerWidth,
            safeArea: { left: 24, right: 12, bottom: 20 },
          });
          assert(grid.columns >= 1 && Number.isInteger(grid.columns));
          assert(grid.contentWidth > 0 && grid.columnWidth > 0);
          assert(
            grid.contentWidth + grid.paddingLeft + grid.paddingRight <=
              Math.min(1500, containerWidth) + 0.001,
          );
          assert(
            Math.abs(grid.cellWidth * grid.columns - grid.contentWidth) < 0.001,
          );
          const largeText = computePosterGridLayout(width, height, false, {
            tvPreview,
            fontScale: 2,
            containerWidth,
          });
          const normal = computePosterGridLayout(width, height, false, {
            tvPreview,
            fontScale: 1,
            containerWidth,
          });
          assert(largeText.columns <= normal.columns);
          const hero = responsiveHomeHeroLayout({
            width,
            height,
            fontScale,
            tvPreview,
            containerWidth,
            viewportHeight: height - 140,
          });
          assert(hero.height > 0 && hero.height <= (hero.compact ? 190 : 360));
          assert(hero.width <= containerWidth);
          assert(hero.height + 56 * fontScale + 80 + 24 <= height - 140 + 1);
          count++;
        }
  }
  const ids = Array.from({ length: 40 }, (_, i) => `provider:movie:${i}`);
  assert.equal(catalogAnchorRow(ids[19], ids, 3), 6);
  assert.equal(catalogAnchorRow(ids[19], ids, 6), 3);
  assert.equal(catalogAnchorRow(ids[19], [...ids].reverse(), 4), 5);
  assert.equal(catalogAnchorRow("other-provider:movie:19", ids, 4), null);
  assert.equal(catalogAnchorRow(null, ids, 4), null);
  assert.equal(catalogAnchorRow(ids[0], ids, 0), null);
  count += 6;
  const controller = createTVPreviewFocusController();
  const entry = (
    id: string,
    x: number,
    scope = "content",
  ): TVPreviewFocusEntry => ({
    id,
    scope,
    bounds: { x, y: 20, width: 50, height: 50 },
    press() {},
    setFocused() {},
  });
  const viewport = { x: 0, y: 0, width: 300, height: 200 };
  const unregister = controller.register(entry(ids[19], 20));
  controller.register(entry(ids[20], 90));
  unregister(); // FlatList remount temporarily changes the controller's current entry.
  controller.register(entry(ids[19], 140));
  assert(await controller.restoreFocus(ids[19], viewport));
  assert.equal(controller.getFocusedId(), ids[19]);
  controller.register(entry("hidden", 500));
  assert.equal(await controller.restoreFocus("hidden", viewport), false);
  const closeModal = controller.pushFocusScope("movie-info");
  controller.register(entry("modal", 10, "movie-info"));
  assert.equal(await controller.restoreFocus(ids[19], viewport), false);
  assert.equal(controller.getFocusedId(), "modal");
  closeModal();
  let release!: (bounds: null) => void;
  controller.register({
    ...entry("recycled", 10),
    measure: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const stale = controller.restoreFocus("recycled", viewport);
  controller.clear();
  release(null);
  assert.equal(await stale, false);
  assert.equal(controller.getFocusedId(), null);
  count += 4;
  console.log(
    `U2 responsive geometry and Preview restore: ${count}/${count} passed; MODEL_NOT_PHYSICAL`,
  );
}
void main();
