import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, StyleSheet, useWindowDimensions, View } from "react-native";
import { VLCPlayer } from "react-native-vlc-media-player";
import { logPlayerDiagnostic } from "@/lib/playerDiagnostics";
import {
  resetPlayerRuntimeInfo,
  updatePlayerRuntimeInfo,
} from "@/lib/playerRuntimeInfo";
import { setPlayerKeepAwake } from "@/modules/legendstream-pip";

export type PlayerFitMode = "fit" | "full" | "original" | "16:9" | "4:3";
export type PlayerCodecMode = "auto" | "hardware" | "software";
export type PlayerTrack = { id: number; name: string };
export type PlayerVideoSize = { width: number; height: number };

export type VlcLoadEvent = {
  duration?: number;
  videoSize?: PlayerVideoSize;
  videoWidth?: number;
  videoHeight?: number;
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

const eventPayload = (event?: Record<string, unknown>) =>
  ((event as any)?.nativeEvent ?? event ?? {}) as Record<string, unknown>;

const readFrameRate = (event?: Record<string, unknown>) => {
  const payload = eventPayload(event);
  const value = Number((payload as any)?.frameRate ?? (payload as any)?.fps ?? 0);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const readVideoSize = (event?: Record<string, unknown>): PlayerVideoSize | undefined => {
  const payload = eventPayload(event);
  const nested = (payload as any)?.videoSize;
  if (nested) {
    const candidate = {
      width: Number(nested.width),
      height: Number(nested.height),
    };
    if (validVideoSize(candidate)) return candidate;
  }

  const candidate = {
    width: Number((payload as any)?.videoWidth ?? 0),
    height: Number((payload as any)?.videoHeight ?? 0),
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

/**
 * Stable VLC surface.
 *
 * ORIG/FIT deliberately use VLC's natural aspect-ratio path. We never force
 * ORIG from window/layout dimensions; that was the source of portrait streams
 * being stretched to the phone's display size.
 *
 * Live resolution/FPS are consumed from the coded selected video track appended
 * to VLC's normal progress event by patch-vlc-progress-metrics.py.
 */
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
    void setPlayerKeepAwake(true);
    return () => {
      void setPlayerKeepAwake(false);
    };
  }, []);

  useEffect(() => {
    applyGeneration.current += 1;
    lastLoadEvent.current = undefined;
    lastMetricKey.current = "";
    displayModeActivated.current = false;
    setPlaybackReady(false);
    resetPlayerRuntimeInfo();
    void logPlayerDiagnostic("vlc_mount", { codec: codecMode, fit });
    return () => {
      void logPlayerDiagnostic("vlc_unmount", { codec: codecMode });
    };
  }, [codecMode, uri]);

  const isLikelyWindowSurface = useCallback((size?: PlayerVideoSize) => {
    if (!validVideoSize(size)) return false;
    const physicalWidth = PixelRatio.getPixelSizeForLayoutSize(window.width);
    const physicalHeight = PixelRatio.getPixelSizeForLayoutSize(window.height);
    const near = (a: number, b: number) => Math.abs(a - b) <= 24;
    return (
      (near(size!.width, physicalWidth) && near(size!.height, physicalHeight)) ||
      (near(size!.width, physicalHeight) && near(size!.height, physicalWidth))
    );
  }, [window.height, window.width]);

  const explicitAspectRatio = useMemo(() => {
    if (fit === "fit" || fit === "original") return null;
    if (fit === "4:3" || fit === "16:9") return fit;
    if (fit === "full") {
      if (window.width <= 0 || window.height <= 0) return null;
      return `${Math.max(1, Math.round(window.width))}:${Math.max(1, Math.round(window.height))}`;
    }
    return null;
  }, [fit, window.height, window.width]);

  useEffect(() => {
    if (!playbackReady || !playerRef.current) return;

    const naturalMode = fit === "fit" || fit === "original";
    if (naturalMode && !displayModeActivated.current) return;
    if (!naturalMode) displayModeActivated.current = true;

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
    rejectWindowSurface = false,
  ) => {
    let size = readVideoSize(event);
    const fps = readFrameRate(event);
    if (rejectWindowSurface && size && isLikelyWindowSurface(size)) {
      void logPlayerDiagnostic("vlc_metric_rejected_window_size", {
        source,
        width: Math.round(size.width),
        height: Math.round(size.height),
      });
      size = undefined;
    }
    if (!size && !fps) return { size: undefined, fps: undefined };

    publishRuntimeInfo(size, fps);

    const key = `${size?.width ?? 0}x${size?.height ?? 0}@${fps ? fps.toFixed(3) : "0"}`;
    if (key !== lastMetricKey.current) {
      lastMetricKey.current = key;
      void logPlayerDiagnostic("vlc_runtime_metrics", {
        source,
        width: size ? Math.round(size.width) : null,
        height: size ? Math.round(size.height) : null,
        fps: fps ?? null,
      });
    }
    return { size, fps };
  }, [isLikelyWindowSurface]);

  const handleLoad = useCallback((event: VlcLoadEvent) => {
    const previous = lastLoadEvent.current;
    const rawSize = readVideoSize(event as Record<string, unknown>);
    const safeSize = rawSize && !isLikelyWindowSurface(rawSize) ? rawSize : previous?.videoSize;
    const safeFps = readFrameRate(event as Record<string, unknown>) ?? previous?.frameRate ?? previous?.fps;

    const mergedEvent: VlcLoadEvent = {
      ...(previous ?? {}),
      ...(event ?? {}),
      videoSize: safeSize,
      videoWidth: safeSize?.width,
      videoHeight: safeSize?.height,
      frameRate: safeFps,
      fps: safeFps,
      audioTracks: Array.isArray(event?.audioTracks)
        ? event.audioTracks
        : previous?.audioTracks,
      textTracks: Array.isArray(event?.textTracks)
        ? event.textTracks
        : previous?.textTracks,
    };
    lastLoadEvent.current = mergedEvent;
    acceptRuntimeMetrics(mergedEvent as Record<string, unknown>, "load", true);

    void logPlayerDiagnostic("vlc_load", {
      width: safeSize ? Math.round(safeSize.width) : null,
      height: safeSize ? Math.round(safeSize.height) : null,
      fps: safeFps ?? null,
      duration: Number(mergedEvent?.duration || 0),
    });
    onLoad(mergedEvent);
  }, [acceptRuntimeMetrics, isLikelyWindowSurface, onLoad]);

  const handleProgress = useCallback((event: VlcProgressEvent) => {
    const { size, fps } = acceptRuntimeMetrics(
      event as Record<string, unknown>,
      "progress-selected-track",
      false,
    );

    if (size) {
      const previous = lastLoadEvent.current;
      if (
        previous?.videoSize?.width !== size.width ||
        previous?.videoSize?.height !== size.height ||
        (fps && previous?.fps !== fps)
      ) {
        const merged: VlcLoadEvent = {
          ...(previous ?? {}),
          videoSize: size,
          videoWidth: size.width,
          videoHeight: size.height,
          ...(fps ? { frameRate: fps, fps } : {}),
        };
        lastLoadEvent.current = merged;
        onLoad(merged);
      }
    }

    onProgress(event);
  }, [acceptRuntimeMetrics, onLoad, onProgress]);

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
