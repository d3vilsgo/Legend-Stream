import { computePremiumHomeHeroMetrics } from "./design/layoutMetrics";
import {
  resolvePremiumCatalogProfile,
  resolvePremiumScreenProfile,
  type PremiumSafeAreaInsets,
} from "./design/screenProfiles";

/** Handheld and Preview geometry; native TV keeps its separately tested budget. */
export function responsiveHomeHeroLayout(input: {
  width: number;
  height: number;
  fontScale?: number;
  tvPreview?: boolean;
  safeArea?: PremiumSafeAreaInsets;
  viewportHeight?: number;
  containerWidth?: number;
}) {
  const profile = resolvePremiumCatalogProfile({ ...input, nativeTv: false });
  const compact = input.width > input.height || Boolean(input.tvPreview);
  const layoutProfile =
    profile.deviceClass === "phone" && compact && !input.tvPreview
      ? resolvePremiumScreenProfile({ ...input, mode: "mobileLandscape" })
      : profile;
  const metrics = computePremiumHomeHeroMetrics(layoutProfile);
  const width = Math.max(
    1,
    Math.min(
      1464,
      input.containerWidth ??
        Math.max(
          1,
          profile.width - 36 - profile.safeArea.left - profile.safeArea.right,
        ),
    ),
  );
  const viewport = Math.max(
    1,
    input.viewportHeight ?? layoutProfile.effectiveContentHeight,
  );
  const scale = Math.max(
    1,
    Math.min(2, Number.isFinite(input.fontScale) ? input.fontScale! : 1),
  );
  const shelfReserve = Math.ceil(56 * scale + 80);
  const budget = Math.max(1, viewport - shelfReserve - 24);
  const height = Math.round(
    Math.max(
      1,
      Math.min(
        width / metrics.aspectRatio,
        metrics.height,
        budget,
        compact ? 190 : 360,
      ),
    ),
  );
  const titleFont = compact ? 22 : profile.deviceClass === "tablet" ? 28 : 26;
  const titleLineHeight = compact
    ? 26
    : profile.deviceClass === "tablet"
      ? 34
      : 31;
  const titleLines = height < titleLineHeight * scale * 2 + 40 ? 1 : 2;
  const showMeta =
    height >= titleLineHeight * scale * titleLines + 20 * scale + 32;
  return {
    width,
    height,
    compact,
    titleFont,
    titleLineHeight,
    titleLines,
    showMeta,
    showEyebrow:
      height >=
      titleLineHeight * scale * titleLines +
        (showMeta ? 16 * scale + 6 : 0) +
        14 * scale +
        7 +
        (compact ? 24 : 36),
    captionPadding: compact ? 12 : 18,
    captionMaxWidth: Math.min(width, metrics.captionMaxWidth),
  };
}
