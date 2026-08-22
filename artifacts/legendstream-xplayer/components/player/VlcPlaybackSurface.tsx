import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { VLCPlayer } from "react-native-vlc-media-player";
import { logPlayerDiagnostic } from "@/lib/playerDiagnostics";

export type PlayerFitMode = "fit" | "full" | "original" | "16:9" | "4:3";
export type PlayerCodecMode = "auto" | "hardware" | "software";
export type PlayerTrack = { id: number; name: string };
export type PlayerVideoSize = { width: number; height: number };

export type VlcLoadEvent = {
  duration?: number;
  videoSize?: PlayerVideoSize;
  audioTracks?: PlayerTrack[];
  textTracks?: PlayerTrack[];
};

export type VlcProgressEvent = {
  currentTime?: number;
  duration?: number;
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

/**
 * Display-mode implementation built on the stable VLC mount path.
 *
 * Scaling/PiP behavior is intentionally unchanged. The only additional native
 * signal listened to here is VLC's existing onNewVideoLayout event, and only
 * until a real media resolution has been learned. This lets live streams expose
 * their coded resolution without touching TextureView sizing or aspect logic.
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
  const [playbackReady, setPlaybackReady] = useState(false);
  const [videoSize, setVideoSize] = useState<PlayerVideoSize | undefined>(undefined);

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
    applyGeneration.current += 1;
    lastLoadEvent.current = undefined;
    setPlaybackReady(false);
    setVideoSize(undefined);
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
    if (fit === "original" && validVideoSize(videoSize)) {
      return `${Math.round(videoSize!.width)}:${Math.round(videoSize!.height)}`;
    }
    return null;
  }, [fit, videoSize, window.height, window.width]);

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

  const handleLoad = useCallback((event: VlcLoadEvent) => {
    lastLoadEvent.current = event;
    if (validVideoSize(event?.videoSize)) {
      const size = {
        width: Number(event.videoSize!.width),
        height: Number(event.videoSize!.height),
      };
      setVideoSize(size);
      void logPlayerDiagnostic("vlc_load", {
        width: Math.round(size.width),
        height: Math.round(size.height),
        duration: Number(event?.duration || 0),
      });
    } else {
      void logPlayerDiagnostic("vlc_load", { duration: Number(event?.duration || 0), resolution: "pending" });
    }
    onLoad(event);
  }, [onLoad]);

  const handleNativeStateChange = useCallback((event: any) => {
    const payload = event?.nativeEvent ?? event;
    if (!payload || payload.type !== "onNewVideoLayout") return;

    const width = Number(payload.mVideoWidth);
    const height = Number(payload.mVideoHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

    const size = { width: Math.round(width), height: Math.round(height) };
    setVideoSize(size);
    void logPlayerDiagnostic("vlc_video_layout", { width: size.width, height: size.height });

    const mergedLoad: VlcLoadEvent = {
      ...(lastLoadEvent.current ?? {}),
      videoSize: size,
    };
    lastLoadEvent.current = mergedLoad;
    onLoad(mergedLoad);
  }, [onLoad]);

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

  const nativeStateProps = useMemo(
    () => validVideoSize(videoSize) ? {} : { onVideoStateChange: handleNativeStateChange },
    [handleNativeStateChange, videoSize],
  );

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
        onProgress={onProgress as any}
        onPlaying={handlePlaying}
        onPaused={handlePaused}
        onEnd={handleEnd}
        onError={handleError}
        {...(nativeStateProps as any)}
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
