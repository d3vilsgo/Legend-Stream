import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type LegendStreamPipNativeModule = {
  isSupported: () => boolean;
  isInPictureInPictureMode: () => boolean;
  enter: (width: number, height: number) => Promise<boolean>;
};

let nativeModule: LegendStreamPipNativeModule | null | undefined;

const getNativeModule = () => {
  if (nativeModule !== undefined) return nativeModule;
  try {
    nativeModule = requireOptionalNativeModule("LegendStreamPip") as LegendStreamPipNativeModule | null;
  } catch {
    nativeModule = null;
  }
  return nativeModule;
};

/**
 * Keep PiP completely out of the player-open hot path.
 *
 * The 1.4.7 baseline proved playback is stable. We therefore report platform
 * capability without resolving the custom native module. The bridge is loaded
 * for the first time only when the user actually presses PiP. This makes the
 * same APK an isolation test: player open validates scaling; PiP tap validates
 * the native bridge/lifecycle path independently.
 */
export const isPipSupported = () =>
  Platform.OS === "android" && Number(Platform.Version) >= 26;

export const isInPipMode = () => {
  if (Platform.OS !== "android" || Number(Platform.Version) < 26) return false;
  const module = getNativeModule();
  try {
    return Boolean(module?.isInPictureInPictureMode?.());
  } catch {
    return false;
  }
};

// Media-volume gestures remain intentionally isolated from the PiP bridge.
export const getMediaVolume = () => 1;

export async function setMediaVolume(_value: number) {
  return false;
}

export async function enterPictureInPicture(width = 16, height = 9) {
  if (Platform.OS !== "android" || Number(Platform.Version) < 26) return false;
  const module = getNativeModule();
  if (!module) return false;
  try {
    if (module.isSupported && !module.isSupported()) return false;
    return Boolean(await module.enter(Math.max(1, Math.round(width)), Math.max(1, Math.round(height))));
  } catch {
    return false;
  }
}
