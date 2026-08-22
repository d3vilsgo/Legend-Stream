import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type LegendStreamPipNativeModule = {
  isSupported: () => boolean;
  isInPictureInPictureMode: () => boolean;
  getMediaVolume: () => number;
  setMediaVolume: (value: number) => Promise<boolean>;
  setKeepScreenOn: (enabled: boolean) => Promise<boolean>;
  enter: (width: number, height: number) => Promise<boolean>;
};

let cachedModule: LegendStreamPipNativeModule | null | undefined;

const getNativeModule = () => {
  if (cachedModule !== undefined) return cachedModule;
  cachedModule = requireOptionalNativeModule("LegendStreamPip") as LegendStreamPipNativeModule | null;
  return cachedModule;
};

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

export const getMediaVolume = () => {
  if (Platform.OS !== "android") return 1;
  try {
    const value = Number(getNativeModule()?.getMediaVolume?.() ?? 1);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  } catch {
    return 1;
  }
};

export async function setMediaVolume(value: number) {
  if (Platform.OS !== "android") return false;
  try {
    const nativeModule = getNativeModule();
    if (!nativeModule?.setMediaVolume) return false;
    return Boolean(await nativeModule.setMediaVolume(Math.max(0, Math.min(1, Number(value) || 0))));
  } catch {
    return false;
  }
}

export async function setPlayerKeepScreenOn(enabled: boolean) {
  if (Platform.OS !== "android") return false;
  try {
    const nativeModule = getNativeModule();
    if (!nativeModule?.setKeepScreenOn) return false;
    return Boolean(await nativeModule.setKeepScreenOn(Boolean(enabled)));
  } catch {
    return false;
  }
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
