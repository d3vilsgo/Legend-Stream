import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
export type RemoteKey = "back" | "select" | "left" | "right" | "up" | "down" | "playPause" | "stop" | "next" | "previous" | "menu";
type RemoteModule = {
  setFocusBlocked: (tag: number, blocked: boolean) => Promise<boolean>;
  configure: (active: boolean, hidden: boolean) => Promise<boolean>;
  addListener: (name: "onRemoteKey", listener: (event: { key: RemoteKey; code: number }) => void) => { remove: () => void };
};
const native = Platform.OS === "android" ? requireOptionalNativeModule<RemoteModule>("LegendStreamTvRemote") : null;
export const configureTvRemote = (active: boolean, hidden: boolean) => native?.configure(active, hidden).catch(() => false);
export const subscribeTvRemote = (listener: (event: { key: RemoteKey; code: number }) => void) => native?.addListener("onRemoteKey", listener);

export const setTvFocusBlocked = (tag: number, blocked: boolean) => native?.setFocusBlocked(tag, blocked).catch(() => false);

export type NativeFocusEvent = { tag: number; id: string };
type FocusModule = {
  registerTarget: (tag: number, id: string, scope: string, region: string, preferred: boolean) => Promise<boolean>;
  unregisterTarget: (tag: number) => Promise<boolean>;
  requestTargetFocus: (tag: number) => Promise<boolean>;
  setScope: (scope: string) => Promise<boolean>;
  addListener: (name: "onNativeFocus", listener: (event: NativeFocusEvent) => void) => { remove: () => void };
};
const focusNative = native as (RemoteModule & FocusModule) | null;
export const registerTvTarget = (tag: number, id: string, scope: string, region: string, preferred: boolean) => focusNative?.registerTarget(tag,id,scope,region,preferred).catch(() => false);
export const unregisterTvTarget = (tag: number) => focusNative?.unregisterTarget(tag).catch(() => false);
export const requestTvTargetFocus = (tag: number) => focusNative?.requestTargetFocus(tag).catch(() => false);
export const setNativeTvScope = (scope: string) => focusNative?.setScope(scope).catch(() => false);
export const subscribeNativeTvFocus = (listener: (event: NativeFocusEvent) => void) => focusNative?.addListener("onNativeFocus",listener);

export type InspectorNativeEvent = {delivery?:string;timeMs?:number;inputAgeMs?:number;beforeFocus?:string;cause?:string;withoutInput?:boolean;kind: string; sequence: number; key: string; phase: string; handled: boolean; focus: string; scope: string; context: string};
const inspectorNative = native as unknown as {setInspector:(enabled:boolean)=>Promise<boolean>;addListener:(name:"onInspector",listener:(event:InspectorNativeEvent)=>void)=>{remove:()=>void}} | null;
export const setNativeInspector = (enabled:boolean) => inspectorNative?.setInspector(enabled).catch(()=>false);
export const subscribeNativeInspector = (listener:(event:InspectorNativeEvent)=>void) => inspectorNative?.addListener("onInspector",listener);
