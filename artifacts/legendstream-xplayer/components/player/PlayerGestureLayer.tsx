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
  onTap: () => void;
  onVolumeChange: (value: number) => void;
  onVolumeCommit?: (value: number) => void;
};

type GestureMode = "brightness" | "volume";
type HudState = { mode: GestureMode; value: number } | null;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Modern player gesture layer:
 * - tap anywhere outside controls => show/hide chrome,
 * - vertical swipe on LEFT half => app brightness,
 * - vertical swipe on RIGHT half => Android media volume.
 *
 * Brightness is scoped to the current activity and restored to the system value
 * when the player unmounts. Horizontal movement is ignored so accidental
 * diagonal gestures do not change volume/brightness.
 */
export function PlayerGestureLayer({
  enabled = true,
  volume,
  onTap,
  onVolumeChange,
  onVolumeCommit,
}: Props) {
  const { width, height } = useWindowDimensions();
  const [hud, setHud] = useState<HudState>(null);

  const brightnessRef = useRef(0.5);
  const volumeRef = useRef(clamp(volume));
  const modeRef = useRef<GestureMode>("brightness");
  const startValueRef = useRef(0.5);
  const latestValueRef = useRef(0.5);
  const movedRef = useRef(false);
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

  const showHud = (mode: GestureMode, value: number) => {
    setHud({ mode, value });
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => setHud(null), 700);
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => enabled,
    onMoveShouldSetPanResponder: (_event, gesture) =>
      enabled && (Math.abs(gesture.dy) > 3 || Math.abs(gesture.dx) > 3),
    onPanResponderGrant: (_event, gesture) => {
      modeRef.current = gesture.x0 < width / 2 ? "brightness" : "volume";
      startValueRef.current = modeRef.current === "brightness"
        ? brightnessRef.current
        : volumeRef.current;
      latestValueRef.current = startValueRef.current;
      movedRef.current = false;
      anyMoveRef.current = false;
    },
    onPanResponderMove: (_event, gesture) => {
      const absX = Math.abs(gesture.dx);
      const absY = Math.abs(gesture.dy);
      if (absX > 7 || absY > 7) anyMoveRef.current = true;
      if (absY < 8 || absY <= absX * 1.05) return;

      movedRef.current = true;
      const travel = Math.max(240, height * 0.55);
      const next = clamp(startValueRef.current - gesture.dy / travel);
      latestValueRef.current = next;
      showHud(modeRef.current, next);

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
      if (!anyMoveRef.current) {
        onTap();
        return;
      }
      if (!movedRef.current) return;
      const value = latestValueRef.current;
      if (modeRef.current === "brightness") {
        brightnessRef.current = value;
        void Brightness.setBrightnessAsync(value).catch(() => undefined);
      } else {
        volumeRef.current = value;
        onVolumeChange(value);
        onVolumeCommit?.(value);
      }
      showHud(modeRef.current, value);
    },
    onPanResponderTerminate: () => {
      setHud(null);
    },
    onPanResponderTerminationRequest: () => true,
  }), [enabled, height, onTap, onVolumeChange, onVolumeCommit, width]);

  if (!enabled) return null;

  return (
    <View style={styles.layer} {...panResponder.panHandlers}>
      {hud ? (
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
  hudValue: {
    marginTop: 7,
    color: "#f8fafc",
    fontSize: 12,
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
