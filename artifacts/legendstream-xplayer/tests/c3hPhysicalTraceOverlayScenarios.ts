import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginStalkerPlaybackTrace,
  clearStalkerTraceEntries,
  getStalkerTraceEntries,
  traceStalker,
} from "../lib/stalkerPlaybackTrace";
import { projectC3HPhysicalTrace } from "../lib/c3hPhysicalTraceProjection";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

function startTrace(at = Date.now()) {
  clearStalkerTraceEntries();
  const traceId = beginStalkerPlaybackTrace();
  const originalNow = Date.now;
  let now = at;
  Date.now = () => now;
  const emit = (
    event: string,
    details: Record<string, string | number | boolean | null | undefined> = {},
    advance = 10,
  ) => {
    traceStalker(event, { traceId, ...details });
    now += advance;
  };
  emit("STALKER_LIVE_TAP");
  return { traceId, emit, restore: () => { Date.now = originalNow; } };
}

const state = () => projectC3HPhysicalTrace(getStalkerTraceEntries());

async function main() {
  {
    const t = startTrace();
    t.emit("PLAYBACK_REACQUIRE_SOURCE", { source: "EXACT_PAGE" });
    assert.equal(state().path, "EXACT_PAGE");
    t.restore();
  }
  {
    const t = startTrace();
    t.emit("PLAYBACK_REACQUIRE_SOURCE", { source: "CATEGORY" });
    assert.equal(state().path, "CATEGORY");
    t.restore();
  }
  {
    const t = startTrace();
    t.emit("PLAYBACK_REACQUIRE_SOURCE", { source: "FULL_DISCOVERY" });
    assert.equal(state().path, "FULL_DISCOVERY");
    t.restore();
  }
  {
    const t = startTrace();
    t.emit("PLAYBACK_REACQUIRE_SOURCE", { source: "https://secret.invalid/?token=bad" });
    const entry = getStalkerTraceEntries().find((item) => item.event === "PLAYBACK_REACQUIRE_SOURCE");
    assert.equal(entry?.details.source, undefined);
    assert.equal(state().path, "UNKNOWN");
    t.restore();
  }
  {
    const t = startTrace();
    t.emit("PLAYBACK_REACQUIRE_ROWS", { rowCount: 37 });
    assert.equal(state().rows, 37);
    t.restore();
  }
  {
    const t = startTrace();
    t.emit("PLAYBACK_REACQUIRE_START");
    t.emit("PLAYBACK_REACQUIRE_LOOKUP");
    t.emit("PLAYBACK_REACQUIRE_GET_ALL");
    t.emit("PLAYBACK_REACQUIRE_LOOKUP");
    t.emit("PLAYBACK_REACQUIRE_DONE", { success: true });
    assert.equal(state().lookups, 2);
    assert.equal(state().getAll, true);
    t.restore();
  }
  {
    const t = startTrace();
    t.emit("PLAYBACK_REACQUIRE_START");
    t.emit("PLAYBACK_REACQUIRE_LOOKUP");
    t.emit("PLAYBACK_REACQUIRE_DONE", { success: true });
    assert.equal(state().lookups, 1);
    assert.equal(state().getAll, false);
    t.restore();
  }
  {
    const t = startTrace();
    t.emit("STALKER_CMD_STAGE", { stage: "ALREADY_RESOLVED" });
    assert.equal(state().cmdStage, "ALREADY_RESOLVED");
    assert.equal(state().createLink, false);
    t.restore();
  }
  {
    const t = startTrace();
    t.emit("STALKER_CMD_STAGE", { stage: "CREATE_LINK_REQUIRED" });
    t.emit("STALKER_CREATE_LINK_START");
    assert.equal(state().cmdStage, "CREATE_LINK_REQUIRED");
    assert.equal(state().createLink, true);
    t.restore();
  }
  {
    const t = startTrace();
    t.emit("VLC_OPENING");
    assert.equal(state().vlc, "OPENING");
    t.emit("VLC_BUFFERING", { bufferPercent: 25 });
    assert.equal(state().vlc, "BUFFERING");
    t.emit("VLC_PLAYING");
    assert.equal(state().vlc, "PLAYING");
    t.restore();
  }
  {
    const t = startTrace(1000);
    t.emit("PLAYBACK_REACQUIRE_START", {}, 20);
    t.emit("PLAYBACK_REACQUIRE_DONE", { success: true }, 30);
    t.emit("CATALOG_RUNTIME_RESOLVE_SUCCESS", { resolvedSourceKind: "https" }, 40);
    t.emit("VLC_SOURCE_SET", { kind: "live" }, 50);
    t.emit("VLC_PLAYING");
    const projected = state();
    assert.equal(projected.reacquireMs, 20);
    assert.equal(projected.c3fMs, 30);
    assert.equal(projected.vlcStartMs, 50);
    assert.equal(projected.totalMs, 150);
    t.restore();
  }
  {
    clearStalkerTraceEntries();
    const first = beginStalkerPlaybackTrace();
    traceStalker("STALKER_LIVE_TAP", { traceId: first });
    traceStalker("PLAYBACK_REACQUIRE_SOURCE", { traceId: first, source: "FULL_DISCOVERY" });
    const second = beginStalkerPlaybackTrace();
    traceStalker("STALKER_LIVE_TAP", { traceId: second });
    traceStalker("PLAYBACK_REACQUIRE_START", { traceId: second });
    const projected = state();
    assert.equal(projected.traceId, second);
    assert.equal(projected.path, "PENDING");
    assert.equal(projected.rows, null);
    assert.equal(projected.lookups, 0);
  }
  {
    clearStalkerTraceEntries();
    assert.equal(state().path, "UNKNOWN");
    assert.equal(state().vlc, "IDLE");
  }
  {
    const t = startTrace();
    traceStalker("PLAYBACK_REACQUIRE_SOURCE", {
      traceId: t.traceId,
      source: "EXACT_PAGE",
      mac: "00:11:22:33:44:55",
      authorization: "Bearer secret",
      cookie: "secret-cookie",
      token: "secret-token",
      cmd: "ffmpeg http://secret.invalid/live",
      url: "http://secret.invalid/live?play_token=secret",
      portalId: "sensitive-id",
    } as any);
    const projected = JSON.stringify(state());
    for (const forbidden of [
      "00:11:22:33:44:55",
      "Bearer secret",
      "secret-cookie",
      "secret-token",
      "ffmpeg",
      "secret.invalid",
      "play_token",
      "sensitive-id",
    ]) assert.equal(projected.includes(forbidden), false);
    t.restore();
  }

  const playerSource = source("components/CompatibilityVideoPlayerV2.tsx");
  assert.match(playerSource, /provider\?\.type === "stalker" && currentKind === "live"/);
  assert.doesNotMatch(source("lib/c3hPhysicalTraceProjection.ts"), /AsyncStorage|SecureStore|FileSystem|fetch\(|XMLHttpRequest/);
  assert.doesNotMatch(source("components/debug/C3HPhysicalTraceOverlay.tsx"), /Pressable|Touchable|onPress|AsyncStorage|fetch\(/);
  assert.match(source("lib/stalkerLiveRuntimeLocator.ts"), /PLAYBACK_REACQUIRE_LOOKUP/);
  assert.match(source("lib/stalkerLiveRuntimeLocator.ts"), /PLAYBACK_REACQUIRE_GET_ALL/);

  console.log("C3H physical trace overlay scenarios: 16/16 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
