import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { VLCPlayer } from "react-native-vlc-media-player";
import { logPlayerDiagnostic } from "@/lib/playerDiagnostics";
import {
  resetPlayerRuntimeInfo,
  updatePlayerRuntimeInfo,
} from "@/lib/playerRuntimeInfo";
import { setPlayerKeepScreenOn } from "@/modules/legendstream-pip";

export type PlayerFitMode = "fit" | "full" | "original" | "16:9" | "4:3";
export type PlayerCodecMode = "auto" | "hardware" | "software";
export type PlayerTrack = { id: number; name: string };
export type PlayerVideoSize = { width: number; height: number };

export type VlcLoadEvent = {
  duration?: number;
  videoSize?: PlayerVideoSize;
  videoWidth?: number;
  videoHeight?: number;
  mVideoWidth?: number;
  mVideoHeight?: number;
  mVideoVisibleWidth?: number;
  mVideoVisibleHeight?: number;
  audioTracks?: PlayerTrack[];
  textTracks?: PlayerTrack[];
  frameRate?: number;
  fps?: number;
};

export type VlcProgressEvent = {
  currentTime?: number;
  duration?: number;
  position?: number;
  isPlaying?: boolean;
  videoSize?: PlayerVideoSize;
  videoWidth?: number;
  videoHeight?: number;
  frameRate?: number;
  fps?: number;
};

type Props = {
  uri: string;
  paused: boolean;
  fit: PlayerFitMode;
  codecMode: PlayerCodecMode;
  audioTrack?: number;
  textTrack?: number;
  onLoad: (event: VlcLoadEvent) => void;
  onProgress: (event: VlcProgressEvent) => void;
  onPlaying: () => void;
  onPaused: () => void;
  onEnd: () => void;
  onError: () => void;
};

const validVideoSize = (value?: PlayerVideoSize) =>
  Boolean(
    value &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0,
  );

const readFrameRate = (event?: Record<string, unknown>) => {
  const value = Number((event as any)?.frameRate ?? (event as any)?.fps ?? 0);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const readVideoSize = (event?: Record<string, unknown>): PlayerVideoSize | undefined => {
  const visibleWidth = Number((event as any)?.mVideoVisibleWidth ?? 0);
  const visibleHeight = Number((event as any)?.mVideoVisibleHeight ?? 0);
  if (visibleWidth > 0 && visibleHeight > 0) {
    return { width: visibleWidth, height: visibleHeight };
  }

  const nested = (event as any)?.videoSize;
  if (nested) {
    const candidate = {
      width: Number(nested.width),
      height: Number(nested.height),
    };
    if (validVideoSize(candidate)) return candidate;
  }

  const candidate = {
    width: Number((event as any)?.videoWidth ?? (event as any)?.mVideoWidth ?? 0),
    height: Number((event as any)?.videoHeight ?? (event as any)?.mVideoHeight ?? 0),
  };
  return validVideoSize(candidate) ? candidate : undefined;
};

const publishRuntimeInfo = (size?: PlayerVideoSize, fps?: number) => {
  const update: { resolution?: string; fps?: number } = {};
  if (validVideoSize(size)) {
    update.resolution = `${Math.round(Number(size!.width))}×${Math.round(Number(size!.height))}`;
  }
  if (fps && Number.isFinite(fps) && fps > 0) update.fps = fps;
  if (update.resolution || update.fps) updatePlayerRuntimeInfo(update);
};

const VlcPlaybackSurfaceImpl = forwardRef<any, Props>(function VlcPlaybackSurface(
  {
    uri,
    paused,
    fit,
    codecMode,
    audioTrack,
    textTrack,
    onLoad,
    onProgress,
    onPlaying,
    onPaused,
    onEnd,
    onError,
  },
  forwardedRef,
) {
  const window = useWindowDimensions();
  const playerRef = useRef<any>(null);
  const applyGeneration = useRef(0);
  const displayModeActivated = useRef(false);
  const lastLoadEvent = useRef<VlcLoadEvent | undefined>(undefined);
  const lastMetricKey = useRef("");
  const [playbackReady, setPlaybackReady] = useState(false);
  const [trustedVideoSize, setTrustedVideoSize] = useState<PlayerVideoSize | undefined>(undefined);

  const assignRef = useCallback((node: any) => {
    playerRef.current = node;
    if (typeof forwardedRef === "function") {
      forwardedRef(node);
    } else if (forwardedRef) {
      forwardedRef.current = node;
    }
  }, [forwardedRef]);

  const initOptions = useMemo(() => {
    const base = [
      "--network-caching=1200",
      "--file-caching=1000",
      "--http-reconnect",
      "--no-drop-late-frames",
    ];
    if (codecMode === "hardware") return [...base, "--avcodec-hw=any"];
    if (codecMode === "software") return [...base, "--avcodec-hw=none"];
    return base;
  }, [codecMode]);

  useEffect(() => {
    void setPlayerKeepScreenOn(true);
    return () => {
      void setPlayerKeepScreenOn(false);
    };
  }, []);

  useEffect(() => {
    applyGeneration.current += 1;
    lastLoadEvent.current = undefined;
    lastMetricKey.current = "";
    setPlaybackReady(false);
    setTrustedVideoSize(undefined);
    resetPlayerRuntimeInfo();
    void logPlayerDiagnostic("vlc_mount", { codec: codecMode, fit });
    return () => {
      void logPlayerDiagnostic("vlc_unmount", { codec: codecMode });
    };
  }, [codecMode, uri]);

  const explicitAspectRatio = useMemo(() => {
    if (fit === "fit") return null;
    if (fit === "4:3" || fit === "16:9") return fit;
    if (fit === "full") {
      if (window.width <= 0 || window.height <= 0) return null;
      return `${Math.max(1, Math.round(window.width))}:${Math.max(1, Math.round(window.height))}`;
    }
    if (fit === "original" && validVideoSize(trustedVideoSize)) {
      return `${Math.round(trustedVideoSize!.width)}:${Math.round(trustedVideoSize!.height)}`;
    }
    return null;
  }, [fit, trustedVideoSize, window.height, window.width]);

  useEffect(() => {
    if (!playbackReady || !playerRef.current) return;
    if (fit === "fit" && !displayModeActivated.current) return;
    if (fit !== "fit") displayModeActivated.current = true;

    const generation = ++applyGeneration.current;
    const player = playerRef.current;

    try {
      player.autoAspectRatio?.(false);
    } catch {
      try { player.setNativeProps?.({ autoAspectRatio: false }); } catch { /* best effort */ }
    }

    const timer = setTimeout(() => {
      if (generation !== applyGeneration.current || playerRef.current !== player) return;
      try {
        player.changeVideoAspectRatio?.(explicitAspectRatio);
      } catch {
        try { player.setNativeProps?.({ videoAspectRatio: explicitAspectRatio }); } catch { /* best effort */ }
      }
    }, 32);

    return () => clearTimeout(timer);
  }, [explicitAspectRatio, fit, playbackReady]);

  const acceptRuntimeMetrics = useCallback((
    event?: Record<string, unknown>,
    source = "unknown",
    trustForAspectRatio = false,
  ) => {
    const rawSize = readVideoSize(event);
    const fps = readFrameRate(event);
    const matchesViewport = Boolean(
      rawSize &&
      Math.abs(rawSize.width - window.width) <= 4 &&
      Math.abs(rawSize.height - window.height) <= 4,
    );
    const size = source === "progress" && matchesViewport ? undefined : rawSize;

    if (!size && !fps) return;

    if (size && trustForAspectRatio) {
      setTrustedVideoSize((previous) => {
        if (previous?.width === size.width && previous?.height === size.height) return previous;
        return size;
      });
    }

    publishRuntimeInfo(size, fps);

    const key = `${size?.width ?? 0}x${size?.height ?? 0}@${fps ? fps.toFixed(3) : "0"}:${source}`;
    if (key !== lastMetricKey.current) {
      lastMetricKey.current = key;
      void logPlayerDiagnostic("vlc_runtime_metrics", {
        source,
        width: size ? Math.round(size.width) : null,
        height: size ? Math.round(size.height) : null,
        fps: fps ?? null,
        trustedForAspectRatio: trustForAspectRatio,
      });
    }
  }, [window.height, window.width]);

  const handleLoad = useCallback((event: VlcLoadEvent) => {
    const previous = lastLoadEvent.current;
    const mergedEvent: VlcLoadEvent = {
      ...(previous ?? {}),
      ...(event ?? {}),
      audioTracks: Array.isArray(event?.audioTracks)
        ? event.audioTracks
        : previous?.audioTracks,
      textTracks: Array.isArray(event?.textTracks)
        ? event.textTracks
        : previous?.textTracks,
    };
    lastLoadEvent.current = mergedEvent;
    acceptRuntimeMetrics(mergedEvent as Record<string, unknown>, "load", true);

    const size = readVideoSize(mergedEvent as Record<string, unknown>);
    const fps = readFrameRate(mergedEvent as Record<string, unknown>);
    void logPlayerDiagnostic("vlc_load", {
      width: size ? Math.round(size.width) : null,
      height: size ? Math.round(size.height) : null,
      fps: fps ?? null,
      duration: Number(mergedEvent?.duration || 0),
    });
    onLoad(mergedEvent);
  }, [acceptRuntimeMetrics, onLoad]);

  const handleProgress = useCallback((event: VlcProgressEvent) => {
    // Runtime metrics are display-only. Never let progress metadata redefine
    // ORIGINAL aspect ratio; some devices expose their viewport dimensions here.
    acceptRuntimeMetrics(event as Record<string, unknown>, "progress", false);
    onProgress(event);
  }, [acceptRuntimeMetrics, onProgress]);

  const handleNativeStateChange = useCallback((event: any) => {
    const payload = event?.nativeEvent ?? event;
    if (!payload || payload.type !== "onNewVideoLayout") return;

    acceptRuntimeMetrics(payload, "layout", true);
    const size = readVideoSize(payload);
    const fps = readFrameRate(payload);
    if (!size) return;

    const mergedLoad: VlcLoadEvent = {
      ...(lastLoadEvent.current ?? {}),
      videoSize: size,
      mVideoVisibleWidth: Number(payload?.mVideoVisibleWidth || 0) || undefined,
      mVideoVisibleHeight: Number(payload?.mVideoVisibleHeight || 0) || undefined,
      ...(fps ? { frameRate: fps } : {}),
    };
    lastLoadEvent.current = mergedLoad;
    onLoad(mergedLoad);
  }, [acceptRuntimeMetrics, onLoad]);

  const handlePlaying = useCallback(() => {
    setPlaybackReady(true);
    void logPlayerDiagnostic("vlc_playing", { codec: codecMode, fit });
    onPlaying();
  }, [codecMode, fit, onPlaying]);

  const handlePaused = useCallback(() => {
    void logPlayerDiagnostic("vlc_paused");
    onPaused();
  }, [onPaused]);

  const handleEnd = useCallback(() => {
    void logPlayerDiagnostic("vlc_end");
    onEnd();
  }, [onEnd]);

  const handleError = useCallback(() => {
    void logPlayerDiagnostic("vlc_error", { codec: codecMode, fit });
    onError();
  }, [codecMode, fit, onError]);

  return (
    <View style={styles.surface} pointerEvents="none">
      <VLCPlayer
        key={`${uri}:${codecMode}`}
        ref={assignRef}
        style={styles.video}
        source={{ uri, initType: 2, initOptions }}
        paused={paused}
        autoplay
        autoAspectRatio
        resizeMode="contain"
        audioTrack={audioTrack}
        textTrack={textTrack}
        onLoad={handleLoad as any}
        onProgress={handleProgress as any}
        onPlaying={handlePlaying}
        onPaused={handlePaused}
        onEnd={handleEnd}
        onError={handleError}
        {...({ onVideoStateChange: handleNativeStateChange } as any)}
      />
    </View>
  );
});

export const VlcPlaybackSurface = memo(VlcPlaybackSurfaceImpl);

const styles = StyleSheet.create({
  surface: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
});
