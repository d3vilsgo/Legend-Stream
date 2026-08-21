import React, { forwardRef, memo, useCallback, useMemo, useState } from "react";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";
import { VLCPlayer } from "react-native-vlc-media-player";

export type PlayerFitMode = "contain" | "cover" | "fill";
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

type Size = { width: number; height: number };

const validSize = (value: Size) =>
  Number.isFinite(value.width) &&
  Number.isFinite(value.height) &&
  value.width > 0 &&
  value.height > 0;

/**
 * Crash-safe Android scaling strategy.
 *
 * The 1.4.7 player proved that VLC is stable when its native playback surface is
 * left alone. Therefore FIT/CROP/FILL are implemented by changing only the
 * React Native TextureView frame. We deliberately do NOT call
 * changeVideoAspectRatio(), setAspectRatio(), resizeMode or any other native VLC
 * geometry command here.
 *
 * VLC's existing autoAspectRatio behavior then receives a view whose own aspect
 * ratio already matches the requested display mode:
 * - FIT: contained media-sized frame
 * - CROP: covering media-sized frame clipped by the parent
 * - FILL: full viewport frame (intentional stretch)
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
  ref,
) {
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [videoSize, setVideoSize] = useState<PlayerVideoSize>({ width: 16, height: 9 });

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

  const frameStyle = useMemo(() => {
    if (!validSize(viewport)) return styles.videoFill;
    if (fit === "fill" || !validSize(videoSize)) return styles.videoFill;

    const scale = fit === "cover"
      ? Math.max(viewport.width / videoSize.width, viewport.height / videoSize.height)
      : Math.min(viewport.width / videoSize.width, viewport.height / videoSize.height);

    const width = Math.max(1, videoSize.width * scale);
    const height = Math.max(1, videoSize.height * scale);

    return {
      position: "absolute" as const,
      width,
      height,
      left: (viewport.width - width) / 2,
      top: (viewport.height - height) / 2,
      backgroundColor: "#000",
    };
  }, [fit, videoSize, viewport]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    setViewport((current) =>
      Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
        ? current
        : { width, height },
    );
  }, []);

  const handleLoad = useCallback((event: VlcLoadEvent) => {
    const next = event?.videoSize;
    if (next && validSize(next)) {
      setVideoSize({ width: Number(next.width), height: Number(next.height) });
    }
    onLoad(event);
  }, [onLoad]);

  return (
    <View style={styles.surface} pointerEvents="none" onLayout={handleLayout}>
      <VLCPlayer
        key={`${uri}:${codecMode}`}
        ref={ref}
        style={frameStyle}
        source={{ uri, initType: 2, initOptions }}
        paused={paused}
        autoplay
        autoAspectRatio
        audioTrack={audioTrack}
        textTrack={textTrack}
        onLoad={handleLoad as any}
        onProgress={onProgress as any}
        onPlaying={onPlaying}
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
    alignItems: "center",
    justifyContent: "center",
  },
  videoFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
});
