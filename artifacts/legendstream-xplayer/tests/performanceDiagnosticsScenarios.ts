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
  assert.deepEqual(controller.snapshot().startups[0]?.events.map((event) => event.name), ["ROOT_MOUNT", "PLAYER_HYDRATION_BEGIN", "PLAYER_HYDRATION_END"]);
});

scenario("paralel sorgular bağımsız süre", () => {
  const { controller, setTime } = enabledController();
  controller.beginStartup("cold");
  setTime(10); controller.markStartup("HOME_LIVE_QUERY_BEGIN"); controller.markStartup("HOME_VOD_QUERY_BEGIN");
  setTime(30); controller.markStartup("HOME_LIVE_QUERY_END");
  setTime(55); controller.markStartup("HOME_VOD_QUERY_END");
  const text = report(controller.snapshot());
  assert.match(text, /startup\[0\]\.home_live_query=20ms/);
  assert.match(text, /startup\[0\]\.home_vod_query=45ms/);
});

scenario("eksik olay NOT_OBSERVED", () => {
  const { controller } = enabledController();
  controller.beginStartup("cold");
  controller.markStartup("ROOT_MOUNT");
  assert.match(report(controller.snapshot()), /startup\[0\]\.root_to_first_usable=NOT_OBSERVED/);
});

scenario("provider switch session izolasyonu", () => {
  const { controller } = enabledController();
  controller.beginStartup("cold");
  controller.markStartup("ROOT_MOUNT");
  controller.bindStartupProvider(1, "xtream");
  const first = controller.snapshot().startups[0]?.id;
  controller.bindStartupProvider(2, "stalker");
  const all = controller.snapshot().startups;
  const second = all.find((entry) => entry.id !== first);
  assert.notEqual(second?.id, first);
  assert.equal(second?.kind, "warm");
  assert.equal(second?.providerGeneration, 2);
  assert.equal(all.find((entry) => entry.id === first)?.events[0]?.name, "ROOT_MOUNT");
});

scenario("cold ve warm ayrımı", () => {
  const { controller } = enabledController();
  controller.beginStartup("cold");
  assert.equal(controller.snapshot().startups[0]?.kind, "cold");
  controller.beginStartup("warm", 3, "m3u");
  assert.equal(controller.snapshot().startups[1]?.kind, "warm");
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
  assert.equal(controller.snapshot().startups.length, 0);
  assert.equal(controller.snapshot().playback.length, 0);
});

scenario("cold ROOT_MOUNT sonrası ilk provider aynı session'a bağlanır", () => {
  const { controller } = enabledController();
  const id = controller.beginStartup("cold");
  controller.markStartup("ROOT_MOUNT");
  assert.equal(controller.bindStartupProvider(1, "m3u"), id);
  const session = controller.snapshot().startups[0];
  assert.equal(session?.kind, "cold");
  assert.equal(session?.providerGeneration, 1);
  assert.equal(session?.events[0]?.name, "ROOT_MOUNT");
});

scenario("hydration sırasındaki generation değişimi cold veriyi korur", () => {
  const { controller } = enabledController();
  controller.beginStartup("cold");
  controller.markStartup("ROOT_MOUNT");
  controller.markStartup("PLAYER_HYDRATION_BEGIN");
  controller.bindStartupProvider(1, "xtream");
  controller.bindStartupProvider(2, "stalker");
  const sessions = controller.snapshot().startups;
  assert.equal(sessions[0]?.events[0]?.name, "ROOT_MOUNT");
  assert.equal(sessions[0]?.events[1]?.name, "PLAYER_HYDRATION_BEGIN");
  controller.markStartup("PLAYER_HYDRATION_END");
  assert.equal(controller.snapshot().startups[0]?.events[2]?.name, "PLAYER_HYDRATION_END");
  assert.equal(sessions[0]?.providerGeneration, 1);
  assert.equal(sessions[1]?.providerGeneration, 2);
});

scenario("cold session ilk snapshot ve usable render olaylarını tutar", () => {
  const { controller, setTime } = enabledController();
  controller.beginStartup("cold"); controller.markStartup("ROOT_MOUNT");
  controller.bindStartupProvider(1, "xtream");
  controller.bindStartupProvider(2, "stalker");
  setTime(90); controller.markStartup("SNAPSHOT_PUBLISH");
  setTime(100); controller.markStartup("HOME_FIRST_USABLE_RENDER");
  const text = report(controller.snapshot());
  const cold = controller.snapshot().startups[0];
  assert.equal(cold?.kind, "cold");
  assert.equal(cold?.events.find((event) => event.name === "HOME_FIRST_USABLE_RENDER")?.atMs, 100);
  assert.match(text, /startup\[0\]\.root_to_first_usable=100ms/);
});

scenario("cold tamamlandıktan sonraki provider switch ayrı warm session açar", () => {
  const { controller, setTime } = enabledController();
  controller.beginStartup("cold"); controller.markStartup("ROOT_MOUNT");
  controller.bindStartupProvider(1, "m3u");
  setTime(50); controller.markStartup("HOME_FIRST_USABLE_RENDER");
  const coldId = controller.snapshot().startups[0]?.id;
  const warmId = controller.bindStartupProvider(2, "xtream");
  assert.notEqual(warmId, coldId);
  assert.equal(controller.snapshot().startups[0]?.id, coldId);
  assert.equal(controller.snapshot().startups[1]?.kind, "warm");
});

scenario("geç yüklenen açık tercih erken cold olaylarını korur", () => {
  const controller = createPerformanceDiagnostics({ initialEnabled: false, preferenceLoaded: false, now: () => 1, randomId: () => "early" });
  controller.beginStartup("cold"); controller.markStartup("ROOT_MOUNT");
  controller.markStartup("PLAYER_HYDRATION_BEGIN");
  controller.setPreference(true, true);
  assert.deepEqual(controller.snapshot().startups[0]?.events.map((event) => event.name), ["ROOT_MOUNT", "PLAYER_HYDRATION_BEGIN"]);
});

scenario("warm session eklendiğinde cold geçmişi raporda kalır", () => {
  const { controller, setTime } = enabledController();
  controller.beginStartup("cold"); controller.markStartup("ROOT_MOUNT");
  controller.bindStartupProvider(1, "xtream");
  setTime(10); controller.markStartup("HOME_FIRST_USABLE_RENDER");
  controller.bindStartupProvider(2, "xtream");
  setTime(20); controller.markStartup("COUNTS_BEGIN");
  setTime(25); controller.markStartup("COUNTS_END");
  const text = report(controller.snapshot());
  assert.match(text, /startup\[0\]\.kind=cold/);
  assert.match(text, /startup\[0\]\.root_to_first_usable=10ms/);
  assert.match(text, /startup\[1\]\.kind=warm/);
  assert.match(text, /startup\[1\]\.counts=5ms/);
});

scenario("playback attempt ID startup session ID'sinden ayrıdır", () => {
  const { controller } = enabledController();
  const startupId = controller.beginStartup("cold");
  const playbackId = controller.beginPlayback("m3u");
  assert.notEqual(startupId, playbackId);
  assert.equal(controller.snapshot().startups.length, 1);
  assert.equal(controller.snapshot().playback.length, 1);
});

scenario("sabit geçmiş kapasitesi dolarken cold session tutulur", () => {
  const { controller } = enabledController();
  controller.beginStartup("cold");
  const coldId = controller.snapshot().startups[0]?.id;
  for (let generation = 1; generation <= 7; generation += 1) {
    controller.beginStartup("warm", generation, "xtream");
  }
  const sessions = controller.snapshot().startups;
  assert.equal(sessions.length, 5);
  assert.equal(sessions[0]?.id, coldId);
  assert.deepEqual(sessions.slice(1).map((session) => session.providerGeneration), [4, 5, 6, 7]);
});

scenario("kapalıyken olay alınmaz ve tamamlanan cold raporu korunur", () => {
  const { controller, setTime } = enabledController();
  controller.beginStartup("cold"); controller.markStartup("ROOT_MOUNT");
  setTime(12); controller.markStartup("HOME_FIRST_USABLE_RENDER");
  controller.setPreference(false, true);
  const before = controller.snapshot().startups[0];
  controller.markStartup("COUNTS_BEGIN");
  assert.equal(controller.snapshot().startups[0]?.events.length, before?.events.length);
  assert.equal(controller.snapshot().startups[0]?.kind, "cold");
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

assert.equal(passed, 19);
process.stdout.write(`performance diagnostics scenarios: ${passed}/19 passed\n`);
