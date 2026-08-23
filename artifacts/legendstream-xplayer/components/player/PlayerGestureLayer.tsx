import { Feather } from "@expo/vector-icons";
import * as Brightness from "expo-brightness";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

type Props = {
  volume: number;
  enabled?: boolean;
  seekEnabled?: boolean;
  position?: number;
  duration?: number;
  onTap: () => void;
  onVolumeChange: (value: number) => void;
  onVolumeCommit?: (value: number) => void;
  onSeekBy?: (seconds: number) => void;
};

type GestureMode = "brightness" | "volume" | "seek";
type HudState =
  | { mode: "brightness" | "volume"; value: number }
  | { mode: "seek"; seconds: number }
  | null;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const clampRange = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * Player gesture layer with directional locking:
 * - tap => show/hide chrome,
 * - vertical swipe on LEFT half => activity brightness,
 * - vertical swipe on RIGHT half => Android media volume,
 * - horizontal swipe => relative seek for VOD/episodes.
 *
 * A gesture is classified once after a movement threshold. This prevents a
 * diagonal horizontal seek from accidentally changing brightness or volume.
 */
export function PlayerGestureLayer({
  enabled = true,
  seekEnabled = false,
  position = 0,
  duration = 0,
  volume,
  onTap,
  onVolumeChange,
  onVolumeCommit,
  onSeekBy,
}: Props) {
  const { width, height } = useWindowDimensions();
  const [hud, setHud] = useState<HudState>(null);

  const brightnessRef = useRef(0.5);
  const volumeRef = useRef(clamp(volume));
  const modeRef = useRef<GestureMode | null>(null);
  const verticalSideRef = useRef<"brightness" | "volume">("brightness");
  const startValueRef = useRef(0.5);
  const latestValueRef = useRef(0.5);
  const seekDeltaRef = useRef(0);
  const anyMoveRef = useRef(false);
  const lastNativeUpdateRef = useRef(0);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    volumeRef.current = clamp(volume);
  }, [volume]);

  useEffect(() => {
    let active = true;
    Brightness.getBrightnessAsync()
      .then((value) => {
        if (active && Number.isFinite(value)) brightnessRef.current = clamp(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
      void Brightness.restoreSystemBrightnessAsync().catch(() => undefined);
    };
  }, []);

  const armHudTimeout = () => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => setHud(null), 700);
  };

  const showLevelHud = (mode: "brightness" | "volume", value: number) => {
    setHud({ mode, value });
    armHudTimeout();
  };

  const showSeekHud = (seconds: number) => {
    setHud({ mode: "seek", seconds });
    armHudTimeout();
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => enabled,
    onMoveShouldSetPanResponder: (_event, gesture) =>
      enabled && (Math.abs(gesture.dy) > 3 || Math.abs(gesture.dx) > 3),
    onPanResponderGrant: (_event, gesture) => {
      modeRef.current = null;
      verticalSideRef.current = gesture.x0 < width / 2 ? "brightness" : "volume";
      startValueRef.current = verticalSideRef.current === "brightness"
        ? brightnessRef.current
        : volumeRef.current;
      latestValueRef.current = startValueRef.current;
      seekDeltaRef.current = 0;
      anyMoveRef.current = false;
    },
    onPanResponderMove: (_event, gesture) => {
      const absX = Math.abs(gesture.dx);
      const absY = Math.abs(gesture.dy);
      if (absX > 7 || absY > 7) anyMoveRef.current = true;

      if (!modeRef.current) {
        if (absY >= 10 && absY > absX * 1.15) {
          modeRef.current = verticalSideRef.current;
        } else if (seekEnabled && onSeekBy && absX >= 12 && absX > absY * 1.15) {
          modeRef.current = "seek";
        } else {
          return;
        }
      }

      if (modeRef.current === "seek") {
        const maxSeek = duration > 0 ? clampRange(duration * 0.08, 30, 180) : 60;
        const travel = Math.max(240, width * 0.62);
        const seconds = clampRange((gesture.dx / travel) * maxSeek, -maxSeek, maxSeek);
        const bounded = duration > 0
          ? clampRange(seconds, -Math.max(0, position), Math.max(0, duration - position))
          : seconds;
        seekDeltaRef.current = bounded;
        showSeekHud(bounded);
        return;
      }

      const travel = Math.max(240, height * 0.55);
      const next = clamp(startValueRef.current - gesture.dy / travel);
      latestValueRef.current = next;
      showLevelHud(modeRef.current, next);

      const now = Date.now();
      if (now - lastNativeUpdateRef.current < 36) return;
      lastNativeUpdateRef.current = now;

      if (modeRef.current === "brightness") {
        brightnessRef.current = next;
        void Brightness.setBrightnessAsync(next).catch(() => undefined);
      } else {
        volumeRef.current = next;
        onVolumeChange(next);
      }
    },
    onPanResponderRelease: () => {
      if (!anyMoveRef.current || !modeRef.current) {
        onTap();
        return;
      }

      if (modeRef.current === "seek") {
        const seconds = seekDeltaRef.current;
        if (Math.abs(seconds) >= 1) onSeekBy?.(seconds);
        showSeekHud(seconds);
        return;
      }

      const value = latestValueRef.current;
      if (modeRef.current === "brightness") {
        brightnessRef.current = value;
        void Brightness.setBrightnessAsync(value).catch(() => undefined);
      } else {
        volumeRef.current = value;
        onVolumeChange(value);
        onVolumeCommit?.(value);
      }
      showLevelHud(modeRef.current, value);
    },
    onPanResponderTerminate: () => {
      setHud(null);
      modeRef.current = null;
    },
    onPanResponderTerminationRequest: () => true,
  }), [
    duration,
    enabled,
    height,
    onSeekBy,
    onTap,
    onVolumeChange,
    onVolumeCommit,
    position,
    seekEnabled,
    width,
  ]);

  if (!enabled) return null;

  return (
    <View style={styles.layer} {...panResponder.panHandlers}>
      {hud?.mode === "seek" ? (
        <View pointerEvents="none" style={[styles.hud, styles.hudSeek]}>
          <Feather
            name={hud.seconds < 0 ? "rewind" : "fast-forward"}
            size={24}
            color="#dffaff"
          />
          <Text style={styles.seekValue}>
            {hud.seconds >= 0 ? "+" : ""}{Math.round(hud.seconds)} sn
          </Text>
        </View>
      ) : hud ? (
        <View
          pointerEvents="none"
          style={[
            styles.hud,
            hud.mode === "brightness" ? styles.hudLeft : styles.hudRight,
          ]}
        >
          <Feather
            name={hud.mode === "brightness" ? "sun" : "volume-2"}
            size={22}
            color="#dffaff"
          />
          <Text style={styles.hudValue}>{Math.round(hud.value * 100)}%</Text>
          <View style={styles.meter}>
            <View style={[styles.meterFill, { height: `${hud.value * 100}%` }]} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  hud: {
    position: "absolute",
    top: "34%",
    width: 58,
    minHeight: 142,
    paddingVertical: 12,
    borderRadius: 22,
    alignItems: "center",
    backgroundColor: "rgba(3,10,18,.84)",
    borderWidth: 1,
    borderColor: "rgba(103,232,249,.28)",
    elevation: 12,
  },
  hudLeft: {
    left: 18,
  },
  hudRight: {
    right: 18,
  },
  hudSeek: {
    top: "44%",
    left: "50%",
    width: 116,
    minHeight: 74,
    marginLeft: -58,
    justifyContent: "center",
  },
  hudValue: {
    marginTop: 7,
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  seekValue: {
    marginTop: 8,
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  meter: {
    marginTop: 10,
    width: 6,
    height: 70,
    borderRadius: 3,
    overflow: "hidden",
    justifyContent: "flex-end",
    backgroundColor: "rgba(148,163,184,.24)",
  },
  meterFill: {
    width: "100%",
    borderRadius: 3,
    backgroundColor: "#22d3ee",
  },
});
