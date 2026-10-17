import assert from "node:assert/strict";
import {
  createPerformanceDiagnostics,
  formatPerformanceDiagnostics,
  MEASUREMENT_TIMEOUT_MS,
} from "../lib/performanceDiagnostics";
let now = 0,
  id = 0;
const d = createPerformanceDiagnostics({
  initialEnabled: true,
  now: () => now,
  randomId: () => `t${++id}`,
});
const old = d.beginPlayback("xtream");
d.markPlayback("RESOLVE_BEGIN", old);
const current = d.beginPlayback("m3u");
d.markPlayback("RESOLVE_END", old);
assert(
  !d
    .snapshot()
    .playback.at(-1)!
    .events.some((e) => e.name === "RESOLVE_END"),
);
d.markPlayback("SOURCE_SET", current);
for (let i = 0; i < 10000; i++) d.markPlayback("VLC_BUFFERING", current);
assert.equal(
  d
    .snapshot()
    .playback.at(-1)!
    .events.filter((e) => e.name === "VLC_BUFFERING").length,
  1,
);
const startup = d.beginStartup("cold");
d.markStartup("ROOT_MOUNT", startup);
d.bindStartupProvider(1, "xtream");
const warm = d.bindStartupProvider(2, "m3u");
d.markStartup("COUNTS_END", startup);
assert(
  !d
    .snapshot()
    .startups.find((s) => s.id === warm)!
    .events.some((e) => e.name === "COUNTS_END"),
);
for (let i = 0; i < 10000; i++) {
  d.markStartup("COUNTS_BEGIN");
  d.markStartup("COUNTS_END");
}
assert(d.snapshot().startups.every((s) => s.events.length <= 192));
for (let i = 0; i < 100; i++) d.beginPlayback("stalker");
assert.equal(d.snapshot().playback.length, 8);
const pending = d.beginMeasurement("CACHE_HYDRATION", "xtream");
now = 25;
d.finishMeasurement(pending);
d.finishMeasurement(pending, "ERROR");
assert.equal(d.snapshot().measurements.at(-1)!.outcome, "SUCCESS");
assert.equal(d.snapshot().measurements.at(-1)!.durationMs, 25);
const late = d.beginMeasurement("PROVIDER_SWITCH", "m3u");
now += MEASUREMENT_TIMEOUT_MS;
assert.equal(d.snapshot().measurements.at(-1)!.outcome, "TIMEOUT");
d.finishMeasurement(late);
assert.equal(d.snapshot().measurements.at(-1)!.outcome, "TIMEOUT");
for (let i = 0; i < 100; i++) d.beginMeasurement("CATALOG_REFRESH", "stalker");
assert.equal(d.snapshot().measurements.length, 32);
d.recordGauge("catalogRows", 100);
d.recordGauge("jsHeapBytes", NaN);
d.recordGauge("https://user:password@host/?token=secret" as never, 100);
d.beginMeasurement("MAC=00:11:22:33:44:55" as never);
d.markStartup("token=secret" as never);
d.markPlayback("password" as never);
const text = formatPerformanceDiagnostics(d.snapshot());
assert(!/password|token=|00:11:22/.test(text));
assert.match(text, /gauge.jsHeapBytes=NOT_OBSERVED/);
const before = d.snapshot().measurements.length;
d.setPreference(false);
d.beginMeasurement("CATALOG_REFRESH");
assert.equal(d.snapshot().measurements.length, before);
console.log(
  "U3 performance lifecycle/privacy/bounds: 10/10 passed; NO_PHYSICAL_PERFORMANCE_CLAIM",
);
