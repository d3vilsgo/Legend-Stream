import assert from "node:assert/strict";
import {
  createPerformanceDiagnostics,
  formatPerformanceDiagnostics,
  type PerformanceDiagnosticsSnapshot,
} from "../lib/performanceDiagnostics";

let passed = 0;
const scenario = (name: string, run: () => void) => {
  run();
  passed += 1;
  process.stdout.write(`PASS ${name}\n`);
};
const enabledController = () => {
  let time = 0;
  let id = 0;
  const controller = createPerformanceDiagnostics({
    initialEnabled: true,
    preferenceLoaded: true,
    now: () => time,
    randomId: () => `test-${++id}`,
  });
  return { controller, setTime: (next: number) => { time = next; } };
};
const report = (snapshot: PerformanceDiagnosticsSnapshot) => formatPerformanceDiagnostics(snapshot);

scenario("startup olay sırası", () => {
  const { controller, setTime } = enabledController();
  controller.beginStartup("cold");
  controller.markStartup("ROOT_MOUNT");
  setTime(2); controller.markStartup("PLAYER_HYDRATION_BEGIN");
  setTime(8); controller.markStartup("PLAYER_HYDRATION_END");
  assert.deepEqual(controller.snapshot().startup?.events.map((event) => event.name), ["ROOT_MOUNT", "PLAYER_HYDRATION_BEGIN", "PLAYER_HYDRATION_END"]);
});

scenario("paralel sorgular bağımsız süre", () => {
  const { controller, setTime } = enabledController();
  controller.beginStartup("cold");
  setTime(10); controller.markStartup("HOME_LIVE_QUERY_BEGIN"); controller.markStartup("HOME_VOD_QUERY_BEGIN");
  setTime(30); controller.markStartup("HOME_LIVE_QUERY_END");
  setTime(55); controller.markStartup("HOME_VOD_QUERY_END");
  const text = report(controller.snapshot());
  assert.match(text, /startup\.home_live_query=20ms/);
  assert.match(text, /startup\.home_vod_query=45ms/);
});

scenario("eksik olay NOT_OBSERVED", () => {
  const { controller } = enabledController();
  controller.beginStartup("cold");
  controller.markStartup("ROOT_MOUNT");
  assert.match(report(controller.snapshot()), /startup\.root_to_first_usable=NOT_OBSERVED/);
});

scenario("provider switch session izolasyonu", () => {
  const { controller } = enabledController();
  controller.beginStartup("cold");
  controller.bindStartupProvider(1, "xtream");
  const first = controller.snapshot().startup?.id;
  controller.bindStartupProvider(2, "stalker");
  const second = controller.snapshot().startup;
  assert.notEqual(second?.id, first);
  assert.equal(second?.kind, "warm");
  assert.equal(second?.providerGeneration, 2);
});

scenario("cold ve warm ayrımı", () => {
  const { controller } = enabledController();
  controller.beginStartup("cold");
  assert.equal(controller.snapshot().startup?.kind, "cold");
  controller.beginStartup("warm", 3, "m3u");
  assert.equal(controller.snapshot().startup?.kind, "warm");
});

scenario("playback correlation ID", () => {
  const { controller, setTime } = enabledController();
  const id = controller.beginPlayback("xtream");
  setTime(4); controller.markPlayback("RESOLVE_BEGIN");
  setTime(10); controller.markPlayback("RESOLVE_END");
  assert.equal(controller.snapshot().playback[0]?.id, id);
  assert.match(report(controller.snapshot()), /playback\.resolve=6ms/);
});

scenario("PLAYING gelmeyen deneme", () => {
  const { controller, setTime } = enabledController();
  controller.beginPlayback("m3u");
  setTime(5); controller.markPlayback("SOURCE_SET");
  setTime(8); controller.markPlayback("VLC_OPENING");
  assert.match(report(controller.snapshot()), /playback\.opening_to_playing=NOT_OBSERVED/);
});

scenario("credential redaction yüzeyi", () => {
  const { controller } = enabledController();
  controller.beginPlayback("https://user:password@example.test/token" as never);
  const text = report(controller.snapshot());
  assert.equal(text.includes("password"), false);
  assert.equal(text.includes("example.test"), false);
  assert.match(text, /playback\.provider=unknown/);
});

scenario("tanılama kapalıyken no-op", () => {
  const controller = createPerformanceDiagnostics({ initialEnabled: false, preferenceLoaded: true });
  controller.beginStartup("cold");
  controller.beginPlayback("xtream");
  assert.equal(controller.snapshot().startup, null);
  assert.equal(controller.snapshot().playback.length, 0);
});

scenario("VLC fazları ayrı hesaplanır", () => {
  const { controller, setTime } = enabledController();
  controller.beginPlayback("stalker");
  setTime(20); controller.markPlayback("SOURCE_SET");
  setTime(35); controller.markPlayback("VLC_OPENING");
  setTime(80); controller.markPlayback("VLC_BUFFERING");
  setTime(135); controller.markPlayback("VLC_PLAYING");
  const text = report(controller.snapshot());
  assert.match(text, /source_set_to_opening=15ms/);
  assert.match(text, /opening_to_playing=100ms/);
  assert.match(text, /tap_to_playing=135ms/);
  assert.match(text, /buffering=OBSERVED/);
});

assert.equal(passed, 10);
process.stdout.write(`performance diagnostics scenarios: ${passed}/10 passed\n`);
