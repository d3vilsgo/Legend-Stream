import assert from "node:assert/strict";
import { computePremiumHomeHeroMetrics, computePremiumPosterGridMetrics } from "../lib/design/layoutMetrics";
import { resolvePremiumCatalogProfile, resolvePremiumScreenProfile } from "../lib/design/screenProfiles";
import { premiumDesignTokens } from "../lib/design/tokens";
import { computePosterGridLayout } from "../lib/catalogGridLayout";
import { resolveDevicePresentation } from "../lib/devicePresentation";

const check = (condition: unknown, message: string): asserts condition => { if (!condition) throw new Error(message); };
let passed = 0;
const scenario = (name: string, run: () => void) => { run(); passed += 1; console.log(`ok premium tablet ${passed} - ${name}`); };

scenario("phone remains phonePortrait after physical landscape rotation", () => {
  const a = resolvePremiumCatalogProfile({ width: 390, height: 844, nativeTv: false });
  const b = resolvePremiumCatalogProfile({ width: 844, height: 390, nativeTv: false });
  check(a.mode === "phonePortrait" && b.mode === "phonePortrait", "phone mode must not become tablet or phone-landscape");
  check(b.deviceClass === "phone" && b.catalogOrientation === "portrait", "rotated phone retains phone identity and portrait catalog policy");
});
scenario("tablet portrait profiles cover representative 8, 10, and 13 inch dp classes", () => {
  for (const [label,width,height] of [["8-inch",800,1280],["10-inch",900,1440],["13-inch",1200,1920]] as const) {
    const p = resolvePremiumCatalogProfile({ width, height, nativeTv: false });
    check(p.mode === "tabletPortrait", `${label} should resolve to tablet portrait`);
    check(p.deviceClass === "tablet", `${label} should retain tablet device class`);
    check(computePremiumPosterGridMetrics(p).columns >= 3, `${label} should use tablet poster density`);
  }
});
scenario("tablet landscape keeps a distinct profile and wider grid", () => {
  const portrait = resolvePremiumCatalogProfile({ width: 900, height: 1200, nativeTv: false });
  const landscape = resolvePremiumCatalogProfile({ width: 1200, height: 900, nativeTv: false });
  check(landscape.mode === "tabletLandscape" && portrait.mode === "tabletPortrait", "orientation selects a tablet layout mode only");
  check(computePremiumPosterGridMetrics(landscape).columns > computePremiumPosterGridMetrics(portrait).columns, "landscape should use more poster columns");
});
scenario("tablet window metrics use available dimensions in split screen", () => {
  const full = resolvePremiumCatalogProfile({ width: 1280, height: 800, nativeTv: false });
  const split = resolvePremiumCatalogProfile({ width: 620, height: 800, nativeTv: false });
  check(full.effectiveContentWidth > split.effectiveContentWidth, "narrowed window reduces effective content width");
  check(computePremiumPosterGridMetrics(full).columns >= computePremiumPosterGridMetrics(split).columns, "grid density follows available window width");
  const narrowBoundary = resolveDevicePresentation({ width: 520, height: 800, nativeTv: false });
  check(narrowBoundary.deviceClass === "phone", "600dp short-edge classifier limit is explicit for narrow split/fold windows");
});
scenario("foldable narrow window follows the documented 600dp short-edge boundary", () => {
  const narrow = resolveDevicePresentation({ width: 500, height: 820, nativeTv: false });
  const expanded = resolveDevicePresentation({ width: 820, height: 1100, nativeTv: false });
  check(narrow.deviceClass === "phone" && expanded.deviceClass === "tablet", "classification follows current window short edge, not physical hinge identity");
});
scenario("native TV and future TV Preview remain distinguishable", () => {
  const tv = resolvePremiumCatalogProfile({ width: 1920, height: 1080, nativeTv: true });
  const preview = resolvePremiumCatalogProfile({ width: 900, height: 1200, nativeTv: false, tvPreview: true });
  check(tv.mode === "tv" && tv.deviceClass === "tv" && !tv.tvPreview, "native TV uses native profile");
  check(preview.mode === "tv" && preview.deviceClass === "tablet" && preview.tvPreview, "preview profile preserves source device and preview flag");
});
scenario("safe area and navigation chrome reduce usable content", () => {
  const base = resolvePremiumScreenProfile({ mode: "tabletLandscape", width: 1200, height: 800 });
  const constrained = resolvePremiumScreenProfile({ mode: "tabletLandscape", width: 1200, height: 800, safeArea: { left: 24, right: 24, top: 20, bottom: 16 }, navState: "open" });
  check(constrained.effectiveContentWidth < base.effectiveContentWidth, "safe area reduces width");
  check(constrained.effectiveContentHeight < base.effectiveContentHeight, "safe area and open navigation reduce height");
});
scenario("tablet hero remains bounded by usable content height", () => {
  for (const mode of ["tabletPortrait","tabletLandscape"] as const) {
    const p = resolvePremiumScreenProfile({ mode, width: mode === "tabletPortrait" ? 900 : 1200, height: mode === "tabletPortrait" ? 1200 : 800, navState: "open" });
    const hero = computePremiumHomeHeroMetrics(p);
    const cap = premiumDesignTokens.hero.maxHeight[mode];
    const fraction = premiumDesignTokens.hero.heightFraction[mode];
    check(hero.height <= cap, `${mode} hero must respect token cap`);
    check(hero.height <= Math.ceil(p.effectiveContentHeight * fraction), `${mode} hero must respect available content height`);
    check(!hero.compact, "tablet layout must not inherit mobile-landscape compact styling");
  }
});
scenario("tablet touch targets and typography keep independent scales", () => {
  check(premiumDesignTokens.touchTarget.tablet >= 44, "tablet touch target remains accessible");
  const portrait = resolvePremiumScreenProfile({ mode: "tabletPortrait", width: 900, height: 1200 });
  const landscape = resolvePremiumScreenProfile({ mode: "tabletLandscape", width: 1200, height: 900 });
  check(portrait.typographyScale > 1 && landscape.typographyScale > 1, "tablet profiles scale typography above phone baseline");
  check(portrait.navChromeHeight !== 58 && landscape.navChromeHeight !== 46, "tablet navigation chrome has separate measurements");
});
scenario("legacy phone profiles remain supported for PR 125/126/127 consumers", () => {
  for (const mode of ["mobilePortrait","mobileLandscape","tv"] as const) {
    const p = resolvePremiumScreenProfile({ mode, width: mode === "tv" ? 1920 : 873, height: mode === "tv" ? 1080 : 393 });
    check(p.effectiveContentWidth > 0 && p.effectiveContentHeight > 0, `${mode} legacy profile remains usable`);
  }
  const grid = computePosterGridLayout(873,393,false);
  check(grid.columns >= 4 && grid.columnWidth > 0, "legacy landscape grid contract remains valid");
});
scenario("profile and metric layer remains separate from provider and playback protocols", () => {
  const p = resolvePremiumCatalogProfile({ width: 1200, height: 900, nativeTv: false });
  check(p.mode === "tabletLandscape", "profile resolves without provider protocol input");
  check(computePremiumHomeHeroMetrics(p).height > 0, "layout metrics resolve without playback state");
});

console.log(`premium tablet design foundation scenarios: ${passed}/${passed} passed`);
