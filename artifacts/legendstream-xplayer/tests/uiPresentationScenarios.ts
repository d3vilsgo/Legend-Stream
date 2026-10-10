import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveUiPresentation } from "../lib/uiPresentation";

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
  for (const forbidden of [
    "@/context/PlayerContext",
    "StalkerMainPage",
    "OptimizedHomeScreen",
    "resolveCatalogPlaybackSource",
    "stalkerPortal",
    "xtreamCatalog",
    "m3uTransport",
    "fetch(",
    "AsyncStorage",
  ]) {
    assert.equal(context.includes(forbidden), false, `UI presentation context leaked ${forbidden}`);
  }
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

scenario("player orientation owner and restore path remain unchanged by presentation foundation", () => {
  const orientation = source("hooks/usePlayerOrientation.ts");
  const player = source("components/CompatibilityVideoPlayerV2.tsx");
  assert.match(orientation, /useWindowDimensions\(\)/);
  assert.match(orientation, /await ScreenOrientation\.unlockAsync\(\)/);
  assert.match(orientation, /await ScreenOrientation\.lockAsync\(ScreenOrientation\.OrientationLock\.PORTRAIT_UP\)/);
  assert.match(player, /await orientation\.restore\(\)/);
  assert.match(player, /onFullscreenExit\?\.\(\)/);
});

assert.equal(passed, 11);
console.log("ui presentation scenarios: 11/11 passed");
