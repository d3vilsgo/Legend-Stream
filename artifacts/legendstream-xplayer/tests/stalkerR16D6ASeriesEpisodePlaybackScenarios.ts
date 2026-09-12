import assert from "node:assert/strict";
import { probeStalkerSeriesCreateLink, type StalkerSeriesEpisode, type StalkerSeriesSeason } from "../lib/stalkerSeriesProbe";

type Params = Record<string, string | number | boolean | undefined>;
function harness(handler: (params: Params) => unknown | Promise<unknown>) {
  const calls: Params[] = [];
  return {
    calls,
    session: {
      async handshake() { return { authenticated: true as const }; },
      async request(params: Params) {
        calls.push({ ...params });
        return handler(params);
      },
    },
  };
}
const season = (cmd: string): StalkerSeriesSeason => ({ id: "season-1", label: "Season 1", rows: [{ season_num: 1, cmd }] });
const episode = (id: string): StalkerSeriesEpisode => ({ id, label: "Episode " + id, seasonId: "season-1", row: {} });

async function main() {
  const rawCmd = "  eyJzZXJpZXNfaWQiOjE4NjQ0LCJzZWFzb25fbnVtIjoyfQ==  !@#";
  const correct = harness(() => ({ cmd: "ffmpeg https://example.invalid/episode.m3u8", headers: { Authorization: "Bearer secret" } }));
  const success = await probeStalkerSeriesCreateLink(correct.session, season(rawCmd), episode("2"));
  assert.deepEqual(correct.calls, [{ type: "vod", action: "create_link", cmd: rawCmd, series: "2" }]);
  assert.equal(success.observation.classification, "SUCCESS");
  assert.equal(success.observation.resolvedScheme, "https");
  assert.equal(success.observation.wrapperPrefix, true);

  const episodeId = harness(() => ({ url: "http://example.invalid/stream" }));
  const plain = await probeStalkerSeriesCreateLink(episodeId.session, season("opaque-season-command"), episode("01"));
  assert.equal(plain.observation.classification, "SUCCESS");
  assert.equal(plain.observation.resolvedScheme, "http");
  assert.equal(plain.observation.wrapperPrefix, false);
  assert.equal(episodeId.calls[0]?.series, "01");

  const missingCmd = harness(() => { throw new Error("must not request"); });
  const noCmd = await probeStalkerSeriesCreateLink(missingCmd.session, season("   "), episode("1"));
  assert.equal(noCmd.observation.classification, "EVIDENCE_REQUIRED");
  assert.equal(missingCmd.calls.length, 0);

  const missingEpisode = harness(() => { throw new Error("must not request"); });
  const noEpisode = await probeStalkerSeriesCreateLink(missingEpisode.session, season("opaque"), { ...episode(""), id: "" });
  assert.equal(noEpisode.observation.classification, "EVIDENCE_REQUIRED");
  assert.equal(missingEpisode.calls.length, 0);

  for (const response of [{}, { status: "ok" }, "unsupported"]) {
    const bounded = harness(() => response);
    await probeStalkerSeriesCreateLink(bounded.session, season("opaque"), episode("2"));
    assert.equal(bounded.calls.length, 1);
  }

  const sensitive = harness(() => ({
    token: "secret-token",
    cookie: "secret-cookie",
    authorization: "Bearer secret",
    headers: { Authorization: "Bearer secret" },
    cmd: "ffmpeg https://example.invalid/secret",
    url: "https://example.invalid/secret",
  }));
  const safe = await probeStalkerSeriesCreateLink(sensitive.session, season("opaque"), episode("2"));
  const safeSummary = JSON.stringify(safe.observation);
  for (const value of ["secret-token", "secret-cookie", "Bearer secret", "example.invalid/secret"]) {
    assert.equal(safeSummary.includes(value), false, "sensitive response value leaked: " + value);
  }
  assert.deepEqual(safe.observation.returnedFieldNames, ["authorization", "cmd", "cookie", "headers", "token", "url"]);

  const nonPlayable = harness(() => ({ status: "ok" }));
  const empty = await probeStalkerSeriesCreateLink(nonPlayable.session, season("opaque"), episode("2"));
  assert.equal(empty.observation.classification, "EMPTY");
  assert.equal(nonPlayable.calls.length, 1);

  console.log("stalker R16-D6-A series episode playback probe scenarios passed");
}
main().catch((error) => { console.error(error); process.exit(1); });
