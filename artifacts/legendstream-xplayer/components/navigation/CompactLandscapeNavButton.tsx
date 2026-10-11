import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

type Props = {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  active: boolean;
  onPress: () => void;
};

/** Compact phone-landscape navigation; native TV retains its existing focus controls. */
export function CompactLandscapeNavButton({ label, icon, active, onPress }: Props) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.button, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.secondary : "transparent" }]}
    >
      <Feather name={icon} size={19} color={active ? colors.primary : colors.foreground} />
      {active ? (
        <Text numberOfLines={1} style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      ) : null}
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
  label: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    maxWidth: 110,
  },
});
