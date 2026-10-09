import assert from "node:assert/strict";
import { computeHomeHeroLayout } from "../lib/homeHeroLayout";

let passed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function main() {
  await scenario("portrait hero keeps the existing sizing contract", () => {
    const layout = computeHomeHeroLayout({ width: 390, height: 844 });
    assert.equal(layout.compactLandscape, false);
    assert.equal(layout.cardWidth, 354);
    assert.deepEqual(layout.frameStyle, {
      width: 354,
      aspectRatio: 2.25,
      minHeight: 190,
      maxHeight: 520,
    });
    assert.equal(layout.captionStyle.paddingHorizontal, 24);
    assert.equal(layout.captionStyle.paddingBottom, 24);
    assert.equal(layout.captionStyle.paddingTop, 70);
    assert.equal(layout.imageTitleStyle.fontSize, 30);
    assert.equal(layout.imageTitleStyle.lineHeight, 35);
  });

  await scenario("landscape phone hero is height-bound and compact", () => {
    const layout = computeHomeHeroLayout({ width: 926, height: 428 });
    assert.equal(layout.compactLandscape, true);
    assert.equal(layout.cardWidth, 890);
    assert.equal(layout.frameStyle.height, 146);
    assert.equal(layout.frameStyle.height! <= Math.round(428 * 0.35), true);
    assert.equal(layout.captionStyle.paddingHorizontal, 16);
    assert.equal(layout.captionStyle.paddingBottom, 14);
    assert.equal(layout.captionStyle.paddingTop, 34);
    assert.equal(layout.imageTitleStyle.fontSize, 22);
    assert.equal(layout.imageTitleStyle.lineHeight, 26);
  });

  await scenario("orientation changes recompute between portrait and compact landscape", () => {
    const portrait = computeHomeHeroLayout({ width: 430, height: 932 });
    const landscape = computeHomeHeroLayout({ width: 932, height: 430 });
    assert.equal(portrait.compactLandscape, false);
    assert.equal(landscape.compactLandscape, true);
    assert.equal("height" in portrait.frameStyle, false);
    assert.equal(typeof landscape.frameStyle.height, "number");
  });

  await scenario("long titles keep a two-line readable typography envelope", () => {
    const portrait = computeHomeHeroLayout({ width: 390, height: 844 });
    const landscape = computeHomeHeroLayout({ width: 800, height: 360 });
    assert.equal(portrait.imageTitleStyle.lineHeight / portrait.imageTitleStyle.fontSize > 1.15, true);
    assert.equal(landscape.imageTitleStyle.lineHeight / landscape.imageTitleStyle.fontSize > 1.15, true);
    assert.equal(landscape.captionStyle.maxWidth <= landscape.cardWidth - 32, true);
  });

  await scenario("carousel page metrics keep card width stable for pagination", () => {
    const layout = computeHomeHeroLayout({ width: 844, height: 390 });
    const index = 2;
    assert.equal(layout.cardWidth, 808);
    assert.equal(layout.cardWidth * index, 1616);
  });

  await scenario("image frame remains contained inside a bounded hero surface", () => {
    const layout = computeHomeHeroLayout({ width: 700, height: 360 });
    assert.equal(layout.compactLandscape, true);
    assert.equal(layout.frameStyle.width, 664);
    assert.equal(layout.frameStyle.height! <= 190, true);
    assert.equal(layout.emptyStyle.height, layout.frameStyle.height);
  });

  await scenario("wide-screen layouts keep the original non-compact max width behavior", () => {
    const layout = computeHomeHeroLayout({ width: 1500, height: 900 });
    assert.equal(layout.compactLandscape, false);
    assert.equal(layout.cardWidth, 1464);
    assert.equal(layout.frameStyle.maxHeight, 520);
    assert.equal(layout.emptyStyle.maxHeight, 420);
  });

  await scenario("Android TV keeps the existing hero layout even with landscape dimensions", () => {
    const layout = computeHomeHeroLayout({ width: 926, height: 428, isTv: true });
    assert.equal(layout.compactLandscape, false);
    assert.equal(layout.frameStyle.aspectRatio, 2.25);
    assert.equal(layout.imageTitleStyle.fontSize, 30);
  });

  console.log("home hero layout scenarios: 8/8 passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
