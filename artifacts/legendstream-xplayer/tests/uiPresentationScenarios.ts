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
  assert.doesNotMatch(context, /provider|stalker|xtream|m3u|playback|fetch\(|AsyncStorage/i);
});

scenario("tabs layout installs one presentation boundary without changing ProductShell delegation", () => {
  const tabs = source("app/(tabs)/_layout.tsx");
  const shell = source("components/ProductShell.tsx");
  assert.match(tabs, /UiPresentationProvider/);
  assert.match(tabs, /<Stack screenOptions=/);
  assert.match(shell, /<StalkerMainPage key=\{provider\.id\}/);
  assert.match(shell, /<OptimizedHomeScreenV6 key=\{provider\.id\}/);
  assert.doesNotMatch(shell, /UiPresentationProvider|useWindowDimensions|Platform\.isTV/);
});

assert.equal(passed, 8);
console.log("ui presentation scenarios: 8/8 passed");
