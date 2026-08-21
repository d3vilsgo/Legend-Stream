#!/usr/bin/env python3
"""Minimal react-native-vlc-media-player patch for LegendStream Android builds.

Diagnostic baseline: preserve upstream VLC runtime behavior exactly and only
lower the library minSdk from API 26 to API 24 so Android 7+ remains supported.
No lifecycle, decoder, option-loop, scaling, or playback code is modified here.
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

    if not gradle.is_file():
        fail(f"VLC Gradle file not found: {gradle}")

    print(f"VLC package: {package_dir}")
    text = gradle.read_text(encoding="utf-8")
    text, changes = re.subn(r"minSdkVersion\s+26\b", "minSdkVersion 24", text)
    gradle.write_text(text, encoding="utf-8")
    print(f"Android 7 minSdk replacements: {changes}")

    verify = gradle.read_text(encoding="utf-8")
    if re.search(r"minSdkVersion\s+26\b", verify):
        fail("VLC minSdk 26 is still present after patch")

    print("Minimal VLC Android patch verification passed")


if __name__ == "__main__":
    main()
