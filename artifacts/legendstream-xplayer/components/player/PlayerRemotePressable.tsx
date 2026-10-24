import {useOptionalTVPreviewFocus} from "@/components/tvPreview/TVPreviewFocus";
import { inspectorAction } from "@/lib/tvRemoteInspector";
import { useNativeTvTarget } from "@/hooks/useNativeTvTarget";
import React, { createContext, useContext, useLayoutEffect, useState, useRef, useId } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions, type PressableProps } from "react-native";

const PlayerFocusContext=createContext("player");
export function PlayerRemoteFocusBoundary({scope,children}:{scope:string;children:React.ReactNode}) {
 const pushScope=useOptionalTVPreviewFocus()?.pushFocusScope;
 useLayoutEffect(()=>{if(Platform.isTV)return pushScope?.(scope);},[pushScope,scope]);
 return <PlayerFocusContext.Provider value={scope}>{children}</PlayerFocusContext.Provider>;
}
/** Same action callbacks as mobile, with a physical-focus outline and visible action name. */
export function PlayerRemotePressable({ children, style, accessibilityLabel, showFocusLabel = true, compactFocus = false, ...props }: PressableProps & { showFocusLabel?: boolean; compactFocus?: boolean }) {
  const { fontScale } = useWindowDimensions();
  const scope=useContext(PlayerFocusContext);
  const activeScope=useOptionalTVPreviewFocus()?.nativeScope;
  const [paperFocused, setFocused] = useState(false);
  const ref=useRef<View>(null);
  const generatedId=useId();
  const id=props.nativeID ?? props.testID ?? `player:${accessibilityLabel ?? "action"}:${generatedId}`;
  const nativeFocus=useNativeTvTarget(ref,id,scope,"player",Boolean(props.disabled || props.focusable===false),Boolean(props.hasTVPreferredFocus));
  const focused=Platform.isTV ? nativeFocus.focused : paperFocused;
  return <Pressable {...props} ref={ref} hasTVPreferredFocus={Platform.isTV ? false : props.hasTVPreferredFocus} onPress={props.onPress ? (event)=>{props.onPress?.(event);if(Platform.isTV)inspectorAction("onPress");} : undefined} nativeID={id} onLayout={(event) => {nativeFocus.register();props.onLayout?.(event);}} accessibilityLabel={accessibilityLabel} accessibilityState={{ ...props.accessibilityState, disabled: Boolean(props.disabled) }}
    focusable={Platform.isTV ? !props.disabled && props.focusable !== false && (!activeScope || activeScope===scope) : props.focusable}
    onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
    onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
    style={(state) => [typeof style === "function" ? style(state) : style,
      Platform.isTV && { minWidth: compactFocus ? 44 : 56, minHeight: compactFocus ? 44 : 56, borderRadius: compactFocus ? 5 : 10, borderWidth: compactFocus ? 2 : 3, borderColor: focused ? (compactFocus ? "#2dd4bf" : "#fff") : "transparent", backgroundColor: focused ? (compactFocus ? "rgba(45,212,191,.16)" : "#075985") : "rgba(0,0,0,.35)" }]}>
      {children as React.ReactNode}
      {Platform.isTV && showFocusLabel && focused && accessibilityLabel ? <Text numberOfLines={2} pointerEvents="none" style={{ maxWidth: 230, flexShrink: 1, color: "white", fontSize: 15, fontWeight: "700", backgroundColor: "#082f49", paddingHorizontal: 8, paddingVertical: 3 }}>{accessibilityLabel}</Text> : null}
  </Pressable>;
}
