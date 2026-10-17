import { nativeTvRegion } from "@/lib/nativeTvRegion";
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { findNodeHandle, Platform, type View } from "react-native";
import { registerTvTarget, unregisterTvTarget, subscribeNativeTvFocus } from "@/modules/legendstream-tv-remote";
/** Native registration describes identity; layout never requests physical focus. */
export function useNativeTvTarget(ref: RefObject<View | null>, id: string, scope="content", region="content", disabled=false, preferred=false) {
 const [focused,setFocused]=useState(false);
 const current=useRef<{tag:number;identity:string}|null>(null);
 const disabledRef=useRef(disabled);disabledRef.current=disabled;
 const register=useCallback(()=>{
  if(!Platform.isTV)return;
  const tag=findNodeHandle(ref.current);if(tag==null)return;
  const identity=JSON.stringify([id,scope,region,disabled,preferred]);
  if(current.current?.tag===tag&&current.current.identity===identity)return;
  if(current.current && (disabled || current.current.tag!==tag))void unregisterTvTarget(current.current.tag);
  current.current={tag,identity};
  if(disabled){setFocused(false);return;}
  void registerTvTarget(tag,id,scope,scope==="content"?nativeTvRegion(id,region):"player",preferred);
 },[disabled,id,preferred,ref,region,scope]);
 useLayoutEffect(()=>{register();},[register]);
 useLayoutEffect(()=>{
  if(!Platform.isTV)return;
  const sub=subscribeNativeTvFocus(e=>setFocused(e.tag===current.current?.tag&&!disabledRef.current));
  return ()=>{sub?.remove();if(current.current)void unregisterTvTarget(current.current.tag);current.current=null;};
 },[]);
 return {focused,register};
}
