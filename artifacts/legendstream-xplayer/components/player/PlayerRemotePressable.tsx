import { inspectorAction } from "@/lib/tvRemoteInspector";
import { useNativeTvTarget } from "@/hooks/useNativeTvTarget";
import React, { useState, useRef, useId } from "react";
import { Platform, Pressable, Text, View, type PressableProps } from "react-native";

/** Same action callbacks as mobile, with a physical-focus outline and visible action name. */
export function PlayerRemotePressable({ children, style, accessibilityLabel, ...props }: PressableProps) {
  const [paperFocused, setFocused] = useState(false);
  const ref=useRef<View>(null);
  const generatedId=useId();
  const id=props.nativeID ?? props.testID ?? `player:${accessibilityLabel ?? "action"}:${generatedId}`;
  const nativeFocus=useNativeTvTarget(ref,id,"player","player",Boolean(props.disabled || props.focusable===false),Boolean(props.hasTVPreferredFocus));
  const focused=Platform.isTV ? nativeFocus.focused : paperFocused;
  return <Pressable {...props} ref={ref} onPress={props.onPress ? (event)=>{props.onPress?.(event);if(Platform.isTV)inspectorAction("onPress");} : undefined} nativeID={id} onLayout={(event) => {nativeFocus.register();props.onLayout?.(event);}} accessibilityLabel={accessibilityLabel} accessibilityState={{ ...props.accessibilityState, disabled: Boolean(props.disabled) }}
    focusable={Platform.isTV ? !props.disabled && props.focusable !== false : props.focusable}
    onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
    onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
    style={(state) => [typeof style === "function" ? style(state) : style,
      Platform.isTV && { minWidth: 56, minHeight: 56, borderRadius: 10, borderWidth: 3, borderColor: focused ? "#fff" : "transparent", backgroundColor: focused ? "#075985" : "rgba(0,0,0,.35)" }]}>
      {children as React.ReactNode}
      {Platform.isTV && focused && accessibilityLabel ? <Text pointerEvents="none" style={{ position: "absolute", bottom: -28, color: "white", fontSize: 15, fontWeight: "700", backgroundColor: "#082f49", paddingHorizontal: 8, paddingVertical: 3 }}>{accessibilityLabel}</Text> : null}
  </Pressable>;
}
