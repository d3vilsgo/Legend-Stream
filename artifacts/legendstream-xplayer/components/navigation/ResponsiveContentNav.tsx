import { nativeTvLayout } from "@/lib/nativeTvResponsive";
import { hasPlayerBackOwner } from "@/lib/playerRemoteOwnership";
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FocusButton } from "@/components/FocusButton";
import { CompactLandscapeNavButton } from "@/components/navigation/CompactLandscapeNavButton";
import { useColors } from "@/hooks/useColors";
import { resolveAdaptiveNavigationModel } from "@/lib/adaptiveNavigation";
import { resolvePremiumCatalogProfile } from "@/lib/design/screenProfiles";
import { useUiPresentation } from "@/context/UiPresentationContext";

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
  backEnabled?: boolean;
};

export function ResponsiveContentNav<Key extends string>({
  items,
  activeKey,
  onSelect,
  productLabel = "BÖLÜMLER",
  backEnabled = true,
}: Props<Key>) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const tv = nativeTvLayout({ width, height, fontScale, safeArea: insets }, items.length);
  const presentation = useUiPresentation();
  const [open, setOpen] = useState(Platform.isTV || presentation.tvPreview);
  const [preferInitialFocus, setPreferInitialFocus] = useState(Platform.isTV);
  const navigationFocusedIds = useRef(new Set<string>());
  const profile = useMemo(() => resolvePremiumCatalogProfile({
    width,
    height,
    nativeTv: Platform.isTV,
    tvPreview: presentation.tvPreview,
    safeArea: { top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left },
    navState: open ? "open" : "closed",
  }), [height, insets.bottom, insets.left, insets.right, insets.top, open, presentation.tvPreview, width]);
  const model = resolveAdaptiveNavigationModel({
    profile,
    open,
    activeKey,
    itemKeys: items.map((item) => item.key),
  });
  const active = items.find((item) => item.key === activeKey) ?? items[0];
  const homeKey = items[0]?.key;

  useEffect(() => {
    setPreferInitialFocus(false);
  }, []);

  useEffect(() => {
    if (presentation.tvPreview) setOpen(true);
  }, [presentation.tvPreview]);

  useEffect(() => {
    if (!model.nativeTv || !backEnabled || !model.backTarget) return;
    const backTarget = model.backTarget;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (hasPlayerBackOwner()) return false;
      if (navigationFocusedIds.current.size === 0) return false;
      onSelect(backTarget);
      return true;
    });
    return () => back.remove();
  }, [activeKey, backEnabled, homeKey, model.backTarget, model.nativeTv, onSelect]);

  const select = (key: Key) => {
    onSelect(key);
    if (!model.nativeTv) setOpen(false);
  };

  if (model.nativeTv) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        contentContainerStyle={[styles.tvNav, { paddingLeft: tv.left, paddingRight: tv.right, paddingTop: tv.top, paddingBottom: tv.gutter }]}
        accessibilityLabel="Ana gezinme"
      >
        {items.map((item) => (
          <FocusButton
            key={item.key}
            focusId={`nav:${item.key}`}
            testID={`adaptive-nav-${item.key}`}
            label={item.label}
            icon={item.icon}
            variant={activeKey === item.key ? "secondary" : "ghost"}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeKey === item.key }}
            hasTVPreferredFocus={preferInitialFocus && activeKey === item.key && activeKey === homeKey}
            onFocusChange={(focused) => { if (focused) navigationFocusedIds.current.add(item.key); else navigationFocusedIds.current.delete(item.key); }}
            onPress={() => select(item.key)}
            labelLines={1}
            labelStyle={{ fontSize: tv.labelFont, flexShrink: 1 }}
            style={[styles.tvTarget, { width: tv.navWidth, minHeight: tv.target, paddingHorizontal: 10 }]}
          />
        ))}
      </ScrollView>
    );
  }

  if (presentation.tvPreview) {
    return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tvNav, { paddingHorizontal: Math.max(profile.horizontalPadding, insets.left, insets.right) }]} accessibilityLabel="TV önizleme gezinmesi">
      {items.map((item) => <CompactLandscapeNavButton
        key={item.key}
        label={item.label}
        shortLabel={item.shortLabel}
        icon={item.icon}
        active={activeKey === item.key}
        showLabel
        minTarget={56}
        onPress={() => select(item.key)}
      />)}
    </ScrollView>;
  }

  return (
    <View style={styles.shell}>
      <View style={[styles.summary, model.compact && styles.summaryCompact, { paddingHorizontal: Math.max(0, profile.horizontalPadding - 14) }]}>
        <View style={styles.identity}>
          <Text numberOfLines={1} style={[styles.product, { color: colors.mutedForeground }]}>{productLabel}</Text>
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
          testID="adaptive-nav-toggle"
          accessibilityRole="button"
          accessibilityLabel={open ? "İçerik menüsünü kapat" : "İçerik menüsünü aç"}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
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
          contentContainerStyle={[
            styles.navRow,
            model.compact && styles.navRowCompact,
            { paddingHorizontal: Math.max(0, profile.horizontalPadding - 14) },
          ]}
          accessibilityLabel="İçerik bölümleri"
        >
          {items.map((item) => (
            <CompactLandscapeNavButton
              key={item.key}
              label={item.label}
              shortLabel={item.shortLabel}
              icon={item.icon}
              active={activeKey === item.key}
              minTarget={model.touchTarget}
              onPress={() => select(item.key)}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { gap: 4 },
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
  tvNav: { alignItems: "center", gap: 10, paddingVertical: 8 },
  tvTarget: { minHeight: 56, minWidth: 56, paddingHorizontal: 18, borderWidth: 2, borderRadius: 14 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.97 }] },
});
