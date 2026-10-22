import React, { useRef } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { EliteV4FocusButton } from "./EliteV4FocusSurface";
import type { EliteHomeItem } from "@/lib/eliteV4HomeModel";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

export function EliteV4ContentRail({
  title,
  railId = "rail",
  items,
  onOpen,
  cardWidth = theme.layout.railCardMax,
  previousRail,
  nextRail,
  onLayoutY,
  onFocused,
}: {
  title: string;
  railId?: string;
  items: readonly EliteHomeItem[];
  onOpen: (item: EliteHomeItem) => void;
  cardWidth?: number;
  previousRail?: { id: string; items: readonly EliteHomeItem[] };
  nextRail?: { id: string; items: readonly EliteHomeItem[] };
  onLayoutY?: (y: number) => void;
  onFocused?: () => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  if (!items.length) return null;
  return (
    <View
      onLayout={(event) => onLayoutY?.(event.nativeEvent.layout.y)}
      style={{ marginBottom: theme.spacing.lg }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 10,
          paddingRight: 8,
        }}
      >
        <Text
          style={{
            color: theme.color.foreground,
            fontSize: theme.type.subtitle,
            fontWeight: "600",
          }}
        >
          {title}
        </Text>
        <Text
          style={{ color: theme.color.quiet, fontSize: theme.type.eyebrow }}
        >
          {items.length}
        </Text>
      </View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 12,
          paddingVertical: 8,
          paddingRight: 28,
        }}
      >
        {items.map((item, index) => {
          const live = item.kind === "live";
          const isContinue = item.progressFraction !== undefined;
          const imageHeight = live
            ? Math.round(cardWidth * 0.56)
            : Math.round(cardWidth * 1.34);
          const kindLabel = live
            ? "canlı kanal"
            : item.kind === "series"
              ? "dizi"
              : "film";
          return (
            <EliteV4FocusButton
              key={item.id}
              focusId={`${railId}-${index}`}
              region="content"
              neighbors={{
                left: index === 0 ? "sidebar-home" : `${railId}-${index - 1}`,
                right:
                  index < items.length - 1
                    ? `${railId}-${index + 1}`
                    : undefined,
                up: previousRail
                  ? `${previousRail.id}-${Math.min(index, previousRail.items.length - 1)}`
                  : "hero",
                down: nextRail
                  ? `${nextRail.id}-${Math.min(index, nextRail.items.length - 1)}`
                  : undefined,
              }}
              onPress={() => onOpen(item)}
              onFocused={() => {
                onFocused?.();
                scrollRef.current?.scrollTo({
                  x: Math.max(0, index * (cardWidth + 12) - 6),
                  animated: true,
                });
              }}
              accessibilityLabel={`${item.title}, ${kindLabel}${isContinue ? ", izlemeye devam et" : ""}`}
              style={{
                width: cardWidth,
                borderRadius: theme.radius.medium,
                borderWidth: 1,
                borderColor: theme.color.border,
                overflow: "hidden",
                backgroundColor: theme.color.surface,
              }}
            >
              {item.image ? (
                <Image
                  source={{ uri: item.image }}
                  resizeMode={live ? "contain" : "cover"}
                  style={{
                    width: "100%",
                    height: imageHeight,
                    padding: live ? 14 : 0,
                    backgroundColor: live
                      ? theme.color.surfaceRaised
                      : "#101721",
                  }}
                />
              ) : (
                <View
                  style={{
                    width: "100%",
                    height: imageHeight,
                    backgroundColor: theme.color.surfaceRaised,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Feather
                    name={
                      live ? "radio" : item.kind === "series" ? "tv" : "film"
                    }
                    size={28}
                    color={theme.color.quiet}
                  />
                </View>
              )}
              <View
                style={{
                  minHeight: isContinue ? 94 : 76,
                  paddingHorizontal: 10,
                  paddingTop: 9,
                  paddingBottom: 11,
                }}
              >
                <Text
                  numberOfLines={2}
                  style={{
                    color: theme.color.foreground,
                    fontSize: 13,
                    fontWeight: "500",
                    lineHeight: 18,
                  }}
                >
                  {item.title}
                </Text>
                {item.subtitle ? (
                  <Text
                    numberOfLines={1}
                    style={{
                      color: theme.color.muted,
                      fontSize: 11,
                      marginTop: 4,
                    }}
                  >
                    {item.subtitle}
                  </Text>
                ) : null}
                {isContinue ? (
                  <View
                    style={{
                      height: 3,
                      marginTop: 9,
                      borderRadius: 3,
                      backgroundColor: theme.color.border,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        width: `${Math.round((item.progressFraction ?? 0) * 100)}%`,
                        height: "100%",
                        backgroundColor: theme.color.accent,
                      }}
                    />
                  </View>
                ) : null}
                {item.kind === "series" ? (
                  <Text
                    numberOfLines={1}
                    style={{
                      color: theme.color.quiet,
                      fontSize: 10,
                      marginTop: 5,
                    }}
                  >
                    Seçmek için Elite V3'e geç
                  </Text>
                ) : null}
              </View>
            </EliteV4FocusButton>
          );
        })}
      </ScrollView>
    </View>
  );
}
