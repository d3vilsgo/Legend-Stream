import { Feather } from "@expo/vector-icons";
import { useEvent } from "expo";
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

  const fitLabel = fit === "contain" ? t("fit") : fit === "cover" ? t("crop") : t("stretch");

  const startDownload = async () => {
    if (!allowDownload || downloadState === "downloading") return;
    setDownloadState("downloading");
    try {
      const uri = typeof effectiveSource === "object" ? effectiveSource.uri : source;
      if (!uri) throw new Error("Missing media URL");
      await downloadMedia(uri, title);
      setDownloadState("done");
    } catch (caught) {
      console.warn("LegendStream download failed", caught);
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
          <Feather name="arrow-left" size={24} color="#fff" />
        </Pressable>
      ) : null}

      {/* Native player already exposes CC/subtitle and audio menus. Keep only
          LegendStream-specific actions beside those controls. */}
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
              size={22}
              color="#fff"
            />
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t("screen")} · ${fitLabel}`}
          onPress={cycleFit}
          style={styles.utilityButton}
        >
          <Feather name={fit === "contain" ? "maximize-2" : fit === "cover" ? "crop" : "maximize"} size={22} color="#fff" />
        </Pressable>
      </View>

      {downloadState === "downloading" ? (
        <View pointerEvents="none" style={styles.downloadBadge}><Text style={styles.downloadBadgeText}>{t("downloading")}</Text></View>
      ) : downloadState === "done" ? (
        <View pointerEvents="none" style={styles.downloadBadge}><Text style={styles.downloadBadgeText}>{t("downloaded")}</Text></View>
      ) : downloadState === "error" ? (
        <View pointerEvents="none" style={styles.downloadBadge}><Text style={styles.downloadBadgeText}>{t("downloadFailed")}</Text></View>
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
  utilityControls: { position: "absolute", right: 142, bottom: 18, flexDirection: "row", gap: 10 },
  utilityButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.60)" },
  downloadBadge: { position: "absolute", right: 18, top: 18, backgroundColor: "rgba(0,0,0,0.68)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  downloadBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,7,13,0.30)" },
  statusText: { fontSize: 14, fontWeight: "600" },
  errorPanel: { ...StyleSheet.absoluteFillObject, padding: 24, alignItems: "center", justifyContent: "center", gap: 8 },
  errorTitle: { fontSize: 20, fontWeight: "700" },
  errorText: { maxWidth: 680, fontSize: 13, lineHeight: 19, textAlign: "center" },
  urlText: { maxWidth: 680, fontSize: 11, textAlign: "center" },
});
