import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";

const isLandscapeOrientation = (orientation: ScreenOrientation.Orientation) =>
  orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
  orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;

const isPortraitOrientation = (orientation: ScreenOrientation.Orientation) =>
  orientation === ScreenOrientation.Orientation.PORTRAIT_UP ||
  orientation === ScreenOrientation.Orientation.PORTRAIT_DOWN;

/**
 * Owns the player orientation lifecycle.
 *
 * The video surface is intentionally held behind a black gate until the first
 * landscape layout arrives. This prevents a landscape video from being created
 * inside the previous portrait layout and then visibly stretching while Android
 * rotates the Activity.
 */
export function usePlayerOrientation(autoLandscape = true) {
  const { width, height } = useWindowDimensions();
  const initialOrientation = useRef<ScreenOrientation.Orientation | null>(null);
  const mounted = useRef(true);
  const [ready, setReady] = useState(!autoLandscape);
  const [exiting, setExiting] = useState(false);

  const landscapeLayout = width >= height;

  useEffect(() => {
    mounted.current = true;
    let fallback: ReturnType<typeof setTimeout> | null = null;

    const prepare = async () => {
      try {
        initialOrientation.current = await ScreenOrientation.getOrientationAsync();
        if (autoLandscape) {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
          fallback = setTimeout(() => {
            if (mounted.current) setReady(true);
          }, 900);
        } else if (mounted.current) {
          setReady(true);
        }
      } catch {
        if (mounted.current) setReady(true);
      }
    };

    void prepare();
    return () => {
      mounted.current = false;
      if (fallback) clearTimeout(fallback);
    };
  }, [autoLandscape]);

  useEffect(() => {
    if (autoLandscape && landscapeLayout) setReady(true);
  }, [autoLandscape, landscapeLayout]);

  const rotate = useCallback(async () => {
    try {
      const orientation = await ScreenOrientation.getOrientationAsync();
      const landscape = isLandscapeOrientation(orientation);
      await ScreenOrientation.lockAsync(
        landscape
          ? ScreenOrientation.OrientationLock.PORTRAIT_UP
          : ScreenOrientation.OrientationLock.LANDSCAPE,
      );
    } catch {
      // Orientation is best-effort on devices/ROMs that restrict Activity locks.
    }
  }, []);

  const restore = useCallback(async () => {
    const original = initialOrientation.current;
    try {
      if (original && isPortraitOrientation(original)) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } else if (original && isLandscapeOrientation(original)) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      } else {
        await ScreenOrientation.unlockAsync();
      }
    } catch {
      try { await ScreenOrientation.unlockAsync(); } catch { /* best effort */ }
    }
  }, []);

  return {
    ready,
    exiting,
    landscapeLayout,
    rotate,
    beginExit: () => setExiting(true),
    restore,
  };
}
