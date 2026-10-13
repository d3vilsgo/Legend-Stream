import { computePremiumPosterGridMetrics } from "./design/layoutMetrics";
import { resolvePremiumCatalogProfile, resolvePremiumScreenProfile, type PremiumSafeAreaInsets, type PremiumNavState } from "./design/screenProfiles";

export type PosterGridLayout = {
  columns: number;
  columnWidth: number;
  contentWidth: number;
  outerPadding: number;
};

export function computePosterGridLayout(
  width: number,
  height: number,
  nativeTv = false,
  options: { tvPreview?: boolean; safeArea?: PremiumSafeAreaInsets; navState?: PremiumNavState; density?: number } = {},
): PosterGridLayout {
  const profile = resolvePremiumCatalogProfile({ width, height, nativeTv, ...options });
  const layoutProfile = profile.deviceClass === "phone" && width > height
    ? resolvePremiumScreenProfile({ mode: "mobileLandscape", width, height, ...options })
    : profile;
  const metrics = computePremiumPosterGridMetrics(layoutProfile);
  return {
    columns: metrics.columns,
    columnWidth: metrics.posterWidth,
    contentWidth: layoutProfile.effectiveContentWidth,
    outerPadding: layoutProfile.horizontalPadding,
  };
}
