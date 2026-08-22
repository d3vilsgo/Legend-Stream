#!/usr/bin/env python3
"""Expose reliable VLC visible resolution/FPS on the existing progress event.

LegendStream already subscribes to VLCPlayer.onProgress. The React wrapper maps
that callback to Android EVENT_PROGRESS roughly every 250 ms, making it the most
reliable runtime metadata route for live MPEG-TS/HLS streams.

Resolution is taken from IVLCVout's visible video size first. This is important
because decoders can expose a coded H.264 frame such as 1920x1088 while the real
visible picture is 1920x1080. If VLC has not published a layout yet we fall back
to the current video track dimensions. FPS remains optional and comes from the
current LibVLC video track when available.

This patch only appends metadata to an event that already exists. It does not
change playback, scaling, decoder selection, PiP, or TextureView layout.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import NoReturn

MARKER = "LegendStream progress runtime metrics v2"
OLD_MARKER = "LegendStream progress runtime metrics"


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
        print("VLC progress runtime metrics v2 patch already present")
        return

    # The build starts from a fresh npm install, but supporting replacement of
    # the first LegendStream version makes the patch deterministic/idempotent.
    if OLD_MARKER in java_text:
        helper_start = java_text.find("    // LegendStream progress runtime metrics:")
        helper_end = java_text.find("    private void setProgressUpdateRunnable() {", helper_start)
        if helper_start < 0 or helper_end < 0:
            fail("Could not locate old LegendStream progress metrics helper block")
        java_text = java_text[:helper_start] + java_text[helper_end:]
        java_text = java_text.replace(
            "                                legendStreamAppendProgressMetrics(map);\n",
            "",
            1,
        )

    fields_anchor = "    private WritableMap mVideoInfo = null;\n"
    if fields_anchor not in java_text:
        fail("Could not locate VLC metadata field anchor for FPS cache")
    java_text = java_text.replace(
        fields_anchor,
        fields_anchor
        + "    // LegendStream progress runtime metrics v2 fallback cache.\n"
        + "    private long legendStreamLastFallbackFpsProbeAt = 0L;\n"
        + "    private double legendStreamCachedFallbackFps = 0d;\n",
        1,
    )

    helper_anchor = "    private void setProgressUpdateRunnable() {\n"
    if helper_anchor not in java_text:
        fail("Could not locate VLC progress runnable helper anchor")

    helper = r'''    // LegendStream progress runtime metrics v2: prefer the visible video
    // dimensions reported by IVLCVout. Coded H.264 frames can be 1920x1088 even
    // when the real visible picture is 1920x1080. Track dimensions are fallback.
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

    private Object legendStreamGetCurrentVideoTrackSafely() {
        if (mMediaPlayer == null) {
            return null;
        }
        try {
            return mMediaPlayer.getClass()
                    .getMethod("getCurrentVideoTrack")
                    .invoke(mMediaPlayer);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private double legendStreamReadTrackFps(Object track) {
        Number numerator = legendStreamReadTrackNumber(track, "frameRateNum");
        Number denominator = legendStreamReadTrackNumber(track, "frameRateDen");
        if (numerator == null || denominator == null || denominator.doubleValue() <= 0d) {
            return 0d;
        }
        final double fps = numerator.doubleValue() / denominator.doubleValue();
        return !Double.isNaN(fps) && !Double.isInfinite(fps) && fps > 0d ? fps : 0d;
    }

    private double legendStreamProbeMediaTrackFps() {
        final long now = android.os.SystemClock.uptimeMillis();
        if (now - legendStreamLastFallbackFpsProbeAt < 1500L) {
            return legendStreamCachedFallbackFps;
        }
        legendStreamLastFallbackFpsProbeAt = now;

        Object media = null;
        try {
            media = mMediaPlayer.getClass().getMethod("getMedia").invoke(mMediaPlayer);
            if (media == null) {
                return legendStreamCachedFallbackFps;
            }
            Number countValue = (Number) media.getClass().getMethod("getTrackCount").invoke(media);
            final int count = countValue == null ? 0 : countValue.intValue();
            java.lang.reflect.Method getTrack = media.getClass().getMethod("getTrack", int.class);
            for (int i = 0; i < count; i++) {
                Object candidate = getTrack.invoke(media, i);
                if (candidate == null) {
                    continue;
                }
                double fps = legendStreamReadTrackFps(candidate);
                if (fps > 0d) {
                    legendStreamCachedFallbackFps = fps;
                    return fps;
                }
            }
        } catch (Throwable ignored) {
            // Optional metadata path only.
        } finally {
            if (media != null) {
                try { media.getClass().getMethod("release").invoke(media); } catch (Throwable ignored) {}
            }
        }
        return legendStreamCachedFallbackFps;
    }

    private void legendStreamPutVideoSize(WritableMap map, int width, int height) {
        if (map == null || width <= 0 || height <= 0) {
            return;
        }
        WritableMap videoSize = Arguments.createMap();
        videoSize.putInt("width", width);
        videoSize.putInt("height", height);
        map.putMap("videoSize", videoSize);
        map.putInt("videoWidth", width);
        map.putInt("videoHeight", height);
        map.putInt("videoVisibleWidth", width);
        map.putInt("videoVisibleHeight", height);
    }

    private void legendStreamAppendProgressMetrics(WritableMap map) {
        if (map == null || mMediaPlayer == null) {
            return;
        }

        // This path works even on streams where getCurrentVideoTrack() is null.
        // onNewVideoLayout updates these fields as soon as a picture is visible.
        int width = mVideoVisibleWidth > 0 ? mVideoVisibleWidth : mVideoWidth;
        int height = mVideoVisibleHeight > 0 ? mVideoVisibleHeight : mVideoHeight;

        Object track = legendStreamGetCurrentVideoTrackSafely();
        if ((width <= 0 || height <= 0) && track != null) {
            Number widthValue = legendStreamReadTrackNumber(track, "width");
            Number heightValue = legendStreamReadTrackNumber(track, "height");
            width = widthValue == null ? 0 : widthValue.intValue();
            height = heightValue == null ? 0 : heightValue.intValue();
        }

        legendStreamPutVideoSize(map, width, height);

        double fps = legendStreamReadTrackFps(track);
        if (fps <= 0d) {
            fps = legendStreamProbeMediaTrackFps();
        }
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
        fail("VLC progress runtime metrics v2 marker missing after patch")
    if "mVideoVisibleWidth > 0 ? mVideoVisibleWidth : mVideoWidth" not in verify:
        fail("VLC visible-width fallback is missing after patch")
    if "legendStreamAppendProgressMetrics(map);" not in verify:
        fail("VLC progress runtime metrics hook missing after patch")
    if 'legendStreamReadTrackNumber(track, "frameRateNum")' not in verify:
        fail("VLC frame-rate metric reader missing after patch")
    if "legendStreamProbeMediaTrackFps()" not in verify:
        fail("VLC fallback FPS probe missing after patch")

    print("Applied VLC visible-resolution/FPS progress metrics bridge v2")


if __name__ == "__main__":
    main()
