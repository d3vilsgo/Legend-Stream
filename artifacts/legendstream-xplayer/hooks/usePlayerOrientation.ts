import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StatusBar, useWindowDimensions } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import { logPlayerDiagnostic } from "@/lib/playerDiagnostics";
import {
  recordM3UOrientationBegin,
  recordM3UOrientationError,
  recordM3UOrientationGetCompleted,
  recordM3UOrientationReady,
  recordM3UOrientationUnlockBegin,
  recordM3UOrientationUnlockEnd,
} from "@/lib/m3uInAppDiagnostics";
import {
  orientationSnapshotFromDimensions,
  resolvePlayerOrientationRestorePlan,
  resolvePlayerOrientationRestoreTarget,
  type PlayerOrientationLockPolicy,
  type PlayerOrientationSnapshot,
  type PlayerOrientationRestoreStep,
} from "@/lib/playerOrientationRestore";

const isLandscapeOrientation = (orientation: ScreenOrientation.Orientation) =>
  orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
  orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;

const isPortraitOrientation = (orientation: ScreenOrientation.Orientation) =>
  orientation === ScreenOrientation.Orientation.PORTRAIT_UP ||
  orientation === ScreenOrientation.Orientation.PORTRAIT_DOWN;

const orientationSnapshotFromScreenOrientation = (
  orientation: ScreenOrientation.Orientation | null,
): PlayerOrientationSnapshot => {
  if (!orientation) return "unknown";
  if (isPortraitOrientation(orientation)) return "portrait";
  if (isLandscapeOrientation(orientation)) return "landscape";
  return "unknown";
};

const orientationLockPolicyFromScreenLock = (
  lock: ScreenOrientation.OrientationLock | null,
): PlayerOrientationLockPolicy => {
  if (lock === null) return "unknown";
  if (
    lock === ScreenOrientation.OrientationLock.PORTRAIT ||
    lock === ScreenOrientation.OrientationLock.PORTRAIT_UP ||
    lock === ScreenOrientation.OrientationLock.PORTRAIT_DOWN
  ) {
    return "portrait";
  }
  if (
    lock === ScreenOrientation.OrientationLock.LANDSCAPE ||
    lock === ScreenOrientation.OrientationLock.LANDSCAPE_LEFT ||
    lock === ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT
  ) {
    return "landscape";
  }
  if (
    lock === ScreenOrientation.OrientationLock.DEFAULT ||
    lock === ScreenOrientation.OrientationLock.ALL
  ) {
    return "free";
  }
  return "unknown";
};

/**
 * Fullscreen/system-UI owner for the player.
 *
 * The player now follows the device orientation instead of forcing landscape on
 * entry. useWindowDimensions() drives the responsive chrome, so rotating the
 * phone reshapes the player immediately. The rotate button remains as an
 * explicit one-shot orientation lock when the user wants to force the opposite
 * orientation.
 */
export function usePlayerOrientation(followDevice = true, diagnosticM3ULive = false) {
  const { width, height } = useWindowDimensions();
  const initialOrientation = useRef<ScreenOrientation.Orientation | null>(null);
  const initialOrientationLock = useRef<ScreenOrientation.OrientationLock | null>(null);
  const launchLayout = useRef<PlayerOrientationSnapshot>(
    orientationSnapshotFromDimensions(width, height),
  );
  const mounted = useRef(true);
  const exitingRef = useRef(false);
  const [ready, setReady] = useState(false);
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
    void logPlayerDiagnostic("player_fullscreen_enter", { followDevice });

    const appState = AppState.addEventListener("change", (state) => {
      void logPlayerDiagnostic("player_app_state", { state });
      if (state === "active" && !exitingRef.current) hideStatusBar();
    });

    const statusGuard = setInterval(() => {
      if (AppState.currentState === "active" && !exitingRef.current) hideStatusBar();
    }, 1000);

    const prepare = async () => {
      const startedAt = globalThis.performance?.now?.() ?? Date.now();
      if (diagnosticM3ULive) recordM3UOrientationBegin();
      try {
        initialOrientation.current = await ScreenOrientation.getOrientationAsync();
        initialOrientationLock.current = await ScreenOrientation.getOrientationLockAsync();
        if (diagnosticM3ULive) recordM3UOrientationGetCompleted();
        if (followDevice) {
          if (diagnosticM3ULive) recordM3UOrientationUnlockBegin();
          await ScreenOrientation.unlockAsync();
          if (diagnosticM3ULive) recordM3UOrientationUnlockEnd();
        }
      } catch (caught) {
        if (diagnosticM3ULive) recordM3UOrientationError(caught);
        // Fullscreen playback can continue even if the OEM rejects a lock change.
      } finally {
        if (mounted.current) {
          setReady(true);
          if (diagnosticM3ULive) {
            const finishedAt = globalThis.performance?.now?.() ?? Date.now();
            recordM3UOrientationReady(finishedAt - startedAt);
          }
        }
      }
    };

    void prepare();
    return () => {
      mounted.current = false;
      appState.remove();
      clearInterval(statusGuard);
      try { StatusBar.setHidden(false, "fade"); } catch { /* best effort */ }
    };
  }, [diagnosticM3ULive, followDevice, hideStatusBar]);

  useEffect(() => {
    if (ready) hideStatusBar();
  }, [height, hideStatusBar, ready, width]);

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

  const applyRestoreStep = useCallback(async (step: PlayerOrientationRestoreStep) => {
    if (step.type === "unlock") {
      await ScreenOrientation.unlockAsync();
      return;
    }
    await ScreenOrientation.lockAsync(
      step.target === "portrait"
        ? ScreenOrientation.OrientationLock.PORTRAIT_UP
        : ScreenOrientation.OrientationLock.LANDSCAPE,
    );
  }, []);

  const restore = useCallback(async () => {
    const initialOrientationSnapshot = orientationSnapshotFromScreenOrientation(initialOrientation.current);
    const target = resolvePlayerOrientationRestoreTarget({
      launchLayout: launchLayout.current,
      initialOrientation: initialOrientationSnapshot,
    });
    const restorePlan = resolvePlayerOrientationRestorePlan({
      launchLayout: launchLayout.current,
      initialOrientation: initialOrientationSnapshot,
      initialLock: orientationLockPolicyFromScreenLock(initialOrientationLock.current),
    });
    try { StatusBar.setHidden(false, "fade"); } catch { /* best effort */ }
    try {
      for (const step of restorePlan) await applyRestoreStep(step);
    } catch {
      try { await ScreenOrientation.unlockAsync(); } catch { /* best effort */ }
    }
    void logPlayerDiagnostic("player_fullscreen_restore", { target });
  }, [applyRestoreStep]);

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
