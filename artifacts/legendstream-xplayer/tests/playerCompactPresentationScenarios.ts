import assert from "node:assert/strict";
import {
  compactInfoHeight,
  liveDrawerWidth,
  realEpgProgress,
  liveDrawerCategories,
  categoryForRow,
} from "../lib/playerCompactPresentation";

let checks = 0;
for (const height of [360, 720, 1080, 1440, 2400]) {
  const size = compactInfoHeight(height);
  assert.equal(size, Math.floor(height / 12));
  assert.ok(size <= height / 10);
  checks++;
}
assert.equal(compactInfoHeight(720, 24, 16), Math.floor(680 / 12));
checks++;
for (const width of [1280, 1920, 2560]) {
  const drawer = liveDrawerWidth(width, 0, 0, true);
  assert.ok(drawer / width >= 0.38 && drawer / width <= 0.42);
  checks++;
}
assert.equal(liveDrawerWidth(390, 0, 0, false, true), Math.floor(390 * 0.86));
checks++;
assert.equal(realEpgProgress(1000, 2000, 1500), 0.5);
checks++;
assert.equal(realEpgProgress(1000, 2000, 3000), 1);
checks++;
assert.equal(realEpgProgress(1000, 1000, 1000), null);
checks++;
assert.equal(realEpgProgress(0, 2000, 1000), null);
checks++;
assert.deepEqual(
  liveDrawerCategories([
    { subtitle: " Haber " },
    { subtitle: "Spor" },
    { subtitle: "Haber" },
    {},
  ]),
  ["Haber", "Spor", "Diğer"],
);
checks++;
assert.equal(categoryForRow({}), "Diğer");
checks++;
console.log(`PASS player compact presentation ${checks}/${checks}`);
