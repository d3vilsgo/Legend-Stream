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
 * Native VLC surface kept deliberately conservative during mount.
 *
 * react-native-vlc-media-player 1.0.98 intentionally iterates initOptions to
 * size()-1. We preserve that upstream behavior and append a harmless duplicate
 * tail option so all intended options are still consumed without patching the
 * native loop. Hardware/software decoder selection uses the library's native
 * hwDecoderEnabled/hwDecoderForced source fields instead of LibVLC CLI flags.
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

  const source = useMemo(() => {
    const initOptions = [
      "--network-caching=1200",
      "--file-caching=1000",
      "--http-reconnect",
      // Upstream 1.0.98 drops the final entry; duplicate the previous safe
      // option instead of relying on a patched native options loop.
      "--http-reconnect",
    ];

    const value: Record<string, unknown> = {
      uri,
      initType: 2,
      initOptions,
    };

    if (codecMode === "hardware") {
      value.hwDecoderEnabled = 1;
      value.hwDecoderForced = 1;
    } else if (codecMode === "software") {
      value.hwDecoderEnabled = 0;
      value.hwDecoderForced = 0;
    }

    return value as any;
  }, [codecMode, uri]);

  const handleLoad = useCallback((event: VlcLoadEvent) => {
    const size = event?.videoSize;
    if (size && Number(size.width) > 0 && Number(size.height) > 0) {
      const normalized = { width: Number(size.width), height: Number(size.height) };
      setVideoSize(normalized);
      onLoad({ ...event, videoSize: normalized });
      return;
    }
    onLoad({ ...event, videoSize });
  }, [onLoad, videoSize]);

  return (
    <View style={styles.surface} pointerEvents="none">
      <VLCPlayer
        key={`${uri}:${codecMode}`}
        ref={ref}
        style={styles.video}
        source={source}
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
