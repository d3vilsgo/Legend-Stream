import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StatusBar, useWindowDimensions } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import { logPlayerDiagnostic } from "@/lib/playerDiagnostics";

const isLandscapeOrientation = (orientation: ScreenOrientation.Orientation) =>
  orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
  orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;

/**
 * Player system-UI/orientation lifecycle.
 *
 * The normal player path follows the device orientation. Entering the player
 * clears any stale app orientation lock, so rotating the phone/tablet reshapes
 * both video chrome and controls automatically. The rotate button remains an
 * explicit override for users who want to force the opposite orientation.
 */
export function usePlayerOrientation(_autoLandscape = true) {
  const { width, height } = useWindowDimensions();
  const mounted = useRef(true);
  const exitingRef = useRef(false);
  const [ready, setReady] = useState(true);
  const [exiting, setExiting] = useState(false);

  const landscapeLayout = width >= height;

  const hideStatusBar = useCallback(() => {
    if (exitingRef.current) return;
    try { StatusBar.setHidden(true, "none"); } catch { /* best effort */ }
  }, []);

  useEffect(() => {
    mounted.current = true;
    exitingRef.current = false;
    hideStatusBar();
    void logPlayerDiagnostic("player_fullscreen_enter", { followDeviceOrientation: true });

    const appState = AppState.addEventListener("change", (state) => {
      void logPlayerDiagnostic("player_app_state", { state });
      if (state === "active" && !exitingRef.current) hideStatusBar();
    });

    const statusGuard = setInterval(() => {
      if (AppState.currentState === "active" && !exitingRef.current) hideStatusBar();
    }, 1000);

    const prepare = async () => {
      try {
        // Release any lock left by an earlier manual rotate/player session.
        await ScreenOrientation.unlockAsync();
      } catch {
        // Current window dimensions still drive the responsive chrome.
      } finally {
        if (mounted.current) setReady(true);
      }
    };

    void prepare();
    return () => {
      mounted.current = false;
      appState.remove();
      clearInterval(statusGuard);
      try { StatusBar.setHidden(false, "fade"); } catch { /* best effort */ }
    };
  }, [hideStatusBar]);

  useEffect(() => {
    hideStatusBar();
    void logPlayerDiagnostic("player_layout", {
      orientation: landscapeLayout ? "landscape" : "portrait",
      width,
      height,
    });
  }, [height, hideStatusBar, landscapeLayout, width]);

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
    try { StatusBar.setHidden(false, "fade"); } catch { /* best effort */ }
    try {
      // Do not leave a player-specific orientation lock on the rest of the app.
      await ScreenOrientation.unlockAsync();
    } catch {
      // Best effort only.
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
