import React from "react";
import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { EliteV4FocusButton, useEliteV4Focus } from "./EliteV4FocusSurface";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

export function EliteV4Sidebar({ onReturnToV3 }: { onReturnToV3: () => void }) {
  const { activeRegion } = useEliteV4Focus();
  const expanded = activeRegion === "sidebar";
  return (
    <View
      style={{
        width: expanded
          ? theme.layout.sidebarExpanded
          : theme.layout.sidebarCompact,
        backgroundColor: theme.color.surface,
        borderRightWidth: 1,
        borderColor: theme.color.border,
        paddingHorizontal: expanded ? 17 : 12,
        paddingVertical: 24,
        justifyContent: "space-between",
        zIndex: 3,
      }}
    >
      <View>
        <Text
          style={{
            color: theme.color.accent,
            fontSize: 13,
            fontWeight: "900",
            letterSpacing: 1.6,
            marginBottom: 36,
            textAlign: expanded ? "left" : "center",
          }}
        >
          {expanded ? "ELITE V4" : "E4"}
        </Text>
        <EliteV4FocusButton
          focusId="sidebar-home"
          region="sidebar"
          initial={false}
          neighbors={{ right: "hero" }}
          onPress={() => undefined}
          accessibilityLabel="Ana Sayfa"
          style={{
            minHeight: 54,
            borderRadius: theme.radius.medium,
            borderWidth: 1,
            borderColor: "transparent",
            backgroundColor: theme.color.accentSoft,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: expanded ? "flex-start" : "center",
            gap: 15,
            paddingHorizontal: expanded ? 16 : 0,
          }}
        >
          <Feather name="home" size={20} color={theme.color.accent} />
          {expanded ? (
            <Text
              style={{
                color: theme.color.foreground,
                fontSize: 15,
                fontWeight: "700",
              }}
            >
              Ana Sayfa
            </Text>
          ) : null}
        </EliteV4FocusButton>
      </View>
      <EliteV4FocusButton
        focusId="sidebar-v3"
        region="sidebar"
        neighbors={{ right: "hero", up: "sidebar-home" }}
        onPress={onReturnToV3}
        accessibilityLabel="Elite V3'e dön"
        style={{
          minHeight: 52,
          borderRadius: theme.radius.medium,
          borderWidth: 1,
          borderColor: theme.color.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: expanded ? "flex-start" : "center",
          gap: 13,
          paddingHorizontal: expanded ? 14 : 0,
        }}
      >
        <Feather name="corner-up-left" size={19} color={theme.color.muted} />
        {expanded ? (
          <Text style={{ color: theme.color.muted, fontSize: 14 }}>
            Elite V3
          </Text>
        ) : null}
      </EliteV4FocusButton>
    </View>
  );
}
