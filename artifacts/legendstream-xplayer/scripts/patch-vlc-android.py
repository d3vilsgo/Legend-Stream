#!/usr/bin/env python3
"""Targeted react-native-vlc-media-player patch for LegendStream Android builds.

Keep upstream VLC playback behavior intact except for compatibility fixes:
1. lower the library minSdk from API 26 to API 24 (Android 7+ support),
2. keep playback running while Android is actually in PiP,
3. pause playback when the PiP window is dismissed to the launcher/background,
4. guard lifecycle pause calls after the native VLC object is released, and
5. expose live-stream resolution/FPS through the library's existing onLoad event.

Decoder, scaling, TextureView sizing, and media bootstrap behavior are not changed.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import NoReturn


def fail(message: str) -> NoReturn:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: patch-vlc-android.py <react-native-vlc-media-player-dir>")

    package_dir = Path(sys.argv[1]).resolve()
    gradle = package_dir / "android" / "build.gradle"
    player_view = (
        package_dir
        / "android"
        / "src"
        / "main"
        / "java"
        / "com"
        / "yuanzhou"
        / "vlc"
        / "vlcplayer"
        / "ReactVlcPlayerView.java"
    )

    if not gradle.is_file():
        fail(f"VLC Gradle file not found: {gradle}")
    if not player_view.is_file():
        fail(f"VLC player view not found: {player_view}")

    gradle_text = gradle.read_text(encoding="utf-8")
    gradle_text, min_sdk_changes = re.subn(
        r"minSdkVersion\s+26\b",
        "minSdkVersion 24",
        gradle_text,
    )
    gradle.write_text(gradle_text, encoding="utf-8")
    print(f"Android 7 minSdk replacements: {min_sdk_changes}")

    java_text = player_view.read_text(encoding="utf-8")
    guard_marker = "LegendStream PiP lifecycle guard"
    dismiss_marker = "LegendStream PiP dismiss monitor"
    grace_marker = "LegendStream PiP return grace"
    release_marker = "LegendStream VLC release-state guard"
    metadata_marker = "LegendStream live video metadata bridge"

    if guard_marker not in java_text:
        fields_marker = "    private final AudioManager audioManager;\n"
        if fields_marker not in java_text:
            fail("Could not locate VLC AudioManager field for PiP monitor state")
        java_text = java_text.replace(
            fields_marker,
            fields_marker
            + "\n"
            + "    // LegendStream PiP dismiss monitor state.\n"
            + "    private boolean legendStreamHostResumed = true;\n"
            + "    private Runnable legendStreamPipExitMonitor = null;\n"
            + "    private long legendStreamPipExitDetectedAt = 0L;\n"
            + "    // LegendStream VLC release-state guard: the Java MediaPlayer wrapper\n"
            + "    // can remain non-null briefly after its native VLCObject is gone.\n"
            + "    private boolean legendStreamPlayerReleased = true;\n",
            1,
        )

        resume_marker = "    @Override\n    public void onHostResume() {\n"
        if resume_marker not in java_text:
            fail("Could not locate VLC onHostResume() for the PiP lifecycle patch")

        resume_replacement = """    // LegendStream PiP dismiss monitor: while PiP is visible we keep VLC
    // playing. When PiP disappears we wait briefly for Android to resume the
    // Activity before deciding that the user actually dismissed the PiP window.
    // This avoids pausing during the normal PiP -> full-app expand animation.
    private void startLegendStreamPipExitMonitor() {
        if (legendStreamPipExitMonitor != null) {
            mProgressUpdateHandler.removeCallbacks(legendStreamPipExitMonitor);
        }
        legendStreamPipExitDetectedAt = 0L;
        legendStreamPipExitMonitor = new Runnable() {
            @Override
            public void run() {
                final android.app.Activity activity = themedReactContext.getCurrentActivity();
                final boolean inPip = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
                        && activity != null
                        && activity.isInPictureInPictureMode();
                final boolean returningToApp = legendStreamHostResumed
                        || (activity != null && activity.hasWindowFocus());

                if (inPip) {
                    legendStreamPipExitDetectedAt = 0L;
                    mProgressUpdateHandler.postDelayed(this, 250);
                    return;
                }

                if (returningToApp) {
                    legendStreamPipExitDetectedAt = 0L;
                    legendStreamPipExitMonitor = null;
                    return;
                }

                final long now = android.os.SystemClock.uptimeMillis();
                if (legendStreamPipExitDetectedAt == 0L) {
                    // LegendStream PiP return grace: Android can report PiP=false
                    // a little before onHostResume()/window focus during expand.
                    legendStreamPipExitDetectedAt = now;
                    mProgressUpdateHandler.postDelayed(this, 900);
                    return;
                }

                if (now - legendStreamPipExitDetectedAt < 800L) {
                    mProgressUpdateHandler.postDelayed(this, 250);
                    return;
                }

                legendStreamPipExitDetectedAt = 0L;
                legendStreamPipExitMonitor = null;
                if (!legendStreamHostResumed
                        && !legendStreamPlayerReleased
                        && !isPaused
                        && mMediaPlayer != null) {
                    isPaused = true;
                    isHostPaused = true;
                    mMediaPlayer.pause();
                    WritableMap map = Arguments.createMap();
                    map.putString("type", "Paused");
                    eventEmitter.onVideoStateChange(map);
                }
            }
        };
        mProgressUpdateHandler.postDelayed(legendStreamPipExitMonitor, 250);
    }

    @Override
    public void onHostResume() {
        legendStreamHostResumed = true;
        legendStreamPipExitDetectedAt = 0L;
        if (legendStreamPipExitMonitor != null) {
            mProgressUpdateHandler.removeCallbacks(legendStreamPipExitMonitor);
            legendStreamPipExitMonitor = null;
        }
        if (legendStreamPlayerReleased || mMediaPlayer == null) {
            return;
        }
"""
        java_text = java_text.replace(resume_marker, resume_replacement, 1)

        pause_marker = "    @Override\n    public void onHostPause() {\n"
        if pause_marker not in java_text:
            fail("Could not locate VLC onHostPause() for the PiP lifecycle patch")

        pause_replacement = """    @Override
    public void onHostPause() {
        legendStreamHostResumed = false;
        // LegendStream PiP lifecycle guard: entering PiP pauses the Activity,
        // but must not pause the media player itself.
        final android.app.Activity legendStreamActivity = themedReactContext.getCurrentActivity();
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
                && legendStreamActivity != null
                && legendStreamActivity.isInPictureInPictureMode()) {
            startLegendStreamPipExitMonitor();
            return;
        }
        // LegendStream VLC release-state guard: lifecycle callbacks can arrive
        // after the Java wrapper survived but the native VLCObject was released.
        if (legendStreamPlayerReleased || mMediaPlayer == null) {
            return;
        }
"""
        java_text = java_text.replace(pause_marker, pause_replacement, 1)

        release_fn_marker = "    private void releasePlayer() {\n"
        if release_fn_marker not in java_text:
            fail("Could not locate VLC releasePlayer() for lifecycle cleanup")
        release_replacement = """    private void releasePlayer() {
        // Mark released before touching native VLC so concurrent lifecycle
        // callbacks cannot call pause() on a dead VLCObject.
        legendStreamPlayerReleased = true;
        legendStreamPipExitDetectedAt = 0L;
        if (legendStreamPipExitMonitor != null) {
            mProgressUpdateHandler.removeCallbacks(legendStreamPipExitMonitor);
            legendStreamPipExitMonitor = null;
        }
"""
        java_text = java_text.replace(release_fn_marker, release_replacement, 1)

        create_marker = "        mMediaPlayer = new MediaPlayer(libvlc);\n"
        if create_marker not in java_text:
            fail("Could not locate VLC MediaPlayer construction for release-state guard")
        java_text = java_text.replace(
            create_marker,
            create_marker + "        legendStreamPlayerReleased = false;\n",
            1,
        )

        java_text = java_text.replace(
            "mMediaPlayer.pause();",
            "legendStreamPauseSafely();",
        )
        helper_anchor = "    // LegendStream PiP dismiss monitor:"
        pause_helper = """    private void legendStreamPauseSafely() {
        if (legendStreamPlayerReleased || mMediaPlayer == null) {
            return;
        }
        try {
            mMediaPlayer.pause();
        } catch (IllegalStateException ignored) {
            // A release can win the race between the lifecycle guard and pause.
            legendStreamPlayerReleased = true;
        }
    }

"""
        if helper_anchor not in java_text:
            fail("Could not locate PiP monitor anchor for safe-pause helper")
        java_text = java_text.replace(helper_anchor, pause_helper + helper_anchor, 1)

        java_text = java_text.replace(
            "if (mMediaPlayer != null && !isPaused) {",
            "if (mMediaPlayer != null && !isPaused && !legendStreamPlayerReleased) {",
        )

        print("Applied VLC PiP lifecycle, release-state and safe-pause guards")
    else:
        print("VLC PiP lifecycle patch already present")

    if metadata_marker not in java_text:
        layout_listener_marker = (
            "    private IVLCVout.OnNewVideoLayoutListener onNewVideoLayoutListener = "
            "new IVLCVout.OnNewVideoLayoutListener() {\n"
        )
        if layout_listener_marker not in java_text:
            fail("Could not locate VLC onNewVideoLayout listener for live metadata")

        metadata_helpers = """    // LegendStream live video metadata bridge: emit coded resolution and FPS
    // through EVENT_ON_LOAD, which VLCPlayer.js already maps to the public
    // onLoad callback. Reflection keeps FPS optional across LibVLC variants.
    private double legendStreamGetFrameRate() {
        if (legendStreamPlayerReleased || mMediaPlayer == null) {
            return 0d;
        }
        try {
            Object track = mMediaPlayer.getClass()
                    .getMethod("getCurrentVideoTrack")
                    .invoke(mMediaPlayer);
            if (track == null) {
                return 0d;
            }
            Number numerator = (Number) track.getClass().getField("frameRateNum").get(track);
            Number denominator = (Number) track.getClass().getField("frameRateDen").get(track);
            if (numerator == null || denominator == null || denominator.doubleValue() <= 0d) {
                return 0d;
            }
            double fps = numerator.doubleValue() / denominator.doubleValue();
            return !Double.isNaN(fps) && !Double.isInfinite(fps) && fps > 0d ? fps : 0d;
        } catch (Throwable ignored) {
            return 0d;
        }
    }

    private void legendStreamEmitVideoInfo(final int width, final int height) {
        if (legendStreamPlayerReleased || mMediaPlayer == null || width <= 0 || height <= 0) {
            return;
        }
        WritableMap info = Arguments.createMap();
        WritableMap videoSize = Arguments.createMap();
        videoSize.putInt("width", width);
        videoSize.putInt("height", height);
        info.putMap("videoSize", videoSize);
        double fps = legendStreamGetFrameRate();
        if (fps > 0d) {
            info.putDouble("frameRate", fps);
        }
        eventEmitter.sendEvent(info, VideoEventEmitter.EVENT_ON_LOAD);
    }

"""
        java_text = java_text.replace(
            layout_listener_marker,
            metadata_helpers + layout_listener_marker,
            1,
        )

        layout_emit_marker = (
            '            map.putString("type", "onNewVideoLayout");\n'
            "            eventEmitter.onVideoStateChange(map);\n"
        )
        if layout_emit_marker not in java_text:
            fail("Could not locate VLC onNewVideoLayout event emission")
        layout_emit_replacement = layout_emit_marker + """            legendStreamEmitVideoInfo(width, height);
            // FPS can become available just after the first layout callback on
            // MPEG-TS/HLS streams, so refresh metadata without touching playback.
            mProgressUpdateHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    legendStreamEmitVideoInfo(width, height);
                }
            }, 700);
"""
        java_text = java_text.replace(layout_emit_marker, layout_emit_replacement, 1)
        print("Applied live resolution/FPS metadata bridge")
    else:
        print("Live resolution/FPS metadata bridge already present")

    player_view.write_text(java_text, encoding="utf-8")

    gradle_verify = gradle.read_text(encoding="utf-8")
    java_verify = player_view.read_text(encoding="utf-8")

    if re.search(r"minSdkVersion\s+26\b", gradle_verify):
        fail("VLC minSdk 26 is still present after patch")
    if guard_marker not in java_verify:
        fail("VLC PiP lifecycle guard is missing after patch")
    if dismiss_marker not in java_verify:
        fail("VLC PiP dismiss monitor is missing after patch")
    if grace_marker not in java_verify:
        fail("VLC PiP return grace is missing after patch")
    if release_marker not in java_verify:
        fail("VLC release-state guard is missing after patch")
    if metadata_marker not in java_verify:
        fail("VLC live metadata bridge is missing after patch")
    if "legendStreamPlayerReleased = false;" not in java_verify:
        fail("VLC release-state reset is missing after MediaPlayer construction")
    if "legendStreamPauseSafely()" not in java_verify:
        fail("VLC safe-pause helper is missing after patch")
    if "legendStreamEmitVideoInfo(width, height)" not in java_verify:
        fail("VLC live metadata emission hook is missing after patch")
    if "frameRateNum" not in java_verify or "frameRateDen" not in java_verify:
        fail("VLC FPS reflection bridge is missing after patch")
    if "isInPictureInPictureMode()" not in java_verify:
        fail("VLC PiP lifecycle check is missing after patch")
    if "startLegendStreamPipExitMonitor()" not in java_verify:
        fail("VLC PiP dismiss monitor hook is missing after patch")
    if re.search(r"\bisReleased\b", java_verify):
        fail("VLC 1.0.98 patch must not reference unavailable isReleased state")

    print("VLC Android compatibility patch verification passed")


if __name__ == "__main__":
    main()
