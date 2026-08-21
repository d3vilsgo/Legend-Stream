import React, { forwardRef, memo, useCallback, useMemo, useState } from "react";
import { LayoutChangeEvent, StyleSheet, View, ViewStyle } from "react-native";
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
  volume: number;
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
const validSize = (size?: Partial<Size> | null): size is Size =>
  Boolean(size && Number(size.width) > 0 && Number(size.height) > 0);

/**
 * Android's VLC TextureView does not reliably honor React Native resizeMode.
 * Instead of delegating fit/cover to the library, this component sizes the
 * native TextureView itself from the real viewport and decoded video size.
 */
const VlcPlaybackSurfaceImpl = forwardRef<any, Props>(function VlcPlaybackSurface(
  {
    uri,
    paused,
    fit,
    codecMode,
    volume,
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
  const [videoSize, setVideoSize] = useState<Size>({ width: 16, height: 9 });

  const source = useMemo(() => {
    const initOptions = [
      "--network-caching=1200",
      "--file-caching=1000",
      "--http-reconnect",
      "--no-drop-late-frames",
    ];
    const base: Record<string, unknown> = { uri, initType: 2, initOptions };
    if (codecMode === "hardware") {
      base.hwDecoderEnabled = 1;
      base.hwDecoderForced = 1;
    } else if (codecMode === "software") {
      base.hwDecoderEnabled = 0;
      base.hwDecoderForced = 0;
    }
    return base as any;
  }, [codecMode, uri]);

  const frameStyle = useMemo<ViewStyle>(() => {
    if (!validSize(viewport) || !validSize(videoSize) || fit === "fill") {
      return { width: "100%", height: "100%" };
    }

    const scaleX = viewport.width / videoSize.width;
    const scaleY = viewport.height / videoSize.height;
    const scale = fit === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    return {
      width: Math.max(1, Math.round(videoSize.width * scale)),
      height: Math.max(1, Math.round(videoSize.height * scale)),
    };
  }, [fit, videoSize, viewport]);

  const forcedAspectRatio = useMemo(() => {
    if (fit !== "fill" || !validSize(viewport)) return undefined;
    return `${Math.max(1, Math.round(viewport.width))}:${Math.max(1, Math.round(viewport.height))}`;
  }, [fit, viewport]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    setViewport((current) =>
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height },
    );
  }, []);

  const handleLoad = useCallback((event: VlcLoadEvent) => {
    if (validSize(event?.videoSize)) {
      setVideoSize((current) =>
        current.width === event.videoSize!.width && current.height === event.videoSize!.height
          ? current
          : { width: event.videoSize!.width, height: event.videoSize!.height },
      );
    }
    onLoad(event);
  }, [onLoad]);

  return (
    <View style={styles.surface} pointerEvents="none" onLayout={handleLayout}>
      <VLCPlayer
        key={`${uri}:${codecMode}`}
        ref={ref}
        style={[styles.video, frameStyle]}
        source={source}
        paused={paused}
        autoplay
        autoAspectRatio={fit !== "fill"}
        videoAspectRatio={forcedAspectRatio as any}
        resizeMode="fill"
        volume={Math.round(Math.max(0, Math.min(1, volume)) * 100)}
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

/**
 * Only playback-affecting props are compared. UI chrome updates must not
 * reconcile the native VLC surface.
 */
export const VlcPlaybackSurface = memo(
  VlcPlaybackSurfaceImpl,
  (previous, next) =>
    previous.uri === next.uri &&
    previous.paused === next.paused &&
    previous.fit === next.fit &&
    previous.codecMode === next.codecMode &&
    previous.volume === next.volume &&
    previous.audioTrack === next.audioTrack &&
    previous.textTrack === next.textTrack,
);

const styles = StyleSheet.create({
  surface: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  video: {
    backgroundColor: "#000",
  },
});
