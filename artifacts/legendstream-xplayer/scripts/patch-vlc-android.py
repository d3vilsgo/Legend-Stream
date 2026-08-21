#!/usr/bin/env python3
"""Targeted react-native-vlc-media-player patch for LegendStream Android builds.

Keep upstream VLC playback behavior intact except for two compatibility fixes:
1. lower the library minSdk from API 26 to API 24 (Android 7+ support), and
2. keep playback running when Android pauses the host Activity to enter PiP.

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

    if guard_marker not in java_text:
        host_pause = re.search(
            r"public\s+void\s+onHostPause\s*\(\s*\)\s*\{",
            java_text,
        )
        if not host_pause:
            fail("Could not locate VLC onHostPause() for the PiP lifecycle patch")

        guard = """
        // LegendStream PiP lifecycle guard: entering PiP pauses the Activity,
        // but must not pause the media player itself.
        final android.app.Activity legendStreamActivity = themedReactContext.getCurrentActivity();
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
                && legendStreamActivity != null
                && legendStreamActivity.isInPictureInPictureMode()) {
            return;
        }
"""
        insert_at = host_pause.end()
        java_text = java_text[:insert_at] + guard + java_text[insert_at:]
        player_view.write_text(java_text, encoding="utf-8")
        print("Applied VLC PiP lifecycle guard")
    else:
        print("VLC PiP lifecycle guard already present")

    gradle_verify = gradle.read_text(encoding="utf-8")
    java_verify = player_view.read_text(encoding="utf-8")

    if re.search(r"minSdkVersion\s+26\b", gradle_verify):
        fail("VLC minSdk 26 is still present after patch")
    if guard_marker not in java_verify:
        fail("VLC PiP lifecycle guard is missing after patch")
    if "isInPictureInPictureMode()" not in java_verify:
        fail("VLC PiP lifecycle check is missing after patch")

    print("VLC Android compatibility patch verification passed")


if __name__ == "__main__":
    main()
