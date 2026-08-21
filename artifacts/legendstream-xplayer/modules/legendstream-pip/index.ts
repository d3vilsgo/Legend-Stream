import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type LegendStreamPipNativeModule = {
  isSupported: () => boolean;
  isInPictureInPictureMode: () => boolean;
  getMediaVolume: () => number;
  setMediaVolume: (value: number) => Promise<boolean>;
  enter: (width: number, height: number) => Promise<boolean>;
};

let cachedModule: LegendStreamPipNativeModule | null | undefined;

const getNativeModule = () => {
  if (cachedModule !== undefined) return cachedModule;
  cachedModule = requireOptionalNativeModule("LegendStreamPip") as LegendStreamPipNativeModule | null;
  return cachedModule;
};

/**
 * PiP isolation build:
 * - Do not resolve the native module while the player is opening.
 * - Android API level alone controls whether the PiP button is shown.
 * - Resolve the native bridge only when PiP is actually used.
 *
 * Volume bridging stays dormant in this build so PiP is the only native feature
 * being reintroduced on top of the stable scaling baseline.
 */
export const isPipSupported = () =>
  Platform.OS === "android" && Number(Platform.Version) >= 26;

export const isInPipMode = () => {
  if (Platform.OS !== "android" || Number(Platform.Version) < 26) return false;
  try {
    return Boolean(getNativeModule()?.isInPictureInPictureMode?.());
  } catch {
    return false;
  }
};

export const getMediaVolume = () => 1;

export async function setMediaVolume(_value: number) {
  return false;
}

export async function enterPictureInPicture(width = 16, height = 9) {
  if (Platform.OS !== "android" || Number(Platform.Version) < 26) return false;
  try {
    const nativeModule = getNativeModule();
    if (!nativeModule?.isSupported?.()) return false;
    return Boolean(
      await nativeModule.enter(
        Math.max(1, Math.round(width)),
        Math.max(1, Math.round(height)),
      ),
    );
  } catch {
    return false;
  }
}
