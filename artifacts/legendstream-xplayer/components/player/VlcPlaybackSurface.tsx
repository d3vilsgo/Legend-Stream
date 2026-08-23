import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, StyleSheet, useWindowDimensions, View, ViewStyle } from "react-native";
import { VLCPlayer } from "react-native-vlc-media-player";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { logPlayerDiagnostic } from "@/lib/playerDiagnostics";
import {
  resetPlayerRuntimeInfo,
  updatePlayerRuntimeInfo,
} from "@/lib/playerRuntimeInfo";
import { setPlayerKeepAwake } from "@/modules/legendstream-pip";

const PLAYER_KEEP_AWAKE_TAG = "legendstream-active-playback";
const FALLBACK_VIDEO_SIZE = { width: 16, height: 9 } as const;

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
  codec?: string;
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
  codec?: string;
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

const readCodec = (event?: Record<string, unknown>) => {
  const payload = eventPayload(event);
  const raw = String((payload as any)?.codec ?? "").trim();
  return raw || undefined;
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

const publishRuntimeInfo = (size?: PlayerVideoSize, fps?: number, codec?: string) => {
  const update: { resolution?: string; fps?: number; codec?: string } = {};
  if (validVideoSize(size)) {
    update.resolution = `${Math.round(Number(size!.width))}×${Math.round(Number(size!.height))}`;
  }
  if (fps && Number.isFinite(fps) && fps > 0) update.fps = fps;
  if (codec) update.codec = codec;
  if (update.resolution || update.fps || update.codec) updatePlayerRuntimeInfo(update);
};

const ratioString = (size: PlayerVideoSize) =>
  `${Math.max(1, Math.round(size.width))}:${Math.max(1, Math.round(size.height))}`;

const containedFrame = (
  containerWidth: number,
  containerHeight: number,
  aspectRatio: number,
): ViewStyle => {
  if (containerWidth <= 0 || containerHeight <= 0 || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return { width: "100%", height: "100%" };
  }

  const containerRatio = containerWidth / containerHeight;
  if (containerRatio > aspectRatio) {
    return { height: "100%", aspectRatio };
  }
  return { width: "100%", aspectRatio };
};

/**
 * Stable VLC surface with a layout-level aspect-ratio guarantee.
 *
 * react-native-vlc-media-player@1.0.98 exposes resizeMode in JS, but Android's
 * ReactVlcPlayerViewManager does not register a resizeMode ReactProp, so that
 * prop is ignored on Android. Its autoAspectRatio implementation also uses the
 * TextureView dimensions (surface width:height), not the coded video track.
 *
 * Therefore FIT/ORIGINAL are enforced twice:
 *   1) React Native sizes the VLC TextureView container from the real coded
 *      track width/height bridged by patch-vlc-progress-metrics.py.
 *   2) VLC receives that same explicit width:height through the imperative
 *      changeVideoAspectRatio path with autoAspectRatio disabled.
 *
 * This prevents a portrait phone surface from forcing a 16:9 stream into the
 * phone's tall aspect ratio. Black letterbox/pillarbox space belongs to the
 * outer surface, never to a stretched VLC TextureView.
 */
const VlcPlaybackSurfaceImpl = forwardRef<any, Props>(function VlcPlaybackSurface(
  {
    uri,
    paused,
    fit = "fit",
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
  const lastLoadEvent = useRef<VlcLoadEvent | undefined>(undefined);
  const lastMetricKey = useRef("");
  const [playbackReady, setPlaybackReady] = useState(false);
  const [sourceVideoSize, setSourceVideoSize] = useState<PlayerVideoSize | undefined>(undefined);

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
    const shouldKeepAwake = playbackReady && !paused;
    if (shouldKeepAwake) {
      void activateKeepAwakeAsync(PLAYER_KEEP_AWAKE_TAG).catch(() => undefined);
      void setPlayerKeepAwake(true);
    } else {
      void deactivateKeepAwake(PLAYER_KEEP_AWAKE_TAG).catch(() => undefined);
      void setPlayerKeepAwake(false);
    }
    return () => {
      void deactivateKeepAwake(PLAYER_KEEP_AWAKE_TAG).catch(() => undefined);
      void setPlayerKeepAwake(false);
    };
  }, [paused, playbackReady]);

  useEffect(() => {
    applyGeneration.current += 1;
    lastLoadEvent.current = undefined;
    lastMetricKey.current = "";
    setPlaybackReady(false);
    setSourceVideoSize(undefined);
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

  const effectiveVideoSize = sourceVideoSize ?? FALLBACK_VIDEO_SIZE;

  const targetAspectRatio = useMemo(() => {
    if (fit === "full") {
      return window.width > 0 && window.height > 0 ? window.width / window.height : 16 / 9;
    }
    if (fit === "4:3") return 4 / 3;
    if (fit === "16:9") return 16 / 9;
    return effectiveVideoSize.width / effectiveVideoSize.height;
  }, [effectiveVideoSize.height, effectiveVideoSize.width, fit, window.height, window.width]);

  const nativeAspectRatio = useMemo(() => {
    if (fit === "full") {
      return `${Math.max(1, Math.round(window.width))}:${Math.max(1, Math.round(window.height))}`;
    }
    if (fit === "4:3" || fit === "16:9") return fit;
    return ratioString(effectiveVideoSize);
  }, [effectiveVideoSize, fit, window.height, window.width]);

  const frameStyle = useMemo<ViewStyle>(() => {
    if (fit === "full") return styles.fullFrame;
    return containedFrame(window.width, window.height, targetAspectRatio);
  }, [fit, targetAspectRatio, window.height, window.width]);

  useEffect(() => {
    if (!playbackReady || !playerRef.current) return;

    const generation = ++applyGeneration.current;
    const player = playerRef.current;

    // 1.0.98 autoAspectRatio is surface-aspect, not source-aspect. Keep it off.
    try {
      player.autoAspectRatio?.(false);
    } catch {
      try { player.setNativeProps?.({ autoAspectRatio: false }); } catch { /* best effort */ }
    }

    const timer = setTimeout(() => {
      if (generation !== applyGeneration.current || playerRef.current !== player) return;
      try {
        player.changeVideoAspectRatio?.(nativeAspectRatio);
      } catch {
        try { player.setNativeProps?.({ videoAspectRatio: nativeAspectRatio }); } catch { /* best effort */ }
      }
      void logPlayerDiagnostic("vlc_aspect_applied", {
        fit,
        nativeAspectRatio,
        sourceWidth: sourceVideoSize?.width ?? null,
        sourceHeight: sourceVideoSize?.height ?? null,
        surfaceWidth: Math.round(window.width),
        surfaceHeight: Math.round(window.height),
      });
    }, 32);

    return () => clearTimeout(timer);
  }, [fit, nativeAspectRatio, playbackReady, sourceVideoSize, window.height, window.width]);

  const acceptRuntimeMetrics = useCallback((
    event?: Record<string, unknown>,
    source = "unknown",
    rejectWindowSurface = false,
  ) => {
    let size = readVideoSize(event);
    const fps = readFrameRate(event);
    const codec = readCodec(event);
    if (rejectWindowSurface && size && isLikelyWindowSurface(size)) {
      void logPlayerDiagnostic("vlc_metric_rejected_window_size", {
        source,
        width: Math.round(size.width),
        height: Math.round(size.height),
      });
      size = undefined;
    }
    if (!size && !fps && !codec) return { size: undefined, fps: undefined, codec: undefined };

    if (size) {
      setSourceVideoSize((previous) =>
        previous?.width === size!.width && previous?.height === size!.height ? previous : size,
      );
    }
    publishRuntimeInfo(size, fps, codec);

    const key = `${size?.width ?? 0}x${size?.height ?? 0}@${fps ? fps.toFixed(3) : "0"}:${codec ?? ""}`;
    if (key !== lastMetricKey.current) {
      lastMetricKey.current = key;
      void logPlayerDiagnostic("vlc_runtime_metrics", {
        source,
        width: size ? Math.round(size.width) : null,
        height: size ? Math.round(size.height) : null,
        fps: fps ?? null,
        codec: codec ?? null,
      });
    }
    return { size, fps, codec };
  }, [isLikelyWindowSurface]);

  const handleLoad = useCallback((event: VlcLoadEvent) => {
    const previous = lastLoadEvent.current;
    const rawSize = readVideoSize(event as Record<string, unknown>);
    const safeSize = rawSize && !isLikelyWindowSurface(rawSize) ? rawSize : previous?.videoSize;
    const safeFps = readFrameRate(event as Record<string, unknown>) ?? previous?.frameRate ?? previous?.fps;
    const safeCodec = readCodec(event as Record<string, unknown>) ?? previous?.codec;

    const mergedEvent: VlcLoadEvent = {
      ...(previous ?? {}),
      ...(event ?? {}),
      videoSize: safeSize,
      videoWidth: safeSize?.width,
      videoHeight: safeSize?.height,
      frameRate: safeFps,
      fps: safeFps,
      codec: safeCodec,
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
      codec: safeCodec ?? null,
      duration: Number(mergedEvent?.duration || 0),
    });
    onLoad(mergedEvent);
  }, [acceptRuntimeMetrics, isLikelyWindowSurface, onLoad]);

  const handleProgress = useCallback((event: VlcProgressEvent) => {
    const { size, fps, codec } = acceptRuntimeMetrics(
      event as Record<string, unknown>,
      "progress-selected-track",
      false,
    );

    const previous = lastLoadEvent.current;
    if (
      (size && (
        previous?.videoSize?.width !== size.width ||
        previous?.videoSize?.height !== size.height
      )) ||
      (fps && previous?.fps !== fps) ||
      (codec && previous?.codec !== codec)
    ) {
      const merged: VlcLoadEvent = {
        ...(previous ?? {}),
        ...(size ? {
          videoSize: size,
          videoWidth: size.width,
          videoHeight: size.height,
        } : {}),
        ...(fps ? { frameRate: fps, fps } : {}),
        ...(codec ? { codec } : {}),
      };
      lastLoadEvent.current = merged;
      onLoad(merged);
    }

    onProgress(event);
  }, [acceptRuntimeMetrics, onLoad, onProgress]);

  const handlePlaying = useCallback(() => {
    setPlaybackReady(true);
    void logPlayerDiagnostic("vlc_playing", { codec: codecMode, fit });
    onPlaying();
  }, [codecMode, fit, onPlaying]);

  const handlePaused = useCallback(() => {
    setPlaybackReady(false);
    void logPlayerDiagnostic("vlc_paused");
    onPaused();
  }, [onPaused]);

  const handleEnd = useCallback(() => {
    setPlaybackReady(false);
    void logPlayerDiagnostic("vlc_end");
    onEnd();
  }, [onEnd]);

  const handleError = useCallback(() => {
    setPlaybackReady(false);
    void logPlayerDiagnostic("vlc_error", { codec: codecMode, fit });
    onError();
  }, [codecMode, fit, onError]);

  return (
    <View style={styles.surface} pointerEvents="none">
      <View style={[styles.videoFrame, frameStyle]}>
        <VLCPlayer
          key={`${uri}:${codecMode}`}
          ref={assignRef}
          style={styles.video}
          source={{ uri, initType: 2, initOptions }}
          paused={paused}
          autoplay
          autoAspectRatio={false}
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
    </View>
  );
});

export const VlcPlaybackSurface = memo(VlcPlaybackSurfaceImpl);

const styles = StyleSheet.create({
  surface: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  videoFrame: {
    overflow: "hidden",
    backgroundColor: "#000",
    alignSelf: "center",
  },
  fullFrame: {
    width: "100%",
    height: "100%",
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
});