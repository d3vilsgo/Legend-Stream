import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
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

const isPositiveSize = (size: Size) =>
  Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;

/**
 * Stable VLC surface with display geometry handled outside LibVLC creation.
 *
 * react-native-vlc-media-player does not implement React Native's resizeMode
 * prop on Android. Passing contain/cover/fill therefore changed the badge but
 * not the picture. We keep the verified native mount path and alter geometry
 * after mount instead:
 *   FIT  -> preserve the media's native aspect ratio;
 *   CROP -> preserve aspect ratio and scale the TextureView until it covers;
 *   FILL -> explicitly set the media aspect ratio to the viewport ratio.
 *
 * None of these operations recreate LibVLC, so switching display mode must not
 * interrupt playback or re-enter the fragile native bootstrap path.
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
  const playerRef = useRef<any>(null);
  useImperativeHandle(forwardedRef, () => playerRef.current);

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

  const nativeAspectRatio = useMemo(() => {
    if (fit === "fill" && isPositiveSize(viewport)) {
      return `${Math.round(viewport.width)}:${Math.round(viewport.height)}`;
    }
    return `${Math.max(1, Math.round(videoSize.width))}:${Math.max(1, Math.round(videoSize.height))}`;
  }, [fit, videoSize.height, videoSize.width, viewport]);

  const coverScale = useMemo(() => {
    if (fit !== "cover" || !isPositiveSize(viewport) || !isPositiveSize(videoSize)) return 1;
    const viewAspect = viewport.width / viewport.height;
    const mediaAspect = videoSize.width / videoSize.height;
    if (!Number.isFinite(viewAspect) || !Number.isFinite(mediaAspect) || viewAspect <= 0 || mediaAspect <= 0) {
      return 1;
    }
    return Math.max(mediaAspect / viewAspect, viewAspect / mediaAspect);
  }, [fit, videoSize, viewport]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player?.changeVideoAspectRatio) return;
    // Run after the native view is committed. handleLoad will trigger this
    // effect again with the real stream dimensions once VLC exposes them.
    const timer = setTimeout(() => {
      try {
        player.autoAspectRatio?.(false);
        player.changeVideoAspectRatio(nativeAspectRatio);
      } catch {
        // A display-mode change must never be allowed to take down playback.
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [nativeAspectRatio, uri, codecMode, videoSize.height, videoSize.width, viewport.height, viewport.width]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setViewport((current) =>
        Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
          ? current
          : { width, height },
      );
    }
  }, []);

  const handleLoad = useCallback((event: VlcLoadEvent) => {
    const next = event?.videoSize;
    if (next && isPositiveSize(next)) {
      setVideoSize({ width: Number(next.width), height: Number(next.height) });
    }
    onLoad(event);
  }, [onLoad]);

  return (
    <View style={styles.surface} pointerEvents="none" onLayout={handleLayout}>
      <VLCPlayer
        key={`${uri}:${codecMode}`}
        ref={playerRef}
        style={[
          styles.video,
          fit === "cover" && coverScale > 1
            ? { transform: [{ scale: coverScale }] }
            : null,
        ]}
        source={{ uri, initType: 2, initOptions }}
        paused={paused}
        autoplay
        autoAspectRatio={false}
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
    backgroundColor: "#000",
  },
});
