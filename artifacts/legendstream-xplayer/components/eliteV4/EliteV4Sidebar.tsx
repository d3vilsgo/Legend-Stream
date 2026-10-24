import React from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
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
    label: "İzleme Geçmişi",
    icon: "clock",
    previous: "sidebar-series",
    next: "sidebar-favorites",
  },
  {
    id: "sidebar-favorites",
    label: "Favorilerim",
    icon: "star",
    previous: "sidebar-history",
    next: "sidebar-settings",
  },
  {
    id: "sidebar-settings",
    label: "Ayarlar",
    icon: "settings",
    previous: "sidebar-favorites",
    next: "sidebar-v3",
  },
];

export function EliteV4Sidebar({
  onReturnToV3,
  activeId = "sidebar-home",
  contentFocusId = "hero",
  onNavigate,
  liveAvailable = false,
}: {
  onReturnToV3: () => void;
  activeId?: string;
  contentFocusId?: string;
  onNavigate?: (
    route:
      | "home"
      | "live"
      | "movies"
      | "series"
      | "history"
      | "favorites"
      | "settings",
  ) => void;
  liveAvailable?: boolean;
}) {
  const { activeRegion } = useEliteV4Focus();
  const expanded = activeRegion === "sidebar";
  const viewport = useWindowDimensions();
  const width = expanded
    ? Math.min(theme.layout.sidebarExpanded, Math.round(viewport.width * 0.3))
    : theme.layout.sidebarCompact;

  const renderEntry = (entry: SidebarEntry) => {
    const active = entry.id === activeId;
    const route =
      entry.id === "sidebar-settings" && onNavigate
        ? "settings"
        : entry.id === "sidebar-history" && onNavigate
          ? "history"
          : entry.id === "sidebar-favorites" && onNavigate
            ? "favorites"
            : entry.id === "sidebar-series" && onNavigate
              ? "series"
              : entry.id === "sidebar-movies" && onNavigate
                ? "movies"
                : entry.id === "sidebar-home"
                  ? "home"
                  : entry.id === "sidebar-live" && liveAvailable
                    ? "live"
                    : null;
    return (
      <EliteV4FocusButton
        key={entry.id}
        focusId={entry.id}
        region="sidebar"
        selected={active}
        neighbors={{
          right: contentFocusId,
          ...(entry.previous ? { up: entry.previous } : {}),
          ...(entry.next ? { down: entry.next } : {}),
        }}
        onPress={() => {
          if (route && onNavigate) onNavigate(route);
          else if (!active) onReturnToV3();
        }}
        accessibilityLabel={
          active || route
            ? entry.label
            : `${entry.label}. Mevcut Elite V3 navigasyonunu aç`
        }
        style={{
          minHeight: 48,
          marginBottom: 5,
          borderRadius: theme.radius.medium,
          borderWidth: 1,
          borderColor: "transparent",
          backgroundColor: active ? theme.color.accentSoft : "transparent",
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
          color={active ? theme.color.accent : theme.color.muted}
        />
        {expanded ? (
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: active ? theme.color.foreground : theme.color.muted,
              fontSize: 14,
              fontWeight: active ? "600" : "400",
            }}
          >
            {entry.label}
          </Text>
        ) : null}
      </EliteV4FocusButton>
    );
  };

  return (
    <View
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
        overflow: "hidden",
      }}
    >
      <ScrollView
        style={{ flex: 1, minHeight: 0 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 12 }}
      >
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
      </ScrollView>
      <EliteV4FocusButton
        focusId="sidebar-v3"
        region="sidebar"
        neighbors={{
          right: contentFocusId,
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
    </View>
  );
}
