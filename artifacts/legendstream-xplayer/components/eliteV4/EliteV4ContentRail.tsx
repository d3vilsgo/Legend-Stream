import React from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { EliteV4FocusButton } from "./EliteV4FocusSurface";
import type { EliteHomeItem } from "@/lib/eliteV4HomeModel";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

export function EliteV4ContentRail({
  items,
  onOpen,
}: {
  items: readonly EliteHomeItem[];
  onOpen: (item: EliteHomeItem) => void;
}) {
  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: theme.color.foreground,
            fontSize: theme.type.subtitle,
            fontWeight: "800",
          }}
        >
          {items[0]?.kind === "live" ? "Canlı Yayınlar" : "Sizin İçin"}
        </Text>
        <Text
          style={{ color: theme.color.quiet, fontSize: theme.type.eyebrow }}
        >
          {items.length ? `${items.length} içerik` : "Katalog bekleniyor"}
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 16,
          paddingVertical: 8,
          paddingRight: 36,
        }}
      >
        {items.map((item, index) => {
          const id = `rail-${index}`;
          return (
            <EliteV4FocusButton
              key={item.id}
              focusId={id}
              region="content"
              neighbors={{
                left: index === 0 ? "sidebar-home" : `rail-${index - 1}`,
                right:
                  index < items.length - 1 ? `rail-${index + 1}` : undefined,
                up: "hero",
              }}
              onPress={() => onOpen(item)}
              accessibilityLabel={`${item.title}, ${item.kind === "live" ? "canlı yayın" : "film"}`}
              style={{
                width: theme.layout.railCardWidth,
                borderRadius: theme.radius.large,
                borderWidth: 2,
                borderColor: "transparent",
                overflow: "hidden",
                backgroundColor: theme.color.surface,
                paddingBottom: 12,
              }}
            >
              {item.image ? (
                <Image
                  source={{ uri: item.image }}
                  resizeMode="cover"
                  style={{
                    width: "100%",
                    height: theme.layout.railCardHeight,
                    backgroundColor: theme.color.surfaceRaised,
                  }}
                />
              ) : (
                <View
                  style={{
                    width: "100%",
                    height: theme.layout.railCardHeight,
                    backgroundColor: theme.color.surfaceRaised,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                />
              )}
              <Text
                numberOfLines={1}
                style={{
                  color: theme.color.foreground,
                  fontSize: 14,
                  fontWeight: "700",
                  marginTop: 10,
                  marginHorizontal: 12,
                }}
              >
                {item.title}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  color: theme.color.muted,
                  fontSize: 12,
                  marginTop: 4,
                  marginHorizontal: 12,
                }}
              >
                {item.subtitle}
              </Text>
            </EliteV4FocusButton>
          );
        })}
      </ScrollView>
    </View>
  );
}
