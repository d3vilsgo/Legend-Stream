import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { CompactLandscapeNavButton } from "@/components/navigation/CompactLandscapeNavButton";
import { useUiPresentation } from "@/context/UiPresentationContext";
import { useColors } from "@/hooks/useColors";

export type ResponsiveContentNavItem<Key extends string> = {
  key: Key;
  label: string;
  shortLabel?: string;
  icon: keyof typeof Feather.glyphMap;
};

type Props<Key extends string> = {
  items: readonly ResponsiveContentNavItem<Key>[];
  activeKey: Key;
  onSelect: (key: Key) => void;
  productLabel?: string;
};

export function ResponsiveContentNav<Key extends string>({
  items,
  activeKey,
  onSelect,
  productLabel = "LEGENDSTREAM",
}: Props<Key>) {
  const colors = useColors();
  const { mode } = useUiPresentation();
  const [open, setOpen] = useState(false);
  const active = items.find((item) => item.key === activeKey) ?? items[0];
  const compact = mode === "mobileLandscape";
  const tv = mode === "tv";

  useEffect(() => {
    if (tv) setOpen(true);
  }, [tv]);

  if (tv) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tvNav}>
        {items.map((item) => (
          <FocusButton
            key={item.key}
            label={item.label}
            icon={item.icon}
            variant={activeKey === item.key ? "secondary" : "ghost"}
            onPress={() => onSelect(item.key)}
          />
        ))}
      </ScrollView>
    );
  }

  return (
    <View style={styles.shell}>
      <View style={[styles.summary, compact ? styles.summaryCompact : null]}>
        <View style={styles.identity}>
          <Text numberOfLines={1} style={[styles.product, { color: colors.mutedForeground }]}>
            {productLabel}
          </Text>
          {active ? (
            <View style={styles.activeLine}>
              <Feather name={active.icon} size={15} color={colors.primary} />
              <Text numberOfLines={1} style={[styles.activeLabel, { color: colors.foreground }]}>
                {active.shortLabel ?? active.label}
              </Text>
            </View>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? "İçerik menüsünü kapat" : "İçerik menüsünü aç"}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          hitSlop={8}
          style={({ pressed }) => [
            styles.toggle,
            { borderColor: open ? colors.primary : colors.border, backgroundColor: open ? colors.secondary : colors.card },
            pressed && styles.pressed,
          ]}
        >
          <Feather name={open ? "chevron-up" : "menu"} size={18} color={open ? colors.primary : colors.foreground} />
          <Text style={[styles.toggleText, { color: colors.foreground }]}>{open ? "Kapat" : "Menü"}</Text>
        </Pressable>
      </View>

      {open ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.navRow, compact ? styles.navRowCompact : null]}
        >
          {items.map((item) => (
            compact ? (
              <CompactLandscapeNavButton
                key={item.key}
                label={item.label}
                shortLabel={item.shortLabel}
                icon={item.icon}
                active={activeKey === item.key}
                onPress={() => onSelect(item.key)}
              />
            ) : (
              <NavIconButton
                key={item.key}
                label={item.label}
                shortLabel={item.shortLabel}
                icon={item.icon}
                active={activeKey === item.key}
                compact={compact}
                onPress={() => onSelect(item.key)}
              />
            )
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function NavIconButton({
  label,
  shortLabel,
  icon,
  active,
  compact,
  onPress,
}: {
  label: string;
  shortLabel?: string;
  icon: keyof typeof Feather.glyphMap;
  active: boolean;
  compact: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.navButton,
        compact ? styles.navButtonCompact : null,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? colors.secondary : "transparent",
        },
        pressed && styles.pressed,
      ]}
    >
      <Feather name={icon} size={compact ? 19 : 20} color={active ? colors.primary : colors.foreground} />
      {active ? (
        <Text numberOfLines={1} style={[styles.navLabel, compact ? styles.navLabelCompact : null, { color: colors.foreground }]}>
          {shortLabel ?? label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: { gap: 6 },
  summary: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  summaryCompact: { minHeight: 44 },
  identity: { flex: 1, minWidth: 0 },
  product: { fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  activeLine: { marginTop: 3, flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 },
  activeLabel: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 14 },
  toggle: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  toggleText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  navRow: { alignItems: "center", gap: 7, paddingBottom: 4 },
  navRowCompact: { gap: 6, paddingBottom: 2 },
  navButton: {
    minHeight: 46,
    minWidth: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  navButtonCompact: { minHeight: 44, borderRadius: 10, paddingHorizontal: 11 },
  navLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13, maxWidth: 116 },
  navLabelCompact: { maxWidth: 96 },
  tvNav: { gap: 6, paddingVertical: 4 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.97 }] },
});
