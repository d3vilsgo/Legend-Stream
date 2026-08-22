#!/usr/bin/env python3
"""Expose coded VLC resolution/FPS on the existing progress event.

This patch intentionally avoids compile-time calls into optional LibVLC track APIs.
react-native-vlc-media-player@1.0.98 currently depends on
org.videolan.android:libvlc-all:3.6.3, but selected-track helper signatures vary
across LibVLC lines. Reflection keeps runtime metrics best-effort and ensures a
missing/changed API can never break the Android release build.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import NoReturn

MARKER = "LegendStream selected-track progress metrics"
HELPER_NAME = "legendStreamAppendProgressMetrics"


def fail(message: str) -> NoReturn:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def verify(java_text: str) -> None:
    if MARKER not in java_text:
        fail("VLC selected-track metrics marker missing after patch")
    if f"{HELPER_NAME}(map);" not in java_text:
        fail("VLC progress metrics hook missing after patch")
    if "legendStreamPlayerReleased" not in java_text:
        fail("VLC release-state guard required by metrics bridge is missing")
    if "Class.forName(\"org.videolan.libvlc.interfaces.IMedia$Track$Type\")" not in java_text:
        fail("VLC reflective selected-track lookup missing after patch")
    if "getCurrentVideoTrack" not in java_text:
        fail("VLC reflective current-video-track fallback missing after patch")
    if "frameRateNum" not in java_text or "frameRateDen" not in java_text:
        fail("VLC reflective frame-rate lookup missing after patch")

    # These were the two compile-breaking references in the previous bridge.
    if re.search(r"\bisReleased\b", java_text):
        fail("Unsafe undefined isReleased reference remains in ReactVlcPlayerView.java")
    if re.search(r"mMediaPlayer\.getSelectedTrack\s*\(", java_text):
        fail("Compile-time getSelectedTrack call remains in ReactVlcPlayerView.java")

    print("Validated VLC progress patch marker and compile-safe reflective API bridge")


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: patch-vlc-progress-metrics.py <react-native-vlc-media-player-dir>")

    package_dir = Path(sys.argv[1]).resolve()
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
    gradle = package_dir / "android" / "build.gradle"

    if not player_view.is_file():
        fail(f"VLC player view not found: {player_view}")
    if not gradle.is_file():
        fail(f"VLC Gradle file not found: {gradle}")

    gradle_text = gradle.read_text(encoding="utf-8")
    libvlc_match = re.search(
        r"org\.videolan\.android:libvlc-all:([^'\"\s]+)",
        gradle_text,
    )
    if not libvlc_match:
        fail("Could not verify react-native-vlc-media-player LibVLC dependency")
    print(f"Verified LibVLC dependency: org.videolan.android:libvlc-all:{libvlc_match.group(1)}")

    java_text = player_view.read_text(encoding="utf-8")

    # Idempotent fast-path. If an already-patched file contains the old unsafe
    # bridge, do not accept it; fail loudly so a stale node_modules patch cannot
    # sneak into release builds.
    if MARKER in java_text:
        verify(java_text)
        print("VLC selected-track runtime metrics patch already present")
        return

    helper_anchor = "    private void setProgressUpdateRunnable() {\n"
    if helper_anchor not in java_text:
        fail("Could not locate VLC progress runnable helper anchor")

    helper = r'''    // LegendStream selected-track progress metrics.
    // Query coded resolution/FPS without compiling against an optional LibVLC
    // selected-track API. Missing methods/fields simply disable the metadata.
    private Object legendStreamGetSelectedVideoTrackReflectively() {
        if (legendStreamPlayerReleased || mMediaPlayer == null) {
            return null;
        }
        try {
            final Class<?> trackTypeClass = Class.forName("org.videolan.libvlc.interfaces.IMedia$Track$Type");
            @SuppressWarnings({"rawtypes", "unchecked"})
            final Object videoType = Enum.valueOf((Class<? extends Enum>) trackTypeClass.asSubclass(Enum.class), "Video");
            return mMediaPlayer.getClass()
                    .getMethod("getSelectedTrack", trackTypeClass)
                    .invoke(mMediaPlayer, videoType);
        } catch (Throwable ignored) {
            try {
                return mMediaPlayer.getClass()
                        .getMethod("getCurrentVideoTrack")
                        .invoke(mMediaPlayer);
            } catch (Throwable ignoredFallback) {
                return null;
            }
        }
    }

    private Number legendStreamReadTrackNumber(Object track, String fieldName) {
        if (track == null) {
            return null;
        }
        try {
            Object value = track.getClass().getField(fieldName).get(track);
            return value instanceof Number ? (Number) value : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private void legendStreamAppendProgressMetrics(WritableMap map) {
        if (map == null || legendStreamPlayerReleased || mMediaPlayer == null) {
            return;
        }
        try {
            final Object videoTrack = legendStreamGetSelectedVideoTrackReflectively();
            if (videoTrack == null) {
                return;
            }

            final Number widthValue = legendStreamReadTrackNumber(videoTrack, "width");
            final Number heightValue = legendStreamReadTrackNumber(videoTrack, "height");
            final int width = widthValue != null ? widthValue.intValue() : 0;
            final int height = heightValue != null ? heightValue.intValue() : 0;
            if (width > 0 && height > 0) {
                WritableMap videoSize = Arguments.createMap();
                videoSize.putInt("width", width);
                videoSize.putInt("height", height);
                map.putMap("videoSize", videoSize);
                map.putInt("videoWidth", width);
                map.putInt("videoHeight", height);
            }

            final Number numeratorValue = legendStreamReadTrackNumber(videoTrack, "frameRateNum");
            final Number denominatorValue = legendStreamReadTrackNumber(videoTrack, "frameRateDen");
            final double numerator = numeratorValue != null ? numeratorValue.doubleValue() : 0d;
            final double denominator = denominatorValue != null ? denominatorValue.doubleValue() : 0d;
            if (numerator > 0d && denominator > 0d) {
                final double fps = numerator / denominator;
                if (!Double.isNaN(fps) && !Double.isInfinite(fps) && fps > 0d) {
                    map.putDouble("frameRate", fps);
                    map.putDouble("fps", fps);
                }
            }
        } catch (Throwable ignored) {
            // Runtime metadata is optional and must never affect playback.
        }
    }

'''
    java_text = java_text.replace(helper_anchor, helper + helper_anchor, 1)

    progress_anchor = (
        "                                updateVideoInfo();\n"
        "                                eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_PROGRESS);"
    )
    if progress_anchor not in java_text:
        fail("Could not locate VLC progress event emission")

    java_text = java_text.replace(
        progress_anchor,
        "                                updateVideoInfo();\n"
        "                                legendStreamAppendProgressMetrics(map);\n"
        "                                eventEmitter.sendEvent(map, VideoEventEmitter.EVENT_PROGRESS);",
        1,
    )

    player_view.write_text(java_text, encoding="utf-8")
    verify(player_view.read_text(encoding="utf-8"))
    print("Applied VLC selected-track resolution/FPS progress bridge")


if __name__ == "__main__":
    main()
