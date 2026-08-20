import React from "react";
import { ScrollView, ScrollViewProps } from "react-native";

/**
 * Lightweight compatibility wrapper. Android's adjustResize plus the native
 * ScrollView is sufficient for our provider/login forms and avoids keeping a
 * Reanimated-based keyboard engine mounted for the entire IPTV application.
 */
export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  ...props
}: ScrollViewProps) {
  return (
    <ScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode="on-drag"
      {...props}
    >
      {children}
    </ScrollView>
  );
}
