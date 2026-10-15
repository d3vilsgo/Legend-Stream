import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
export type RemoteKey = "select" | "left" | "right" | "up" | "down" | "playPause" | "stop" | "next" | "previous" | "menu";
type RemoteModule = {
  setFocusBlocked: (tag: number, blocked: boolean) => Promise<boolean>;
  configure: (active: boolean, hidden: boolean) => Promise<boolean>;
  addListener: (name: "onRemoteKey", listener: (event: { key: RemoteKey; code: number }) => void) => { remove: () => void };
};
const native = Platform.OS === "android" ? requireOptionalNativeModule<RemoteModule>("LegendStreamTvRemote") : null;
export const configureTvRemote = (active: boolean, hidden: boolean) => native?.configure(active, hidden).catch(() => false);
export const subscribeTvRemote = (listener: (event: { key: RemoteKey; code: number }) => void) => native?.addListener("onRemoteKey", listener);

export const setTvFocusBlocked = (tag: number, blocked: boolean) => native?.setFocusBlocked(tag, blocked).catch(() => false);
