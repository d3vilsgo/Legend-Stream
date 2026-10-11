import { computePremiumPosterGridMetrics } from "./design/layoutMetrics";
import { resolvePremiumScreenProfile } from "./design/screenProfiles";
import type { PremiumUiMode } from "./design/tokens";

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
): PosterGridLayout {
  const mode: PremiumUiMode = nativeTv
    ? "tv"
    : width > height ? "mobileLandscape" : "mobilePortrait";
  const profile = resolvePremiumScreenProfile({ mode, width, height });
  const metrics = computePremiumPosterGridMetrics(profile);
  return {
    columns: metrics.columns,
    columnWidth: metrics.posterWidth,
    contentWidth: profile.effectiveContentWidth,
    outerPadding: profile.horizontalPadding,
  };
}
