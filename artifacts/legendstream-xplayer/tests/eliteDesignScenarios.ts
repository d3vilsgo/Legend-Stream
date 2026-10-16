import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import assert from "node:assert/strict";
import {
  eliteTokens as t,
  eliteLayout,
  eliteOverlaySurface,
  eliteTargetVisual,
  type EliteMode,
} from "../lib/design/eliteTokens";
import {
  eliteDemoReduce as reduce,
  eliteInitialState,
  eliteRestoreId,
} from "../lib/design/eliteShowcaseModel";
function luminance(rgb: number[]) {
  return rgb
    .map((n) => n / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
    .reduce((s, n, i) => s + n * [0.2126, 0.7152, 0.0722][i], 0);
}
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const contrast = (a: number[], b: number[]) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
let count = 0;
for (const kind of ["information", "interaction", "error"] as const)
  for (const back of [0, 255]) {
    const opacity = eliteOverlaySurface(kind).opacity;
    const composite = rgb(t.color.surface).map(
      (n) => n * opacity + back * (1 - opacity),
    );
    for (const text of [t.color.text, t.color.muted])
      assert(contrast(rgb(text), composite) >= 4.5, `${kind} text contrast`);
    count++;
  }
assert(contrast(rgb(t.color.onAccent), rgb(t.color.accent)) >= 4.5);
for (const surface of [t.color.surface, t.color.raised, t.color.selected])
  assert(contrast(rgb(t.color.focus), rgb(surface)) >= 3);
for (const focused of [false, true])
  for (const selected of [false, true])
    for (const active of [false, true]) {
      const v = eliteTargetVisual(focused, selected, active);
      assert.equal(v.activeMarker, active);
      assert.equal(v.selectedMarker, selected);
      assert.equal(v.borderColor, focused ? t.color.focus : "transparent");
      assert.equal(v.borderWidth, 3);
      assert.equal(v.scale, 1);
      count++;
    }
const cases: Array<[number, number, EliteMode]> = [
  [390, 844, "mobile"],
  [900, 1200, "tablet"],
  [960, 540, "nativeTv"],
  [1280, 720, "nativeTv"],
  [1920, 1080, "nativeTv"],
  [1536, 864, "nativeTv"],
  [960, 540, "preview"],
];
for (const [w, h, mode] of cases)
  for (const font of [0.85, 1, 1.3, 1.6, 2])
    for (const safe of [{}, { left: 48, right: 32, top: 24, bottom: 40 }]) {
      const m = eliteLayout(w, h, mode, font, safe);
      assert(m.contentWidth <= w - m.left - m.right + 0.001);
      assert(m.contentWidth <= t.limit.contentWidth);
      assert(m.posterWidth <= 240 && m.posterWidth > 0);
      assert(
        m.columns * m.posterWidth + (m.columns - 1) * 16 <= m.bodyWidth + 0.001,
      );
      assert(m.panelWidth <= m.bodyWidth && m.heroHeight <= 360);
      assert(m.rowHeight >= m.target);
      assert.equal(m.tv, mode === "nativeTv" || mode === "preview");
      count++;
    }
let state = { ...eliteInitialState };
state = reduce(state, { type: "navigate", section: "live" });
assert.equal(state.active, "live");
state = reduce(state, { type: "open", opener: "live:channels" });
assert(state.overlay);
assert.equal(reduce(state, { type: "navigate", section: "movies" }), state);
const id = state.selectedChannel;
assert.equal(
  reduce(state, { type: "selectChannel", id: "not-mounted" }),
  state,
);
state = reduce(state, { type: "selectChannel", id: "demo:channel:2" });
assert.notEqual(state.selectedChannel, id);
assert.equal(state.active, "live");
assert(state.overlay);
state = reduce(state, { type: "close" });
assert(!state.overlay);
assert.equal(state.opener, "live:channels");
assert.equal(eliteRestoreId(state.opener, ["live:channels"]), "live:channels");
assert.equal(eliteRestoreId(state.opener, ["unrelated"]), null);
process.stdout.write(
  `Elite design scenarios: ${count} geometry/state/contrast cases + interaction reducer passed\n`,
);

// Dependency boundary is architectural: the preview must not import playback/provider/orientation authority.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = ts.createSourceFile(
  "EliteShowcase.tsx",
  readFileSync(resolve(root, "components/elite/EliteShowcase.tsx"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const allowed = new Set([
  "react",
  "react-native",
  "react-native-svg",
  "../../lib/design/eliteTokens",
  "../../lib/design/eliteShowcaseModel",
]);
for (const statement of source.statements)
  if (ts.isImportDeclaration(statement))
    assert(
      allowed.has((statement.moduleSpecifier as ts.StringLiteral).text),
      "Showcase dependency crosses production authority",
    );
