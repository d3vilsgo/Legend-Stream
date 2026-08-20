import { Feather } from "@expo/vector-icons";
import { useEvent } from "expo";
import * as ScreenOrientation from "expo-screen-orientation";
import React, { useCallback, useEffect, useMemo } from "react";
import {
  BackHandler,
  Platform,
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
    // Xtream live streams are normally MPEG-TS. Some panels report m3u8 even
    // though the HLS endpoint is rejected while the TS endpoint works.
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

  const exitPlayer = useCallback(async () => {
    if (Platform.OS === "android" && autoFullscreen) {
      // Restore portrait before returning to the catalogue. Doing this before
      // changing the React view prevents the catalogue briefly appearing in
      // landscape during player dismissal.
      try {
        await ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.PORTRAIT_UP,
        );
      } catch {
        // Orientation restoration is best-effort.
      }
    }
    onFullscreenExit?.();
  }, [autoFullscreen, onFullscreenExit]);

  useEffect(() => {
    if (Platform.OS !== "android" || !autoFullscreen) return;

    // This component is already mounted as a dedicated full-screen player
    // screen. Lock that screen to landscape instead of opening expo-video's
    // second fullscreen layer, which caused landscape -> portrait -> landscape
    // flicker on some Android devices.
    void ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    ).catch(() => undefined);

    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      void exitPlayer();
      return true;
    });

    return () => {
      back.remove();
    };
  }, [autoFullscreen, exitPlayer]);

  return (
    <View style={styles.root}>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        // The surrounding player route is already true full-screen. Disable
        // the nested native fullscreen modal so Android performs only one
        // orientation transition.
        fullscreenOptions={{ enable: !autoFullscreen }}
        allowsPictureInPicture
        contentFit="contain"
      />

      {onFullscreenExit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => void exitPlayer()}
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