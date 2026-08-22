#!/usr/bin/env python3
"""Targeted react-native-vlc-media-player patch for LegendStream Android builds.

Keep upstream VLC playback behavior intact except for three compatibility fixes:
1. lower the library minSdk from API 26 to API 24 (Android 7+ support),
2. keep playback running while Android is actually in PiP, and
3. pause playback when the PiP window is dismissed to the launcher/background.

No decoder, option-loop, scaling, or media bootstrap code is modified here.
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
            + "    private long legendStreamPipExitDetectedAt = 0L;\n",
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
                if (!legendStreamHostResumed && !isPaused && mMediaPlayer != null) {
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
"""
        java_text = java_text.replace(pause_marker, pause_replacement, 1)

        release_marker = "    private void releasePlayer() {\n"
        if release_marker not in java_text:
            fail("Could not locate VLC releasePlayer() for PiP monitor cleanup")
        release_replacement = """    private void releasePlayer() {
        legendStreamPipExitDetectedAt = 0L;
        if (legendStreamPipExitMonitor != null) {
            mProgressUpdateHandler.removeCallbacks(legendStreamPipExitMonitor);
            legendStreamPipExitMonitor = null;
        }
"""
        java_text = java_text.replace(release_marker, release_replacement, 1)

        player_view.write_text(java_text, encoding="utf-8")
        print("Applied VLC PiP lifecycle guard, return grace and dismiss monitor")
    else:
        print("VLC PiP lifecycle patch already present")

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
    if "isInPictureInPictureMode()" not in java_verify:
        fail("VLC PiP lifecycle check is missing after patch")
    if "startLegendStreamPipExitMonitor()" not in java_verify:
        fail("VLC PiP dismiss monitor hook is missing after patch")
    if "isReleased" in java_verify:
        fail("VLC 1.0.98 PiP patch must not reference non-existent isReleased state")

    print("VLC Android compatibility patch verification passed")


if __name__ == "__main__":
    main()
