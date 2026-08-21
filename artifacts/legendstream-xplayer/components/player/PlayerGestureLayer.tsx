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

type GestureMode = "brightness" | "volume" | null;

type Props = {
  volume: number;
  enabled?: boolean;
  onTap: () => void;
  onVolumeChange: (value: number) => void;
  onVolumeCommit?: (value: number) => void;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const VERTICAL_THRESHOLD = 10;
const SIDE_ZONE_RATIO = 0.38;
const NATIVE_UPDATE_INTERVAL_MS = 45;

/**
 * Full-screen gesture catcher that sits behind the visible player controls.
 *
 * Left vertical swipe  -> activity brightness
 * Right vertical swipe -> VLC player volume
 * Tap                  -> show/hide player chrome
 *
 * The middle strip intentionally does not own a vertical gesture so future
 * horizontal-seek/double-tap gestures can be added without competing with
 * brightness or volume.
 */
export function PlayerGestureLayer({
  volume,
  enabled = true,
  onTap,
  onVolumeChange,
  onVolumeCommit,
}: Props) {
  const { width, height } = useWindowDimensions();
  const [mode, setMode] = useState<GestureMode>(null);
  const [hudValue, setHudValue] = useState(0);

  const originalBrightness = useRef<number | null>(null);
  const brightness = useRef(0.5);
  const volumeRef = useRef(clamp01(volume));
  const gestureStartValue = useRef(0);
  const gestureChanged = useRef(false);
  const lastNativeUpdate = useRef(0);
  const pendingBrightness = useRef<number | null>(null);
  const brightnessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    volumeRef.current = clamp01(volume);
  }, [volume]);

  useEffect(() => {
    let cancelled = false;
    Brightness.getBrightnessAsync()
      .then((value) => {
        if (cancelled || !Number.isFinite(value)) return;
        const safe = clamp01(value);
        originalBrightness.current = safe;
        brightness.current = safe;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (brightnessTimer.current) clearTimeout(brightnessTimer.current);
      if (hudTimer.current) clearTimeout(hudTimer.current);
      const original = originalBrightness.current;
      if (original !== null) void Brightness.setBrightnessAsync(original).catch(() => undefined);
    };
  }, []);

  const showHud = (nextMode: Exclude<GestureMode, null>, value: number) => {
    setMode(nextMode);
    setHudValue(clamp01(value));
    if (hudTimer.current) clearTimeout(hudTimer.current);
    hudTimer.current = setTimeout(() => setMode(null), 900);
  };

  const applyBrightness = (value: number) => {
    const safe = clamp01(value);
    brightness.current = safe;
    showHud("brightness", safe);

    const now = Date.now();
    const elapsed = now - lastNativeUpdate.current;
    if (elapsed >= NATIVE_UPDATE_INTERVAL_MS) {
      lastNativeUpdate.current = now;
      void Brightness.setBrightnessAsync(safe).catch(() => undefined);
      return;
    }

    pendingBrightness.current = safe;
    if (!brightnessTimer.current) {
      brightnessTimer.current = setTimeout(() => {
        brightnessTimer.current = null;
        const pending = pendingBrightness.current;
        pendingBrightness.current = null;
        if (pending === null) return;
        lastNativeUpdate.current = Date.now();
        void Brightness.setBrightnessAsync(pending).catch(() => undefined);
      }, Math.max(8, NATIVE_UPDATE_INTERVAL_MS - elapsed));
    }
  };

  const applyVolume = (value: number) => {
    const safe = clamp01(value);
    volumeRef.current = safe;
    showHud("volume", safe);
    onVolumeChange(safe);
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => enabled,
    onMoveShouldSetPanResponder: () => enabled,
    onPanResponderGrant: (event) => {
      gestureChanged.current = false;
      const x = event.nativeEvent.locationX;
      if (x <= width * SIDE_ZONE_RATIO) {
        gestureStartValue.current = brightness.current;
      } else if (x >= width * (1 - SIDE_ZONE_RATIO)) {
        gestureStartValue.current = volumeRef.current;
      }
    },
    onPanResponderMove: (event, gesture) => {
      if (!enabled) return;
      const x = gesture.x0 || event.nativeEvent.locationX;
      const absY = Math.abs(gesture.dy);
      const absX = Math.abs(gesture.dx);
      if (absY < VERTICAL_THRESHOLD || absY < absX * 1.15) return;

      const travel = Math.max(180, height * 0.72);
      const delta = -gesture.dy / travel;

      if (x <= width * SIDE_ZONE_RATIO) {
        gestureChanged.current = true;
        applyBrightness(gestureStartValue.current + delta);
      } else if (x >= width * (1 - SIDE_ZONE_RATIO)) {
        gestureChanged.current = true;
        applyVolume(gestureStartValue.current + delta);
      }
    },
    onPanResponderRelease: () => {
      if (!gestureChanged.current) {
        onTap();
      } else if (mode === "volume") {
        onVolumeCommit?.(volumeRef.current);
      }
      gestureChanged.current = false;
    },
    onPanResponderTerminate: () => {
      if (mode === "volume") onVolumeCommit?.(volumeRef.current);
      gestureChanged.current = false;
    },
    onPanResponderTerminationRequest: () => true,
  }), [enabled, height, mode, onTap, onVolumeCommit, width]);

  return (
    <View style={styles.layer} {...panResponder.panHandlers}>
      {mode ? (
        <View
          pointerEvents="none"
          style={[
            styles.hud,
            mode === "brightness" ? styles.hudLeft : styles.hudRight,
          ]}
        >
          <Feather
            name={mode === "brightness" ? "sun" : hudValue <= 0.01 ? "volume-x" : "volume-2"}
            size={24}
            color="#fff"
          />
          <Text style={styles.hudLabel}>{mode === "brightness" ? "Parlaklık" : "Ses"}</Text>
          <Text style={styles.hudValue}>%{Math.round(hudValue * 100)}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${hudValue * 100}%` }]} />
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
    width: 156,
    minHeight: 112,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 15,
    backgroundColor: "rgba(4,8,14,.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  hudLeft: { left: 24 },
  hudRight: { right: 24 },
  hudLabel: { color: "#d9e2ef", fontWeight: "700", fontSize: 12, marginTop: 7 },
  hudValue: { color: "#fff", fontWeight: "900", fontSize: 21, marginTop: 1 },
  track: {
    marginTop: 10,
    width: "100%",
    height: 4,
    overflow: "hidden",
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,.22)",
  },
  fill: { height: 4, backgroundColor: "#22d3ee" },
});
