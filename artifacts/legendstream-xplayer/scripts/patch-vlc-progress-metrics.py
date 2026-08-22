#!/usr/bin/env python3
"""Expose VLC resolution/FPS on the existing progress event.

The VLC view already knows the rendered video's visible width/height through
onNewVideoLayout. Those fields are more reliable for live MPEG-TS/HLS streams
than querying the current track alone, and they avoid reporting the phone's
viewport as the stream resolution.

This patch only enriches the existing progress event. It does not modify
playback, scaling, decoder, PiP, or TextureView layout behavior.
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

    helper = r'''    // LegendStream progress runtime metrics: prefer VLC's visible video
    // dimensions captured by onNewVideoLayout. Fall back to current video-track
    // metadata and use the track for FPS when available.
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

        int width = mVideoVisibleWidth > 0 ? mVideoVisibleWidth : mVideoWidth;
        int height = mVideoVisibleHeight > 0 ? mVideoVisibleHeight : mVideoHeight;

        Object track = null;
        try {
            track = mMediaPlayer.getClass()
                    .getMethod("getCurrentVideoTrack")
                    .invoke(mMediaPlayer);
        } catch (Throwable ignored) {
            // Layout dimensions can still provide the resolution.
        }

        if ((width <= 0 || height <= 0) && track != null) {
            Number widthValue = legendStreamReadTrackNumber(track, "width");
            Number heightValue = legendStreamReadTrackNumber(track, "height");
            width = widthValue == null ? 0 : widthValue.intValue();
            height = heightValue == null ? 0 : heightValue.intValue();
        }

        if (width > 0 && height > 0) {
            WritableMap videoSize = Arguments.createMap();
            videoSize.putInt("width", width);
            videoSize.putInt("height", height);
            map.putMap("videoSize", videoSize);
            map.putInt("videoWidth", width);
            map.putInt("videoHeight", height);
        }

        if (track != null) {
            Number numerator = legendStreamReadTrackNumber(track, "frameRateNum");
            Number denominator = legendStreamReadTrackNumber(track, "frameRateDen");
            if (numerator != null && denominator != null && denominator.doubleValue() > 0d) {
                final double fps = numerator.doubleValue() / denominator.doubleValue();
                if (!Double.isNaN(fps) && !Double.isInfinite(fps) && fps > 0d) {
                    map.putDouble("frameRate", fps);
                    map.putDouble("fps", fps);
                }
            }
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
    if "mVideoVisibleWidth" not in verify or "mVideoVisibleHeight" not in verify:
        fail("VLC visible-size metric fallback missing after patch")
    if 'legendStreamReadTrackNumber(track, "frameRateNum")' not in verify:
        fail("VLC frame-rate metric reader missing after patch")

    print("Applied VLC visible-resolution/FPS progress bridge")


if __name__ == "__main__":
    main()
