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
type Panel = "content" | "subtitles" | "audio" | null;
type SelectableItem = { id: string; title: string; subtitle?: string; source: string; isLive?: boolean };

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const value = Math.floor(seconds);
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

const trackLabel = (track: any, index: number) => track?.label || track?.language || `#${index + 1}`;

export function UnifiedVideoPlayer({
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
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [currentSource, setCurrentSource] = useState(source);
  const [currentTitle, setCurrentTitle] = useState(title);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekWidth, setSeekWidth] = useState(1);
  const [trackVersion, setTrackVersion] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mediaKind = useMemo<"live" | "movie" | "episode" | "download">(() => {
    if (/^file:/i.test(currentSource)) return "download";
    if (/\/movie\//i.test(currentSource)) return "movie";
    if (/\/series\//i.test(currentSource)) return "episode";
    return "live";
  }, [currentSource]);

  const effectiveSource = useMemo<VideoSource>(() => {
    const uri = /\/live\//i.test(currentSource) && /\.m3u8(?:$|\?)/i.test(currentSource)
      ? currentSource.replace(/\.m3u8(?=$|\?)/i, ".ts")
      : currentSource;
    return {
      uri,
      contentType: /\.m3u8(?:$|\?)/i.test(uri) ? "hls" : "auto",
      headers: /^https?:/i.test(uri) ? {
        Accept: "*/*",
        "User-Agent": "ExoPlayer/LegendStream-XPlayer",
      } : undefined,
    };
  }, [currentSource]);

  const resume = mediaKind === "movie" || mediaKind === "episode" ? getProgress(currentSource) : undefined;

  const player = useVideoPlayer(effectiveSource, (instance) => {
    instance.staysActiveInBackground = false;
    if (resume && resume.position > 5) {
      try { (instance as any).currentTime = resume.position; } catch { /* best effort */ }
    }
    instance.play();
  });

  const { status, error } = useEvent(player, "statusChange", { status: player.status });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });

  const revealControls = useCallback((keep = false) => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!keep && !panel && downloadState !== "downloading") {
      hideTimer.current = setTimeout(() => setControlsVisible(false), 2800);
    }
  }, [downloadState, panel]);

  useEffect(() => {
    revealControls(Boolean(panel) || downloadState === "downloading");
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [downloadState, panel, revealControls]);

  useEffect(() => {
    const timer = setInterval(() => {
      const anyPlayer = player as any;
      const nextPosition = Number(anyPlayer.currentTime ?? 0);
      const nextDuration = Number(anyPlayer.duration ?? 0);
      if (Number.isFinite(nextPosition)) setPosition(nextPosition);
      if (Number.isFinite(nextDuration) && nextDuration >= 0) setDuration(nextDuration);
    }, 500);
    return () => clearInterval(timer);
  }, [player]);

  useEffect(() => {
    const anyPlayer = player as any;
    if (typeof anyPlayer.addListener !== "function") return;
    const sourceLoad = anyPlayer.addListener("sourceLoad", () => setTrackVersion((value: number) => value + 1));
    return () => sourceLoad?.remove?.();
  }, [player]);

  useEffect(() => {
    const anyPlayer = player as any;
    const load = async () => {
      try {
        if (typeof anyPlayer.replaceAsync === "function") await anyPlayer.replaceAsync(effectiveSource);
        else if (typeof anyPlayer.replace === "function") anyPlayer.replace(effectiveSource);
        const nextResume = mediaKind === "movie" || mediaKind === "episode" ? getProgress(currentSource) : undefined;
        if (nextResume && nextResume.position > 5) anyPlayer.currentTime = nextResume.position;
        player.play();
      } catch (caught) {
        console.warn("LegendStream source switch failed", caught);
      }
    };
    void load();
  }, [currentSource, effectiveSource, getProgress, mediaKind, player]);

  const persistProgress = useCallback(async () => {
    if (mediaKind !== "movie" && mediaKind !== "episode") return;
    const anyPlayer = player as any;
    const current = Number(anyPlayer.currentTime ?? 0);
    const total = Number(anyPlayer.duration ?? 0);
    if (!Number.isFinite(current) || current < 1) return;
    await saveProgress({
      kind: mediaKind,
      title: currentTitle,
      source: currentSource,
      position: current,
      duration: Number.isFinite(total) ? total : 0,
    });
  }, [currentSource, currentTitle, mediaKind, player, saveProgress]);

  useEffect(() => {
    if (mediaKind !== "movie" && mediaKind !== "episode") return;
    const timer = setInterval(() => { void persistProgress(); }, 5000);
    return () => { clearInterval(timer); void persistProgress(); };
  }, [mediaKind, persistProgress]);

  const currentLive = useMemo(() => {
    if (mediaKind !== "live" || !provider) return undefined;
    return channels.find((channel) => channel.providerId === provider.id && channel.streamUrl === currentSource);
  }, [channels, currentSource, mediaKind, provider]);

  const liveQueue = useMemo(() => {
    if (!provider || !currentLive) return [];
    const same = channels.filter((channel) => channel.providerId === provider.id && channel.category === currentLive.category);
    return same.length ? same : channels.filter((channel) => channel.providerId === provider.id);
  }, [channels, currentLive, provider]);

  const episodeQueue = useMemo(() => mediaKind === "episode" ? getEpisodePlaybackQueue(currentSource) : undefined, [currentSource, mediaKind]);
  const vodQueue = useMemo(() => mediaKind === "movie" ? getVodPlaybackQueue(currentSource) : undefined, [currentSource, mediaKind]);

  const selectableItems = useMemo<SelectableItem[]>(() => {
    if (mediaKind === "live") {
      return liveQueue.slice(0, 500).map((channel) => ({ id: channel.id, title: channel.name, subtitle: channel.category, source: channel.streamUrl, isLive: true }));
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
      const same = current?.categoryId ? vodQueue.items.filter((item) => item.categoryId === current.categoryId) : vodQueue.items;
      return same.slice(0, 500).map((item) => ({ id: item.id, title: item.title, subtitle: item.genre || t("movies"), source: item.url }));
    }
    return [];
  }, [episodeQueue, liveQueue, mediaKind, t, vodQueue]);

  const currentIndex = useMemo(() => selectableItems.findIndex((item) => item.source === currentSource), [currentSource, selectableItems]);
  const canNavigate = selectableItems.length > 1 && currentIndex >= 0;

  const switchTo = useCallback(async (item: SelectableItem) => {
    await persistProgress();
    setCurrentSource(item.source);
    setCurrentTitle(item.title);
    setPanel(null);
    if (item.isLive) void recordWatched(item.id);
    revealControls();
  }, [persistProgress, recordWatched, revealControls]);

  const moveRelative = useCallback((delta: number) => {
    if (!canNavigate) return;
    const next = currentIndex + delta;
    if (next < 0 || next >= selectableItems.length) return;
    void switchTo(selectableItems[next]);
  }, [canNavigate, currentIndex, selectableItems, switchTo]);

  useEffect(() => {
    const anyPlayer = player as any;
    if (typeof anyPlayer.addListener !== "function") return;
    const sub = anyPlayer.addListener("playToEnd", () => {
      if (mediaKind === "episode" && currentIndex >= 0 && currentIndex < selectableItems.length - 1) moveRelative(1);
    });
    return () => sub?.remove?.();
  }, [currentIndex, mediaKind, moveRelative, player, selectableItems.length]);

  const exitPlayer = useCallback(() => {
    void persistProgress();
    onFullscreenExit?.();
  }, [onFullscreenExit, persistProgress]);

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (panel) { setPanel(null); revealControls(); return true; }
      exitPlayer();
      return true;
    });
    return () => back.remove();
  }, [exitPlayer, panel, revealControls]);

  const cycleFit = () => {
    setFit((value) => value === "contain" ? "cover" : value === "cover" ? "fill" : "contain");
    revealControls();
  };

  const rotateScreen = async () => {
    revealControls();
    try {
      const orientation = await ScreenOrientation.getOrientationAsync();
      const landscape = orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT || orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
      await ScreenOrientation.lockAsync(landscape ? ScreenOrientation.OrientationLock.PORTRAIT_UP : ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
    } catch { /* best effort */ }
  };

  const startDownload = async () => {
    if (!allowDownload || downloadState === "downloading") return;
    setDownloadState("downloading");
    setDownloadProgress(0);
    setDownloadError(null);
    revealControls(true);
    try {
      const uri = typeof effectiveSource === "object" ? effectiveSource.uri : currentSource;
      if (!uri) throw new Error("Missing media URL");
      await downloadMedia(uri, currentTitle, {
        kind: mediaKind === "episode" ? "episode" : "movie",
        onProgress: (progress) => setDownloadProgress(progress),
      });
      setDownloadProgress(1);
      setDownloadState("done");
      setTimeout(() => setDownloadState("idle"), 2200);
    } catch (caught) {
      setDownloadError(caught instanceof Error ? caught.message : "DOWNLOAD_FAILED");
      setDownloadState("error");
    }
  };

  const seekBy = (seconds: number) => {
    const anyPlayer = player as any;
    const total = Number(anyPlayer.duration ?? 0);
    const current = Number(anyPlayer.currentTime ?? 0);
    if (!Number.isFinite(current)) return;
    anyPlayer.currentTime = Math.max(0, Number.isFinite(total) && total > 0 ? Math.min(total, current + seconds) : current + seconds);
    revealControls();
  };

  const seekTo = (x: number) => {
    if (mediaKind === "live" || duration <= 0 || seekWidth <= 1) return;
    const ratio = Math.max(0, Math.min(1, x / seekWidth));
    (player as any).currentTime = duration * ratio;
    setPosition(duration * ratio);
    revealControls();
  };

  const anyPlayer = player as any;
  void trackVersion;
  const subtitleTracks: any[] = anyPlayer.availableSubtitleTracks ?? [];
  const audioTracks: any[] = anyPlayer.availableAudioTracks ?? [];
  const selectedSubtitle = anyPlayer.subtitleTrack ?? null;
  const selectedAudio = anyPlayer.audioTrack ?? null;

  const chooseSubtitle = (track: any | null) => {
    anyPlayer.subtitleTrack = track;
    setTrackVersion((v) => v + 1);
    setPanel(null);
    revealControls();
  };

  const chooseAudio = (track: any) => {
    anyPlayer.audioTrack = track;
    setTrackVersion((v) => v + 1);
    setPanel(null);
    revealControls();
  };

  const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;

  return (
    <View style={styles.root} onTouchStart={() => revealControls(Boolean(panel))}>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls={false}
        fullscreenOptions={{ enable: !autoFullscreen }}
        allowsPictureInPicture
        contentFit={fit}
      />

      {controlsVisible && onFullscreenExit ? (
        <Pressable onPress={exitPlayer} style={styles.backButton} accessibilityRole="button" accessibilityLabel={t("back")}>
          <Feather name="arrow-left" size={28} color="#fff" />
        </Pressable>
      ) : null}

      {controlsVisible ? <>
        <View style={styles.centerControls}>
          {mediaKind !== "live" ? <Pressable onPress={() => seekBy(-10)} style={styles.centerButton}><Feather name="rotate-ccw" size={28} color="#fff" /><Text style={styles.seekLabel}>10</Text></Pressable> : null}
          <Pressable onPress={() => { isPlaying ? player.pause() : player.play(); revealControls(); }} style={styles.playButton}>
            <Feather name={isPlaying ? "pause" : "play"} size={36} color="#111" />
          </Pressable>
          {mediaKind !== "live" ? <Pressable onPress={() => seekBy(15)} style={styles.centerButton}><Feather name="rotate-cw" size={28} color="#fff" /><Text style={styles.seekLabel}>15</Text></Pressable> : null}
        </View>

        <View style={styles.bottomBar}>
          {mediaKind !== "live" ? <>
            <Pressable
              onLayout={(e) => setSeekWidth(e.nativeEvent.layout.width)}
              onPress={(e) => seekTo(e.nativeEvent.locationX)}
              style={styles.seekTrack}
            >
              <View style={[styles.seekFill, { width: `${progress * 100}%` }]} />
              <View style={[styles.seekThumb, { left: `${progress * 100}%` }]} />
            </Pressable>
            <View style={styles.timeRow}><Text style={styles.timeText}>{formatTime(position)}</Text><Text style={styles.timeText}>·</Text><Text style={styles.timeText}>{formatTime(duration)}</Text></View>
          </> : <View style={styles.liveLabel}><View style={styles.liveDot} /><Text style={styles.timeText}>LIVE</Text></View>}

          <View style={styles.iconRow}>
            <View style={styles.iconGroup}>
              {canNavigate ? <BarButton icon="skip-back" disabled={currentIndex <= 0} onPress={() => moveRelative(-1)} /> : null}
              {selectableItems.length ? <BarButton icon="list" onPress={() => { setPanel(panel === "content" ? null : "content"); revealControls(true); }} /> : null}
              {canNavigate ? <BarButton icon="skip-forward" disabled={currentIndex >= selectableItems.length - 1} onPress={() => moveRelative(1)} /> : null}
              {allowDownload ? <BarButton icon={downloadState === "done" ? "check-circle" : downloadState === "error" ? "alert-circle" : "download"} disabled={downloadState === "downloading"} onPress={() => void startDownload()} /> : null}
              <BarButton icon={fit === "contain" ? "maximize-2" : fit === "cover" ? "crop" : "maximize"} onPress={cycleFit} />
              <BarButton icon="rotate-cw" onPress={() => void rotateScreen()} />
            </View>
            <View style={styles.iconGroup}>
              <Pressable onPress={() => { setPanel(panel === "subtitles" ? null : "subtitles"); revealControls(true); }} style={styles.ccButton}><Text style={styles.ccText}>CC</Text></Pressable>
              <BarButton icon="settings" onPress={() => { setPanel(panel === "audio" ? null : "audio"); revealControls(true); }} />
            </View>
          </View>
        </View>
      </> : null}

      {panel ? <View style={styles.panel} onTouchStart={() => revealControls(true)}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>{panel === "content" ? currentTitle : panel === "subtitles" ? t("subtitles") : t("audio")}</Text>
          <Pressable onPress={() => { setPanel(null); revealControls(); }} style={styles.panelClose}><Feather name="x" size={22} color="#fff" /></Pressable>
        </View>
        <ScrollView style={styles.panelScroll} contentContainerStyle={{ paddingBottom: 12 }}>
          {panel === "content" ? selectableItems.map((item, index) => <MenuRow key={`${item.id}-${index}`} title={item.title} subtitle={item.subtitle} active={item.source === currentSource} onPress={() => void switchTo(item)} />) : null}
          {panel === "subtitles" ? <>
            <MenuRow title={t("off")} active={!selectedSubtitle} onPress={() => chooseSubtitle(null)} />
            {subtitleTracks.length ? subtitleTracks.map((track, index) => <MenuRow key={track.id || `${track.language}-${index}`} title={trackLabel(track, index)} active={selectedSubtitle?.id ? selectedSubtitle.id === track.id : selectedSubtitle === track} onPress={() => chooseSubtitle(track)} />) : <Text style={styles.emptyText}>{t("noTracks")}</Text>}
          </> : null}
          {panel === "audio" ? audioTracks.length ? audioTracks.map((track, index) => <MenuRow key={track.id || `${track.language}-${index}`} title={trackLabel(track, index)} active={selectedAudio?.id ? selectedAudio.id === track.id : selectedAudio === track} onPress={() => chooseAudio(track)} />) : <Text style={styles.emptyText}>{t("noTracks")}</Text> : null}
        </ScrollView>
      </View> : null}

      {downloadState !== "idle" ? <View pointerEvents="none" style={styles.downloadBadge}>
        <Text style={styles.downloadText}>
          {downloadState === "downloading" ? `${t("downloading")} · ${Math.round(downloadProgress * 100)}%` : downloadState === "done" ? t("downloaded") : `${t("downloadFailed")}${downloadError ? ` · ${downloadError}` : ""}`}
        </Text>
      </View> : null}

      {status === "loading" ? <View pointerEvents="none" style={styles.loadingOverlay}><Text style={[styles.loadingText, { color: colors.foreground }]}>{t("loadingVideo")}</Text></View> : null}
      {status === "error" ? <View style={[styles.errorPanel, { backgroundColor: colors.card }]}><Text style={[styles.errorTitle, { color: colors.foreground }]}>{t("playbackFailed")}</Text><Text style={[styles.errorText, { color: colors.mutedForeground }]}>{error?.message || t("playbackFailed")}</Text></View> : null}
    </View>
  );
}

function BarButton({ icon, onPress, disabled = false }: { icon: React.ComponentProps<typeof Feather>["name"]; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.barButton, disabled && styles.disabled]}><Feather name={icon} size={26} color="#fff" /></Pressable>;
}

function MenuRow({ title, subtitle, active, onPress }: { title: string; subtitle?: string; active?: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.menuRow, active && styles.menuRowActive]}>
    <Text numberOfLines={1} style={styles.menuTitle}>{title}</Text>
    {subtitle ? <Text numberOfLines={1} style={styles.menuSubtitle}>{subtitle}</Text> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { width: "100%", height: "100%", backgroundColor: "#000" },
  video: { width: "100%", height: "100%", backgroundColor: "#000" },
  backButton: { position: "absolute", top: 18, left: 18, width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.42)" },
  centerControls: { position: "absolute", left: 0, right: 0, top: "42%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 34 },
  centerButton: { width: 54, height: 54, alignItems: "center", justifyContent: "center" },
  playButton: { width: 68, height: 68, borderRadius: 34, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  seekLabel: { position: "absolute", color: "#fff", fontSize: 11, fontWeight: "800" },
  bottomBar: { position: "absolute", left: 14, right: 14, bottom: 8, paddingTop: 8 },
  seekTrack: { height: 22, justifyContent: "center" },
  seekFill: { position: "absolute", left: 0, height: 3, backgroundColor: "#fff" },
  seekTrack: { height: 22, justifyContent: "center", backgroundColor: "transparent", borderTopWidth: 0 },
  seekThumb: { position: "absolute", marginLeft: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: "#fff" },
  timeRow: { flexDirection: "row", gap: 7, alignItems: "center", minHeight: 24 },
  timeText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  liveLabel: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 24 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  iconRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 50 },
  iconGroup: { flexDirection: "row", alignItems: "center", gap: 2 },
  barButton: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  ccButton: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  ccText: { color: "#fff", borderWidth: 2, borderColor: "#fff", borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1, fontSize: 13, fontWeight: "900" },
  disabled: { opacity: 0.28 },
  panel: { position: "absolute", right: 16, top: 70, bottom: 86, width: "58%", maxWidth: 460, borderRadius: 16, backgroundColor: "rgba(8,13,22,0.96)", overflow: "hidden" },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.18)" },
  panelTitle: { color: "#fff", fontWeight: "800", fontSize: 17, flex: 1 },
  panelClose: { padding: 6 },
  panelScroll: { flex: 1 },
  menuRow: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.10)" },
  menuRowActive: { backgroundColor: "rgba(255,255,255,0.12)" },
  menuTitle: { color: "#fff", fontWeight: "700", fontSize: 14 },
  menuSubtitle: { color: "rgba(255,255,255,0.62)", fontSize: 12, marginTop: 2 },
  emptyText: { color: "rgba(255,255,255,0.62)", padding: 16 },
  downloadBadge: { position: "absolute", right: 18, top: 18, maxWidth: 420, backgroundColor: "rgba(0,0,0,0.72)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  downloadText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.20)" },
  loadingText: { fontWeight: "700" },
  errorPanel: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  errorTitle: { fontSize: 20, fontWeight: "800" },
  errorText: { fontSize: 13, textAlign: "center" },
});
