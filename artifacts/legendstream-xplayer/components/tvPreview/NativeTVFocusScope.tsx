import React, { useLayoutEffect, useRef, type ReactNode } from "react";
import { findNodeHandle, Platform, View } from "react-native";
import { useTVPreviewFocus } from "./TVPreviewFocus";
import { setTvFocusBlocked } from "@/modules/legendstream-tv-remote";

/** Android ViewGroup blocks every descendant, including legacy buttons, while another scope owns focus. */
export function NativeTVFocusScope({ children }: { children: ReactNode }) {
  const { nativeScope } = useTVPreviewFocus();
  const ref = useRef<View>(null);
  const blocked = Platform.isTV && nativeScope !== "content";
  useLayoutEffect(() => {
    if (!Platform.isTV) return;
    const tag = findNodeHandle(ref.current);
    if (tag != null) void setTvFocusBlocked(tag, blocked);
  }, [blocked]);
  return <View ref={ref} collapsable={false} style={{ flex: 1, minHeight: 0 }}
    pointerEvents={blocked ? "none" : "auto"}
    importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}
    accessibilityElementsHidden={blocked}>{children}</View>;
}
