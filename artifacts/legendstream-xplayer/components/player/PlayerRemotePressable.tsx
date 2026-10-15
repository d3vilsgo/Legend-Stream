import React, { useState } from "react";
import { Platform, Pressable, Text, type PressableProps } from "react-native";

/** Same action callbacks as mobile, with a physical-focus outline and visible action name. */
export function PlayerRemotePressable({ children, style, accessibilityLabel, ...props }: PressableProps) {
  const [focused, setFocused] = useState(false);
  return <Pressable {...props} accessibilityLabel={accessibilityLabel} accessibilityState={{ ...props.accessibilityState, disabled: Boolean(props.disabled) }}
    focusable={Platform.isTV ? !props.disabled && props.focusable !== false : props.focusable}
    onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
    onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
    style={(state) => [typeof style === "function" ? style(state) : style,
      Platform.isTV && { minWidth: 56, minHeight: 56, borderRadius: 10, borderWidth: 3, borderColor: focused ? "#fff" : "transparent", backgroundColor: focused ? "#075985" : "rgba(0,0,0,.35)" }]}>
      {children as React.ReactNode}
      {Platform.isTV && focused && accessibilityLabel ? <Text pointerEvents="none" style={{ position: "absolute", bottom: -28, color: "white", fontSize: 15, fontWeight: "700", backgroundColor: "#082f49", paddingHorizontal: 8, paddingVertical: 3 }}>{accessibilityLabel}</Text> : null}
  </Pressable>;
}
