import React from "react";
import { ScrollView, Text, View } from "react-native";
import { EliteV4Hero } from "./EliteV4Hero";
import { EliteV4ContentRail } from "./EliteV4ContentRail";
import type { EliteHomeItem } from "@/lib/eliteV4HomeModel";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

export function EliteV4Home({
  items,
  providerName,
  providerId,
  providerType,
  loading,
  onOpen,
}: {
  items: readonly EliteHomeItem[];
  providerName: string;
  providerId: string;
  providerType: string;
  loading: boolean;
  onOpen: (item: EliteHomeItem) => void;
}) {
  const hero = items[0] ?? null;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      contentContainerStyle={{
        paddingTop: 30,
        paddingHorizontal: 38,
        paddingBottom: 44,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", marginBottom: 20 }}
      >
        <Text
          style={{
            color: theme.color.foreground,
            fontSize: 18,
            fontWeight: "800",
            letterSpacing: 0.5,
          }}
        >
          LEGENDSTREAM
        </Text>
        <View
          style={{
            width: 5,
            height: 5,
            borderRadius: 3,
            backgroundColor: theme.color.accent,
            marginHorizontal: 12,
          }}
        />
        <Text
          numberOfLines={1}
          style={{ color: theme.color.muted, fontSize: 14, flexShrink: 1 }}
        >
          {providerName}
        </Text>
      </View>
      <EliteV4Hero
        item={hero}
        onOpen={onOpen}
        providerId={providerId}
        providerType={providerType}
      />
      {items.length ? (
        <EliteV4ContentRail items={items} onOpen={onOpen} />
      ) : (
        <Text
          style={{
            color: theme.color.muted,
            fontSize: 16,
            paddingVertical: 24,
          }}
        >
          {loading
            ? "Kataloğunuz yükleniyor…"
            : "Bu sağlayıcıda henüz gösterilecek içerik yok."}
        </Text>
      )}
    </ScrollView>
  );
}
