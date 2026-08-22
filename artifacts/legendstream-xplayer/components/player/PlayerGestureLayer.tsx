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

type GestureKind = "brightness" | "volume" | null;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function PlayerGestureLayer({
  volume,
  enabled = true,
  onTap,
  onVolumeChange,
  onVolumeCommit,
}: Props) {
  const { width, height } = useWindowDimensions();
  const startX = useRef(0);
  const startValue = useRef(0.5);
  const activeKind = useRef<GestureKind>(null);
  const currentValue = useRef(0.5);
  const brightnessValue = useRef(0.5);
  const moved = useRef(false);
  const lastBrightnessWrite = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hudKind, setHudKind] = useState<GestureKind>(null);
  const [hudValue, setHudValue] = useState(0.5);

  useEffect(() => {
    let cancelled = false;
    Brightness.getBrightnessAsync()
      .then((value) => {
        if (!cancelled && Number.isFinite(value)) brightnessValue.current = clamp01(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const showHud = (kind: Exclude<GestureKind, null>, value: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setHudKind(kind);
    setHudValue(value);
  };

  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHudKind(null), 650);
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => enabled,
    onMoveShouldSetPanResponder: (_event, gesture) =>
      enabled && Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: (event) => {
      startX.current = event.nativeEvent.pageX;
      activeKind.current = null;
      moved.current = false;
      currentValue.current = clamp01(volume);
    },
    onPanResponderMove: (_event, gesture) => {
      if (!enabled) return;
      if (!activeKind.current) {
        const vertical = Math.abs(gesture.dy) > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.1;
        if (!vertical) return;
        activeKind.current = startX.current < width / 2 ? "brightness" : "volume";
        startValue.current = activeKind.current === "brightness"
          ? brightnessValue.current
          : clamp01(volume);
      }

      moved.current = true;
      const travel = Math.max(220, height * 0.52);
      const next = clamp01(startValue.current - gesture.dy / travel);
      currentValue.current = next;
      showHud(activeKind.current, next);

      if (activeKind.current === "volume") {
        onVolumeChange(next);
        return;
      }

      brightnessValue.current = next;
      const now = Date.now();
      if (now - lastBrightnessWrite.current >= 45) {
        lastBrightnessWrite.current = now;
        void Brightness.setBrightnessAsync(next).catch(() => undefined);
      }
    },
    onPanResponderRelease: () => {
      if (!moved.current) {
        onTap();
      } else if (activeKind.current === "volume") {
        onVolumeCommit?.(currentValue.current);
      } else if (activeKind.current === "brightness") {
        void Brightness.setBrightnessAsync(currentValue.current).catch(() => undefined);
      }
      activeKind.current = null;
      scheduleHide();
    },
    onPanResponderTerminate: () => {
      if (activeKind.current === "volume") onVolumeCommit?.(currentValue.current);
      activeKind.current = null;
      scheduleHide();
    },
    onPanResponderTerminationRequest: () => true,
  }), [enabled, height, onTap, onVolumeChange, onVolumeCommit, volume, width]);

  if (!enabled) return null;

  return (
    <View style={styles.layer} {...responder.panHandlers}>
      {hudKind ? (
        <View
          pointerEvents="none"
          style={[
            styles.hud,
            hudKind === "brightness" ? styles.hudLeft : styles.hudRight,
          ]}
        >
          <Feather
            name={hudKind === "brightness" ? "sun" : "volume-2"}
            size={22}
            color="#dffaff"
          />
          <Text style={styles.hudValue}>{Math.round(hudValue * 100)}%</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { height: `${Math.round(hudValue * 100)}%` }]} />
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
    top: "38%",
    width: 66,
    minHeight: 122,
    paddingVertical: 12,
    borderRadius: 22,
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(3,10,18,.86)",
    borderWidth: 1,
    borderColor: "rgba(103,232,249,.32)",
  },
  hudLeft: { left: 18 },
  hudRight: { right: 18 },
  hudValue: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  track: {
    width: 7,
    height: 56,
    borderRadius: 4,
    overflow: "hidden",
    justifyContent: "flex-end",
    backgroundColor: "rgba(148,163,184,.26)",
  },
  fill: {
    width: "100%",
    borderRadius: 4,
    backgroundColor: "#22d3ee",
  },
});
