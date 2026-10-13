import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useColors } from "@/hooks/useColors";

type Props = {
  label: string;
  shortLabel?: string;
  icon: keyof typeof Feather.glyphMap;
  active: boolean;
  minTarget?: 44 | 48 | 56;
  onPress: () => void;
};

export function CompactLandscapeNavButton({ label, shortLabel, icon, active, minTarget = 44, onPress }: Props) {
  const colors = useColors();
  return (
    <Pressable
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
      {active ? <Text numberOfLines={1} style={[styles.label, { color: colors.foreground }]}>{shortLabel ?? label}</Text> : null}
    </Pressable>
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
