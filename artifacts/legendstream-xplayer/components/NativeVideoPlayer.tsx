import { useEvent } from "expo";
import * as ScreenOrientation from "expo-screen-orientation";
import React, { useEffect, useRef } from "react";
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
  const videoRef = useRef<VideoView>(null);
  const player = useVideoPlayer(source, (instance) => {
    instance.staysActiveInBackground = true;
    instance.play();
  });
  const { status, error } = useEvent(player, "statusChange", {
    status: player.status,
  });

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return () => {
      void ScreenOrientation.unlockAsync();
    };
  }, []);

  const lockLandscape = () => {
    if (Platform.OS === "android") {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    }
  };

  const unlockOrientation = () => {
    if (Platform.OS === "android") {
      void ScreenOrientation.unlockAsync();
    }
  };

  return (
    <View style={styles.root}>
      <VideoView
        ref={videoRef}
        player={player}
        style={styles.video}
        nativeControls
        allowsFullscreen
        allowsPictureInPicture
        contentFit="contain"
        onFullscreenEnter={lockLandscape}
        onFullscreenExit={unlockOrientation}
      />
      {status === "loading" ? (
        <View pointerEvents="none" style={styles.overlay}>
          <Text style={[styles.statusText, { color: colors.foreground }]}>Loading {title}…</Text>
        </View>
      ) : null}
      {status === "error" ? (
        <View style={[styles.errorPanel, { backgroundColor: colors.card }]}> 
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>Playback failed</Text>
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}> 
            {error?.message || "The stream could not be decoded or reached."}
          </Text>
          {Platform.OS === "web" && source.startsWith("http://") ? (
            <Text style={[styles.errorText, { color: colors.mutedForeground }]}> 
              This provider uses HTTP. An HTTPS browser preview can block HTTP video as mixed content; test the same stream in the Android build.
            </Text>
          ) : null}
          <Text numberOfLines={1} style={[styles.urlText, { color: colors.primary }]}>{source}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: "100%",
    height: "100%",
    backgroundColor: "#05070d",
  },
  video: {
    width: "100%",
    height: "100%",
    backgroundColor: "#05070d",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5,7,13,0.36)",
  },
  statusText: {
    fontSize: 14,
    fontWeight: "600",
  },
  errorPanel: {
    ...StyleSheet.absoluteFillObject,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  errorText: {
    maxWidth: 680,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  urlText: {
    maxWidth: 680,
    fontSize: 11,
  },
});
