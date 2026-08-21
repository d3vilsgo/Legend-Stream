import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { VLCPlayer } from "react-native-vlc-media-player";

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
 * Display-mode implementation built on the stable 1.4.10 VLC mount path.
 *
 * Important: the native player is still created exactly like the known-good
 * baseline (full-screen TextureView + autoAspectRatio). We do not resize the
 * TextureView and we do not touch VLC aspect ratio while the player is opening.
 *
 * Only after playback is running AND the user selects a non-default display
 * mode do we switch VLC from automatic aspect ratio to an explicit ratio. This
 * avoids the React-prop ordering race that made the earlier FIT/CROP/FILL builds
 * ineffective and, in some builds, unstable.
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
    setPlaybackReady(false);
    setVideoSize(undefined);
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

    // Keep the initial FIT path byte-for-byte equivalent to the stable baseline.
    // Native aspect-ratio control is activated only after the user chooses a
    // display mode. Once activated, returning to FIT means aspectRatio=null.
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
    if (validVideoSize(event?.videoSize)) {
      setVideoSize({
        width: Number(event.videoSize!.width),
        height: Number(event.videoSize!.height),
      });
    }
    onLoad(event);
  }, [onLoad]);

  const handlePlaying = useCallback(() => {
    setPlaybackReady(true);
    onPlaying();
  }, [onPlaying]);

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
        onPaused={onPaused}
        onEnd={onEnd}
        onError={onError}
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
