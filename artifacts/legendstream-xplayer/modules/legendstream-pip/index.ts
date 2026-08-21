import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type LegendStreamPipNativeModule = {
  isSupported: () => boolean;
  isInPictureInPictureMode: () => boolean;
  getMediaVolume: () => number;
  setMediaVolume: (value: number) => Promise<boolean>;
  enter: (width: number, height: number) => Promise<boolean>;
};

const nativeModule = requireOptionalNativeModule("LegendStreamPip") as LegendStreamPipNativeModule | null;

export const isPipSupported = () =>
  Platform.OS === "android" && Boolean(nativeModule?.isSupported?.());

export const isInPipMode = () =>
  Platform.OS === "android" && Boolean(nativeModule?.isInPictureInPictureMode?.());

export const getMediaVolume = () => {
  if (Platform.OS !== "android" || !nativeModule) return 1;
  try {
    return Math.max(0, Math.min(1, Number(nativeModule.getMediaVolume?.() ?? 1)));
  } catch {
    return 1;
  }
};

export async function setMediaVolume(value: number) {
  if (Platform.OS !== "android" || !nativeModule) return false;
  try {
    return Boolean(await nativeModule.setMediaVolume(Math.max(0, Math.min(1, value))));
  } catch {
    return false;
  }
}

export async function enterPictureInPicture(width = 16, height = 9) {
  if (Platform.OS !== "android" || !nativeModule) return false;
  try {
    return Boolean(await nativeModule.enter(Math.max(1, Math.round(width)), Math.max(1, Math.round(height))));
  } catch {
    return false;
  }
}
