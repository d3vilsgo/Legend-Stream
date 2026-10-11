import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const navSource = source("components/navigation/ResponsiveContentNav.tsx");
const compactSource = source("components/navigation/CompactLandscapeNavButton.tsx");
const m3uShellSource = source("components/OptimizedHomeScreenPaged.tsx");
const stalkerShellSource = source("components/StalkerMainPage.tsx");
const presentationSource = source("lib/uiPresentation.ts");

let passed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function main() {
  await scenario("common responsive nav component owns open and closed mobile states", () => {
    assert.match(navSource, /export function ResponsiveContentNav/);
    assert.match(navSource, /const \[open, setOpen\] = useState\(false\)/);
    assert.match(navSource, /accessibilityState=\{\{ expanded: open \}\}/);
    assert.match(navSource, /setOpen\(\(value\) => !value\)/);
    assert.match(navSource, /open \? \(/);
  });

  await scenario("closed state exposes product identity, active section and explicit opener", () => {
    assert.match(navSource, /productLabel = "LEGENDSTREAM"/);
    assert.match(navSource, /active\.shortLabel \?\? active\.label/);
    assert.match(navSource, /accessibilityLabel=\{open \? "İçerik menüsünü kapat" : "İçerik menüsünü aç"\}/);
    assert.match(navSource, />\{open \? "Kapat" : "Menü"\}<\/Text>/);
  });

  await scenario("open mobile state keeps every tab icon available and labels only the active item", () => {
    assert.match(navSource, /items\.map\(\(item\) =>/);
    assert.match(navSource, /accessibilityRole="tab"/);
    assert.match(navSource, /accessibilityState=\{\{ selected: active \}\}/);
    assert.match(navSource, /active \? \(/);
    assert.match(navSource, /shortLabel \?\? label/);
  });

  await scenario("PR 124 compact landscape icon behavior is preserved as a reusable primitive", () => {
    assert.match(compactSource, /export function CompactLandscapeNavButton/);
    assert.match(compactSource, /minHeight:\s*44/);
    assert.match(compactSource, /minWidth:\s*48/);
    assert.match(navSource, /<CompactLandscapeNavButton/);
    assert.match(navSource, /compact \? \(/);
  });

  await scenario("mobile portrait and mobile landscape use the same component and differ only by mode styling", () => {
    assert.match(presentationSource, /"mobilePortrait" \| "mobileLandscape" \| "tv"/);
    assert.match(navSource, /const compact = mode === "mobileLandscape"/);
    assert.match(navSource, /summaryCompact/);
    assert.match(navSource, /navRowCompact/);
    assert.doesNotMatch(navSource, /useWindowDimensions/);
  });

  await scenario("Android TV keeps visible focusable navigation through FocusButton", () => {
    assert.match(navSource, /if \(tv\)/);
    assert.match(navSource, /<FocusButton/);
    assert.match(navSource, /variant=\{activeKey === item\.key \? "secondary" : "ghost"\}/);
    assert.match(navSource, /useEffect\(\(\) => \{\s*if \(tv\) setOpen\(true\);/s);
  });

  await scenario("M3U and Xtream shell uses the shared nav contract without provider logic in nav", () => {
    assert.match(m3uShellSource, /ResponsiveContentNavItem<ContentView>\[\]/);
    assert.match(m3uShellSource, /<ResponsiveContentNav items=\{nav\} activeKey=\{view\} onSelect=\{navigate\}/);
    assert.doesNotMatch(navSource, /provider|xtream|m3u|stalker|playback|LibVLC/i);
  });

  await scenario("Stalker shell uses the same nav contract and preserves presented return view from player", () => {
    assert.match(stalkerShellSource, /ResponsiveContentNavItem<StalkerContentView>\[\]/);
    assert.match(stalkerShellSource, /const presentedView = view === "player" \? playable\?\.returnTo \?\? "home" : view/);
    assert.match(stalkerShellSource, /<ResponsiveContentNav items=\{nav\} activeKey=\{presentedView\} onSelect=\{navigate\}/);
  });

  await scenario("all required content destinations remain present in both shells", () => {
    for (const key of ["home", "live", "movies", "series", "history", "downloads", "settings"]) {
      assert.match(m3uShellSource, new RegExp(`key: "${key}"`));
      assert.match(stalkerShellSource, new RegExp(`key: "${key}"`));
    }
  });

  await scenario("touch targets stay at or above the 44dp mobile floor", () => {
    assert.match(navSource, /minHeight:\s*44/);
    assert.match(navSource, /minWidth:\s*44/);
    assert.match(compactSource, /minHeight:\s*44/);
    assert.match(compactSource, /minWidth:\s*48/);
  });

  console.log("responsive content nav scenarios: 10/10 passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
