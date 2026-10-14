import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveUiPresentation } from "../lib/uiPresentation";
import {
  armPendingPlayerOrientationPolicyRestore,
  clearPendingPlayerOrientationPolicyRestore,
  orientationSnapshotFromDimensions,
  releasePendingPlayerOrientationPolicyRestoreForLayout,
  resolvePlayerOrientationRestorePlan,
  resolvePlayerOrientationRestoreTarget,
  setPendingPlayerOrientationPolicyRestore,
} from "../lib/playerOrientationRestore";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

let passed = 0;
const scenario = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`ok ui ${passed} - ${name}`);
};

scenario("auto keeps portrait phones on the existing mobile portrait surface", () => {
  assert.equal(resolveUiPresentation({
    preference: "auto", nativeTv: false, width: 412, height: 915,
  }).mode, "mobilePortrait");
});

scenario("auto resolves landscape phones independently from TV", () => {
  const result = resolveUiPresentation({
    preference: "auto", nativeTv: false, width: 915, height: 412,
  });
  assert.equal(result.mode, "mobileLandscape");
  assert.equal(result.tvLayout, false);
  assert.equal(result.landscape, true);
});

scenario("auto resolves native Android TV to TV layout", () => {
  const result = resolveUiPresentation({
    preference: "auto", nativeTv: true, width: 1920, height: 1080,
  });
  assert.equal(result.mode, "tv");
  assert.equal(result.tvLayout, true);
  assert.equal(result.nativeTv, true);
});

scenario("explicit TV preference can select TV layout on a phone", () => {
  assert.equal(resolveUiPresentation({
    preference: "tv", nativeTv: false, width: 412, height: 915,
  }).mode, "tv");
});

scenario("explicit mobile preference can retain mobile layout on native TV hardware", () => {
  const result = resolveUiPresentation({
    preference: "mobile", nativeTv: true, width: 1920, height: 1080,
  });
  assert.equal(result.mode, "mobileLandscape");
  assert.equal(result.tvLayout, false);
  assert.equal(result.nativeTv, true);
});

scenario("invalid zero dimensions fail closed to portrait mobile outside TV mode", () => {
  assert.equal(resolveUiPresentation({
    preference: "auto", nativeTv: false, width: 0, height: 0,
  }).mode, "mobilePortrait");
});

scenario("runtime provider derives only device/layout state and owns no product protocol", () => {
  const context = source("context/UiPresentationContext.tsx");
  assert.match(context, /Platform\.isTV/);
  assert.match(context, /useWindowDimensions\(\)/);
  assert.match(context, /resolveUiPresentation/);
  assert.match(context, /releasePendingPlayerOrientationPolicyRestoreForLayout/);
  for (const forbidden of [
    "@/context/PlayerContext",
    "StalkerMainPage",
    "OptimizedHomeScreen",
    "resolveCatalogPlaybackSource",
    "stalkerPortal",
    "xtreamCatalog",
    "m3uTransport",
    "fetch(",
  ]) {
    assert.equal(context.includes(forbidden), false, `UI presentation context leaked ${forbidden}`);
  }
  assert.match(context, /legendstream\.ui\.tvPreview\.v1/);
  assert.match(context, /AsyncStorage\.getItem/);
  assert.match(context, /AsyncStorage\.setItem/);
});

scenario("router Stack stays outside the dimension-reactive presentation provider", () => {
  const tabs = source("app/(tabs)/_layout.tsx");
  const shell = source("components/ProductShell.tsx");
  assert.doesNotMatch(tabs, /UiPresentationProvider|useWindowDimensions|Platform\.isTV/);
  assert.match(tabs, /return <Stack screenOptions=/);
  assert.match(shell, /UiPresentationProvider/);
  assert.match(shell, /<ProductShellContent \/>/);
});

scenario("portrait landscape portrait transitions keep one stable product delegate boundary", () => {
  const portrait = resolveUiPresentation({
    preference: "auto", nativeTv: false, width: 412, height: 915,
  });
  const landscape = resolveUiPresentation({
    preference: "auto", nativeTv: false, width: 915, height: 412,
  });
  const portraitAgain = resolveUiPresentation({
    preference: "auto", nativeTv: false, width: 412, height: 915,
  });
  assert.deepEqual(
    [portrait.mode, landscape.mode, portraitAgain.mode],
    ["mobilePortrait", "mobileLandscape", "mobilePortrait"],
  );
  const shell = source("components/ProductShell.tsx");
  assert.match(shell, /<StalkerMainPage key=\{provider\.id\}/);
  assert.match(shell, /<OptimizedHomeScreenV6 key=\{provider\.id\}/);
});

scenario("repeated orientation changes update mode without changing product navigation ownership", () => {
  const sequence = [
    [412, 915],
    [915, 412],
    [412, 915],
    [915, 412],
  ].map(([width, height]) => resolveUiPresentation({
    preference: "auto", nativeTv: false, width, height,
  }).mode);
  assert.deepEqual(sequence, [
    "mobilePortrait",
    "mobileLandscape",
    "mobilePortrait",
    "mobileLandscape",
  ]);
  const shell = source("components/ProductShell.tsx");
  assert.doesNotMatch(shell, /setView\(|router\.|navigation\./);
});

scenario("player orientation owner stays outside product protocol and playback source", () => {
  const orientation = source("hooks/usePlayerOrientation.ts");
  const player = source("components/CompatibilityVideoPlayerV2.tsx");
  assert.match(orientation, /useWindowDimensions\(\)/);
  assert.match(orientation, /orientationSnapshotFromDimensions\(width, height\)/);
  assert.match(orientation, /resolvePlayerOrientationRestoreTarget/);
  assert.match(orientation, /await ScreenOrientation\.getOrientationLockAsync\(\)/);
  assert.match(orientation, /resolvePlayerOrientationRestorePlan/);
  assert.match(orientation, /await ScreenOrientation\.unlockAsync\(\)/);
  assert.match(orientation, /ScreenOrientation\.OrientationLock\.PORTRAIT_UP/);
  assert.match(orientation, /ScreenOrientation\.OrientationLock\.LANDSCAPE/);
  assert.match(player, /await orientation\.restore\(\)/);
  assert.match(player, /onFullscreenExit\?\.\(\)/);
  assert.match(player, /orientation\.releaseWhenLayoutReady\(\)/);
  for (const forbidden of [
    "resolveCatalogPlaybackSource",
    "StalkerPortalSession",
    "get_epg_info",
    "vlcRef.current?.seek",
    "effectiveUri",
  ]) {
    assert.equal(orientation.includes(forbidden), false, `orientation owner leaked ${forbidden}`);
  }
});

scenario("player restore prefers launch portrait layout over fullscreen orientation side effects", () => {
  assert.equal(orientationSnapshotFromDimensions(390, 844), "portrait");
  assert.equal(resolvePlayerOrientationRestoreTarget({
    launchLayout: "portrait",
    initialOrientation: "landscape",
  }), "portrait");
});

scenario("player restore preserves launch landscape layout when leaving fullscreen", () => {
  assert.equal(orientationSnapshotFromDimensions(844, 390), "landscape");
  assert.equal(resolvePlayerOrientationRestoreTarget({
    launchLayout: "landscape",
    initialOrientation: "portrait",
  }), "landscape");
});

scenario("player restore falls back to the system orientation when launch dimensions are unavailable", () => {
  assert.equal(orientationSnapshotFromDimensions(0, 0), "unknown");
  assert.equal(resolvePlayerOrientationRestoreTarget({
    launchLayout: "unknown",
    initialOrientation: "landscape",
  }), "landscape");
  assert.equal(resolvePlayerOrientationRestoreTarget({
    launchLayout: "unknown",
    initialOrientation: "unknown",
  }), "unlock");
});

scenario("player restore releases portrait launch back to free rotation", () => {
  assert.deepEqual(resolvePlayerOrientationRestorePlan({
    launchLayout: "portrait",
    initialOrientation: "landscape",
    initialLock: "free",
  }), [
    { type: "lock", target: "portrait" },
    { type: "unlock" },
  ]);
});

scenario("player restore releases landscape launch back to free rotation", () => {
  assert.deepEqual(resolvePlayerOrientationRestorePlan({
    launchLayout: "landscape",
    initialOrientation: "portrait",
    initialLock: "free",
  }), [
    { type: "lock", target: "landscape" },
    { type: "unlock" },
  ]);
});

scenario("player restore preserves a fixed pre-player portrait policy", () => {
  assert.deepEqual(resolvePlayerOrientationRestorePlan({
    launchLayout: "landscape",
    initialOrientation: "landscape",
    initialLock: "portrait",
  }), [
    { type: "lock", target: "landscape" },
    { type: "lock", target: "portrait" },
  ]);
});

scenario("player restore treats unknown pre-player lock as free rotation", () => {
  assert.deepEqual(resolvePlayerOrientationRestorePlan({
    launchLayout: "unknown",
    initialOrientation: "portrait",
    initialLock: "unknown",
  }), [
    { type: "lock", target: "portrait" },
    { type: "unlock" },
  ]);
});

scenario("player exit policy release waits until it is armed", () => {
  const calls: string[] = [];
  clearPendingPlayerOrientationPolicyRestore();
  setPendingPlayerOrientationPolicyRestore({
    target: "landscape",
    release: () => { calls.push("released"); },
  });
  assert.equal(releasePendingPlayerOrientationPolicyRestoreForLayout({ width: 915, height: 412 }), false);
  assert.deepEqual(calls, []);
  assert.equal(armPendingPlayerOrientationPolicyRestore(), true);
  assert.deepEqual(calls, ["released"]);
  clearPendingPlayerOrientationPolicyRestore();
});

scenario("player exit policy release waits for matching landscape catalog layout", () => {
  const calls: string[] = [];
  clearPendingPlayerOrientationPolicyRestore();
  setPendingPlayerOrientationPolicyRestore({
    target: "landscape",
    release: () => { calls.push("released"); },
  });
  assert.equal(releasePendingPlayerOrientationPolicyRestoreForLayout({ width: 390, height: 844 }), false);
  armPendingPlayerOrientationPolicyRestore();
  assert.equal(releasePendingPlayerOrientationPolicyRestoreForLayout({ width: 390, height: 844 }), false);
  assert.deepEqual(calls, []);
  assert.equal(releasePendingPlayerOrientationPolicyRestoreForLayout({ width: 844, height: 390 }), true);
  assert.deepEqual(calls, ["released"]);
  clearPendingPlayerOrientationPolicyRestore();
});

scenario("player exit policy release waits for matching portrait catalog layout", () => {
  const calls: string[] = [];
  clearPendingPlayerOrientationPolicyRestore();
  setPendingPlayerOrientationPolicyRestore({
    target: "portrait",
    release: () => { calls.push("released"); },
  });
  assert.equal(releasePendingPlayerOrientationPolicyRestoreForLayout({ width: 844, height: 390 }), false);
  armPendingPlayerOrientationPolicyRestore();
  assert.equal(releasePendingPlayerOrientationPolicyRestoreForLayout({ width: 844, height: 390 }), false);
  assert.deepEqual(calls, []);
  assert.equal(releasePendingPlayerOrientationPolicyRestoreForLayout({ width: 390, height: 844 }), true);
  assert.deepEqual(calls, ["released"]);
  clearPendingPlayerOrientationPolicyRestore();
});

scenario("player close arms policy release after fullscreen exit request", () => {
  const v2 = source("components/CompatibilityVideoPlayerV2.tsx");
  const legacy = source("components/CompatibilityVideoPlayer.tsx");
  for (const player of [v2, legacy]) {
    const restoreIndex = player.indexOf("await orientation.restore()");
    const exitIndex = player.indexOf("onFullscreenExit?.()");
    const releaseIndex = player.indexOf("orientation.releaseWhenLayoutReady()");
    assert.ok(restoreIndex >= 0);
    assert.ok(exitIndex > restoreIndex);
    assert.ok(releaseIndex > exitIndex);
  }
});

scenario("player policy restore can recover when layout ready happened before exit arm", () => {
  const calls: string[] = [];
  clearPendingPlayerOrientationPolicyRestore();
  assert.equal(releasePendingPlayerOrientationPolicyRestoreForLayout({ width: 844, height: 390 }), false);
  setPendingPlayerOrientationPolicyRestore({
    target: "landscape",
    release: () => { calls.push("released"); },
  });
  assert.equal(armPendingPlayerOrientationPolicyRestore(), true);
  assert.deepEqual(calls, ["released"]);
  clearPendingPlayerOrientationPolicyRestore();
});

assert.equal(passed, 23);
console.log("ui presentation scenarios: 23/23 passed");
