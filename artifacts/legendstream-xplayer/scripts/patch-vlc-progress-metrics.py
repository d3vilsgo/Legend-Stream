#!/usr/bin/env python3
"""Expose VLC coded resolution/FPS on the existing progress event.

LegendStream already subscribes to VLCPlayer.onProgress. The React wrapper maps
that callback to Android's EVENT_PROGRESS every 250 ms, making it a more reliable
runtime metadata route for live MPEG-TS/HLS streams than one-shot load/layout
callbacks. This patch only appends metadata to the existing progress payload.
It does not change playback, scaling, decoder, PiP, or TextureView behavior.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import NoReturn

MARKER = "LegendStream progress runtime metrics"


def fail(message: str) -> NoReturn:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


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
    if not player_view.is_file():
        fail(f"VLC player view not found: {player_view}")

    java_text = player_view.read_text(encoding="utf-8")
    if MARKER in java_text:
        print("VLC progress runtime metrics patch already present")
        return

    helper_anchor = "    private void setProgressUpdateRunnable() {\n"
    if helper_anchor not in java_text:
        fail("Could not locate VLC progress runnable helper anchor")

    helper = r'''    // LegendStream progress runtime metrics: append the coded video track
    // size and frame rate to the progress event that already reaches JS every
    // 250 ms. Reflection keeps this compatible with minor LibVLC API changes.
    private Number legendStreamReadTrackNumber(Object track, String fieldName) {
        if (track == null) {
            return null;
        }
        try {
            return (Number) track.getClass().getField(fieldName).get(track);
        } catch (Throwable ignored) {
            try {
                java.lang.reflect.Field field = track.getClass().getDeclaredField(fieldName);
                field.setAccessible(true);
                return (Number) field.get(track);
            } catch (Throwable ignoredAgain) {
                return null;
            }
        }
    }

    private void legendStreamAppendProgressMetrics(WritableMap map) {
        if (map == null || mMediaPlayer == null) {
            return;
        }
        try {
            Object track = mMediaPlayer.getClass()
                    .getMethod("getCurrentVideoTrack")
                    .invoke(mMediaPlayer);
            if (track == null) {
                return;
            }

            Number widthValue = legendStreamReadTrackNumber(track, "width");
            Number heightValue = legendStreamReadTrackNumber(track, "height");
            final int width = widthValue == null ? 0 : widthValue.intValue();
            final int height = heightValue == null ? 0 : heightValue.intValue();
            if (width > 0 && height > 0) {
                WritableMap videoSize = Arguments.createMap();
                videoSize.putInt("width", width);
                videoSize.putInt("height", height);
                map.putMap("videoSize", videoSize);
                map.putInt("videoWidth", width);
                map.putInt("videoHeight", height);
            }

            Number numerator = legendStreamReadTrackNumber(track, "frameRateNum");
            Number denominator = legendStreamReadTrackNumber(track, "frameRateDen");
            if (numerator != null && denominator != null && denominator.doubleValue() > 0d) {
                final double fps = numerator.doubleValue() / denominator.doubleValue();
                if (!Double.isNaN(fps) && !Double.isInfinite(fps) && fps > 0d) {
                    map.putDouble("frameRate", fps);
                    map.putDouble("fps", fps);
                }
            }
        } catch (Throwable ignored) {
            // Metadata is optional; playback must never fail because metrics are unavailable.
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
    verify = player_view.read_text(encoding="utf-8")
    if MARKER not in verify:
        fail("VLC progress runtime metrics marker missing after patch")
    if "legendStreamAppendProgressMetrics(map);" not in verify:
        fail("VLC progress runtime metrics hook missing after patch")
    if 'legendStreamReadTrackNumber(track, "width")' not in verify:
        fail("VLC coded-width metric reader missing after patch")
    if 'legendStreamReadTrackNumber(track, "frameRateNum")' not in verify:
        fail("VLC frame-rate metric reader missing after patch")

    print("Applied VLC progress resolution/FPS metrics bridge")


if __name__ == "__main__":
    main()
