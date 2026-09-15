import React, { useMemo } from "react";
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import {
  adjacentStalkerCategoryId,
  isStalkerCategoryHorizontalIntent,
  resolveStalkerCategorySwipe,
  type StalkerCategoryPagerItem,
  type StalkerCategorySwipeDirection,
} from "@/lib/stalkerCategoryPager";

export function StalkerCategoryPager({
  categories,
  activeId,
  disabled = false,
  showControls = true,
  onSelect,
  children,
}: {
  categories: readonly StalkerCategoryPagerItem[];
  activeId: string | null;
  disabled?: boolean;
  showControls?: boolean;
  onSelect: (id: string) => void;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const activeIndex = categories.findIndex((item) => item.id === activeId);
  const active = activeIndex >= 0 ? categories[activeIndex] ?? null : null;
  const previous = activeIndex > 0 ? categories[activeIndex - 1] ?? null : null;
  const next = activeIndex >= 0 && activeIndex < categories.length - 1 ? categories[activeIndex + 1] ?? null : null;

  const move = (direction: StalkerCategorySwipeDirection) => {
    if (disabled) return;
    const id = adjacentStalkerCategoryId(categories, activeId, direction);
    if (id) onSelect(id);
  };

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        !Platform.isTV && !disabled && isStalkerCategoryHorizontalIntent(gesture.dx, gesture.dy),
      onPanResponderRelease: (_event, gesture) => {
        const direction = resolveStalkerCategorySwipe(gesture.dx, gesture.dy, disabled || Platform.isTV);
        if (direction) move(direction);
      },
      onPanResponderTerminationRequest: () => true,
      onPanResponderTerminate: () => undefined,
    }),
    [activeId, categories, disabled, onSelect],
  );

  return <View style={styles.root} {...panResponder.panHandlers}>
    {showControls && active ? <View
      accessibilityRole="tablist"
      style={[styles.controls, { borderColor: colors.border, backgroundColor: colors.card }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={previous ? `Önceki kategori: ${previous.title}` : "Önceki kategori yok"}
        focusable
        disabled={disabled || !previous}
        onPress={() => move("previous")}
        style={[styles.side, (!previous || disabled) && styles.disabled]}
      >
        <Text numberOfLines={1} style={[styles.sideText, { color: colors.mutedForeground }]}>
          {previous ? `‹ ${previous.title}` : "‹"}
        </Text>
      </Pressable>
      <View style={styles.activeWrap}>
        <Text numberOfLines={1} style={[styles.activeText, { color: colors.primary }]}>{active.title}</Text>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          {Platform.isTV ? "Kategori · sol/sağ düğmeleri" : "Kategori · sola/sağa kaydır"}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={next ? `Sonraki kategori: ${next.title}` : "Sonraki kategori yok"}
        focusable
        disabled={disabled || !next}
        onPress={() => move("next")}
        style={[styles.side, styles.sideRight, (!next || disabled) && styles.disabled]}
      >
        <Text numberOfLines={1} style={[styles.sideText, styles.sideTextRight, { color: colors.mutedForeground }]}>
          {next ? `${next.title} ›` : "›"}
        </Text>
      </Pressable>
    </View> : null}
    <View style={styles.content}>{children}</View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  controls: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 14,
    marginHorizontal: 18,
    marginTop: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  side: { flex: 1, minHeight: 42, justifyContent: "center", paddingHorizontal: 6 },
  sideRight: { alignItems: "flex-end" },
  sideText: { fontSize: 13, fontWeight: "700" },
  sideTextRight: { textAlign: "right" },
  activeWrap: { flex: 1.2, alignItems: "center", justifyContent: "center", minWidth: 0 },
  activeText: { fontSize: 16, fontWeight: "900", textAlign: "center" },
  hint: { fontSize: 10, marginTop: 2, textAlign: "center" },
  disabled: { opacity: 0.35 },
});
