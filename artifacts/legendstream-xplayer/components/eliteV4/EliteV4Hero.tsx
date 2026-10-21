import React from "react";
import { ImageBackground, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import type { EliteHomeItem } from "@/lib/eliteV4HomeModel";
import { EliteV4FocusButton } from "./EliteV4FocusSurface";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

export function EliteV4Hero({
  item,
  onOpen,
}: {
  item: EliteHomeItem | null;
  onOpen: (item: EliteHomeItem) => void;
}) {
  return (
    <View
      style={{
        height: 360,
        borderRadius: theme.radius.hero,
        overflow: "hidden",
        backgroundColor: theme.color.surfaceRaised,
        marginBottom: theme.spacing.xl,
      }}
    >
      {item?.image ? (
        <ImageBackground
          source={{ uri: item.image }}
          resizeMode="cover"
          style={{ flex: 1, justifyContent: "flex-end" }}
        />
      ) : null}
      <LinearGradient
        colors={[
          "rgba(8,10,14,0.02)",
          "rgba(8,10,14,0.48)",
          "rgba(8,10,14,0.97)",
        ]}
        locations={[0, 0.48, 1]}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <View
        style={{
          position: "absolute",
          left: 34,
          right: 34,
          bottom: 30,
          alignItems: "flex-start",
        }}
      >
        <Text
          style={{
            color: theme.color.accent,
            fontSize: theme.type.eyebrow,
            fontWeight: "800",
            letterSpacing: 2,
            marginBottom: 12,
          }}
        >
          ÖNE ÇIKAN
        </Text>
        <Text
          numberOfLines={2}
          style={{
            color: theme.color.foreground,
            fontSize: theme.type.hero,
            fontWeight: "900",
            maxWidth: 760,
            letterSpacing: -1.4,
          }}
        >
          {item?.title ?? "LegendStream"}
        </Text>
        <Text
          numberOfLines={2}
          style={{
            color: theme.color.muted,
            fontSize: theme.type.body,
            marginTop: 8,
            maxWidth: 650,
          }}
        >
          {item?.subtitle ??
            "Kataloğunuz hazır olduğunda içerikler burada görünür."}
        </Text>
        {item ? (
          <EliteV4FocusButton
            focusId="hero"
            region="content"
            initial
            neighbors={{
              left: "sidebar-home",
              down: "rail-0",
              right: "rail-0",
            }}
            onPress={() => onOpen(item)}
            accessibilityLabel={`${item.title} oynat`}
            style={{
              marginTop: 22,
              minHeight: 50,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.foreground,
              borderWidth: 2,
              borderColor: "transparent",
              paddingHorizontal: 23,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Feather name="play" size={17} color={theme.color.background} />
            <Text
              style={{
                color: theme.color.background,
                fontWeight: "900",
                fontSize: 14,
              }}
            >
              Şimdi izle
            </Text>
          </EliteV4FocusButton>
        ) : null}
      </View>
    </View>
  );
}
