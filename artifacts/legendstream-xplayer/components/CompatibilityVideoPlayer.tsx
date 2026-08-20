import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import { VLCPlayer } from "react-native-vlc-media-player";
import { useI18n } from "@/context/I18nContext";
import { useMediaLibrary } from "@/context/MediaLibraryContext";
import { usePlayer } from "@/context/PlayerContext";
import { downloadMedia } from "@/lib/downloads";
import { getEpisodePlaybackQueue, getVodPlaybackQueue } from "@/lib/xtreamCatalog";

type FitMode = "contain" | "cover" | "fill";
type CodecMode = "auto" | "hardware" | "software";
type Panel = "content" | "subtitles" | "audio" | "codec" | null;
type SelectableItem = { id: string; title: string; subtitle?: string; source: string; isLive?: boolean };
type Track = { id: number; name: string };

const CODEC_MODE_KEY = "@legendstream/codec-mode-v1";

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const v = Math.floor(seconds);
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const s = v % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

const codecLabel = (mode: CodecMode) => mode === "hardware" ? "HW" : mode === "software" ? "SW" : "AUTO";

export function CompatibilityVideoPlayer({ source, title, onFullscreenExit, allowDownload = false }: {
  source: string;
  title: string;
  autoFullscreen?: boolean;
  onFullscreenExit?: () => void;
  allowDownload?: boolean;
}) {
  const { t } = useI18n();
  const { getProgress, saveProgress } = useMediaLibrary();
  const { provider, channels, recordWatched } = usePlayer();
  const vlcRef = useRef<any>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumedSource = useRef<string | null>(null);

  const [currentSource, setCurrentSource] = useState(source);
  const [currentTitle, setCurrentTitle] = useState(title);
  const [paused, setPaused] = useState(false);
  const [fit, setFit] = useState<FitMode>("contain");
  const [codecMode, setCodecMode] = useState<CodecMode>("auto");
  const [controlsVisible, setControlsVisible] = useState(true);
  const [infoVisible, setInfoVisible] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioTracks, setAudioTracks] = useState<Track[]>([]);
  const [textTracks, setTextTracks] = useState<Track[]>([]);
  const [audioTrack, setAudioTrack] = useState<number | undefined>(undefined);
  const [textTrack, setTextTrack] = useState<number | undefined>(undefined);
  const [downloadState, setDownloadState] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(CODEC_MODE_KEY).then((saved) => {
      if (saved === "auto" || saved === "hardware" || saved === "software") setCodecMode(saved);
    }).catch(() => undefined);
  }, []);

  const mediaKind = useMemo<"live" | "movie" | "episode" | "download">(() => {
    if (/^file:/i.test(currentSource)) return "download";
    if (/\/movie\//i.test(currentSource)) return "movie";
    if (/\/series\//i.test(currentSource)) return "episode";
    return "live";
  }, [currentSource]);

  const effectiveUri = useMemo(() => /\/live\//i.test(currentSource) && /\.m3u8(?:$|\?)/i.test(currentSource)
    ? currentSource.replace(/\.m3u8(?=$|\?)/i, ".ts")
    : currentSource, [currentSource]);

  const revealControls = useCallback((keep = false) => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!keep && !panel && downloadState !== "downloading") hideTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  }, [downloadState, panel]);

  const revealMediaInfo = useCallback(() => {
    setInfoVisible(true);
    if (infoTimer.current) clearTimeout(infoTimer.current);
    infoTimer.current = setTimeout(() => setInfoVisible(false), 4500);
  }, []);

  useEffect(() => {
    revealControls(Boolean(panel) || downloadState === "downloading");
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [downloadState, panel, revealControls]);

  useEffect(() => {
    revealMediaInfo();
    return () => { if (infoTimer.current) clearTimeout(infoTimer.current); };
  }, [currentSource, currentTitle, revealMediaInfo]);

  const persistProgress = useCallback(async () => {
    if (mediaKind !== "movie" && mediaKind !== "episode") return;
    if (position < 1) return;
    await saveProgress({ kind: mediaKind, title: currentTitle, source: currentSource, position, duration });
  }, [currentSource, currentTitle, duration, mediaKind, position, saveProgress]);

  useEffect(() => {
    if (mediaKind !== "movie" && mediaKind !== "episode") return;
    const timer = setInterval(() => void persistProgress(), 5000);
    return () => { clearInterval(timer); void persistProgress(); };
  }, [mediaKind, persistProgress]);

  const currentLive = useMemo(() => mediaKind === "live" && provider
    ? channels.find((c) => c.providerId === provider.id && c.streamUrl === currentSource)
    : undefined, [channels, currentSource, mediaKind, provider]);

  const liveQueue = useMemo(() => {
    if (!provider || !currentLive) return [];
    const same = channels.filter((c) => c.providerId === provider.id && c.category === currentLive.category);
    return same.length ? same : channels.filter((c) => c.providerId === provider.id);
  }, [channels, currentLive, provider]);

  const episodeQueue = useMemo(() => mediaKind === "episode" ? getEpisodePlaybackQueue(currentSource) : undefined, [currentSource, mediaKind]);
  const vodQueue = useMemo(() => mediaKind === "movie" ? getVodPlaybackQueue(currentSource) : undefined, [currentSource, mediaKind]);

  const selectableItems = useMemo<SelectableItem[]>(() => {
    if (mediaKind === "live") return liveQueue.slice(0, 500).map((c) => ({ id: c.id, title: c.name, subtitle: c.category, source: c.streamUrl, isLive: true }));
    if (mediaKind === "episode" && episodeQueue) return episodeQueue.items.map((i) => ({ id: i.id, title: i.title, subtitle: `${t("season")} ${i.season}${i.episodeNumber ? ` · ${t("episode")} ${i.episodeNumber}` : ""}`, source: i.url }));
    if (mediaKind === "movie" && vodQueue) {
      const current = vodQueue.items[vodQueue.index];
      const same = current?.categoryId ? vodQueue.items.filter((i) => i.categoryId === current.categoryId) : vodQueue.items;
      return same.slice(0, 500).map((i) => ({ id: i.id, title: i.title, subtitle: i.genre || t("movies"), source: i.url }));
    }
    return [];
  }, [episodeQueue, liveQueue, mediaKind, t, vodQueue]);

  const currentIndex = useMemo(() => selectableItems.findIndex((i) => i.source === currentSource), [currentSource, selectableItems]);
  const currentMeta = currentIndex >= 0 ? selectableItems[currentIndex]?.subtitle : currentLive?.category;
  const canNavigate = selectableItems.length > 1 && currentIndex >= 0;

  const switchTo = useCallback(async (item: SelectableItem) => {
    await persistProgress();
    setCurrentSource(item.source);
    setCurrentTitle(item.title);
    setPosition(0); setDuration(0); setPaused(false); setPanel(null); setErrorText(null);
    setAudioTracks([]); setTextTracks([]); setAudioTrack(undefined); setTextTrack(undefined);
    resumedSource.current = null;
    if (item.isLive) void recordWatched(item.id);
    revealControls();
    revealMediaInfo();
  }, [persistProgress, recordWatched, revealControls, revealMediaInfo]);

  const moveRelative = useCallback((delta: number) => {
    if (!canNavigate) return;
    const next = currentIndex + delta;
    if (next < 0 || next >= selectableItems.length) return;
    void switchTo(selectableItems[next]);
  }, [canNavigate, currentIndex, selectableItems, switchTo]);

  const exitPlayer = useCallback(() => { void persistProgress(); onFullscreenExit?.(); }, [onFullscreenExit, persistProgress]);

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (panel) { setPanel(null); revealControls(); return true; }
      exitPlayer(); return true;
    });
    return () => back.remove();
  }, [exitPlayer, panel, revealControls]);

  const seekBy = (seconds: number) => {
    if (duration <= 0 || mediaKind === "live") return;
    const next = Math.max(0, Math.min(duration, position + seconds));
    vlcRef.current?.seek?.(next / duration);
    setPosition(next); revealControls();
  };

  const cycleFit = () => { setFit((v) => v === "contain" ? "cover" : v === "cover" ? "fill" : "contain"); revealControls(); };
  const rotateScreen = async () => {
    revealControls();
    try {
      const o = await ScreenOrientation.getOrientationAsync();
      const landscape = o === ScreenOrientation.Orientation.LANDSCAPE_LEFT || o === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
      await ScreenOrientation.lockAsync(landscape ? ScreenOrientation.OrientationLock.PORTRAIT_UP : ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
    } catch { /* best effort */ }
  };

  const changeCodecMode = async (mode: CodecMode) => {
    await persistProgress();
    setCodecMode(mode);
    setPanel(null);
    setErrorText(null);
    resumedSource.current = null;
    await AsyncStorage.setItem(CODEC_MODE_KEY, mode).catch(() => undefined);
    revealControls();
    revealMediaInfo();
  };

  const startDownload = async () => {
    if (!allowDownload || downloadState === "downloading") return;
    setDownloadState("downloading"); setDownloadProgress(0); revealControls(true);
    try {
      await downloadMedia(effectiveUri, currentTitle, { kind: mediaKind === "episode" ? "episode" : "movie", onProgress: (p) => setDownloadProgress(p) });
      setDownloadProgress(1); setDownloadState("done"); setTimeout(() => setDownloadState("idle"), 2200);
    } catch { setDownloadState("error"); }
  };

  const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
  const initOptions = useMemo(() => {
    const base = ["--network-caching=1200", "--file-caching=1000", "--http-reconnect", "--no-drop-late-frames"];
    if (codecMode === "hardware") return [...base, "--avcodec-hw=any"];
    if (codecMode === "software") return [...base, "--avcodec-hw=none"];
    return base;
  }, [codecMode]);

  return <View style={s.root} onTouchStart={() => { revealControls(Boolean(panel)); revealMediaInfo(); }}>
    <VLCPlayer
      key={`${effectiveUri}:${codecMode}`}
      ref={vlcRef}
      style={s.video}
      source={{ uri: effectiveUri, initType: 2, initOptions }}
      paused={paused}
      autoplay
      autoAspectRatio
      resizeMode={fit}
      audioTrack={audioTrack}
      textTrack={textTrack}
      onLoad={(e: any) => {
        setDuration(Number(e?.duration || 0));
        setAudioTracks(Array.isArray(e?.audioTracks) ? e.audioTracks : []);
        setTextTracks(Array.isArray(e?.textTracks) ? e.textTracks : []);
        if (resumedSource.current !== currentSource && (mediaKind === "movie" || mediaKind === "episode") && Number(e?.duration) > 0) {
          const saved = getProgress(currentSource);
          if (saved?.position && saved.position > 5) vlcRef.current?.seek?.(Math.max(0, Math.min(1, saved.position / Number(e.duration))));
          resumedSource.current = currentSource;
        }
      }}
      onProgress={(e: any) => {
        const ct = Number(e?.currentTime || 0); const d = Number(e?.duration || duration || 0);
        if (Number.isFinite(ct)) setPosition(ct); if (Number.isFinite(d) && d > 0) setDuration(d);
      }}
      onPlaying={() => setPaused(false)}
      onPaused={() => setPaused(true)}
      onEnd={() => { if (mediaKind === "episode" && currentIndex >= 0 && currentIndex < selectableItems.length - 1) moveRelative(1); }}
      onError={() => setErrorText(codecMode === "hardware" ? "Donanımsal çözümleme başarısız. Otomatik veya Yazılım codec modunu deneyin." : "Bu medya seçili codec moduyla oynatılamadı.")}
    />

    {errorText ? <View style={s.error}><Text style={s.errorTitle}>{t("playbackFailed") || "Oynatma başarısız"}</Text><Text style={s.errorText}>{errorText}</Text></View> : null}

    {infoVisible ? <View style={s.mediaHud} pointerEvents="none">
      <View style={s.liveDot} />
      <View style={{ flex: 1 }}><Text numberOfLines={1} style={s.mediaTitle}>{currentTitle}</Text>{currentMeta ? <Text numberOfLines={1} style={s.mediaMeta}>{currentMeta}</Text> : null}</View>
      <View style={s.codecBadge}><Text style={s.codecBadgeText}>{codecLabel(codecMode)}</Text></View>
    </View> : null}

    {controlsVisible && onFullscreenExit ? <Pressable onPress={exitPlayer} style={s.back}><Feather name="arrow-left" size={28} color="#fff" /></Pressable> : null}

    {controlsVisible ? <>
      <View style={s.center}>
        {mediaKind !== "live" ? <Pressable onPress={() => seekBy(-10)} style={s.centerBtn}><Feather name="rotate-ccw" size={28} color="#fff" /><Text style={s.small}>10</Text></Pressable> : null}
        <Pressable onPress={() => { setPaused((p) => !p); revealControls(); }} style={s.play}><Feather name={paused ? "play" : "pause"} size={32} color="#000" /></Pressable>
        {mediaKind !== "live" ? <Pressable onPress={() => seekBy(15)} style={s.centerBtn}><Feather name="rotate-cw" size={28} color="#fff" /><Text style={s.small}>15</Text></Pressable> : null}
      </View>

      <View style={s.bottom}>
        {mediaKind !== "live" ? <View style={s.seekRow}><Text style={s.time}>{formatTime(position)}</Text><View style={s.seek}><View style={[s.seekFill,{width:`${progress*100}%`}]} /></View><Text style={s.time}>{formatTime(duration)}</Text></View> : null}
        <View style={s.barShell}><View style={s.bar}>
          {canNavigate ? <Pressable onPress={() => moveRelative(-1)} disabled={currentIndex <= 0} style={s.icon}><Feather name="skip-back" size={22} color="#fff" /></Pressable> : null}
          {selectableItems.length ? <Pressable onPress={() => { setPanel(panel === "content" ? null : "content"); revealControls(true); }} style={s.icon}><Feather name="list" size={23} color="#fff" /></Pressable> : null}
          {canNavigate ? <Pressable onPress={() => moveRelative(1)} disabled={currentIndex >= selectableItems.length-1} style={s.icon}><Feather name="skip-forward" size={22} color="#fff" /></Pressable> : null}
          {allowDownload ? <Pressable onPress={() => void startDownload()} style={s.icon}><Feather name={downloadState === "done" ? "check-circle" : downloadState === "error" ? "alert-circle" : "download"} size={22} color="#fff" /></Pressable> : null}
          <Pressable onPress={cycleFit} style={s.icon}><Feather name="maximize-2" size={22} color="#fff" /></Pressable>
          <Pressable onPress={() => void rotateScreen()} style={s.icon}><Feather name="rotate-cw" size={22} color="#fff" /></Pressable>
          <Pressable onPress={() => { setPanel(panel === "subtitles" ? null : "subtitles"); revealControls(true); }} style={s.icon}><Text style={s.cc}>CC</Text></Pressable>
          <Pressable onPress={() => { setPanel(panel === "audio" ? null : "audio"); revealControls(true); }} style={s.icon}><Feather name="volume-2" size={22} color="#fff" /></Pressable>
          <Pressable onPress={() => { setPanel(panel === "codec" ? null : "codec"); revealControls(true); }} style={[s.icon, s.codecIcon]}><Feather name="cpu" size={21} color="#fff" /><Text style={s.codecMini}>{codecLabel(codecMode)}</Text></Pressable>
        </View></View>
      </View>
    </> : null}

    {panel ? <View style={s.panel}>
      <ScrollView>
        {panel === "content" ? selectableItems.map((i) => <Pressable key={i.id} onPress={() => void switchTo(i)} style={s.row}><Text style={s.rowTitle}>{i.title}</Text><Text style={s.rowSub}>{i.subtitle || ""}</Text></Pressable>) : null}
        {panel === "subtitles" ? <><Pressable onPress={() => { setTextTrack(-1); setPanel(null); }} style={s.row}><Text style={s.rowTitle}>Kapalı</Text></Pressable>{textTracks.map((tr) => <Pressable key={tr.id} onPress={() => { setTextTrack(tr.id); setPanel(null); }} style={s.row}><Text style={s.rowTitle}>{tr.name}</Text></Pressable>)}</> : null}
        {panel === "audio" ? audioTracks.map((tr) => <Pressable key={tr.id} onPress={() => { setAudioTrack(tr.id); setPanel(null); }} style={s.row}><Text style={s.rowTitle}>{tr.name}</Text></Pressable>) : null}
        {panel === "codec" ? <>
          <Text style={s.panelHeading}>Codec çözümleme</Text>
          <Text style={s.panelHint}>AUTO önerilir. Eski veya sorunlu cihazlarda SW, güçlü cihazlarda HW seçilebilir.</Text>
          {(["auto","hardware","software"] as CodecMode[]).map((mode) => <Pressable key={mode} onPress={() => void changeCodecMode(mode)} style={[s.row, codecMode === mode && s.rowActive]}>
            <View style={{ flexDirection:"row",alignItems:"center",gap:10 }}><Feather name={mode === "hardware" ? "zap" : mode === "software" ? "cpu" : "shuffle"} size={20} color="#fff" /><Text style={s.rowTitle}>{mode === "auto" ? "Otomatik" : mode === "hardware" ? "Donanımsal (HW)" : "Yazılımsal (SW)"}</Text></View>
            <Text style={s.rowSub}>{mode === "auto" ? "VLC en uygun çözümleyiciyi seçer" : mode === "hardware" ? "Düşük CPU kullanımı, cihaz codec desteğine bağlı" : "En geniş codec uyumluluğu, daha yüksek CPU/batarya kullanımı"}</Text>
          </Pressable>)}
        </> : null}
      </ScrollView>
    </View> : null}

    {downloadState === "downloading" ? <View style={s.toast}><Text style={s.toastText}>İndiriliyor… %{Math.round(downloadProgress*100)}</Text></View> : null}
  </View>;
}

const s = StyleSheet.create({
  root:{flex:1,backgroundColor:"#000"},video:{...StyleSheet.absoluteFillObject},back:{position:"absolute",top:18,left:18,width:52,height:52,borderRadius:26,backgroundColor:"rgba(4,8,14,.72)",borderWidth:1,borderColor:"rgba(255,255,255,.12)",alignItems:"center",justifyContent:"center"},
  mediaHud:{position:"absolute",top:18,left:84,right:18,minHeight:54,borderRadius:16,backgroundColor:"rgba(4,8,14,.72)",borderWidth:1,borderColor:"rgba(255,255,255,.10)",paddingHorizontal:14,paddingVertical:9,flexDirection:"row",alignItems:"center",gap:10},liveDot:{width:8,height:8,borderRadius:4,backgroundColor:"#22d3ee"},mediaTitle:{color:"#fff",fontSize:16,fontWeight:"900"},mediaMeta:{color:"#aab4c3",fontSize:12,marginTop:2},codecBadge:{paddingHorizontal:8,paddingVertical:4,borderRadius:9,backgroundColor:"rgba(34,211,238,.16)",borderWidth:1,borderColor:"rgba(34,211,238,.35)"},codecBadgeText:{color:"#67e8f9",fontSize:10,fontWeight:"900"},
  center:{position:"absolute",left:0,right:0,top:"40%",flexDirection:"row",justifyContent:"center",alignItems:"center",gap:34},centerBtn:{width:52,height:52,borderRadius:26,backgroundColor:"rgba(4,8,14,.45)",alignItems:"center",justifyContent:"center"},play:{width:66,height:66,borderRadius:33,backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},small:{position:"absolute",color:"#fff",fontWeight:"800",fontSize:11},
  bottom:{position:"absolute",left:0,right:0,bottom:0,paddingHorizontal:14,paddingBottom:12},seekRow:{flexDirection:"row",alignItems:"center",gap:10,marginBottom:9,paddingHorizontal:5},time:{color:"#fff",fontWeight:"700",fontSize:13},seek:{flex:1,height:4,backgroundColor:"rgba(255,255,255,.30)",borderRadius:3,overflow:"hidden"},seekFill:{height:4,backgroundColor:"#22d3ee"},barShell:{borderRadius:18,backgroundColor:"rgba(4,8,14,.78)",borderWidth:1,borderColor:"rgba(255,255,255,.10)",overflow:"hidden"},bar:{flexDirection:"row",alignItems:"center",justifyContent:"space-around",paddingVertical:7,paddingHorizontal:5},icon:{minWidth:42,height:42,borderRadius:12,alignItems:"center",justifyContent:"center"},codecIcon:{paddingHorizontal:5},codecMini:{color:"#67e8f9",fontSize:8,fontWeight:"900",marginTop:-2},cc:{color:"#fff",fontWeight:"900",fontSize:15,borderWidth:2,borderColor:"#fff",borderRadius:4,paddingHorizontal:3,lineHeight:18},
  panel:{position:"absolute",right:16,top:82,bottom:92,width:"46%",maxWidth:440,backgroundColor:"rgba(6,11,20,.97)",borderRadius:18,borderWidth:1,borderColor:"rgba(255,255,255,.12)",padding:10},panelHeading:{color:"#fff",fontSize:18,fontWeight:"900",paddingHorizontal:12,paddingTop:8},panelHint:{color:"#94a3b8",fontSize:12,paddingHorizontal:12,paddingVertical:8,lineHeight:17},row:{paddingVertical:12,paddingHorizontal:12,borderBottomWidth:1,borderBottomColor:"rgba(255,255,255,.08)",borderRadius:10},rowActive:{backgroundColor:"rgba(34,211,238,.12)",borderColor:"rgba(34,211,238,.22)"},rowTitle:{color:"#fff",fontWeight:"800"},rowSub:{color:"#9ca3af",fontSize:12,marginTop:3},
  toast:{position:"absolute",top:84,right:18,backgroundColor:"rgba(4,8,14,.80)",borderWidth:1,borderColor:"rgba(255,255,255,.10)",borderRadius:12,paddingHorizontal:14,paddingVertical:10},toastText:{color:"#fff",fontWeight:"800"},error:{...StyleSheet.absoluteFillObject,alignItems:"center",justifyContent:"center",padding:30,backgroundColor:"#07101f"},errorTitle:{color:"#fff",fontSize:26,fontWeight:"900",marginBottom:10},errorText:{color:"#9ca3af",textAlign:"center",maxWidth:560,lineHeight:21}
});
