import assert from "node:assert/strict";
import { nativeTvHomeLayout } from "../lib/design/nativeTvHomeLayout";
import { nativeTvLayout } from "../lib/nativeTvResponsive";
let passed = 0;
const measurements: unknown[] = [];
for (const [width, height] of [
  [960, 540],
  [1280, 720],
  [1920, 1080],
  [1536, 864],
]) {
  for (const fontScale of [1, 1.3, 1.6, 2])
    for (const safeArea of [
      { top: 0, right: 0, bottom: 0, left: 0 },
      { top: 24, right: 32, bottom: 32, left: 48 },
    ])
      for (const overscan of [
        undefined,
        { top: 28, bottom: 32, left: 40, right: 40 },
      ]) {
        const tv = nativeTvLayout({
          width,
          height,
          fontScale,
          safeArea,
          overscan,
        });
        const measuredViewport =
          height -
          (48 + tv.target + tv.top + tv.gutter + 16) -
          safeArea.top -
          Math.max(safeArea.bottom, 10);
        const input = {
          width,
          height,
          fontScale,
          safeArea,
          overscan,
          viewportHeight: measuredViewport,
        };
        const l = nativeTvHomeLayout(input);
        assert(l.heroHeight > 0 && l.heroHeight <= 320);
        assert(l.shelfBudgetMet, JSON.stringify({ input, l }));
        assert(l.visibleCardHeight >= 72);
        const caption =
          l.padding * 2 +
          l.borderSpace +
          l.titleLineHeight * fontScale * l.titleLines +
          (l.showMeta ? l.metaLineHeight * fontScale + 6 : 0);
        assert(caption <= l.heroHeight);
        assert([1, 2].includes(l.titleLines));
        passed++;
        if (fontScale === 1 && safeArea.top === 0 && !overscan) {
          const oldHero = Math.max(
            190,
            Math.min(520, Math.min(1500, width - tv.left - tv.right) / 2.25),
          );
          measurements.push({
            window: `${width}×${height}`,
            viewport: Math.round(measuredViewport),
            oldHero: Math.round(oldHero),
            hero: l.heroHeight,
            oldVisible: Math.max(
              0,
              Math.round(l.availableHeight - oldHero - 176),
            ),
            firstCardTop: Math.round(l.firstCardTop),
            visible: Math.round(l.visibleCardHeight),
            available: Math.round(l.availableHeight),
          });
        }
      }
}
for (const bad of [NaN, 0, -10]) {
  const l = nativeTvHomeLayout({
    width: 960,
    height: 540,
    fontScale: 1,
    viewportHeight: bad,
  });
  assert(Number.isFinite(l.heroHeight));
  passed++;
}
const short = nativeTvHomeLayout({
  width: 960,
  height: 540,
  fontScale: 1,
  viewportHeight: 300,
});
const tall = nativeTvHomeLayout({
  width: 960,
  height: 540,
  fontScale: 1,
  viewportHeight: 420,
});
assert(short.heroHeight < tall.heroHeight);
passed++;
console.log(JSON.stringify(measurements));
console.log(
  `Native TV Home geometry: ${passed}/${passed} passed; ANDROID_RENDERER_NOT_TESTED`,
);

