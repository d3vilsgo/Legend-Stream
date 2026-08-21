import React, { forwardRef, memo, useCallback, useMemo, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
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

const validVideoSize = (value?: PlayerVideoSize) =>
  Boolean(
    value &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0,
  );

/**
 * Phase-2 scaling isolation build.
 *
 * The verified 1.4.10 baseline must stay untouched on player open. Therefore:
 * - CONTAIN is byte-for-byte equivalent at the native VLC level: full-screen
 *   TextureView + autoAspectRatio=true.
 * - COVER never changes the TextureView layout. It only applies a compositor
 *   transform after VLC has reported the actual video size.
 * - FILL uses the library's documented native React props
 *   autoAspectRatio/videoAspectRatio. No imperative native calls are made.
 *
 * We deliberately do not resize/reposition the native TextureView and do not
 * call changeVideoAspectRatio() from an effect. Those were the two experimental
 * paths associated with the previous player-open crashes.
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
  const window = useWindowDimensions();
  const [videoSize, setVideoSize] = useState<PlayerVideoSize | undefined>(undefined);

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

  const coverScale = useMemo(() => {
    if (fit !== "cover" || !validVideoSize(videoSize) || window.width <= 0 || window.height <= 0) {
      return 1;
    }
    const viewAspect = window.width / window.height;
    const mediaAspect = videoSize!.width / videoSize!.height;
    if (!Number.isFinite(viewAspect) || !Number.isFinite(mediaAspect) || viewAspect <= 0 || mediaAspect <= 0) {
      return 1;
    }
    return Math.max(mediaAspect / viewAspect, viewAspect / mediaAspect);
  }, [fit, videoSize, window.height, window.width]);

  const fillAspectRatio = useMemo(() => {
    if (window.width <= 0 || window.height <= 0) return undefined;
    return `${Math.max(1, Math.round(window.width))}:${Math.max(1, Math.round(window.height))}`;
  }, [window.height, window.width]);

  const handleLoad = useCallback((event: VlcLoadEvent) => {
    if (validVideoSize(event?.videoSize)) {
      setVideoSize({
        width: Number(event.videoSize!.width),
        height: Number(event.videoSize!.height),
      });
    }
    onLoad(event);
  }, [onLoad]);

  return (
    <View style={styles.surface} pointerEvents="none">
      <VLCPlayer
        key={`${uri}:${codecMode}`}
        ref={ref}
        style={[
          styles.video,
          fit === "cover" && coverScale > 1
            ? { transform: [{ scale: coverScale }] }
            : null,
        ]}
        source={{ uri, initType: 2, initOptions }}
        paused={paused}
        autoplay
        autoAspectRatio={fit !== "fill"}
        videoAspectRatio={fit === "fill" ? fillAspectRatio : undefined}
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
