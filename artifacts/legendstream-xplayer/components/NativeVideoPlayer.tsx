import { Feather } from "@expo/vector-icons";
import { useEvent } from "expo";
import * as ScreenOrientation from "expo-screen-orientation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useMediaLibrary } from "@/context/MediaLibraryContext";
import { usePlayer } from "@/context/PlayerContext";
import { downloadMedia } from "@/lib/downloads";
import { getEpisodePlaybackQueue, getVodPlaybackQueue } from "@/lib/xtreamCatalog";

type FitMode = "contain" | "cover" | "fill";
type DownloadState = "idle" | "downloading" | "done" | "error";
type SelectableItem = { id: string; title: string; subtitle?: string; source: string; isLive?: boolean };

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
  const { getProgress, saveProgress } = useMediaLibrary();
  const { provider, channels, recordWatched } = usePlayer();
  const [fit, setFit] = useState<FitMode>("contain");
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [currentSource, setCurrentSource] = useState(source);
  const [currentTitle, setCurrentTitle] = useState(title);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mediaKind = useMemo<"live" | "movie" | "episode" | "download">(() => {
    if (/^file:/i.test(currentSource)) return "download";
    if (/\/movie\//i.test(currentSource)) return "movie";
    if (/\/series\//i.test(currentSource)) return "episode";
    return "live";
  }, [currentSource]);

  const effectiveSource = useMemo(() => {
    const uri = /\/live\//i.test(currentSource) && /\.m3u8(?:$|\?)/i.test(currentSource)
      ? currentSource.replace(/\.m3u8(?=$|\?)/i, ".ts")
      : currentSource;

    const value: VideoSource = {
      uri,
      contentType: /\.m3u8(?:$|\?)/i.test(uri) ? "hls" : "auto",
      headers: /^https?:/i.test(uri) ? {
        Accept: "*/*",
        "User-Agent": "ExoPlayer/LegendStream-XPlayer",
      } : undefined,
    };
    return value;
  }, [currentSource]);

  const initialResume = mediaKind === "movie" || mediaKind === "episode" ? getProgress(currentSource) : undefined;

  const player = useVideoPlayer(effectiveSource, (instance) => {
    instance.staysActiveInBackground = false;
    if (initialResume && initialResume.position > 5) {
      try { (instance as any).currentTime = initialResume.position; } catch { /* best effort */ }
    }
    instance.play();
  });

  const loadedUri = useRef(typeof effectiveSource === "object" ? effectiveSource.uri : currentSource);

  const { status, error } = useEvent(player, "statusChange", {
    status: player.status,
  });

  const revealControls = useCallback((keep = false) => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!keep && !selectorOpen && downloadState !== "downloading") {
      hideTimer.current = setTimeout(() => setControlsVisible(false), 3200);
    }
  }, [downloadState, selectorOpen]);

  useEffect(() => {
    revealControls(selectorOpen || downloadState === "downloading");
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [downloadState, revealControls, selectorOpen]);

  useEffect(() => {
    const uri = typeof effectiveSource === "object" ? effectiveSource.uri : currentSource;
    if (!uri || loadedUri.current === uri) return;
    loadedUri.current = uri;
    const load = async () => {
      try {
        const anyPlayer = player as any;
        if (typeof anyPlayer.replaceAsync === "function") await anyPlayer.replaceAsync(effectiveSource);
        else if (typeof anyPlayer.replace === "function") anyPlayer.replace(effectiveSource);
        const resume = mediaKind === "movie" || mediaKind === "episode" ? getProgress(currentSource) : undefined;
        if (resume && resume.position > 5) {
          try { anyPlayer.currentTime = resume.position; } catch { /* best effort */ }
        }
        player.play();
      } catch (caught) {
        console.warn("LegendStream source switch failed", caught);
      }
    };
    void load();
  }, [currentSource, effectiveSource, getProgress, mediaKind, player]);

  const persistProgress = useCallback(async () => {
    if (mediaKind !== "movie" && mediaKind !== "episode") return;
    const position = Number((player as any).currentTime ?? 0);
    const duration = Number((player as any).duration ?? 0);
    if (!Number.isFinite(position) || position < 1) return;
    await saveProgress({
      kind: mediaKind,
      title: currentTitle,
      source: currentSource,
      position,
      duration: Number.isFinite(duration) ? duration : 0,
    });
  }, [currentSource, currentTitle, mediaKind, player, saveProgress]);

  const exitPlayer = useCallback(() => {
    void persistProgress();
    onFullscreenExit?.();
  }, [onFullscreenExit, persistProgress]);

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selectorOpen) {
        setSelectorOpen(false);
        revealControls();
        return true;
      }
      exitPlayer();
      return true;
    });
    return () => back.remove();
  }, [exitPlayer, revealControls, selectorOpen]);

  useEffect(() => {
    if (mediaKind !== "movie" && mediaKind !== "episode") return;
    const timer = setInterval(() => { void persistProgress(); }, 5000);
    return () => {
      clearInterval(timer);
      void persistProgress();
    };
  }, [mediaKind, persistProgress]);

  const currentLive = useMemo(() => {
    if (mediaKind !== "live" || !provider) return undefined;
    return channels.find((channel) => channel.providerId === provider.id && channel.streamUrl === currentSource);
  }, [channels, currentSource, mediaKind, provider]);

  const liveQueue = useMemo(() => {
    if (!currentLive || !provider) return [];
    const sameCategory = channels.filter((channel) => channel.providerId === provider.id && channel.category === currentLive.category);
    return sameCategory.length ? sameCategory : channels.filter((channel) => channel.providerId === provider.id);
  }, [channels, currentLive, provider]);

  const episodeQueue = useMemo(() => mediaKind === "episode" ? getEpisodePlaybackQueue(currentSource) : undefined, [currentSource, mediaKind]);
  const vodQueue = useMemo(() => mediaKind === "movie" ? getVodPlaybackQueue(currentSource) : undefined, [currentSource, mediaKind]);

  const selectableItems = useMemo<SelectableItem[]>(() => {
    if (mediaKind === "live") {
      return liveQueue.slice(0, 500).map((channel) => ({
        id: channel.id,
        title: channel.name,
        subtitle: channel.category,
        source: channel.streamUrl,
        isLive: true,
      }));
    }
    if (mediaKind === "episode" && episodeQueue) {
      return episodeQueue.items.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: `${t("season")} ${item.season}${item.episodeNumber ? ` · ${t("episode")} ${item.episodeNumber}` : ""}`,
        source: item.url,
      }));
    }
    if (mediaKind === "movie" && vodQueue) {
      const current = vodQueue.items[vodQueue.index];
      const sameCategory = current?.categoryId
        ? vodQueue.items.filter((item) => item.categoryId === current.categoryId)
        : vodQueue.items;
      return sameCategory.slice(0, 500).map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.genre || t("movies"),
        source: item.url,
      }));
    }
    return [];
  }, [episodeQueue, liveQueue, mediaKind, t, vodQueue]);

  const currentIndex = useMemo(() => selectableItems.findIndex((item) => item.source === currentSource), [currentSource, selectableItems]);

  const switchTo = useCallback(async (item: SelectableItem) => {
    await persistProgress();
    setCurrentSource(item.source);
    setCurrentTitle(item.title);
    setSelectorOpen(false);
    if (item.isLive) void recordWatched(item.id);
    revealControls();
  }, [persistProgress, recordWatched, revealControls]);

  const moveRelative = useCallback((delta: number) => {
    if (!selectableItems.length || currentIndex < 0) return;
    const next = currentIndex + delta;
    if (next < 0 || next >= selectableItems.length) return;
    void switchTo(selectableItems[next]);
  }, [currentIndex, selectableItems, switchTo]);

  useEffect(() => {
    const anyPlayer = player as any;
    if (typeof anyPlayer.addListener !== "function") return;
    const subscription = anyPlayer.addListener("playToEnd", () => {
      if (mediaKind === "episode" && currentIndex >= 0 && currentIndex < selectableItems.length - 1) {
        moveRelative(1);
      }
    });
    return () => subscription?.remove?.();
  }, [currentIndex, mediaKind, moveRelative, player, selectableItems.length]);

  const cycleFit = () => {
    setFit((current) => current === "contain" ? "cover" : current === "cover" ? "fill" : "contain");
    revealControls();
  };

  const rotateScreen = async () => {
    revealControls();
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
      // Best effort on vendor-customized Android builds.
    }
  };

  const startDownload = async () => {
    if (!allowDownload || downloadState === "downloading") return;
    revealControls(true);
    setDownloadState("downloading");
    setDownloadError(null);
    setDownloadProgress(0);
    try {
      const uri = typeof effectiveSource === "object" ? effectiveSource.uri : currentSource;
      if (!uri) throw new Error("Missing media URL");
      await downloadMedia(uri, currentTitle, {
        kind: mediaKind === "episode" ? "episode" : "movie",
        onProgress: (progress) => setDownloadProgress(progress),
      });
      setDownloadProgress(1);
      setDownloadState("done");
      setTimeout(() => setDownloadState("idle"), 2500);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "DOWNLOAD_FAILED";
      console.warn("LegendStream download failed", caught);
      setDownloadError(message);
      setDownloadState("error");
    }
  };

  const canNavigate = selectableItems.length > 1 && currentIndex >= 0;

  return (
    <View style={styles.root} onTouchStart={() => revealControls(selectorOpen)}>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        fullscreenOptions={{ enable: !autoFullscreen }}
        allowsPictureInPicture
        contentFit={fit}
      />

      {controlsVisible && onFullscreenExit ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={exitPlayer} style={styles.backButton}>
          <Feather name="arrow-left" size={26} color="#fff" />
        </Pressable>
      ) : null}

      {controlsVisible ? <View style={styles.utilityControls}>
        {canNavigate ? <Pressable accessibilityRole="button" onPress={() => moveRelative(-1)} disabled={currentIndex <= 0} style={[styles.utilityButton, currentIndex <= 0 && styles.disabled]}>
          <Feather name="skip-back" size={22} color="#fff" />
        </Pressable> : null}

        {selectableItems.length ? <Pressable accessibilityRole="button" onPress={() => { setSelectorOpen((value) => !value); revealControls(true); }} style={styles.utilityButton}>
          <Feather name="list" size={23} color="#fff" />
        </Pressable> : null}

        {canNavigate ? <Pressable accessibilityRole="button" onPress={() => moveRelative(1)} disabled={currentIndex >= selectableItems.length - 1} style={[styles.utilityButton, currentIndex >= selectableItems.length - 1 && styles.disabled]}>
          <Feather name="skip-forward" size={22} color="#fff" />
        </Pressable> : null}

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

        <Pressable accessibilityRole="button" accessibilityLabel={t("screen")} onPress={cycleFit} style={styles.utilityButton}>
          <Feather name={fit === "contain" ? "maximize-2" : fit === "cover" ? "crop" : "maximize"} size={23} color="#fff" />
        </Pressable>

        <Pressable accessibilityRole="button" accessibilityLabel="Rotate screen" onPress={() => void rotateScreen()} style={styles.utilityButton}>
          <Feather name="rotate-cw" size={23} color="#fff" />
        </Pressable>
      </View> : null}

      {selectorOpen ? <View style={styles.selector} onTouchStart={() => revealControls(true)}>
        <View style={styles.selectorHeader}>
          <Text style={styles.selectorTitle}>{mediaKind === "live" ? currentLive?.category || t("liveTv") : currentTitle}</Text>
          <Pressable onPress={() => { setSelectorOpen(false); revealControls(); }} style={styles.selectorClose}><Feather name="x" size={22} color="#fff" /></Pressable>
        </View>
        <ScrollView style={styles.selectorScroll} contentContainerStyle={{ paddingBottom: 12 }}>
          {selectableItems.map((item, index) => <Pressable key={`${item.id}-${index}`} onPress={() => void switchTo(item)} style={[styles.selectorRow, item.source === currentSource && styles.selectorRowActive]}>
            <Text numberOfLines={1} style={styles.selectorRowTitle}>{item.title}</Text>
            {item.subtitle ? <Text numberOfLines={1} style={styles.selectorRowSub}>{item.subtitle}</Text> : null}
          </Pressable>)}
        </ScrollView>
      </View> : null}

      {downloadState === "downloading" ? (
        <View pointerEvents="none" style={styles.downloadBadge}><Text style={styles.downloadBadgeText}>{t("downloading")} · {Math.round(downloadProgress * 100)}%</Text></View>
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
          <Text numberOfLines={2} style={[styles.urlText, { color: colors.primary }]}>{typeof effectiveSource === "object" ? effectiveSource.uri : currentSource}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%", height: "100%", backgroundColor: "#05070d" },
  video: { width: "100%", height: "100%", backgroundColor: "#05070d" },
  backButton: { position: "absolute", top: 18, left: 18, width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.58)" },
  utilityControls: { position: "absolute", right: 142, bottom: 18, flexDirection: "row", gap: 8, alignItems: "center" },
  utilityButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.54)" },
  disabled: { opacity: 0.32 },
  selector: { position: "absolute", right: 18, top: 70, bottom: 76, width: "42%", minWidth: 260, maxWidth: 430, backgroundColor: "rgba(6,10,18,0.96)", borderRadius: 14, overflow: "hidden" },
  selectorHeader: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.18)" },
  selectorTitle: { color: "#fff", fontSize: 15, fontWeight: "800", flex: 1 },
  selectorClose: { padding: 9 },
  selectorScroll: { flex: 1 },
  selectorRow: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.10)" },
  selectorRowActive: { backgroundColor: "rgba(26,211,229,0.18)" },
  selectorRowTitle: { color: "#fff", fontSize: 14, fontWeight: "700" },
  selectorRowSub: { color: "rgba(255,255,255,0.62)", fontSize: 11, marginTop: 2 },
  downloadBadge: { position: "absolute", right: 18, top: 18, maxWidth: 420, backgroundColor: "rgba(0,0,0,0.72)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  downloadBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,7,13,0.30)" },
  statusText: { fontSize: 14, fontWeight: "600" },
  errorPanel: { ...StyleSheet.absoluteFillObject, padding: 24, alignItems: "center", justifyContent: "center", gap: 8 },
  errorTitle: { fontSize: 20, fontWeight: "700" },
  errorText: { maxWidth: 680, fontSize: 13, lineHeight: 19, textAlign: "center" },
  urlText: { maxWidth: 680, fontSize: 11, textAlign: "center" },
});
