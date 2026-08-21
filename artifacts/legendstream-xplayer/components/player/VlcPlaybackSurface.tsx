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
 * Scaling isolation v2.
 *
 * Keep the native VLC surface contract identical to the stable 1.4.10 build:
 * full-screen TextureView + autoAspectRatio=true. FIT/CROP/FILL are applied only
 * as compositor transforms after VLC reports the actual video size.
 *
 * This avoids the react-native-vlc-media-player prop-order problem where
 * autoAspectRatio and videoAspectRatio can be delivered in either order. The
 * native implementation ignores setAspectRatio while autoAspectRatio is true,
 * so the previous FILL mode could intermittently do nothing and could remain
 * stuck when switching modes.
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

  const displayTransform = useMemo(() => {
    if (
      fit === "contain" ||
      !validVideoSize(videoSize) ||
      window.width <= 0 ||
      window.height <= 0
    ) {
      return null;
    }

    const viewAspect = window.width / window.height;
    const mediaAspect = videoSize!.width / videoSize!.height;
    if (
      !Number.isFinite(viewAspect) ||
      !Number.isFinite(mediaAspect) ||
      viewAspect <= 0 ||
      mediaAspect <= 0
    ) {
      return null;
    }

    if (fit === "cover") {
      const scale = viewAspect >= mediaAspect
        ? viewAspect / mediaAspect
        : mediaAspect / viewAspect;
      return { transform: [{ scale }] };
    }

    // FILL intentionally distorts only the axis that contains the letterbox.
    // Because the full-screen TextureView is clipped by its parent, the black
    // letterbox area is pushed outside the viewport while the picture stretches
    // to the exact screen bounds.
    return viewAspect >= mediaAspect
      ? { transform: [{ scaleX: viewAspect / mediaAspect }] }
      : { transform: [{ scaleY: mediaAspect / viewAspect }] };
  }, [fit, videoSize, window.height, window.width]);

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
        style={[styles.video, displayTransform]}
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
