import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text } from "react-native";
import { useColors } from "@/hooks/useColors";
import { TVPreviewPressable } from "@/components/tvPreview/TVPreviewFocus";

type Props = {
  label: string;
  shortLabel?: string;
  icon: keyof typeof Feather.glyphMap;
  active: boolean;
  minTarget?: 44 | 48 | 56;
  onPress: () => void;
  showLabel?: boolean;
};

export function CompactLandscapeNavButton({ label, shortLabel, icon, active, minTarget = 44, onPress, showLabel = active }: Props) {
  const colors = useColors();
  return (
    <TVPreviewPressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { minHeight: minTarget, minWidth: Math.max(48, minTarget) },
        { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.secondary : "transparent" },
        pressed && styles.pressed,
      ]}
    >
      <Feather name={icon} size={19} color={active ? colors.primary : colors.foreground} />
      {showLabel ? <Text numberOfLines={1} style={[styles.label, { color: colors.foreground }]}>{shortLabel ?? label}</Text> : null}
    </TVPreviewPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    minWidth: 48,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 10,
  },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 13, maxWidth: 110 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.97 }] },
});
