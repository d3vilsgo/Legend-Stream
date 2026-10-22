/**
 * Device classification is intentionally separate from TV preview selection and
 * the player's temporary orientation lock. Dimensions are React Native dp.
 */
export type DevicePresentationClass = "phone" | "tablet" | "tv";
export type CatalogPresentationMode = "phonePortrait" | "tabletPortrait" | "tabletLandscape" | "tv";
export type DevicePresentationInput = {
  width: number;
  height: number;
  nativeTv: boolean;
  tvPreview?: boolean;
};

const TABLET_MIN_SHORT_EDGE_DP = 600;

export function resolveDevicePresentation(input: DevicePresentationInput): {
  deviceClass: DevicePresentationClass;
  catalogMode: CatalogPresentationMode;
  tvLayout: boolean;
  preview: boolean;
  catalogOrientation: "portrait" | "free" | "landscape";
} {
  if (input.nativeTv) {
    return { deviceClass: "tv", catalogMode: "tv", tvLayout: true, preview: false, catalogOrientation: "landscape" };
  }
  const width = Number.isFinite(input.width) && input.width > 0 ? input.width : 0;
  const height = Number.isFinite(input.height) && input.height > 0 ? input.height : 0;
  const shortEdge = Math.min(width, height);
  const deviceClass: "phone" | "tablet" = shortEdge >= TABLET_MIN_SHORT_EDGE_DP ? "tablet" : "phone";
  if (input.tvPreview) {
    return { deviceClass, catalogMode: "tv", tvLayout: true, preview: true, catalogOrientation: "landscape" };
  }
  if (deviceClass === "phone") {
    return { deviceClass, catalogMode: "phonePortrait", tvLayout: false, preview: false, catalogOrientation: "portrait" };
  }
  return {
    deviceClass,
    catalogMode: width >= height ? "tabletLandscape" : "tabletPortrait",
    tvLayout: false,
    preview: false,
    catalogOrientation: "free",
  };
}
