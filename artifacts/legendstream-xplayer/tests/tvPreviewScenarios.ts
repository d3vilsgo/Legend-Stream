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
    await new Promise<void>((res