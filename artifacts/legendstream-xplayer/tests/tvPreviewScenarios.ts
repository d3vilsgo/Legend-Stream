import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAdaptiveNavigationModel } from "../lib/adaptiveNavigation";
import { resolveDevicePresentation } from "../lib/devicePresentation";
import { resolvePremiumCatalogProfile } from "../lib/design/screenProfiles";
import { createOrientationOwnershipCoordinator } from "../lib/orientationOwnership";
import { createTVPreviewFocusController, resolveTVPreviewFocusTarget, type TVPreviewFocusEntry } from "../lib/tvPreviewFocus";
import { resolveUiPresentation } from "../lib/uiPresentation";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const keys = ["home", "live", "movies", "series", "history", "downloads", "settings"] as const;
let passed = 0;
function scenario(name: string, run: () => void | Promise<void>) {
  return Promise.resolve().then(run).then(() => { passed += 1; console.log(`ok TV Preview ${passed} - ${name}`); });
}
const entry = (id: string, x: number, y: number, press: () => void = () => undefined, setFocused: (value: boolean) => void = () => undefined): TVPreviewFocusEntry => ({
  id, bounds: { x, y, width: 100, height: 60 }, press, setFocused,
});

async function main() {
  await scenario("explicit handheld preference resolves to TV layout preview", () => {
    const result = resolveUiPresentation({ preference: "tv", nativeTv: false, width: 390, height: 844 });
    assert.equal(result.tvLayout, true); assert.equal(result.tvPreview, true); assert.equal(result.mode, "tv"); assert.equal(result.landscape, true);
  });
  await scenario("automatic phone mode remains mobile", () => {
    const result = resolveUiPresentation({ preference: "auto", nativeTv: false, width: 390, height: 844 });
    assert.equal(result.tvPreview, false); assert.equal(result.tvLayout, false); assert.equal(result.mode, "mobilePortrait");
  });
  await scenario("native Android TV is distinguished from handheld preview", () => {
    const result = resolveUiPresentation({ preference: "auto", nativeTv: true, width: 1920, height: 1080 });
    assert.equal(result.nativeTv, true); assert.equal(result.tvPreview, false); assert.equal(result.tvLayout, true);
  });
  await scenario("phone keeps portrait catalog policy when preview is off", () => {
    const result = resolveDevicePresentation({ width: 390, height: 844, nativeTv: false, tvPreview: false });
    assert.equal(result.deviceClass, "phone"); assert.equal(result.catalogOrientation, "portrait");
  });
  await scenario("phone preview resolves a TV landscape catalog profile", () => {
    const result = resolveDevicePresentation({ width: 844, height: 390, nativeTv: false, tvPreview: true });
    assert.equal(result.preview, true); assert.equal(result.tvLayout, true); assert.equal(result.catalogOrientation, "landscape");
  });
  await scenario("tablet preview retains tablet device identity while using TV layout", () => {
    const result = resolveDevicePresentation({ width: 1200, height: 800, nativeTv: false, tvPreview: true });
    assert.equal(result.deviceClass, "tablet"); assert.equal(result.catalogMode, "tv"); assert.equal(result.preview, true);
  });
  await scenario("orientation policy switches between TV landscape and restored phone portrait", async () => {
    const calls: string[] = [];
    const ownership = createOrientationOwnershipCoordinator();
    ownership.registerCatalogPolicy("landscape", { lockPortrait: () => { calls.push("portrait"); }, lockLandscape: () => { calls.push("landscape"); }, unlock: () => { calls.push("free"); } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    ownership.registerCatalogPolicy("portrait", { lockPortrait: () => { calls.push("portrait"); }, lockLandscape: () => { calls.push("landscape"); }, unlock: () => { calls.push("free"); } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls, ["landscape", "portrait"]);
  });
  await scenario("player owns orientation during playback and catalog policy resumes on release", async () => {
    const calls: string[] = [];
    const ownership = createOrientationOwnershipCoordinator();
    ownership.registerCatalogPolicy("portrait", { lockPortrait: () => { calls.push("portrait"); }, lockLandscape: () => { calls.push("landscape"); }, unlock: () => { calls.push("free"); } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0)); calls.length = 0;
    await ownership.acquirePlayer();
    ownership.registerCatalogPolicy("landscape", { lockPortrait: () => { calls.push("portrait"); }, lockLandscape: () => { calls.push("landscape"); }, unlock: () => { calls.push("free"); } });
    assert.deepEqual(calls, []); assert.equal(ownership.snapshot().owner, "player");
    await ownership.handoffPlayerToCatalog();
    assert.deepEqual(calls, ["landscape"]); assert.equal(ownership.snapshot().owner, "catalog");
  });
  await scenario("preview navigation keeps all main sections visible", () => {
    const profile = resolvePremiumCatalogProfile({ width: 1280, height: 720, nativeTv: false, tvPreview: true });
    const model = resolveAdaptiveNavigationModel({ profile, open: true, activeKey: "home", itemKeys: keys });
    assert.deepEqual(model.visibleItemKeys, [...keys]); assert.equal(model.showTabLabels, "all"); assert.equal(model.showMenuToggle, false);
  });
  await scenario("preview route selection retains the selected accessible tab", () => {
    for (const activeKey of keys) {
      const profile = resolvePremiumCatalogProfile({ width: 1280, height: 720, nativeTv: false, tvPreview: true });
      const model = resolveAdaptiveNavigationModel({ profile, open: true, activeKey, itemKeys: keys });
      assert.equal(model.activeKey, activeKey); assert.ok(model.visibleItemKeys.includes(activeKey));
    }
  });
  await scenario("normal phone navigation keeps the compact touch layout", () => {
    const profile = resolvePremiumCatalogProfile({ width: 390, height: 844, nativeTv: false });
    const model = resolveAdaptiveNavigationModel({ profile, open: false, activeKey: "live", itemKeys: keys });
    assert.equal(model.nativeTv, false); assert.equal(model.showMenuToggle, true); assert.deepEqual(model.visibleItemKeys, []);
  });
  await scenario("native TV remains labeled and keeps Home as its Back target", () => {
    const profile = resolvePremiumCatalogProfile({ width: 1920, height: 1080, nativeTv: true });
    const model = resolveAdaptiveNavigationModel({ profile, open: true, activeKey: "series", itemKeys: keys });
    assert.equal(model.nativeTv, true); assert.equal(model.touchTarget, 56); assert.equal(model.backTarget, "home");
  });
  await scenario("directional search selects the closest right-hand catalog card", () => {
    const current = entry("a", 0, 0); const right = entry("b", 120, 0); const diagonal = entry("c", 100, 100);
    assert.equal(resolveTVPreviewFocusTarget(current, "right", [current, right, diagonal])?.id, "b");
  });
  await scenario("directional search selects the nearest item above", () => {
    const current = entry("a", 100, 100); const above = entry("b", 100, 0); const far = entry("c", 0, 0);
    assert.equal(resolveTVPreviewFocusTarget(current, "up", [current, above, far])?.id, "b");
  });
  await scenario("focus does not jump to an item behind the pressed direction", () => {
    const current = entry("a", 100, 100); const left = entry("b", 0, 100);
    assert.equal(resolveTVPreviewFocusTarget(current, "right", [current, left]), null);
  });
  await scenario("virtual OK invokes the currently focused real screen action", () => {
    const selected: string[] = []; const activated: string[] = []; const focus = createTVPreviewFocusController(undefined, (id) => activated.push(id));
    focus.register(entry("home-live-card", 0, 0, () => { selected.push("live"); }));
    focus.activate(); assert.deepEqual(selected, ["live"]); assert.deepEqual(activated, ["home-live-card"]);
  });
  await scenario("directional movement updates visible focused state before OK", async () => {
    const changes: Array<[string, boolean]> = []; const selected: string[] = [];
    const focus = createTVPreviewFocusController();
    focus.register(entry("home", 0, 0, () => { selected.push("home"); }, (value) => { changes.push(["home", value]); }));
    focus.register(entry("live", 120, 0, () => { selected.push("live"); }, (value) => { changes.push(["live", value]); }));
    await focus.move("right", { x: 0, y: 0, width: 400, height: 200 }); focus.activate();
    assert.deepEqual(selected, ["live"]); assert.deepEqual(changes, [["home", true], ["home", false], ["live", true]]);
  });
  await scenario("movement remeasures targets after scroll and exposes the refreshed focus coordinates", async () => {
    const focus = createTVPreviewFocusController(); let targetX = 120;
    focus.register(entry("home:live", 0, 0));
    focus.register({ ...entry("vod:asset-42", 120, 0, () => undefined), measure: async () => ({ x: targetX, y: 0, width: 100, height: 60 }) });
    await focus.move("right", { x: 0, y: 0, width: 400, height: 200 });
    assert.equal(focus.getFocusedId(), "vod:asset-42");
    targetX = 240;
    await focus.move("right", { x: 0, y: 0, width: 400, height: 200 });
    assert.equal(focus.getFocusedEntry()?.bounds.x, 240);
  });
  await scenario("offscreen cells are excluded until focus reveals and remeasures them", async () => {
    const focus = createTVPreviewFocusController(); let focusedTarget: string | null = null; let activated = "";
    focus.register(entry("menu:vod", 0, 0));
    focus.register({
      ...entry("vod:poster-7", 0, 500, () => { activated = "poster-7"; }, (value) => { if (value) focusedTarget = "vod:poster-7"; }),
      measure: async () => ({ x: 0, y: 500, width: 100, height: 60 }),
      reveal: async () => ({ x: 120, y: 20, width: 100, height: 60 }),
    });
    await focus.move("down", { x: 0, y: 0, width: 400, height: 200 });
    assert.equal(focus.getFocusedId(), "vod:poster-7"); assert.equal(focusedTarget, "vod:poster-7");
    focus.activate(); assert.equal(activated, "poster-7");
  });
  await scenario("unmeasurable stale registrations are removed and cannot receive OK", async () => {
    let staleActivation = 0; const focus = createTVPreviewFocusController();
    focus.register(entry("menu:live", 0, 0));
    focus.register({ ...entry("stale:item", 120, 0, () => { staleActivation += 1; }), measure: async () => null });
    await focus.move("right", { x: 0, y: 0, width: 400, height: 200 });
    assert.equal(focus.getFocusedId(), "menu:live"); focus.activate(); assert.equal(staleActivation, 0);
  });
  await scenario("modal focus scope isolates category choices and restores the previous content ID", async () => {
    const selected: string[] = []; const focus = createTVPreviewFocusController();
    focus.register(entry("menu:vod", 0, 0));
    focus.register(entry("vod:poster-42", 120, 0, () => selected.push("vod:42")));
    await focus.move("right", { x: 0, y: 0, width: 400, height: 200 });
    assert.equal(focus.getFocusedId(), "vod:poster-42");
    focus.register({ ...entry("category:all", 0, 0, () => selected.push("category:all")), scope: "category-drawer" });
    const closeScope = focus.pushFocusScope("category-drawer");
    assert.equal(focus.getFocusedId(), "category:all"); focus.activate();
    assert.deepEqual(selected, ["category:all"]);
    closeScope(); assert.equal(focus.getFocusedId(), "vod:poster-42");
  });
  await scenario("scope changes invalidate pending movement and offscreen focus IDs", async () => {
    const focus = createTVPreviewFocusController(); let finishMeasure: ((value: { x: number; y: number; width: number; height: number } | null) => void) | undefined;
    focus.register(entry("menu:vod", 0, 0));
    focus.register({ ...entry("stale:poster", 120, 0), scope: "content", measure: () => new Promise((resolve) => { finishMeasure = resolve; }) });
    const moving = focus.move("right", { x: 0, y: 0, width: 400, height: 200 });
    focus.pushFocusScope("category-drawer"); finishMeasure?.({ x: 120, y: 0, width: 100, height: 60 }); await moving;
    assert.notEqual(focus.getFocusedId(), "stale:poster");
  });
  await scenario("virtual Back executes the active screen navigation callback", () => {
    let route = "series"; const focus = createTVPreviewFocusController();
    focus.setBackAction(() => { route = "home"; }); focus.back(); assert.equal(route, "home");
  });
  await scenario("Home, Live, VOD and Series use the same interactive preview wrapper", () => {
    assert.match(source("components/home/HomeDiscovery.tsx"), /return <TVPreviewPressable/);
    assert.match(source("components/catalog/PagedCatalogViews.tsx"), /function GridCard[\s\S]*?TVPreviewPressable/);
    assert.match(source("components/catalog/StalkerLiveCatalog.tsx"), /TVPreviewPressable focusId=\{`stalker-live:\$\{channel\.id\}`\} accessibilityRole="button"/);
    assert.match(source("components/stalker/StalkerVodSurface.tsx"), /TVPreviewPressable focusId=\{`stalker-vod:\$\{item\.portalId\}`\} accessibilityRole="button"/);
  });
  await scenario("persistent settings switch writes through AsyncStorage", () => {
    const context = source("context/UiPresentationContext.tsx"); const setting = source("components/tvPreview/TVPreviewSetting.tsx");
    assert.match(context, /legendstream\.ui\.tvPreview\.v1/); assert.match(context, /AsyncStorage\.setItem/);
    assert.match(setting, /testID="tv-preview-toggle"/); assert.match(setting, /accessibilityRole="switch"/);
  });
  await scenario("D-pad overlay exposes six labeled controls and exact UI callback wiring", () => {
    const controls = source("components/tvPreview/TVPreviewFocus.tsx");
    for (const id of ["up", "down", "left", "right", "ok", "back"]) assert.ok(controls.includes(`tv-preview-dpad-${id}`));
    assert.match(controls, /button\("OK", "OK", focus\.activate/); assert.match(controls, /onPress=\{focus\.back\}/);
    assert.match(controls, /testID="tv-preview-focus-target"/); assert.match(controls, /testID="tv-preview-activation-target"/);
    assert.match(controls, /tv-preview-dpad-collapse/); assert.match(controls, /tv-preview-dpad-expand/);
    assert.match(controls, /tv-preview-dpad-diagnostics-toggle/); assert.match(controls, /tv-preview-diagnostics-panel/);
    assert.match(controls, /position: "absolute" as const/); assert.match(controls, /StyleSheet\.absoluteFillObject/);
    assert.match(controls, /pointerEvents="box-none"/); assert.match(controls, /width: 28, height: 28/);
    assert.match(controls, /TVPreviewFocusRegion/); assert.match(source("components/ProductShell.tsx"), /<TVPreviewControls \/>/);
    assert.match(source("components/catalog/PagedCatalogViews.tsx"), /focusScope="category-drawer"/);
    assert.match(source("components/ProductShell.tsx"), /TVPreviewFocusRegion><ProductShellContent \/><\/TVPreviewFocusRegion>\s*<TVPreviewControls \/>/);
  });
  await scenario("catalog viewport stays independent from the floating controller height", () => {
    const focus = source("components/tvPreview/TVPreviewFocus.tsx");
    const shell = source("components/ProductShell.tsx");
    assert.match(focus, /style=\{\{ flex: 1, minHeight: 0 \}\}/);
    assert.match(focus, /overlay: \{ \.\.\.StyleSheet\.absoluteFillObject/);
    assert.match(shell, /<View style=\{\{ flex: 1, minHeight: 0 \}\}>/);
    assert.match(source("components/OptimizedHomeScreenPaged.tsx"), /screen: \{ flex: 1, minHeight: 0 \}/);
    assert.match(source("components/StalkerMainPage.tsx"), /screen: \{ flex: 1, minHeight: 0 \}/);
    assert.match(source("components/catalog/PagedCatalogViews.tsx"), /return <View style=\{\{ flex: 1, minHeight: 0 \}\} \{\.\.\.drawerSwipe\.panHandlers\}>/);
  });
  await scenario("M3U and Xtream keep their real Home Live VOD and Series catalog render paths", () => {
    const paged = source("components/OptimizedHomeScreenPaged.tsx");
    assert.match(paged, /presentedView === "home" \? <HomeDiscovery/);
    assert.match(paged, /provider\.type === "m3u" \|\| provider\.type === "xtream"\) \? <PagedLiveCatalog/);
    assert.match(paged, /provider\.type === "m3u" \|\| provider\.type === "xtream"\) \? <PagedMoviesCatalog/);
    assert.match(paged, /provider\.type === "m3u" \|\| provider\.type === "xtream"\) \? <PagedSeriesCatalog/);
  });
  await scenario("Stalker keeps separate real live and VOD poster render paths", () => {
    const main = source("components/StalkerMainPage.tsx");
    const paged = source("components/OptimizedHomeScreenPaged.tsx");
    assert.match(main, /presentedView === "live" \? \([\s\S]*?<PagedLiveCatalog/);
    assert.match(main, /presentedView === "movies" \? \([\s\S]*?<StalkerGoldenMoviesCatalog/);
    assert.match(main, /presentedView === "series" \? \([\s\S]*?<StalkerSeriesProductSurface/);
    assert.match(paged, /provider\.type === "stalker"[^\n]*<StalkerLiveCatalog/);
    assert.match(paged, /provider\.type === "stalker"[^\n]*<StalkerVodSurface/);
  });
  await scenario("loaded empty VOD and Series catalogs render explicit empty states, not a blank body", () => {
    const paged = source("components/catalog/PagedCatalogViews.tsx");
    assert.match(paged, /Katalogda film bulunamadı\./);
    assert.match(paged, /Katalogda dizi bulunamadı\./);
    assert.match(paged, /page\.loadingInitial\s*\? <CatalogLoadingSkeleton/);
  });
  await scenario("collapsing the D-pad leaves controller focus and activation state in its provider", () => {
    const controls = source("components/tvPreview/TVPreviewFocus.tsx");
    assert.match(controls, /setCollapsed\(true\)/); assert.match(controls, /setCollapsed\(false\)/);
    assert.match(controls, /const \[focusedId, setFocusedId\] = useState/);
    assert.match(controls, /const \[lastActivatedId, setLastActivatedId\] = useState/);
    assert.match(controls, /const \[showDiagnostics, setShowDiagnostics\] = useState\(false\)/);
  });
  await scenario("player orientation implementation retains independent ownership", () => {
    assert.match(source("hooks/usePlayerOrientation.ts"), /acquirePlayerOrientationOwnership/);
    assert.match(source("hooks/usePlayerOrientation.ts"), /handoffPlayerOrientationToCatalog/);
    assert.match(source("components/ProductShell.tsx"), /<TVPreviewControls \/>/);
  });
  assert.equal(passed, 32);
  console.log(`TV Preview interaction scenarios: ${passed}/32 passed`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
