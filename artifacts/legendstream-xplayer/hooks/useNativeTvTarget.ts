import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { findNodeHandle, Platform, type View } from "react-native";
import { registerTvTarget, unregisterTvTarget, subscribeNativeTvFocus } from "@/modules/legendstream-tv-remote";

/** Does not rely on RN Paper onFocus/onBlur, which discard surfaceId=-1 events. */
export function useNativeTvTarget(ref: RefObject<View | null>, id: string, scope="content", region="content", disabled=false, preferred=false) {
  const [focused,setFocused]=useState(false);
  const tagRef=useRef<number | null>(null);
  const register=useCallback(() => {
    if(!Platform.isTV) return;
    const tag=findNodeHandle(ref.current);
    if(tag==null) return;
    tagRef.current=tag;
    if(disabled) {void unregisterTvTarget(tag);setFocused(false);return;}
    void registerTvTarget(tag,id,scope,scope==="content" ? region : "player",preferred);
  },[disabled,id,preferred,ref,region,scope]);
  useLayoutEffect(() => {
    if(!Platform.isTV) return;
    const subscription=subscribeNativeTvFocus((event) => setFocused(event.tag===tagRef.current && !disabled));
    register();
    return () => {subscription?.remove(); if(tagRef.current!=null) void unregisterTvTarget(tagRef.current);};
  },[disabled,register]);
  return {focused,register};
}
