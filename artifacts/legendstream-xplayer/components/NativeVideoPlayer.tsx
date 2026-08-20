import { Feather } from "@expo/vector-icons";
import { useEvent } from "expo";
import React, { useCallback, useMemo, useState } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [subtitleOpen, setSubtitleOpen] = useState(false);
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

  const sourceInfo = useEvent(player, "sourceLoad", {
    videoSource: null,
    availableAudioTracks: [],
    availableSubtitleTracks: [],
    availableVideoTracks: [],
    duration: 0,
  });

  const audioTracks = sourceInfo.availableAudioTracks ?? [];
  const subtitleTracks = sourceInfo.availableSubtitleTracks ?? [];

  const exitPlayer = useCallback(() => {
    onFullscreenExit?.();
  }, [onFullscreenExit]);

  React.useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (audioOpen || subtitleOpen || settingsOpen) {
        setAudioOpen(false);
        setSubtitleOpen(false);
        setSettingsOpen(false);
        return true;
      }
      exitPlayer();
      return true;
    });
    return () => back.remove();
  }, [exitPlayer, audioOpen, subtitleOpen, settingsOpen]);

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
    } catch {
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("settings")}
        onPress={() => { setSettingsOpen((value) => !value); setAudioOpen(false); setSubtitleOpen(false); }}
        style={styles.settingsButton}
      >
        <Feather name="sliders" size={22} color="#fff" />
      </Pressable>

      {settingsOpen ? (
        <View style={styles.controlPanel}>
          <Pressable style={styles.controlRow} onPress={() => { setAudioOpen((value) => !value); setSubtitleOpen(false); }}>
            <Feather name="volume-2" size={18} color="#fff" /><Text style={styles.controlText}>{t("audio")} · {audioTracks.length || 1}</Text>
          </Pressable>
          <Pressable style={styles.controlRow} onPress={() => { setSubtitleOpen((value) => !value); setAudioOpen(false); }}>
            <Feather name="message-square" size={18} color="#fff" /><Text style={styles.controlText}>{t("subtitles")} · {subtitleTracks.length}</Text>
          </Pressable>
          <Pressable style={styles.controlRow} onPress={cycleFit}>
            <Feather name="maximize" size={18} color="#fff" /><Text style={styles.controlText}>{t("screen")} · {fitLabel}</Text>
          </Pressable>
          {allowDownload ? (
            <Pressable style={styles.controlRow} onPress={() => void startDownload()} disabled={downloadState === "downloading"}>
              <Feather name={downloadState === "done" ? "check-circle" : downloadState === "error" ? "alert-circle" : "download"} size={18} color="#fff" />
              <Text style={styles.controlText}>{downloadState === "downloading" ? t("downloading") : downloadState === "done" ? t("downloaded") : downloadState === "error" ? t("downloadFailed") : t("download")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {audioOpen ? (
        <TrackMenu title={t("audio")} emptyText={t("noTracks")}>
          {audioTracks.length ? audioTracks.map((track, index) => (
            <Pressable key={track.id || `${track.language}-${index}`} style={styles.trackRow} onPress={() => { player.audioTrack = track; setAudioOpen(false); setSettingsOpen(false); }}>
              <Text style={styles.trackText}>{track.label || track.language || `${t("audio")} ${index + 1}`}</Text>
            </Pressable>
          )) : null}
        </TrackMenu>
      ) : null}

      {subtitleOpen ? (
        <TrackMenu title={t("subtitles")} emptyText={t("noTracks")}>
          <Pressable style={styles.trackRow} onPress={() => { player.subtitleTrack = null; setSubtitleOpen(false); setSettingsOpen(false); }}>
            <Text style={styles.trackText}>{t("off")}</Text>
          </Pressable>
          {subtitleTracks.map((track, index) => (
            <Pressable key={track.id || `${track.language}-${index}`} style={styles.trackRow} onPress={() => { player.subtitleTrack = track; setSubtitleOpen(false); setSettingsOpen(false); }}>
              <Text style={styles.trackText}>{track.label || track.language || `${t("subtitles")} ${index + 1}`}</Text>
            </Pressable>
          ))}
        </TrackMenu>
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

function TrackMenu({ title, emptyText, children }: { title: string; emptyText: string; children: React.ReactNode }) {
  const count = React.Children.count(children);
  return <View style={styles.trackMenu}><Text style={styles.trackTitle}>{title}</Text><ScrollView style={{ maxHeight: 260 }}>{count ? children : <Text style={styles.trackText}>{emptyText}</Text>}</ScrollView></View>;
}

const styles = StyleSheet.create({
  root: { width: "100%", height: "100%", backgroundColor: "#05070d" },
  video: { width: "100%", height: "100%", backgroundColor: "#05070d" },
  backButton: { position: "absolute", top: 18, left: 18, width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.58)" },
  settingsButton: { position: "absolute", top: 18, right: 18, width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.58)" },
  controlPanel: { position: "absolute", top: 74, right: 18, width: 240, backgroundColor: "rgba(8,12,20,0.94)", borderRadius: 14, padding: 8, gap: 4 },
  controlRow: { minHeight: 46, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 10 },
  controlText: { color: "#fff", fontSize: 14, fontWeight: "700", flex: 1 },
  trackMenu: { position: "absolute", top: 74, right: 268, width: 250, backgroundColor: "rgba(8,12,20,0.96)", borderRadius: 14, padding: 10 },
  trackTitle: { color: "#fff", fontWeight: "800", fontSize: 15, marginBottom: 8 },
  trackRow: { minHeight: 42, justifyContent: "center", paddingHorizontal: 10, borderRadius: 8 },
  trackText: { color: "#fff", fontSize: 13 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,7,13,0.30)" },
  statusText: { fontSize: 14, fontWeight: "600" },
  errorPanel: { ...StyleSheet.absoluteFillObject, padding: 24, alignItems: "center", justifyContent: "center", gap: 8 },
  errorTitle: { fontSize: 20, fontWeight: "700" },
  errorText: { maxWidth: 680, fontSize: 13, lineHeight: 19, textAlign: "center" },
  urlText: { maxWidth: 680, fontSize: 11, textAlign: "center" },
});
