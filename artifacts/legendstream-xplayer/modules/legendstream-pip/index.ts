// Phase-2 isolation build: keep PiP completely outside the runtime until
// crash-free scaling is verified on device. These no-op exports preserve the
// player contract without resolving or autolinking a native module.

export const isPipSupported = () => false;
export const isInPipMode = () => false;
export const getMediaVolume = () => 1;

export async function setMediaVolume(_value: number) {
  return false;
}

export async function enterPictureInPicture(_width = 16, _height = 9) {
  return false;
}
