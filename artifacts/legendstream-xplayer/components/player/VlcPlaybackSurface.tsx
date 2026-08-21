import React, { forwardRef, memo, useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
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

/**
 * Crash-safe VLC bootstrap.
 *
 * Keep the initial native view configuration identical to the last verified
 * working 1.4.0 path. Advanced scaling is deliberately kept out of the native
 * mount path so an invalid aspect-ratio/TextureView transition cannot kill the
 * Android process while the Activity is rotating into landscape.
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

  const handleLoad = useCallback((event: VlcLoadEvent) => {
    const size = event?.videoSize;
    if (size && Number(size.width) > 0 && Number(size.height) > 0) {
      setVideoSize({ width: Number(size.width), height: Number(size.height) });
    }
    onLoad({ ...event, videoSize: size ?? videoSize });
  }, [onLoad, videoSize]);

  return (
    <View style={styles.surface} pointerEvents="none">
      <VLCPlayer
        key={`${uri}:${codecMode}`}
        ref={ref}
        style={styles.video}
        source={{ uri, initType: 2, initOptions }}
        paused={paused}
        autoplay
        autoAspectRatio
        resizeMode={fit}
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

/** UI-only state must never rebuild the native VLC surface. */
export const VlcPlaybackSurface = memo(
  VlcPlaybackSurfaceImpl,
  (previous, next) =>
    previous.uri === next.uri &&
    previous.paused === next.paused &&
    previous.fit === next.fit &&
    previous.codecMode === next.codecMode &&
    previous.audioTrack === next.audioTrack &&
    previous.textTrack === next.textTrack,
);

const styles = StyleSheet.create({
  surface: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  video: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
});
