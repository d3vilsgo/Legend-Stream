import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

type LegendStreamPipNativeModule = {
  isSupported: () => boolean;
  isInPictureInPictureMode: () => boolean;
  enter: (width: number, height: number) => Promise<boolean>;
};

const nativeModule = requireOptionalNativeModule<LegendStreamPipNativeModule>("LegendStreamPip");

export const isPipSupported = () =>
  Platform.OS === "android" && Boolean(nativeModule?.isSupported?.());

export const isInPipMode = () =>
  Platform.OS === "android" && Boolean(nativeModule?.isInPictureInPictureMode?.());

export async function enterPictureInPicture(width = 16, height = 9) {
  if (Platform.OS !== "android" || !nativeModule) return false;
  try {
    return Boolean(await nativeModule.enter(Math.max(1, Math.round(width)), Math.max(1, Math.round(height))));
  } catch {
    return false;
  }
}
