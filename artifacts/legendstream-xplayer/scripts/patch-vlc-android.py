#!/usr/bin/env python3
"""Minimal react-native-vlc-media-player patch for LegendStream Android builds.

Keeps upstream VLC runtime behavior intact while applying only two targeted
compatibility changes:
- lower the library minSdk from API 26 to API 24 for Android 7+ support;
- do not pause VLC when the host Activity is already in Android PiP mode.

No decoder, option-loop, scaling, or playback bootstrap code is modified.
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
    gradle_text, changes = re.subn(
        r"minSdkVersion\s+26\b", "minSdkVersion 24", gradle_text
    )
    gradle.write_text(gradle_text, encoding="utf-8")
    print(f"Android 7 minSdk replacements: {changes}")

    view_text = view.read_text(encoding="utf-8")
    marker = "public void onHostPause() {"
    pip_guard = """public void onHostPause() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
                && themedReactContext.getCurrentActivity() != null
                && themedReactContext.getCurrentActivity().isInPictureInPictureMode()) {
            return;
        }"""

    if "isInPictureInPictureMode()" in view_text:
        print("VLC PiP lifecycle guard already present")
    elif marker in view_text:
        view_text = view_text.replace(marker, pip_guard, 1)
        view.write_text(view_text, encoding="utf-8")
        print("Applied VLC PiP lifecycle guard")
    else:
        fail("Could not locate VLC onHostPause() for PiP guard")

    verify_gradle = gradle.read_text(encoding="utf-8")
    verify_view = view.read_text(encoding="utf-8")
    if re.search(r"minSdkVersion\s+26\b", verify_gradle):
        fail("VLC minSdk 26 is still present after patch")
    if "isInPictureInPictureMode()" not in verify_view:
        fail("VLC PiP lifecycle guard is missing after patch")

    print("Minimal VLC Android compatibility patch verification passed")


if __name__ == "__main__":
    main()
