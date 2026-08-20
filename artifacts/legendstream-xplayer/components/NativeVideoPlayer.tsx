import { Feather } from "@expo/vector-icons";
import { useEvent } from "expo";
import React, { useCallback, useMemo } from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { VideoView, useVideoPlayer, type VideoSource } from "expo-video";
import { useColors } from "@/hooks/useColors";

export function NativeVideoPlayer({
  source,
  title,
  autoFullscreen = true,
  onFullscreenExit,
}: {
  source: string;
  title: string;
  autoFullscreen?: boolean;
  onFullscreenExit?: () => void;
}) {
  const colors = useColors();

  const effectiveSource = useMemo(() => {
    const uri = /\/live\//i.test(source) && /\.m3u8(?:$|\?)/i.test(source)
      ? source.replace(/\.m3u8(?=$|\?)/i, ".ts")
      : source;

    const value: VideoSource = {
      uri,
      contentType: /\.m3u8(?:$|\?)/i.test(uri) ? "hls" : "auto",
      headers: {
        Accept: "*/*",
        "User-Agent": "ExoPlayer/LegendStream-XPlayer",
      },
    };
    return value;
  }, [source]);

  const player = useVideoPlayer(effectiveSource, (instance) => {
    instance.staysActiveInBackground = false;
    instance.play();
  });

  const { status, error } = useEvent(player, "statusChange", {
    status: player.status,
  });

  const exitPlayer = useCallback(() => {
    onFullscreenExit?.();
  }, [onFullscreenExit]);

  React.useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      exitPlayer();
      return true;
    });
    return () => back.remove();
  }, [exitPlayer]);

  return (
    <View style={styles.root}>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        fullscreenOptions={{ enable: !autoFullscreen }}
        allowsPictureInPicture
        contentFit="contain"
      />

      {onFullscreenExit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={exitPlayer}
          style={styles.backButton}
        >
          <Feather name="arrow-left" size={24} color="#fff" />
        </Pressable>
      ) : null}

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
          <Text numberOfLines={2} style={[styles.urlText, { color: colors.primary }]}> 
            {typeof effectiveSource === "object" ? effectiveSource.uri : source}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%", height: "100%", backgroundColor: "#05070d" },
  video: { width: "100%", height: "100%", backgroundColor: "#05070d" },
  backButton: {
    position: "absolute",
    top: 18,
    left: 18,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.52)",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5,7,13,0.36)",
  },
  statusText: { fontSize: 14, fontWeight: "600" },
  errorPanel: {
    ...StyleSheet.absoluteFillObject,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  errorTitle: { fontSize: 20, fontWeight: "700" },
  errorText: { maxWidth: 680, fontSize: 13, lineHeight: 19, textAlign: "center" },
  urlText: { maxWidth: 680, fontSize: 11, textAlign: "center" },
});
