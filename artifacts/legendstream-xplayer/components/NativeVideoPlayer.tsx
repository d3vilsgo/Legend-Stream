import { Feather } from "@expo/vector-icons";
import { useEvent } from "expo";
import * as ScreenOrientation from "expo-screen-orientation";
import React, { useCallback, useMemo, useState } from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { VideoView, useVideoPlayer, type VideoSource } from "expo-video";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/context/I18nContext";
import { downloadMedia } from "@/lib/downloads";

type FitMode = "contain" | "cover" | "fill";
type DownloadState = "idle" | "downloading" | "done" | "error";

export function NativeVideoPlayer({
  source,
  title,
  autoFullscreen = true,
  onFullscreenExit,
  allowDownload = false,
}: {
  source: string;
  title: string;
  autoFullscreen?: boolean;
  onFullscreenExit?: () => void;
  allowDownload?: boolean;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const [fit, setFit] = useState<FitMode>("contain");
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const [downloadError, setDownloadError] = useState<string | null>(null);

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

  const cycleFit = () => {
    setFit((current) => current === "contain" ? "cover" : current === "cover" ? "fill" : "contain");
  };

  const rotateScreen = async () => {
    try {
      const orientation = await ScreenOrientation.getOrientationAsync();
      const landscape =
        orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
      await ScreenOrientation.lockAsync(
        landscape
          ? ScreenOrientation.OrientationLock.PORTRAIT_UP
          : ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT,
      );
    } catch {
      // Manual orientation is best-effort on vendor-customized Android builds.
    }
  };

  const startDownload = async () => {
    if (!allowDownload || downloadState === "downloading") return;
    setDownloadState("downloading");
    setDownloadError(null);
    try {
      const uri = typeof effectiveSource === "object" ? effectiveSource.uri : source;
      if (!uri) throw new Error("Missing media URL");
      await downloadMedia(uri, title);
      setDownloadState("done");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "DOWNLOAD_FAILED";
      console.warn("LegendStream download failed", caught);
      setDownloadError(message);
      setDownloadState("error");
    }
  };

  return (
    <View style={styles.root}>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        fullscreenOptions={{ enable: !autoFullscreen }}
        allowsPictureInPicture
        contentFit={fit}
      />

      {onFullscreenExit ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={exitPlayer} style={styles.backButton}>
          <Feather name="arrow-left" size={26} color="#fff" />
        </Pressable>
      ) : null}

      {/* Native controls already provide CC/subtitle and the media settings gear.
          Keep only actions that the native Android player does not expose. */}
      <View style={styles.utilityControls}>
        {allowDownload ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("download")}
            onPress={() => void startDownload()}
            disabled={downloadState === "downloading"}
            style={styles.utilityButton}
          >
            <Feather
              name={downloadState === "done" ? "check-circle" : downloadState === "error" ? "alert-circle" : "download"}
              size={23}
              color="#fff"
            />
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("screen")}
          onPress={cycleFit}
          style={styles.utilityButton}
        >
          <Feather name={fit === "contain" ? "maximize-2" : fit === "cover" ? "crop" : "maximize"} size={23} color="#fff" />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rotate screen"
          onPress={() => void rotateScreen()}
          style={styles.utilityButton}
        >
          <Feather name="rotate-cw" size={23} color="#fff" />
        </Pressable>
      </View>

      {downloadState === "downloading" ? (
        <View pointerEvents="none" style={styles.downloadBadge}><Text style={styles.downloadBadgeText}>{t("downloading")}</Text></View>
      ) : downloadState === "done" ? (
        <View pointerEvents="none" style={styles.downloadBadge}><Text style={styles.downloadBadgeText}>{t("downloaded")}</Text></View>
      ) : downloadState === "error" ? (
        <View pointerEvents="none" style={styles.downloadBadge}><Text numberOfLines={2} style={styles.downloadBadgeText}>{t("downloadFailed")}{downloadError ? ` · ${downloadError}` : ""}</Text></View>
      ) : null}

      {status === "loading" ? (
        <View pointerEvents="none" style={styles.overlay}>
          <Text style={[styles.statusText, { color: colors.foreground }]}>{t("loadingVideo")}</Text>
        </View>
      ) : null}

      {status === "error" ? (
        <View style={[styles.errorPanel, { backgroundColor: colors.card }]}> 
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>{t("playbackFailed")}</Text>
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{error?.message || t("playbackFailed")}</Text>
          <Text numberOfLines={2} style={[styles.urlText, { color: colors.primary }]}>{typeof effectiveSource === "object" ? effectiveSource.uri : source}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%", height: "100%", backgroundColor: "#05070d" },
  video: { width: "100%", height: "100%", backgroundColor: "#05070d" },
  backButton: { position: "absolute", top: 18, left: 18, width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.58)" },
  utilityControls: { position: "absolute", right: 142, bottom: 18, flexDirection: "row", gap: 8 },
  utilityButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.54)" },
  downloadBadge: { position: "absolute", right: 18, top: 18, maxWidth: 420, backgroundColor: "rgba(0,0,0,0.72)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  downloadBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,7,13,0.30)" },
  statusText: { fontSize: 14, fontWeight: "600" },
  errorPanel: { ...StyleSheet.absoluteFillObject, padding: 24, alignItems: "center", justifyContent: "center", gap: 8 },
  errorTitle: { fontSize: 20, fontWeight: "700" },
  errorText: { maxWidth: 680, fontSize: 13, lineHeight: 19, textAlign: "center" },
  urlText: { maxWidth: 680, fontSize: 11, textAlign: "center" },
});
