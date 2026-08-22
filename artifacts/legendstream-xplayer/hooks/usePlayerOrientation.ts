import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StatusBar, useWindowDimensions } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import { logPlayerDiagnostic } from "@/lib/playerDiagnostics";

const isLandscapeOrientation = (orientation: ScreenOrientation.Orientation) =>
  orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
  orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;

const isPortraitOrientation = (orientation: ScreenOrientation.Orientation) =>
  orientation === ScreenOrientation.Orientation.PORTRAIT_UP ||
  orientation === ScreenOrientation.Orientation.PORTRAIT_DOWN;

/**
 * Owns player orientation and fullscreen-system-UI lifecycle.
 *
 * Some Android/HyperOS builds can make the status bar visible again after a
 * transient system-UI interaction. While the player is active we re-assert the
 * hidden state at a low frequency. VLC surface, scaling and PiP are untouched.
 */
export function usePlayerOrientation(autoLandscape = true) {
  const { width, height } = useWindowDimensions();
  const initialOrientation = useRef<ScreenOrientation.Orientation | null>(null);
  const mounted = useRef(true);
  const exitingRef = useRef(false);
  const [ready, setReady] = useState(!autoLandscape);
  const [exiting, setExiting] = useState(false);

  const landscapeLayout = width >= height;

  const hideStatusBar = useCallback(() => {
    if (exitingRef.current) return;
    try { StatusBar.setHidden(true, "none"); } catch { /* best effort */ }
  }, []);

  useEffect(() => {
    mounted.current = true;
    exitingRef.current = false;
    let fallback: ReturnType<typeof setTimeout> | null = null;

    hideStatusBar();
    void logPlayerDiagnostic("player_fullscreen_enter", { autoLandscape });

    const appState = AppState.addEventListener("change", (state) => {
      void logPlayerDiagnostic("player_app_state", { state });
      if (state === "active" && !exitingRef.current) hideStatusBar();
    });

    const statusGuard = setInterval(() => {
      if (AppState.currentState === "active" && !exitingRef.current) hideStatusBar();
    }, 1000);

    const prepare = async () => {
      try {
        initialOrientation.current = await ScreenOrientation.getOrientationAsync();
        if (autoLandscape) {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
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
      clearInterval(statusGuard);
      if (fallback) clearTimeout(fallback);
      try { StatusBar.setHidden(false, "fade"); } catch { /* best effort */ }
    };
  }, [autoLandscape, hideStatusBar]);

  useEffect(() => {
    if (autoLandscape && landscapeLayout) {
      setReady(true);
      hideStatusBar();
    }
  }, [autoLandscape, hideStatusBar, landscapeLayout]);

  const rotate = useCallback(async () => {
    try {
      const orientation = await ScreenOrientation.getOrientationAsync();
      const landscape = isLandscapeOrientation(orientation);
      void logPlayerDiagnostic("player_rotate", { fromLandscape: landscape });
      await ScreenOrientation.lockAsync(
        landscape
          ? ScreenOrientation.OrientationLock.PORTRAIT_UP
          : ScreenOrientation.OrientationLock.LANDSCAPE,
      );
      hideStatusBar();
      setTimeout(hideStatusBar, 250);
    } catch {
      void logPlayerDiagnostic("player_rotate_failed");
    }
  }, [hideStatusBar]);

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
    void logPlayerDiagnostic("player_fullscreen_restore");
  }, []);

  const beginExit = useCallback(() => {
    exitingRef.current = true;
    setExiting(true);
    try { StatusBar.setHidden(false, "fade"); } catch { /* best effort */ }
    void logPlayerDiagnostic("player_exit_requested");
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
