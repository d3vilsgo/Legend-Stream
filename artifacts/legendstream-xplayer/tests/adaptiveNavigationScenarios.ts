import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAdaptiveNavigationModel } from "../lib/adaptiveNavigation";
import { resolvePremiumCatalogProfile } from "../lib/design/screenProfiles";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const keys = ["home", "live", "movies", "series", "history", "downloads", "settings"] as const;
let passed = 0;
function scenario(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`ok adaptive navigation ${passed} - ${name}`);
}

scenario("phone portrait uses icon-priority collapsed tabs with 44dp targets", () => {
  const profile = resolvePremiumCatalogProfile({ width: 393, height: 873, nativeTv: false });
  const model = resolveAdaptiveNavigationModel({ profile, open: true, activeKey: "home", itemKeys: keys });
  assert.equal(model.mode, "phonePortrait");
  assert.equal(model.touchTarget, 44);
  assert.equal(model.showTabLabels, "active-only");
  assert.deepEqual(model.visibleItemKeys, [...keys]);
});
scenario("phone landscape dimensions remain phone portrait navigation", () => {
  const profile = resolvePremiumCatalogProfile({ width: 873, height: 393, nativeTv: false });
  const model = resolveAdaptiveNavigationModel({ profile, open: false, activeKey: "live", itemKeys: keys });
  assert.equal(model.mode, "phonePortrait");
  assert.equal(model.nativeTv, false);
  assert.deepEqual(model.visibleItemKeys, []);
});
scenario("tablet portrait uses 48dp targets and keeps the existing tablet profile", () => {
  const profile = resolvePremiumCatalogProfile({ width: 800, height: 1280, nativeTv: false });
  const model = resolveAdaptiveNavigationModel({ profile, open: true, activeKey: "series", itemKeys: keys });
  assert.equal(model.mode, "tabletPortrait");
  assert.equal(model.touchTarget, 48);
  assert.equal(model.availableContentWidth, profile.effectiveContentWidth);
});
scenario("tablet landscape uses available window width and preserves horizontal navigation", () => {
  const profile = resolvePremiumCatalogProfile({ width: 1280, height: 800, nativeTv: false, safeArea: { left: 24, right: 24 } });
  const model = resolveAdaptiveNavigationModel({ profile, open: true, activeKey: "movies", itemKeys: keys });
  assert.equal(model.mode, "tabletLandscape");
  assert.equal(model.touchTarget, 48);
  assert.equal(model.availableContentWidth, profile.effectiveContentWidth);
});
scenario("split-screen width changes the menu profile and content metrics", () => {
  const full = resolvePremiumCatalogProfile({ width: 1280, height: 800, nativeTv: false, navState: "open" });
  const split = resolvePremiumCatalogProfile({ width: 620, height: 800, nativeTv: false, navState: "open" });
  const fullModel = resolveAdaptiveNavigationModel({ profile: full, open: true, activeKey: "home", itemKeys: keys });
  const splitModel = resolveAdaptiveNavigationModel({ profile: split, open: true, activeKey: "home", itemKeys: keys });
  assert.ok(fullModel.availableContentWidth > splitModel.availableContentWidth);
  assert.ok(fullModel.availableContentHeight < resolvePremiumCatalogProfile({ width: 1280, height: 800, nativeTv: false, navState: "closed" }).effectiveContentHeight);
});
scenario("closed and open navigation expose only mounted focus targets", () => {
  const profile = resolvePremiumCatalogProfile({ width: 900, height: 1200, nativeTv: false });
  const closed = resolveAdaptiveNavigationModel({ profile, open: false, activeKey: "series", itemKeys: keys });
  const open = resolveAdaptiveNavigationModel({ profile, open: true, activeKey: "series", itemKeys: keys });
  assert.deepEqual(closed.visibleItemKeys, []);
  assert.deepEqual(open.visibleItemKeys, [...keys]);
  assert.equal(open.activeKey, closed.activeKey);
});
scenario("main navigation targets preserve Home, Live, VOD, Series and other routes", () => {
  for (const activeKey of keys) {
    const model = resolveAdaptiveNavigationModel({ profile: resolvePremiumCatalogProfile({ width: 900, height: 1200, nativeTv: false }), open: true, activeKey, itemKeys: keys });
    assert.equal(model.activeKey, activeKey);
    assert.ok(model.visibleItemKeys.includes(activeKey));
  }
});
scenario("native Android TV gets labeled focus targets with minimum 56dp and Home back target", () => {
  const profile = resolvePremiumCatalogProfile({ width: 1920, height: 1080, nativeTv: true });
  const model = resolveAdaptiveNavigationModel({ profile, open: false, activeKey: "series", itemKeys: keys });
  assert.equal(model.nativeTv, true);
  assert.equal(model.touchTarget, 56);
  assert.equal(model.showTabLabels, "all");
  assert.deepEqual(model.visibleItemKeys, [...keys]);
  assert.equal(model.backTarget, "home");
});
scenario("native TV does not trap Back on Home", () => {
  const profile = resolvePremiumCatalogProfile({ width: 1920, height: 1080, nativeTv: true });
  const model = resolveAdaptiveNavigationModel({ profile, open: true, activeKey: "home", itemKeys: keys });
  assert.equal(model.backTarget, null);
});
scenario("TV Preview classification does not masquerade as native focus navigation", () => {
  const profile = resolvePremiumCatalogProfile({ width: 900, height: 1200, nativeTv: false, tvPreview: true });
  const model = resolveAdaptiveNavigationModel({ profile, open: true, activeKey: "home", itemKeys: keys });
  assert.equal(model.nativeTv, false);
  assert.equal(model.mode, "tv");
  assert.equal(model.touchTarget, 48);
});
scenario("M3U and Xtream shell routes remain wired through their existing navigate handler", () => {
  const shell = source("components/OptimizedHomeScreenPaged.tsx");
  assert.match(shell, /<ResponsiveContentNav items={nav} activeKey={view} onSelect={navigate}/);
  for (const providerRoute of ['view === "live" && (provider.type === "m3u" || provider.type === "xtream")', 'view === "movies" && (provider.type === "m3u" || provider.type === "xtream")', 'view === "series" && (provider.type === "m3u" || provider.type === "xtream")']) assert.ok(shell.includes(providerRoute));
});
scenario("Stalker keeps its separate product surfaces and player return selection", () => {
  const shell = source("components/StalkerMainPage.tsx");
  assert.match(shell, /<ResponsiveContentNav items={nav} activeKey={presentedView} onSelect={navigate}/);
  assert.match(shell, /<PagedLiveCatalog/);
  assert.match(shell, /StalkerGoldenMoviesCatalog/);
  assert.match(shell, /StalkerSeriesProductSurface/);
  assert.match(shell, /const presentedView = view === "player" \? playable\?\.returnTo \?\? "home" : view/);
});
scenario("TV focus targets use FocusButton rather than touch-only Pressable tabs", () => {
  const nav = source("components/navigation/ResponsiveContentNav.tsx");
  assert.match(nav, /<FocusButton/);
  assert.match(source("components/FocusButton.tsx"), /focusable={!disabled}/);
  assert.match(nav, /hasTVPreferredFocus/);
  assert.match(nav, /accessibilityRole=\"tab\"/);
});
scenario("visible active tab retains its translated accessible label and selected state", () => {
  const nav = source("components/navigation/ResponsiveContentNav.tsx");
  const button = source("components/navigation/CompactLandscapeNavButton.tsx");
  assert.match(button, /accessibilityRole="tab"/);
  assert.match(button, /accessibilityLabel={label}/);
  assert.match(button, /accessibilityState={{ selected: active }}/);
  assert.match(nav, /activeKey === item.key/);
});
scenario("the navigation surface uses device profiles independently of orientation ownership", () => {
  const nav = source("components/navigation/ResponsiveContentNav.tsx");
  assert.match(nav, /resolvePremiumCatalogProfile/);
  assert.doesNotMatch(nav, /orientationOwnership|ScreenOrientation|lockAsync/);
  const context = source("context/UiPresentationContext.tsx");
  assert.match(context, /registerCatalogOrientationPolicy/);
});
scenario("TV nav buttons are not clipped into a focus trap and closed menus unmount tabs", () => {
  const nav = source("components/navigation/ResponsiveContentNav.tsx");
  // Native TV keeps the scroll affordance visible; phone/tablet closed menus still unmount their tabs.
  assert.ok(nav.includes("showsHorizontalScrollIndicator"));
  assert.ok(nav.includes("{open ? ("));
  assert.ok(nav.includes("BackHandler"));
  assert.ok(nav.includes("hardwareBackPress"));
  // Track focus ownership per tab: a blur from one tab must not erase another focused tab.
  assert.ok(nav.includes("navigationFocusedIds.current.size === 0"));
  assert.ok(nav.includes("navigationFocusedIds.current.add(item.key)"));
  assert.ok(nav.includes("navigationFocusedIds.current.delete(item.key)"));
  assert.ok(!nav.includes("navigationFocusedRef.current"));
});
console.log(`premium adaptive navigation scenarios: ${passed}/${passed} passed`);
