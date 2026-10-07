import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { StalkerEpgObservability } from "../lib/stalkerEpgObservability";

const source = (path: string) => readFileSync(new NodeURL(path, import.meta.url), "utf8");

export async function runStalkerEpgTouchObservabilityScenarios() {
  const control = source("../components/catalog/StalkerEpgProbeControl.tsx");
  const paged = source("../components/catalog/PagedCatalogViews.tsx");
  const manual = source("../components/catalog/ManualEpgControl.tsx");
  let passed = 0;
  const scenario = (name: string, run: () => void) => {
    run();
    passed += 1;
    console.log(`ok touch ${passed} - ${name}`);
  };

  scenario("Pressable exposes fixed touch phase handlers and unmistakable hit target", () => {
    assert.match(control, /hitSlop=\{10\}/);
    assert.match(control, /onPressIn=\{\(\) => observable\.touch\("TOUCH_DOWN"\)\}/);
    assert.match(control, /onPressOut=\{\(\) => observable\.touch\("TOUCH_UP"\)\}/);
    assert.match(control, /onLongPress=\{\(\) => observable\.touch\("LONG_PRESS"\)\}/);
    assert.match(control, /minHeight: 44/);
    assert.match(control, /borderWidth: 1/);
    assert.match(control, /backgroundColor: pressed \? colors\.secondary : colors\.card/);
  });

  scenario("PRESS is recorded synchronously before existing observable.press", () => {
    const pressHandler = control.match(/onPress=\{\(\) => \{([\s\S]*?)observable\.press\(Boolean\(channel\), probe/)?.[1] ?? "";
    assert.match(pressHandler, /observable\.touch\("PRESS"\)/);
    assert.ok(pressHandler.indexOf('observable.touch("PRESS")') < pressHandler.indexOf("const probe = owner.current"));
  });

  scenario("touch phases remain distinct from PRESSED and survive accepted press reset", () => {
    const observable = new StalkerEpgObservability();
    observable.touch("TOUCH_DOWN");
    observable.touch("TOUCH_UP");
    observable.touch("PRESS");
    const owner = { run: () => Promise.resolve(), cancel: () => undefined } as any;
    observable.press(true, owner, {
      getSession: () => ({ isAuthenticated: () => true, request: async () => [] }) as any,
      getIdentity: async () => ({}),
      log: () => undefined,
    });
    assert.deepEqual(observable.getSnapshot().split("\n").slice(0, 4), ["TOUCH_DOWN", "TOUCH_UP", "PRESS", "PRESSED"]);
  });

  scenario("copy summary carries only fixed touch labels with bounded history", () => {
    const observable = new StalkerEpgObservability();
    for (let i = 0; i < 30; i++) observable.touch(i % 2 === 0 ? "TOUCH_DOWN" : "TOUCH_UP");
    observable.touch("LONG_PRESS");
    const snapshot = observable.getSnapshot().split("\n");
    assert.equal(snapshot.length, 20);
    const summary = observable.summary("1.4.43", 60, "0d62161a");
    assert.match(summary, /TOUCH_DOWN|TOUCH_UP/);
    assert.match(summary, /LONG_PRESS/);
    assert.doesNotMatch(summary, /nativeEvent|pageX|pageY|locationX|locationY|identifier|target/);
  });

  scenario("touch instrumentation remains Stalker-only and leaves shared responders and normal EPG untouched", () => {
    assert.doesNotMatch(paged, /TOUCH_DOWN|TOUCH_UP|LONG_PRESS|StalkerEpgObservability/);
    assert.doesNotMatch(manual, /TOUCH_DOWN|TOUCH_UP|LONG_PRESS|StalkerEpgObservability/);
    assert.match(control, /if \(provider\.type !== "stalker"\) return null/);
  });

  assert.equal(passed, 5);
  console.log("R18-E0P touch observability scenarios: 5/5 passed");
}
