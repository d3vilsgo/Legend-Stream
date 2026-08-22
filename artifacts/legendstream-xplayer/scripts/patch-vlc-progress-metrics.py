#!/usr/bin/env python3
"""Expose coded VLC resolution/FPS on the existing progress event.

The previous live-metrics bridge could fall back to onNewVideoLayout dimensions.
On some phones those dimensions describe the output surface (for example
1220x2712) rather than the broadcast stream, which also broke ORIG aspect mode.

LibVLC 3.6.3 exposes the selected video elementary stream directly through
MediaPlayer.getSelectedTrack(IMedia.Track.Type.Video). This patch reads that
track on the already-existing progress tick and appends width/height/FPS to the
same JS event. No playback, decoder, PiP, TextureView or scaling code is changed.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import NoReturn

MARKER = "LegendStream selected-track progress metrics"


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
        print("VLC selected-track runtime metrics patch already present")
        return

    import_anchor = "import org.videolan.libvlc.interfaces.IVLCVout;\n"
    if import_anchor not in java_text:
        fail("Could not locate VLC IVLCVout import")
    if "import org.videolan.libvlc.interfaces.IMedia;" not in java_text:
        java_text = java_text.replace(
            import_anchor,
            import_anchor + "import org.videolan.libvlc.interfaces.IMedia;\n",
            1,
        )

    helper_anchor = "    private void setProgressUpdateRunnable() {\n"
    if helper_anchor not in java_text:
        fail("Could not locate VLC progress runnable helper anchor")

    helper = r'''    // LegendStream selected-track progress metrics.
    // Query the actual selected video elementary stream. Never use TextureView
    // or output-layout dimensions as source resolution.
    private void legendStreamAppendProgressMetrics(WritableMap map) {
        if (map == null || mMediaPlayer == null || isReleased) {
            return;
        }
        try {
            final IMedia.Track selected = mMediaPlayer.getSelectedTrack(IMedia.Track.Type.Video);
            if (!(selected instanceof IMedia.VideoTrack)) {
                return;
            }

            final IMedia.VideoTrack videoTrack = (IMedia.VideoTrack) selected;
            final int width = videoTrack.width;
            final int height = videoTrack.height;
            if (width > 0 && height > 0) {
                WritableMap videoSize = Arguments.createMap();
                videoSize.putInt("width", width);
                videoSize.putInt("height", height);
                map.putMap("videoSize", videoSize);
                map.putInt("videoWidth", width);
                map.putInt("videoHeight", height);
            }

            final int numerator = videoTrack.frameRateNum;
            final int denominator = videoTrack.frameRateDen;
            if (numerator > 0 && denominator > 0) {
                final double fps = ((double) numerator) / ((double) denominator);
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
    verify = player_view.read_text(encoding="utf-8")
    if MARKER not in verify:
        fail("VLC selected-track metrics marker missing after patch")
    if "getSelectedTrack(IMedia.Track.Type.Video)" not in verify:
        fail("VLC selected video-track lookup missing after patch")
    if "videoTrack.frameRateNum" not in verify or "videoTrack.frameRateDen" not in verify:
        fail("VLC frame-rate fields missing after patch")
    if "legendStreamAppendProgressMetrics(map);" not in verify:
        fail("VLC progress metrics hook missing after patch")

    print("Applied VLC selected-track resolution/FPS progress bridge")


if __name__ == "__main__":
    main()
