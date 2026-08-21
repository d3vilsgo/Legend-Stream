import React from "react";
import { Pressable, StyleSheet } from "react-native";

type Props = {
  volume: number;
  enabled?: boolean;
  onTap: () => void;
  onVolumeChange: (value: number) => void;
  onVolumeCommit?: (value: number) => void;
};

/**
 * Diagnostic baseline gesture layer.
 *
 * Phase-2 brightness/media-volume native integrations are intentionally
 * disabled until the player-open crash is isolated. This layer keeps only the
 * proven tap-to-show/hide-controls behavior and contains no native API calls.
 */
export function PlayerGestureLayer({ enabled = true, onTap }: Props) {
  if (!enabled) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Oynatıcı kontrollerini göster veya gizle"
      style={styles.layer}
      onPress={onTap}
    />
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
});
