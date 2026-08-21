#!/usr/bin/env python3
"""Patch react-native-vlc-media-player 1.0.98 for LegendStream Android builds.

Keeps Android 7 (API 24) compatibility, fixes the upstream option-loop off-by-one,
and guards VLC's host-pause callback while the Activity is in Picture-in-Picture.
The script is intentionally version-controlled so CI does not contain fragile
multi-line Python embedded in YAML.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


def fail(message: str) -> "NoReturn":
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: patch-vlc-android.py <react-native-vlc-media-player-dir>")

    package_dir = Path(sys.argv[1]).resolve()
    gradle = package_dir / "android" / "build.gradle"
    view = (
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
    if not view.is_file():
        fail(f"VLC player view not found: {view}")

    print(f"VLC package: {package_dir}")

    gradle_text = gradle.read_text(encoding="utf-8")
    gradle_text, min_sdk_changes = re.subn(
        r"minSdkVersion\s+26\b", "minSdkVersion 24", gradle_text
    )
    gradle.write_text(gradle_text, encoding="utf-8")
    print(f"Android 7 minSdk patch replacements: {min_sdk_changes}")

    text = view.read_text(encoding="utf-8")
    legacy_loop = "for (int i = 0; i < options.size() - 1; i++)"
    fixed_loop = "for (int i = 0; i < options.size(); i++)"
    loop_changes = text.count(legacy_loop)
    text = text.replace(legacy_loop, fixed_loop)
    print(f"VLC option-loop replacements: {loop_changes}")

    host_pause = re.search(
        r"public\s+void\s+onHostPause\s*\(\s*\)\s*\{", text
    )
    if host_pause and "isInPictureInPictureMode()" not in text:
        guard = """public void onHostPause() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
                && themedReactContext.getCurrentActivity() != null
                && themedReactContext.getCurrentActivity().isInPictureInPictureMode()) {
            return;
        }"""
        text = text[: host_pause.start()] + guard + text[host_pause.end() :]
        print("Applied VLC PiP lifecycle guard")
    elif host_pause:
        print("VLC PiP lifecycle guard already present")
    else:
        # Some package layouts omit LifecycleEventListener entirely. That is not
        # a patch failure; there is no onHostPause callback capable of pausing PiP.
        print("VLC package has no onHostPause(); lifecycle PiP guard not required")

    view.write_text(text, encoding="utf-8")

    verify_gradle = gradle.read_text(encoding="utf-8")
    verify_view = view.read_text(encoding="utf-8")
    if re.search(r"minSdkVersion\s+26\b", verify_gradle):
        fail("VLC minSdk 26 is still present after patch")
    if legacy_loop in verify_view:
        fail("VLC option-loop off-by-one is still present after patch")
    if re.search(r"onHostPause\s*\(", verify_view) and "isInPictureInPictureMode()" not in verify_view:
        fail("VLC onHostPause exists but PiP lifecycle guard is missing")

    print("VLC Android patch verification passed")


if __name__ == "__main__":
    main()
