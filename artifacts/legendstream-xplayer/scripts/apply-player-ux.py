#!/usr/bin/env python3
"""Idempotent source patcher for the adaptive player UX branch.

This helper exists so the branch can apply small, reviewable edits to large
player source files without replacing their unrelated contents.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Expected source fragment not found in {path}: {old[:80]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def main() -> None:
    compatibility = ROOT / "components" / "CompatibilityVideoPlayerV2.tsx"
    chrome = ROOT / "components" / "player" / "PlayerChrome.tsx"
    chrome_v2 = ROOT / "components" / "player" / "PlayerChromeV2.tsx"
    surface = ROOT / "components" / "player" / "VlcPlaybackSurface.tsx"
    app_json = ROOT / "app.json"

    replace_once(
        compatibility,
        '  const [fit, setFit] = useState<PlayerFitMode>("fit");',
        '  const [fit, setFit] = useState<PlayerFitMode>("full");',
    )

    replace_once(
        chrome,
        'import React, { useEffect, useState, useSyncExternalStore } from "react";',
        'import React, { useState, useSyncExternalStore } from "react";',
    )
    replace_once(
        chrome,
        '} from "react-native";\nimport {\n  PlayerChrome as PlayerChromeV2,',
        '} from "react-native";\nimport { useSafeAreaInsets } from "react-native-safe-area-context";\nimport {\n  PlayerChrome as PlayerChromeV2,',
    )
    replace_once(chrome, 'const initializedPlayers = new WeakSet<Function>();\n', '')
    replace_once(chrome, '    ? "FULL"', '    ? "FILL"')
    replace_once(
        chrome,
        '  const { width, height } = useWindowDimensions();\n  const portrait = height > width;',
        '  const { width, height } = useWindowDimensions();\n  const insets = useSafeAreaInsets();\n  const portrait = height > width;',
    )
    replace_once(
        chrome,
        '''  useEffect(() => {\n    const cycle = props.onCycleFit as unknown as Function;\n    if (initializedPlayers.has(cycle)) return;\n    initializedPlayers.add(cycle);\n    if (props.fitMode === "fit") {\n      props.onCycleFit();\n      props.onCycleFit();\n    }\n  }, [props.fitMode, props.onCycleFit]);\n\n''',
        '',
    )
    replace_once(
        chrome,
        '''  const gap = portrait ? 3 : 6;\n  const sidePadding = portrait ? 20 : 54;\n  const availableWidth = Math.max(240, width - sidePadding);\n  const buttonSize = clamp(\n    Math.floor((availableWidth - gap * Math.max(0, actions.length - 1)) / Math.max(1, actions.length)),\n    34,\n    portrait ? 46 : 52,\n  );\n  const iconSize = clamp(Math.round(buttonSize * 0.46), 17, 23);\n  const dockHeight = buttonSize + (portrait ? 14 : 16);''',
        '''  const gap = portrait ? 2 : 5;\n  const outerPadding = portrait ? 8 : 20;\n  const safeHorizontal = insets.left + insets.right;\n  const dockInnerPadding = 12;\n  const availableWidth = Math.max(1, width - safeHorizontal - outerPadding * 2 - dockInnerPadding);\n  const buttonSize = clamp(\n    Math.floor((availableWidth - gap * Math.max(0, actions.length - 1)) / Math.max(1, actions.length)),\n    30,\n    portrait ? 46 : 54,\n  );\n  const iconSize = clamp(Math.round(buttonSize * 0.46), 15, 24);\n  const dockHeight = buttonSize + (portrait ? 12 : 16);\n  const progressScale = clamp(width / (portrait ? 390 : 840), 0.82, 1.2);\n  const timeWidth = clamp(Math.round(54 * progressScale), 44, 64);\n  const timeFontSize = clamp(Math.round(11 * progressScale), 9, 13);''',
    )
    replace_once(
        chrome,
        '<View style={[styles.bottom, portrait ? styles.bottomPortrait : styles.bottomLandscape]} pointerEvents="box-none">',
        '''<View\n          style={[\n            styles.bottom,\n            portrait ? styles.bottomPortrait : styles.bottomLandscape,\n            {\n              bottom: Math.max(insets.bottom, portrait ? 8 : 12),\n              paddingLeft: Math.max(outerPadding, insets.left + 8),\n              paddingRight: Math.max(outerPadding, insets.right + 8),\n            },\n          ]}\n          pointerEvents="box-none"\n        >''',
    )
    replace_once(
        chrome,
        '<View style={styles.seekRow}>',
        '<View style={[styles.seekRow, { height: Math.round(32 * progressScale), gap: Math.max(5, Math.round(8 * progressScale)) }]}>',
    )
    replace_once(
        chrome,
        '<Text style={styles.time}>{formatTime(chrome.position)}</Text>',
        '<Text style={[styles.time, { width: timeWidth, fontSize: timeFontSize }]}>{formatTime(chrome.position)}</Text>',
    )
    replace_once(
        chrome,
        '<Text style={[styles.time, styles.timeRight]}>{formatTime(chrome.duration)}</Text>',
        '<Text style={[styles.time, styles.timeRight, { width: timeWidth, fontSize: timeFontSize }]}>{formatTime(chrome.duration)}</Text>',
    )
    replace_once(
        chrome,
        '      hitSlop={3}',
        '      hitSlop={Math.max(3, Math.ceil((44 - size) / 2))}',
    )
    replace_once(
        chrome,
        '  bottomLandscape: { bottom: 18, paddingHorizontal: 28 },\n  bottomPortrait: { bottom: 14, paddingHorizontal: 10 },',
        '  bottomLandscape: {},\n  bottomPortrait: {},',
    )

    replace_once(chrome_v2, '  if (mode === "full") return "FULL";', '  if (mode === "full") return "FILL";')
    replace_once(
        chrome_v2,
        '''        volume={props.volume}\n        onTap={props.onBackgroundPress}\n        onVolumeChange={props.onVolumeChange}\n        onVolumeCommit={props.onVolumeCommit}''',
        '''        volume={props.volume}\n        seekEnabled={props.mediaKind !== "live" && props.duration > 0}\n        position={props.position}\n        duration={props.duration}\n        onTap={props.onBackgroundPress}\n        onVolumeChange={props.onVolumeChange}\n        onVolumeCommit={props.onVolumeCommit}\n        onSeekBy={props.onSeekBy}''',
    )

    replace_once(
        surface,
        'import { VLCPlayer } from "react-native-vlc-media-player";',
        'import { VLCPlayer } from "react-native-vlc-media-player";\nimport { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";',
    )
    replace_once(
        surface,
        'export type PlayerFitMode = "fit" | "full" | "original" | "16:9" | "4:3";',
        'const PLAYER_KEEP_AWAKE_TAG = "legendstream-active-playback";\n\nexport type PlayerFitMode = "fit" | "full" | "original" | "16:9" | "4:3";',
    )
    replace_once(
        surface,
        '''  useEffect(() => {\n    void setPlayerKeepAwake(true);\n    return () => {\n      void setPlayerKeepAwake(false);\n    };\n  }, []);''',
        '''  useEffect(() => {\n    const shouldKeepAwake = playbackReady && !paused;\n    if (shouldKeepAwake) {\n      void activateKeepAwakeAsync(PLAYER_KEEP_AWAKE_TAG).catch(() => undefined);\n      void setPlayerKeepAwake(true);\n    } else {\n      void deactivateKeepAwake(PLAYER_KEEP_AWAKE_TAG).catch(() => undefined);\n      void setPlayerKeepAwake(false);\n    }\n    return () => {\n      void deactivateKeepAwake(PLAYER_KEEP_AWAKE_TAG).catch(() => undefined);\n      void setPlayerKeepAwake(false);\n    };\n  }, [paused, playbackReady]);''',
    )
    replace_once(
        surface,
        '''  const handlePaused = useCallback(() => {\n    void logPlayerDiagnostic("vlc_paused");''',
        '''  const handlePaused = useCallback(() => {\n    setPlaybackReady(false);\n    void logPlayerDiagnostic("vlc_paused");''',
    )
    replace_once(
        surface,
        '''  const handleEnd = useCallback(() => {\n    void logPlayerDiagnostic("vlc_end");''',
        '''  const handleEnd = useCallback(() => {\n    setPlaybackReady(false);\n    void logPlayerDiagnostic("vlc_end");''',
    )
    replace_once(
        surface,
        '''  const handleError = useCallback(() => {\n    void logPlayerDiagnostic("vlc_error", { codec: codecMode, fit });''',
        '''  const handleError = useCallback(() => {\n    setPlaybackReady(false);\n    void logPlayerDiagnostic("vlc_error", { codec: codecMode, fit });''',
    )

    app = json.loads(app_json.read_text(encoding="utf-8"))
    expo = app["expo"]
    if expo.get("version") == "1.4.26":
        expo["version"] = "1.4.27"
    android = expo["android"]
    if android.get("versionCode") == 40:
        android["versionCode"] = 41
    app_json.write_text(json.dumps(app, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("Applied adaptive player UX source edits")


if __name__ == "__main__":
    main()
