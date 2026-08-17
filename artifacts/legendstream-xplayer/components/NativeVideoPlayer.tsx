import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { useColors } from "@/hooks/useColors";

export function NativeVideoPlayer({
  source,
  title,
}: {
  source: string;
  title: string;
}) {
  const colors = useColors();
  const player = useVideoPlayer(source, (instance) => {
    instance.play();
    instance.staysActiveInBackground = true;
  });

  if (Platform.OS === "web") {
    return (
      <View style={[styles.webFallback, { backgroundColor: colors.card }]}>
        <Text style={[styles.webTitle, { color: colors.foreground }]}>
          {title}
        </Text>
        <Text style={[styles.webText, { color: colors.mutedForeground }]}>
          Playback is available on the Android build. Web preview is for
          navigation and provider setup.
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.webUrl, { color: colors.primary }]}
        >
          {source}
        </Text>
      </View>
    );
  }

  return (
    <VideoView
      player={player}
      style={styles.video}
      nativeControls
      allowsPictureInPicture
      contentFit="contain"
    />
  );
}

const styles = StyleSheet.create({
  video: {
    width: "100%",
    height: "100%",
    backgroundColor: "#05070d",
  },
  webFallback: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    gap: 8,
  },
  webTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
  },
  webText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  webUrl: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
});