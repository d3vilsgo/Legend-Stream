import React, { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { EliteV4FocusButton, useEliteV4Focus } from "./EliteV4FocusSurface";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

type SidebarEntry = {
  id: string;
  label: string;
  icon: string;
  active?: boolean;
  previous?: string;
  next?: string;
};

const entries: readonly SidebarEntry[] = [
  {
    id: "sidebar-home",
    label: "Ana Sayfa",
    icon: "home",
    active: true,
    previous: "sidebar-v3",
    next: "sidebar-live",
  },
  {
    id: "sidebar-live",
    label: "Canlı TV",
    icon: "radio",
    previous: "sidebar-home",
    next: "sidebar-movies",
  },
  {
    id: "sidebar-movies",
    label: "Filmler",
    icon: "film",
    previous: "sidebar-live",
    next: "sidebar-series",
  },
  {
    id: "sidebar-series",
    label: "Diziler",
    icon: "tv",
    previous: "sidebar-movies",
    next: "sidebar-history",
  },
  {
    id: "sidebar-history",
    label: "İzlemeye Devam Et",
    icon: "clock",
    previous: "sidebar-series",
    next: "sidebar-settings",
  },
  {
    id: "sidebar-settings",
    label: "Ayarlar",
    icon: "settings",
    previous: "sidebar-history",
    next: "sidebar-v3",
  },
];

export function EliteV4Sidebar({ onReturnToV3 }: { onReturnToV3: () => void }) {
  const { activeRegion } = useEliteV4Focus();
  const expanded = activeRegion === "sidebar";
  const width = useRef(new Animated.Value(theme.layout.sidebarCompact)).current;
  useEffect(() => {
    Animated.timing(width, {
      toValue: expanded
        ? theme.layout.sidebarExpanded
        : theme.layout.sidebarCompact,
      duration: 145,
      useNativeDriver: false,
    }).start();
  }, [expanded, width]);

  const renderEntry = (entry: SidebarEntry) => (
    <EliteV4FocusButton
      key={entry.id}
      focusId={entry.id}
      region="sidebar"
      selected={entry.active}
      neighbors={{
        right: "hero",
        ...(entry.previous ? { up: entry.previous } : {}),
        ...(entry.next ? { down: entry.next } : {}),
      }}
      onPress={entry.active ? () => undefined : onReturnToV3}
      accessibilityLabel={
        entry.active
          ? entry.label
          : `${entry.label}. Mevcut Elite V3 navigasyonunu aç`
      }
      style={{
        minHeight: 48,
        marginBottom: 5,
        borderRadius: theme.radius.medium,
        borderWidth: 1,
        borderColor: "transparent",
        backgroundColor: entry.active ? theme.color.accentSoft : "transparent",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: expanded ? "flex-start" : "center",
        gap: 13,
        paddingHorizontal: expanded ? 13 : 0,
      }}
    >
      <Feather
        name={entry.icon as never}
        size={19}
        color={entry.active ? theme.color.accent : theme.color.muted}
      />
      {expanded ? (
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: entry.active ? theme.color.foreground : theme.color.muted,
            fontSize: 14,
            fontWeight: entry.active ? "600" : "400",
          }}
        >
          {entry.active ? entry.label : `${entry.label} · V3`}
        </Text>
      ) : null}
    </EliteV4FocusButton>
  );

  return (
    <Animated.View
      style={{
        width,
        flexShrink: 0,
        backgroundColor: theme.color.surface,
        borderRightWidth: 1,
        borderColor: theme.color.border,
        paddingHorizontal: expanded ? 12 : 8,
        paddingTop: 18,
        paddingBottom: 16,
        justifyContent: "space-between",
        zIndex: 3,
      }}
    >
      <View>
        <Text
          style={{
            color: theme.color.accent,
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 1.4,
            marginBottom: 22,
            textAlign: expanded ? "left" : "center",
          }}
        >
          {expanded ? "ELITE V4" : "E4"}
        </Text>
        {entries.map(renderEntry)}
      </View>
      <EliteV4FocusButton
        focusId="sidebar-v3"
        region="sidebar"
        neighbors={{
          right: "hero",
          up: "sidebar-settings",
          down: "sidebar-home",
        }}
        onPress={onReturnToV3}
        accessibilityLabel="Elite V3'e dön"
        style={{
          minHeight: 46,
          borderRadius: theme.radius.medium,
          borderWidth: 1,
          borderColor: theme.color.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: expanded ? "flex-start" : "center",
          gap: 12,
          paddingHorizontal: expanded ? 13 : 0,
        }}
      >
        <Feather name="corner-up-left" size={18} color={theme.color.muted} />
        {expanded ? (
          <Text style={{ color: theme.color.muted, fontSize: 13 }}>
            Elite V3'e dön
          </Text>
        ) : null}
      </EliteV4FocusButton>
    </Animated.View>
  );
}
