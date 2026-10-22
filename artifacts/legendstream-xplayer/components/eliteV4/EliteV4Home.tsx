import React from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { EliteV4Hero } from "./EliteV4Hero";
import { EliteV4ContentRail } from "./EliteV4ContentRail";
import type { EliteHomeSections, EliteHomeItem } from "@/lib/eliteV4HomeModel";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

function cardWidthForViewport(width: number) {
  const horizontalPadding = width < 600 ? 18 : 30;
  const available = Math.max(
    180,
    width - theme.layout.sidebarCompact - horizontalPadding * 2 - 24,
  );
  return Math.max(
    theme.layout.railCardMin,
    Math.min(theme.layout.railCardMax, Math.floor(available / 1.65)),
  );
}

export function EliteV4Home({
  sections,
  providerName,
  providerId,
  providerType,
  loading,
  onOpen,
}: {
  sections: EliteHomeSections;
  providerName: string;
  providerId: string;
  providerType: string;
  loading: boolean;
  onOpen: (item: EliteHomeItem) => void;
}) {
  const { width, height } = useWindowDimensions();
  const hero =
    sections.featured[0] ??
    sections.continueWatching[0] ??
    sections.movies[0] ??
    sections.series[0] ??
    sections.live[0] ??
    null;
  const padding = width < 600 ? 18 : 30;
  const heroHeight = Math.max(
    theme.layout.heroMinHeight,
    Math.min(theme.layout.heroMaxHeight, Math.round(height * 0.35)),
  );
  const cardWidth = cardWidthForViewport(width);
  const visibleSections = [
    {
      id: "featured",
      title: "Öne Çıkanlar",
      items: sections.featured.filter((item) => item.id !== hero?.id),
    },
    {
      id: "continue",
      title: "İzlemeye Devam Et",
      items: sections.continueWatching,
    },
    { id: "live", title: "Canlı Kanallar", items: sections.live },
    { id: "movies", title: "Filmler", items: sections.movies },
    { id: "series", title: "Diziler", items: sections.series },
  ].filter((section) => section.items.length > 0);
  const firstRailFocusId = visibleSections[0]
    ? `${visibleSections[0].id}-0`
    : undefined;

  return (
    <ScrollView
      style={{ flex: 1, minWidth: 0, backgroundColor: theme.color.background }}
      contentContainerStyle={{
        paddingTop: 18,
        paddingHorizontal: padding,
        paddingBottom: 30,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", marginBottom: 13 }}
      >
        <Text
          style={{
            color: theme.color.foreground,
            fontSize: 16,
            fontWeight: "600",
            letterSpacing: 0.4,
          }}
        >
          LEGENDSTREAM
        </Text>
        <View
          style={{
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.color.accent,
            marginHorizontal: 10,
          }}
        />
        <Text
          numberOfLines={1}
          style={{ color: theme.color.muted, fontSize: 12, flexShrink: 1 }}
        >
          {providerName}
        </Text>
      </View>
      <EliteV4Hero
        item={hero}
        onOpen={onOpen}
        providerId={providerId}
        providerType={providerType}
        height={heroHeight}
        width={Math.max(260, width - theme.layout.sidebarCompact - padding * 2)}
        firstRailFocusId={firstRailFocusId}
      />
      {visibleSections.map((section) => (
        <EliteV4ContentRail
          key={section.id}
          railId={section.id}
          title={section.title}
          items={section.items}
          onOpen={onOpen}
          cardWidth={cardWidth}
        />
      ))}
      {!hero && !visibleSections.length ? (
        <Text
          style={{
            color: theme.color.muted,
            fontSize: 14,
            paddingVertical: 20,
          }}
        >
          {loading
            ? "Kataloğunuz yükleniyor…"
            : "Bu sağlayıcıda gösterilecek içerik bulunamadı."}
        </Text>
      ) : null}
    </ScrollView>
  );
}
