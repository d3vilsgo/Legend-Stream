import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StatusBar, useWindowDimensions } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";

const isLandscapeOrientation = (orientation: ScreenOrientation.Orientation) =>
  orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
  orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;

const isPortraitOrientation = (orientation: ScreenOrientation.Orientation) =>
  orientation === ScreenOrientation.Orientation.PORTRAIT_UP ||
  orientation === ScreenOrientation.Orientation.PORTRAIT_DOWN;

/**
 * Owns the player orientation and fullscreen-system-UI lifecycle.
 *
 * The video surface is intentionally held behind a black gate until the first
 * landscape layout arrives. Android's status bar is hidden for the whole player
 * session and restored as soon as the user leaves the player.
 */
export function usePlayerOrientation(autoLandscape = true) {
  const { width, height } = useWindowDimensions();
  const initialOrientation = useRef<ScreenOrientation.Orientation | null>(null);
  const mounted = useRef(true);
  const exitingRef = useRef(false);
  const [ready, setReady] = useState(!autoLandscape);
  const [exiting, setExiting] = useState(false);

  const landscapeLayout = width >= height;

  useEffect(() => {
    mounted.current = true;
    exitingRef.current = false;
    let fallback: ReturnType<typeof setTimeout> | null = null;

    const hideStatusBar = () => {
      try { StatusBar.setHidden(true, "fade"); } catch { /* best effort */ }
    };

    hideStatusBar();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active" && !exitingRef.current) hideStatusBar();
    });

    const prepare = async () => {
      try {
        initialOrientation.current = await ScreenOrientation.getOrientationAsync();
        if (autoLandscape) {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
          // A few older Android 7/8 devices report the new window size late.
          // Keep the black gate long enough to avoid ever constructing VLC in
          // the stale portrait dimensions, but do not leave the user stuck if a
          // vendor ROM delays/blocks the dimension event entirely.
          fallback = setTimeout(() => {
            if (mounted.current) setReady(true);
          }, 1800);
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
      appState.remove();
      if (fallback) clearTimeout(fallback);
      try { StatusBar.setHidden(false, "fade"); } catch { /* best effort */ }
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
      StatusBar.setHidden(true, "fade");
    } catch {
      // Orientation is best-effort on devices/ROMs that restrict Activity locks.
    }
  }, []);

  const restore = useCallback(async () => {
    const original = initialOrientation.current;
    try { StatusBar.setHidden(false, "fade"); } catch { /* best effort */ }
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

  const beginExit = useCallback(() => {
    exitingRef.current = true;
    setExiting(true);
    try { StatusBar.setHidden(false, "fade"); } catch { /* best effort */ }
  }, []);

  return {
    ready,
    exiting,
    landscapeLayout,
    rotate,
    beginExit,
    restore,
  };
}
