import React, {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { AppState, Platform, useWindowDimensions } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
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

const UiPresentationContext = createContext<UiPresentation | null>(null);

export function UiPresentationProvider({
  children,
  preference = "auto",
}: {
  children: ReactNode;
  preference?: UiModePreference;
}) {
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
      }),
    [height, width],
  );
  const catalogOrientationPolicy: CatalogOrientationPolicy =
    devicePresentation.deviceClass === "phone"
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
    <UiPresentationContext.Provider value={presentation}>
      {children}
    </UiPresentationContext.Provider>
  );
}

export function useUiPresentation() {
  const value = useContext(UiPresentationContext);
  if (!value)
    throw new Error(
      "useUiPresentation must be used within UiPresentationProvider",
    );
  return value;
}
