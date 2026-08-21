import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type LegendStreamPipNativeModule = {
  isSupported: () => boolean;
  isInPictureInPictureMode: () => boolean;
  enter: (width: number, height: number) => Promise<boolean>;
};

const nativeModule = requireOptionalNativeModule("LegendStreamPip") as LegendStreamPipNativeModule | null;

/**
 * Phase-2 isolation rule:
 * keep the PiP bridge independent from brightness/media-volume gesture work.
 * 1.4.7 proved the VLC baseline is stable, so re-introduce one native feature
 * family at a time. Volume functions intentionally remain JS no-ops until PiP
 * and scaling have passed device testing.
 */
export const isPipSupported = () => {
  if (Platform.OS !== "android" || !nativeModule) return false;
  try {
    return Boolean(nativeModule.isSupported?.());
  } catch {
    return false;
  }
};

export const isInPipMode = () => {
  if (Platform.OS !== "android" || !nativeModule) return false;
  try {
    return Boolean(nativeModule.isInPictureInPictureMode?.());
  } catch {
    return false;
  }
};

export const getMediaVolume = () => 1;

export async function setMediaVolume(_value: number) {
  return false;
}

export async function enterPictureInPicture(width = 16, height = 9) {
  if (Platform.OS !== "android" || !nativeModule) return false;
  try {
    return Boolean(await nativeModule.enter(Math.max(1, Math.round(width)), Math.max(1, Math.round(height))));
  } catch {
    return false;
  }
}
