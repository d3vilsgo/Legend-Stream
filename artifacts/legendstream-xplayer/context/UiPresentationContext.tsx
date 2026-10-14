import React, {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform, useWindowDimensions } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  resolveUiPresentation,
  type UiModePreference,
  type UiPresentation,
} from "@/lib/uiPresentation";
import { releasePendingPlayerOrientationPolicyRestoreForLayout } from "@/lib/playerOrientationRestore";
import { resolveDevicePresentation } from "@/lib/devicePresentation";
import {
  registerCatalogOrientationPolicy,
  reassertCatalogOrientationPolicy,
  type CatalogOrientationPolicy,
} from "@/lib/orientationOwnership";

type UiPresentationContextValue = UiPresentation & {
  setTvPreview: (enabled: boolean) => void;
};
const UiPresentationContext = createContext<UiPresentationContextValue | null>(null);
const TV_PREVIEW_PREFERENCE_KEY = "legendstream.ui.tvPreview.v1";

export function UiPresentationProvider({
  children,
  preference: initialPreference = "auto",
}: {
  children: ReactNode;
  preference?: UiModePreference;
}) {
  const [preference, setPreferenceState] = useState<UiModePreference>(initialPreference);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const pendingPreference = useRef<UiModePreference | null>(null);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(TV_PREVIEW_PREFERENCE_KEY).then((stored) => {
      if (!active) return;
      const saved = stored === "tv" || stored === "auto" ? stored : initialPreference;
      setPreferenceState(pendingPreference.current ?? saved);
      setPreferenceLoaded(true);
    }).catch(() => setPreferenceLoaded(true));
    return () => { active = false; };
  }, [initialPreference]);
  const setTvPreview = (enabled: boolean) => {
    const next: UiModePreference = enabled ? "tv" : "auto";
    pendingPreference.current = next;
    setPreferenceState(next);
  };
  useEffect(() => {
    if (preferenceLoaded) void AsyncStorage.setItem(TV_PREVIEW_PREFERENCE_KEY, preference).catch(() => undefined);
  }, [preference, preferenceLoaded]);
  const { width, height } = useWindowDimensions();
  const presentation = useMemo(
    () =>
      resolveUiPresentation({
        preference,
        nativeTv: Platform.isTV,
        width,
        height,
      }),
    [preference, width, height],
  );
  const devicePresentation = useMemo(
    () =>
      resolveDevicePresentation({
        nativeTv: Platform.isTV,
        width,
        height,
        tvPreview: preference === "tv",
      }),
    [height, preference, width],
  );
  const catalogOrientationPolicy: CatalogOrientationPolicy =
    devicePresentation.preview
      ? "landscape"
      : devicePresentation.deviceClass === "phone"
      ? "portrait"
      : devicePresentation.deviceClass === "tablet"
        ? "free"
        : "preserve";

  useEffect(
    () =>
      registerCatalogOrientationPolicy(catalogOrientationPolicy, {
        lockPortrait: () =>
          ScreenOrientation.lockAsync(
            ScreenOrientation.OrientationLock.PORTRAIT_UP,
          ),
        lockLandscape: () => ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE),
        unlock: () => ScreenOrientation.unlockAsync(),
      }),
    [catalogOrientationPolicy],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void reassertCatalogOrientationPolicy();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    releasePendingPlayerOrientationPolicyRestoreForLayout({ width, height });
  }, [height, width]);

  return (
    <UiPresentationContext.Provider value={{ ...presentation, setTvPreview }}>
      {children}
    </UiPresentationContext.Provider>
  );
}

export function useUiPresentation(): UiPresentationContextValue {
  const value = useContext(UiPresentationContext);
  if (!value)
    throw new Error(
      "useUiPresentation must be used within UiPresentationProvider",
    );
  return value;
}
