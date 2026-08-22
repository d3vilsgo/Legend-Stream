#!/usr/bin/env python3
"""Expose reliable VLC stream resolution/FPS on the existing progress event.

LegendStream already receives VLC progress events about every 250 ms. This patch
adds optional stream metadata to that existing payload without touching playback,
scaling, decoder selection, PiP, or TextureView layout.

Some Android/VLC combinations report the TextureView/window dimensions through
onNewVideoLayout. Those are NOT the source-video resolution. We therefore reject
layout values that match the device screen (including swapped orientation), use
real video-track dimensions when available, and only use non-screen-like layout
dimensions as a fallback. If no trustworthy resolution exists, no resolution is
emitted rather than showing a false phone-screen value.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import NoReturn

MARKER = "LegendStream progress runtime metrics v3"


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
        print("VLC progress runtime metrics v3 patch already present")
        return

    fields_anchor = "    private WritableMap mVideoInfo = null;\n"
    if fields_anchor not in java_text:
        fail("Could not locate VLC metadata field anchor")
    java_text = java_text.replace(
        fields_anchor,
        fields_anchor
        + "    // LegendStream progress runtime metrics v3 FPS fallback cache.\n"
        + "    private long legendStreamLastFallbackFpsProbeAt = 0L;\n"
        + "    private double legendStreamCachedFallbackFps = 0d;\n",
        1,
    )

    helper_anchor = "    private void setProgressUpdateRunnable() {\n"
    if helper_anchor not in java_text:
        fail("Could not locate VLC progress runnable helper anchor")

    helper = r'''    // LegendStream progress runtime metrics v3.
    private Number legendStreamReadTrackNumber(Object track, String fieldName) {
        if (track == null) return null;
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

    private Object legendStreamGetCurrentVideoTrackSafely() {
        if (mMediaPlayer == null) return null;
        try {
            return mMediaPlayer.getClass().getMethod("getCurrentVideoTrack").invoke(mMediaPlayer);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private boolean legendStreamLooksLikeScreenSize(int width, int height) {
        if (width <= 0 || height <= 0 || screenWidth <= 0 || screenHeight <= 0) return false;
        final int tolerance = 8;
        final boolean same = Math.abs(width - screenWidth) <= tolerance
                && Math.abs(height - screenHeight) <= tolerance;
        final boolean swapped = Math.abs(width - screenHeight) <= tolerance
                && Math.abs(height - screenWidth) <= tolerance;
        return same || swapped;
    }

    private double legendStreamReadTrackFps(Object track) {
        Number numerator = legendStreamReadTrackNumber(track, "frameRateNum");
        Number denominator = legendStreamReadTrackNumber(track, "frameRateDen");
        if (numerator == null || denominator == null || denominator.doubleValue() <= 0d) return 0d;
        final double fps = numerator.doubleValue() / denominator.doubleValue();
        return !Double.isNaN(fps) && !Double.isInfinite(fps) && fps > 0d ? fps : 0d;
    }

    private double legendStreamProbeMediaTrackFps() {
        final long now = android.os.SystemClock.uptimeMillis();
        if (now - legendStreamLastFallbackFpsProbeAt < 1500L) {
            return legendStreamCachedFallbackFps;
        }
        legendStreamLastFallbackFpsProbeAt = now;

        try {
            Object media = mMediaPlayer.getClass().getMethod("getMedia").invoke(mMediaPlayer);
            if (media == null) return legendStreamCachedFallbackFps;
            Number countValue = (Number) media.getClass().getMethod("getTrackCount").invoke(media);
            final int count = countValue == null ? 0 : countValue.intValue();
            java.lang.reflect.Method getTrack = media.getClass().getMethod("getTrack", int.class);
            for (int i = 0; i < count; i++) {
                Object candidate = getTrack.invoke(media, i);
                double fps = legendStreamReadTrackFps(candidate);
                if (fps > 0d) {
                    legendStreamCachedFallbackFps = fps;
                    return fps;
                }
            }
        } catch (Throwable ignored) {
            // FPS is optional metadata; playback must never depend on it.
        }
        return legendStreamCachedFallbackFps;
    }

    private void legendStreamPutVideoSize(WritableMap map, int width, int height) {
        if (map == null || width <= 0 || height <= 0) return;
        WritableMap videoSize = Arguments.createMap();
        videoSize.putInt("width", width);
        videoSize.putInt("height", height);
        map.putMap("videoSize", videoSize);
        map.putInt("videoWidth", width);
        map.putInt("videoHeight", height);
    }

    private void legendStreamAppendProgressMetrics(WritableMap map) {
        if (map == null || mMediaPlayer == null) return;

        Object track = legendStreamGetCurrentVideoTrackSafely();
        int width = 0;
        int height = 0;

        // Prefer actual LibVLC video-track dimensions when they exist.
        if (track != null) {
            Number widthValue = legendStreamReadTrackNumber(track, "width");
            Number heightValue = legendStreamReadTrackNumber(track, "height");
            int trackWidth = widthValue == null ? 0 : widthValue.intValue();
            int trackHeight = heightValue == null ? 0 : heightValue.intValue();
            if (trackWidth > 0 && trackHeight > 0
                    && !legendStreamLooksLikeScreenSize(trackWidth, trackHeight)) {
                width = trackWidth;
                height = trackHeight;
            }
        }

        // Some live streams do not expose getCurrentVideoTrack(). In that case
        // use VLC layout dimensions only when they are not just the phone view.
        if (width <= 0 || height <= 0) {
            int visibleWidth = mVideoVisibleWidth > 0 ? mVideoVisibleWidth : 0;
            int visibleHeight = mVideoVisibleHeight > 0 ? mVideoVisibleHeight : 0;
            if (visibleWidth > 0 && visibleHeight > 0
                    && !legendStreamLooksLikeScreenSize(visibleWidth, visibleHeight)) {
                width = visibleWidth;
                height = visibleHeight;
            }
        }

        if ((width <= 0 || height <= 0)
                && mVideoWidth > 0 && mVideoHeight > 0
                && !legendStreamLooksLikeScreenSize(mVideoWidth, mVideoHeight)) {
            width = mVideoWidth;
            height = mVideoHeight;
        }

        legendStreamPutVideoSize(map, width, height);

        double fps = legendStreamReadTrackFps(track);
        if (fps <= 0d) fps = legendStreamProbeMediaTrackFps();
        if (fps > 0d) {
            map.putDouble("frameRate", fps);
            map.putDouble("fps", fps);
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
        fail("VLC progress runtime metrics v3 marker missing after patch")
    if "legendStreamLooksLikeScreenSize" not in verify:
        fail("VLC viewport rejection helper is missing after patch")
    if "legendStreamAppendProgressMetrics(map);" not in verify:
        fail("VLC progress runtime metrics hook missing after patch")
    if 'legendStreamReadTrackNumber(track, "frameRateNum")' not in verify:
        fail("VLC frame-rate metric reader missing after patch")

    print("Applied VLC stream resolution/FPS progress metrics bridge v3")


if __name__ == "__main__":
    main()
