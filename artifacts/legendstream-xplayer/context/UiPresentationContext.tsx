import React, { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { Platform, useWindowDimensions } from "react-native";
import {
  resolveUiPresentation,
  type UiModePreference,
  type UiPresentation,
} from "@/lib/uiPresentation";
import { releasePendingPlayerOrientationPolicyRestoreForLayout } from "@/lib/playerOrientationRestore";

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
    () => resolveUiPresentation({
      preference,
      nativeTv: Platform.isTV,
      width,
      height,
    }),
    [preference, width, height],
  );

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
  if (!value) throw new Error("useUiPresentation must be used within UiPresentationProvider");
  return value;
}
