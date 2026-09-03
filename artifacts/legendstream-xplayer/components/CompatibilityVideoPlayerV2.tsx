import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, BackHandler, StyleSheet, Text, View } from "react-native";
import { useMediaLibrary } from "@/context/MediaLibraryContext";
import { selectChannelEpg, usePlayer } from "@/context/PlayerContext";
import { downloadMedia } from "@/lib/downloads";
import {
  DEFAULT_PLAYER_CHROME_TIMEOUT_SECONDS,
  getPlayerChromeTimeoutSeconds,
} from "@/lib/playerPreferences";
import {
  buildVodStreamUrl,
  getEpisodePlaybackQueue,
  getVodPlaybackQueue,
} from "@/lib/xtreamCatalog";
import { isCatalogRuntimeSource } from "@/lib/catalogPersistence";
import { resolveCatalogRuntimeSource } from "@/lib/catalogRuntime";
import {
  getCachedLivePlaybackWindow,
  getCachedVodPlaybackWindow,
  type CatalogPlaybackIdentity,
} from "@/lib/catalogPageRepository";
import {
  liveQueueIndex,
  resolveLiveQueue,
  type LiveChannelIdentity,
} from "@/lib/playerLiveQueue";
import type { Channel } from "@/lib/iptv";
import { usePlayerOrientation } from "@/hooks/usePlayerOrientation";
import {
  enterPictureInPicture,
  getMediaVolume,
  isInPipMode,
  isPipSupported,
  setMediaVolume,
} from "@/modules/legendstream-pip";
import {
  PlayerChrome,
  PlayerDownloadState,
  PlayerMediaKind,
  PlayerPanel,
  PlayerSelectableItem,
} from "@/components/player/PlayerChrome";
import {
  PlayerCodecMode,
  PlayerFitMode,
  PlayerTrack,
  PlayerVideoSize,
  VlcLoadEvent,
  VlcPlaybackSurface,
  VlcProgressEvent,
} from "@/components/player/VlcPlaybackSurface";

const CODEC_MODE_KEY = "@legendstream/codec-mode-v1";
const UI_PROGRESS_INTERVAL_MS = 500;
const PROGRESS_PERSIST_INTERVAL_MS = 15_000;

const inferMediaKind = (source: string): PlayerMediaKind => {
  if (/^file:/i.test(source)) return "download";
  if (/\/movie\//i.test(source)) return "movie";
  if (/\/series\//i.test(source)) return "episode";
  return "live";
};

/** VLC Android reports MediaPlayer.getLength()/getTime() in milliseconds. */
const normalizeDuration = (raw: unknown) => {
  const value = Number(raw || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 86_400 ? value / 1000 : value;
};

const normalizeCurrentTime = (raw: unknown, rawDuration: unknown) => {
  const value = Number(raw || 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  const durationValue = Number(rawDuration || 0);
  return durationValue > 86_400 ? value / 1000 : value;
};

type PlaybackSnapshot = {
  source: string;
  title: string;
  kind: PlayerMediaKind;
  position: number;
  duration: number;
};

export function CompatibilityVideoPlayer({
  source,
  title,
  subtitle,
  mediaKind,
  liveIdentity,
  vodIdentity,
  autoFullscreen = true,
  onFullscreenExit,
  allowDownload = false,
}: {
  source: string;
  title: string;
  subtitle?: string;
  mediaKind?: PlayerMediaKind;
  liveIdentity?: LiveChannelIdentity;
  vodIdentity?: CatalogPlaybackIdentity;
  autoFullscreen?: boolean;
  onFullscreenExit?: () => void;
  allowDownload?: boolean;
}) {
  const { getProgress, saveProgress } = useMediaLibrary();
  const {
    provider,
    channels,
    epg,
    isEpgLoading,
    recordWatched,
  } = usePlayer();
  const orientation = usePlayerOrientation(autoFullscreen);

  const vlcRef = useRef<any>(null);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumedSource = useRef<string | null>(null);
  const lastUiProgressAt = useRef(0);
  const lastDownloadUiAt = useRef(0);
  const exitStarted = useRef(false);

  const initialKind = mediaKind ?? inferMediaKind(source);
  const playbackRef = useRef<PlaybackSnapshot>({
    source,
    title,
    kind: initialKind,
    position: 0,
    duration: 0,
  });

  const [currentSource, setCurrentSource] = useState(source);
  const [resolvedSource, setResolvedSource] = useState<string | null>(
    isCatalogRuntimeSource(source) ? null : source,
  );
  const [currentTitle, setCurrentTitle] = useState(title);
  const [currentSubtitle, setCurrentSubtitle] = useState(subtitle);
  const [currentKind, setCurrentKind] = useState<PlayerMediaKind>(initialKind);
  const [currentLiveIdentity, setCurrentLiveIdentity] = useState<LiveChannelIdentity | null>(
    initialKind === "live" ? liveIdentity ?? null : null,
  );
  const [currentVodIdentity, setCurrentVodIdentity] = useState<CatalogPlaybackIdentity | null>(
    initialKind === "movie" ? vodIdentity ?? null : null,
  );
  const [cachedLiveChannels, setCachedLiveChannels] = useState<Channel[]>([]);
  const [cachedVodItems, setCachedVodItems] = useState<Awaited<ReturnType<typeof getCachedVodPlaybackWindow>>>([]);
  const [paused, setPaused] = useState(false);
  const [fit, setFit] = useState<PlayerFitMode>("fit");
  const [codecMode, setCodecMode] = useState<PlayerCodecMode>("auto");
  const [volume, setVolume] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [infoVisible, setInfoVisible] = useState(true);
  const [panel, setPanel] = useState<PlayerPanel>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoSize, setVideoSize] = useState<PlayerVideoSize>({ width: 16, height: 9 });
  const [resolutionLabel, setResolutionLabel] = useState<string | undefined>(undefined);
  const [streamCodec, setStreamCodec] = useState<string | undefined>(undefined);
  const [chromeTimeoutSeconds, setChromeTimeoutSeconds] = useState(DEFAULT_PLAYER_CHROME_TIMEOUT_SECONDS);
  const [audioTracks, setAudioTracks] = useState<PlayerTrack[]>([]);
  const [textTracks, setTextTracks] = useState<PlayerTrack[]>([]);
  const [audioTrack, setAudioTrack] = useState<number | undefined>(undefined);
  const [textTrack, setTextTrack] = useState<number | undefined>(undefined);
  const [downloadState, setDownloadState] = useState<PlayerDownloadState>("idle");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pipSupported, setPipSupported] = useState(false);
  const [pipActive, setPipActive] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(CODEC_MODE_KEY)
      .then((saved) => {
        if (saved === "auto" || saved === "hardware" || saved === "software") setCodecMode(saved);
      })
      .catch(() => undefined);
    getPlayerChromeTimeoutSeconds()
      .then(setChromeTimeoutSeconds)
      .catch(() => undefined);
    setPipSupported(isPipSupported());
    setVolume(getMediaVolume());
  }, []);

  const effectiveUri = useMemo(() => {
    const runtimeSource = resolvedSource ?? "";
    return /\/live\//i.test(runtimeSource) && /\.m3u8(?:$|\?)/i.test(runtimeSource)
      ? runtimeSource.replace(/\.m3u8(?=$|\?)/i, ".ts")
      : runtimeSource;
  }, [resolvedSource]);

  const clearControlsTimer = useCallback(() => {
    if (controlsTimer.current) {
      clearTimeout(controlsTimer.current);
      controlsTimer.current = null;
    }
  }, []);

  const clearInfoTimer = useCallback(() => {
    if (infoTimer.current) {
      clearTimeout(infoTimer.current);
      infoTimer.current = null;
    }
  }, []);

  const revealControls = useCallback((keep = false) => {
    setControlsVisible(true);
    clearControlsTimer();
    if (!keep) controlsTimer.current = setTimeout(
      () => setControlsVisible(false),
      chromeTimeoutSeconds * 1000,
    );
  }, [chromeTimeoutSeconds, clearControlsTimer]);

  const revealMediaInfo = useCallback(() => {
    setInfoVisible(true);
    clearInfoTimer();
    infoTimer.current = setTimeout(
      () => setInfoVisible(false),
      chromeTimeoutSeconds * 1000,
    );
  }, [chromeTimeoutSeconds, clearInfoTimer]);

  useEffect(() => {
    let cancelled = false;
    if (!isCatalogRuntimeSource(currentSource)) {
      setResolvedSource(currentSource);
      return () => { cancelled = true; };
    }
    setResolvedSource(null);
    setErrorText(null);
    void resolveCatalogRuntimeSource(currentSource, provider)
      .then((next) => {
        if (!cancelled) setResolvedSource(next);
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedSource(null);
        setErrorText("The cached playback address could not be refreshed. Refresh the catalog and try again.");
        revealControls(true);
        revealMediaInfo();
      });
    return () => { cancelled = true; };
  }, [
    currentSource,
    provider?.id,
    provider?.type,
    provider?.url,
    provider?.playlistUrl,
    provider?.username,
    provider?.password,
    revealControls,
    revealMediaInfo,
  ]);

  const onBackgroundPress = useCallback(() => {
    if (panel) {
      setPanel(null);
      revealControls();
      return;
    }
    if (controlsVisible) {
      clearControlsTimer();
      clearInfoTimer();
      setControlsVisible(false);
      setInfoVisible(false);
      return;
    }
    setVolume(getMediaVolume());
    revealControls();
    revealMediaInfo();
  }, [clearControlsTimer, clearInfoTimer, controlsVisible, panel, revealControls, revealMediaInfo]);

  const togglePanel = useCallback((next: Exclude<PlayerPanel, null>) => {
    setPanel((current) => current === next ? null : next);
    revealControls(true);
    revealMediaInfo();
  }, [revealControls, revealMediaInfo]);

  useEffect(() => {
    if (panel || downloadState === "downloading") {
      clearControlsTimer();
      setControlsVisible(true);
      return;
    }
    revealControls();
  }, [clearControlsTimer, downloadState, panel, revealControls]);

  useEffect(() => {
    revealMediaInfo();
    return () => {
      clearControlsTimer();
      clearInfoTimer();
    };
  }, [clearControlsTimer, clearInfoTimer, currentSource, currentTitle, revealMediaInfo]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      setVolume(getMediaVolume());
      if (pipActive && !isInPipMode()) {
        setPipActive(false);
        revealControls();
        revealMediaInfo();
      }
    });
    return () => subscription.remove();
  }, [pipActive, revealControls, revealMediaInfo]);

  const persistProgress = useCallback(async () => {
    const snapshot = playbackRef.current;
    if (snapshot.kind !== "movie" && snapshot.kind !== "episode") return;
    if (snapshot.position < 1) return;
    await saveProgress({
      kind: snapshot.kind,
      title: snapshot.title,
      source: snapshot.source,
      position: snapshot.position,
      duration: snapshot.duration,
    });
  }, [saveProgress]);

  useEffect(() => {
    const timer = setInterval(() => void persistProgress(), PROGRESS_PERSIST_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      void persistProgress();
    };
  }, [persistProgress]);

  useEffect(() => {
    let cancelled = false;
    if (
      currentKind !== "live" ||
      !currentLiveIdentity ||
      !provider ||
      provider.id !== currentLiveIdentity.providerId ||
      (provider.type !== "m3u" && provider.type !== "xtream")
    ) {
      setCachedLiveChannels([]);
      return () => { cancelled = true; };
    }
    void getCachedLivePlaybackWindow(provider, {
      providerId: currentLiveIdentity.providerId,
      itemId: currentLiveIdentity.channelId,
    })
      .then((items) => {
        if (!cancelled) setCachedLiveChannels(items);
      })
      .catch(() => {
        if (!cancelled) setCachedLiveChannels([]);
      });
    return () => { cancelled = true; };
  }, [currentKind, currentLiveIdentity, provider]);

  useEffect(() => {
    let cancelled = false;
    if (
      currentKind !== "movie" ||
      !currentVodIdentity ||
      !provider ||
      provider.id !== currentVodIdentity.providerId ||
      (provider.type !== "m3u" && provider.type !== "xtream")
    ) {
      setCachedVodItems([]);
      return () => { cancelled = true; };
    }
    void getCachedVodPlaybackWindow(provider, currentVodIdentity)
      .then((items) => {
        if (!cancelled) setCachedVodItems(items);
      })
      .catch(() => {
        if (!cancelled) setCachedVodItems([]);
      });
    return () => { cancelled = true; };
  }, [currentKind, currentVodIdentity, provider]);

  const liveQueue = useMemo(
    () => currentKind === "live"
      ? resolveLiveQueue(cachedLiveChannels, channels, currentLiveIdentity)
      : [],
    [cachedLiveChannels, channels, currentKind, currentLiveIdentity],
  );
  const currentLiveIndex = useMemo(
    () => liveQueueIndex(liveQueue, currentLiveIdentity),
    [currentLiveIdentity, liveQueue],
  );
  const currentLive = currentLiveIndex >= 0 ? liveQueue[currentLiveIndex] : undefined;

  // EPG is presentation-only while playback is active. Do not start any EPG
  // network request from the player and do not use an EPG timer in this parent.
  // The normal VLC progress updates already re-render the overlay often enough
  // for Date.now() to advance without touching the native video surface.
  const currentEpg = selectChannelEpg(epg, currentLive, Date.now());

  const episodeQueue = useMemo(
    () => currentKind === "episode" ? getEpisodePlaybackQueue(currentSource) : undefined,
    [currentKind, currentSource],
  );
  const legacyVodQueue = useMemo(
    () => currentKind === "movie" ? getVodPlaybackQueue(currentSource) : undefined,
    [currentKind, currentSource],
  );

  const selectableItems = useMemo<PlayerSelectableItem[]>(() => {
    if (currentKind === "live") {
      return liveQueue.slice(0, 500).map((channel) => ({
        id: channel.id,
        title: channel.name,
        subtitle: channel.category,
        source: channel.streamUrl,
        isLive: true,
      }));
    }
    if (currentKind === "episode" && episodeQueue) {
      return episodeQueue.items.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: `Sezon ${item.season}${item.episodeNumber ? ` · Bölüm ${item.episodeNumber}` : ""}`,
        source: item.url,
      }));
    }
    if (currentKind === "movie" && cachedVodItems.length) {
      const credentials = provider?.type === "xtream" && provider.username && provider.password
        ? {
            baseUrl: provider.url || provider.playlistUrl,
            username: provider.username,
            password: provider.password,
          }
        : null;
      return cachedVodItems.slice(0, 500).map((item) => ({
        id: String(item.stream_id),
        title: item.name,
        subtitle: item.genre || "Filmler",
        source: buildVodStreamUrl(credentials, item),
      }));
    }
    if (currentKind === "movie" && legacyVodQueue) {
      const current = legacyVodQueue.items[legacyVodQueue.index];
      const sameCategory = current?.categoryId
        ? legacyVodQueue.items.filter((item) => item.categoryId === current.categoryId)
        : legacyVodQueue.items;
      return sameCategory.slice(0, 500).map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.genre || "Filmler",
        source: item.url,
      }));
    }
    return [];
  }, [cachedVodItems, currentKind, episodeQueue, legacyVodQueue, liveQueue, provider]);

  const currentIndex = useMemo(
    () => currentKind === "live"
      ? currentLiveIndex
      : selectableItems.findIndex((item) => item.source === currentSource),
    [currentKind, currentLiveIndex, currentSource, selectableItems],
  );
  const queueMeta = currentIndex >= 0 ? selectableItems[currentIndex]?.subtitle : currentLive?.category;
  const currentMeta = currentSubtitle || queueMeta;
  const canNavigate = selectableItems.length > 1 && currentIndex >= 0;

  const switchTo = useCallback(async (item: PlayerSelectableItem) => {
    await persistProgress();
    const kind: PlayerMediaKind = item.isLive ? "live" : inferMediaKind(item.source);
    playbackRef.current = { source: item.source, title: item.title, kind, position: 0, duration: 0 };
    setCurrentSource(item.source);
    setCurrentTitle(item.title);
    setCurrentSubtitle(item.subtitle);
    setCurrentKind(kind);
    setCurrentLiveIdentity(
      item.isLive && provider
        ? { providerId: provider.id, channelId: item.id }
        : null,
    );
    setCurrentVodIdentity(
      kind === "movie" && provider
        ? { providerId: provider.id, itemId: item.id }
        : null,
    );
    setPosition(0);
    setDuration(0);
    setPaused(false);
    setPanel(null);
    setErrorText(null);
    setResolutionLabel(undefined);
    setStreamCodec(undefined);
    setAudioTracks([]);
    setTextTracks([]);
    setAudioTrack(undefined);
    setTextTrack(undefined);
    resumedSource.current = null;
    if (item.isLive) void recordWatched(item.id);
    revealControls();
    revealMediaInfo();
  }, [persistProgress, provider, recordWatched, revealControls, revealMediaInfo]);

  const moveRelative = useCallback((delta: number) => {
    if (!canNavigate) return;
    const next = currentIndex + delta;
    if (next < 0 || next >= selectableItems.length) return;
    void switchTo(selectableItems[next]);
  }, [canNavigate, currentIndex, selectableItems, switchTo]);

  const exitPlayer = useCallback(async () => {
    if (exitStarted.current) return;
    exitStarted.current = true;
    orientation.beginExit();
    clearControlsTimer();
    clearInfoTimer();
    await persistProgress();
    await orientation.restore();
    onFullscreenExit?.();
  }, [clearControlsTimer, clearInfoTimer, onFullscreenExit, orientation, persistProgress]);

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (panel) {
        setPanel(null);
        revealControls();
        return true;
      }
      void exitPlayer();
      return true;
    });
    return () => back.remove();
  }, [exitPlayer, panel, revealControls]);

  const seekToRatio = useCallback((ratio: number) => {
    if (currentKind === "live") return;
    const safe = Math.max(0, Math.min(1, ratio));
    vlcRef.current?.seek?.(safe);
    const nextPosition = playbackRef.current.duration * safe;
    playbackRef.current.position = nextPosition;
    setPosition(nextPosition);
    revealControls();
  }, [currentKind, revealControls]);

  const seekBy = useCallback((seconds: number) => {
    if (currentKind === "live" || playbackRef.current.duration <= 0) return;
    const next = Math.max(0, Math.min(
      playbackRef.current.duration,
      playbackRef.current.position + seconds,
    ));
    vlcRef.current?.seek?.(next / playbackRef.current.duration);
    playbackRef.current.position = next;
    setPosition(next);
    revealControls();
  }, [currentKind, revealControls]);

  const cycleFit = useCallback(() => {
    const modes: PlayerFitMode[] = ["fit", "full", "original", "16:9", "4:3"];
    setFit((value) => {
      const index = modes.indexOf(value);
      return modes[(index + 1 + modes.length) % modes.length] ?? "fit";
    });
    revealControls();
    revealMediaInfo();
  }, [revealControls, revealMediaInfo]);

  const changeCodecMode = useCallback(async (mode: PlayerCodecMode) => {
    await persistProgress();
    setCodecMode(mode);
    setPanel(null);
    setErrorText(null);
    setStreamCodec(undefined);
    resumedSource.current = null;
    await AsyncStorage.setItem(CODEC_MODE_KEY, mode).catch(() => undefined);
    revealControls();
    revealMediaInfo();
  }, [persistProgress, revealControls, revealMediaInfo]);

  const changeMediaVolume = useCallback((value: number) => {
    const safe = Math.max(0, Math.min(1, value));
    setVolume(safe);
    void setMediaVolume(safe);
  }, []);

  const startDownload = useCallback(async () => {
    if (!allowDownload || downloadState === "downloading" || !effectiveUri) return;
    setDownloadState("downloading");
    setDownloadProgress(0);
    revealControls(true);
    try {
      await downloadMedia(effectiveUri, currentTitle, {
        kind: currentKind === "episode" ? "episode" : "movie",
        onProgress: (progressValue) => {
          const now = Date.now();
          if (now - lastDownloadUiAt.current >= 250 || progressValue >= 1) {
            lastDownloadUiAt.current = now;
            setDownloadProgress(progressValue);
          }
        },
      });
      setDownloadProgress(1);
      setDownloadState("done");
      setTimeout(() => setDownloadState("idle"), 2200);
    } catch {
      setDownloadState("error");
    }
  }, [allowDownload, currentKind, currentTitle, downloadState, effectiveUri, revealControls]);

  const handleLoad = useCallback((event: VlcLoadEvent) => {
    const normalizedDuration = normalizeDuration(event?.duration);
    if (normalizedDuration > 0) {
      playbackRef.current.duration = normalizedDuration;
      setDuration(normalizedDuration);
    }
    if (event?.videoSize && event.videoSize.width > 0 && event.videoSize.height > 0) {
      const width = Math.round(Number(event.videoSize.width));
      const height = Math.round(Number(event.videoSize.height));
      setVideoSize({ width, height });
      setResolutionLabel(`${width}×${height}`);
    }
    if (event?.codec) setStreamCodec(event.codec);
    setAudioTracks(Array.isArray(event?.audioTracks) ? event.audioTracks : []);
    setTextTracks(Array.isArray(event?.textTracks) ? event.textTracks : []);

    const snapshot = playbackRef.current;
    if (
      resumedSource.current !== snapshot.source &&
      (snapshot.kind === "movie" || snapshot.kind === "episode") &&
      normalizedDuration > 0
    ) {
      const saved = getProgress(snapshot.source);
      if (saved?.position && saved.position > 5) {
        const ratio = Math.max(0, Math.min(1, saved.position / normalizedDuration));
        vlcRef.current?.seek?.(ratio);
        playbackRef.current.position = saved.position;
        setPosition(saved.position);
      }
      resumedSource.current = snapshot.source;
    }
  }, [getProgress]);

  const handleProgress = useCallback((event: VlcProgressEvent) => {
    const currentTime = normalizeCurrentTime(event?.currentTime, event?.duration);
    const normalizedDuration = normalizeDuration(event?.duration);
    playbackRef.current.position = currentTime;
    if (normalizedDuration > 0) playbackRef.current.duration = normalizedDuration;

    const now = Date.now();
    if (now - lastUiProgressAt.current < UI_PROGRESS_INTERVAL_MS) return;
    lastUiProgressAt.current = now;
    setPosition(currentTime);
    if (normalizedDuration > 0) setDuration(normalizedDuration);
  }, []);

  const handlePlaying = useCallback(() => {
    setPaused(false);
  }, []);

  const handlePaused = useCallback(() => {
    setPaused(true);
  }, []);

  const handleError = useCallback(() => {
    setErrorText(
      codecMode === "auto"
        ? "Oynatma başarısız. AUTO modu hem donanım hem yazılım çözümlemeyi denedi."
        : codecMode === "hardware"
          ? "Donanımsal çözümleme başarısız. AUTO veya SW codec modunu deneyin."
          : "Yazılımsal çözümleme ile bu medya oynatılamadı.",
    );
    revealControls(true);
    revealMediaInfo();
  }, [codecMode, revealControls, revealMediaInfo]);

  const handleEnd = useCallback(() => {
    if (currentKind === "episode" && currentIndex >= 0 && currentIndex < selectableItems.length - 1) {
      moveRelative(1);
    }
  }, [currentIndex, currentKind, moveRelative, selectableItems.length]);

  const enterPip = useCallback(async () => {
    if (!pipSupported) return;
    setPanel(null);
    clearControlsTimer();
    clearInfoTimer();
    setControlsVisible(false);
    setInfoVisible(false);
    const entered = await enterPictureInPicture(videoSize.width, videoSize.height);
    if (entered) {
      setPipActive(true);
      return;
    }
    revealControls();
    revealMediaInfo();
  }, [clearControlsTimer, clearInfoTimer, pipSupported, revealControls, revealMediaInfo, videoSize]);

  if (!orientation.ready || orientation.exiting) {
    return (
      <View style={styles.root}>
        <View style={styles.orientationGate}>
          {!orientation.exiting ? <Text style={styles.preparing}>Oynatıcı hazırlanıyor…</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {effectiveUri ? <VlcPlaybackSurface
        ref={vlcRef}
        uri={effectiveUri}
        paused={paused}
        fit={fit}
        codecMode={codecMode}
        audioTrack={audioTrack}
        textTrack={textTrack}
        onLoad={handleLoad}
        onProgress={handleProgress}
        onPlaying={handlePlaying}
        onPaused={handlePaused}
        onEnd={handleEnd}
        onError={handleError}
      /> : null}

      {!pipActive ? (
        <PlayerChrome
          title={currentTitle}
          meta={currentMeta}
          resolution={resolutionLabel}
          streamCodec={streamCodec}
          epgNow={currentEpg.now}
          epgNext={currentEpg.next}
          epgLoading={currentKind === "live" && isEpgLoading}
          mediaKind={currentKind}
          codecMode={codecMode}
          fitMode={fit}
          volume={volume}
          controlsVisible={controlsVisible}
          infoVisible={infoVisible}
          panel={panel}
          paused={paused}
          position={position}
          duration={duration}
          selectableItems={selectableItems}
          currentIndex={currentIndex}
          canNavigate={canNavigate}
          allowDownload={allowDownload}
          downloadState={downloadState}
          downloadProgress={downloadProgress}
          audioTracks={audioTracks}
          textTracks={textTracks}
          errorText={errorText}
          canExit={Boolean(onFullscreenExit)}
          pipSupported={pipSupported}
          onBackgroundPress={onBackgroundPress}
          onExit={() => void exitPlayer()}
          onTogglePause={() => {
            setPaused((value) => !value);
            revealControls();
          }}
          onSeekBy={seekBy}
          onSeekRatio={seekToRatio}
          onMoveRelative={moveRelative}
          onTogglePanel={togglePanel}
          onSwitchTo={(item) => void switchTo(item)}
          onSelectSubtitle={(id) => {
            setTextTrack(id);
            setPanel(null);
            revealControls();
          }}
          onSelectAudio={(id) => {
            setAudioTrack(id);
            setPanel(null);
            revealControls();
          }}
          onChangeCodec={(mode) => void changeCodecMode(mode)}
          onDownload={() => void startDownload()}
          onCycleFit={cycleFit}
          onRotate={() => void orientation.rotate()}
          onVolumeChange={changeMediaVolume}
          onEnterPip={() => void enterPip()}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  orientationGate: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  preparing: {
    color: "#8d99a9",
    fontSize: 13,
    fontWeight: "700",
  },
});