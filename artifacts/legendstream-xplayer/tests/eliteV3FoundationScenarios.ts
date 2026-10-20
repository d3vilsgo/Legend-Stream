import assert from "node:assert/strict";
import { eliteV3, eliteV3Frame, eliteV3LivePanels, eliteV3TargetVisual } from "../lib/design/eliteV3Tokens";

let cases = 0;
for (const [width, height, native] of [
  [393, 873, false], [873, 393, false], [800, 1280, false],
  [1280, 800, false], [960, 540, true], [1280, 720, true],
  [1920, 1080, true], [3840, 2160, true],
] as const) {
  for (const fontScale of [1, 1.4, 2]) {
    const metrics = eliteV3Frame(width, height, fontScale, native, {
      left: 12, right: 18, top: 10, bottom: 16,
    });
    assert(metrics.contentWidth > 0 && metrics.contentWidth <= width);
    assert(metrics.target >= (native ? 56 : 44));
    assert.equal(metrics.rail > 0, native);
    assert(metrics.type.body * metrics.scale <= metrics.target);
    assert(metrics.gap >= 10);
    cases++;
  }
}
for (const width of [480, 720, 960, 1280, 1920]) {
  for (const scale of [1, 1.5, 2]) {
    const m = eliteV3LivePanels(width, scale);
    assert(m.categoryWidth > 0 && m.channelWidth > 0 && m.videoWidth > 0);
    if (!m.stacked) {
      const fraction = (m.categoryWidth + m.channelWidth + m.gap) / width;
      assert(Math.abs(fraction - 0.32) < 0.01);
      assert.equal(m.categoryWidth + m.channelWidth + m.videoWidth + m.gap * 2, width);
    } else {
      assert.equal(m.categoryWidth + m.channelWidth + m.gap, width);
    }
    cases++;
  }
}
for (const focused of [true, false]) for (const selected of [true, false])
  for (const active of [true, false]) for (const disabled of [true, false]) {
    const style = eliteV3TargetVisual(focused, selected, active, disabled);
    assert.equal(style.borderColor, focused ? eliteV3.color.focus : "transparent");
    assert.equal(style.activeIndicatorColor, active ? eliteV3.color.active : "transparent");
    assert.equal(style.backgroundColor, selected ? eliteV3.color.selected : eliteV3.color.panel);
    assert.equal(style.opacity, disabled ? 0.55 : 1);
    cases++;
  }
assert.notEqual(eliteV3.color.focus, eliteV3.color.selected);
assert.notEqual(eliteV3.color.active, eliteV3.color.focus);
assert.equal(eliteV3.typography.family, "Inter_400Regular");
console.log(`Elite V3 foundation: ${cases}/${cases} responsive, Live budget and orthogonal visual assertions PASS`);
