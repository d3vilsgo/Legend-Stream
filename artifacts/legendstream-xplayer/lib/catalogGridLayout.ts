import { computePremiumPosterGridMetrics } from "./design/layoutMetrics";
import { premiumDesignTokens } from "./design/tokens";
import {
  resolvePremiumCatalogProfile,
  resolvePremiumScreenProfile,
  type PremiumSafeAreaInsets,
  type PremiumNavState,
} from "./design/screenProfiles";

export type PosterGridLayout = {
  columns: number;
  columnWidth: number;
  cellWidth: number;
  contentWidth: number;
  outerPadding: number;
  paddingLeft: number;
  paddingRight: number;
};

/** Window dimensions classify the device; the measured list constrains its grid. */
export function computePosterGridLayout(
  width: number,
  height: number,
  nativeTv = false,
  options: {
    tvPreview?: boolean;
    safeArea?: PremiumSafeAreaInsets;
    navState?: PremiumNavState;
    density?: number;
    fontScale?: number;
    containerWidth?: number;
  } = {},
): PosterGridLayout {
  const profile = resolvePremiumCatalogProfile({
    width,
    height,
    nativeTv,
    ...options,
  });
  const layoutProfile =
    profile.deviceClass === "phone" && !options.tvPreview && width > height
      ? resolvePremiumScreenProfile({
          mode: "mobileLandscape",
          width,
          height,
          ...options,
        })
      : profile;
  const container = Math.min(
    1500,
    Number.isFinite(options.containerWidth) && options.containerWidth! > 0
      ? options.containerWidth!
      : profile.width,
  );
  const overscan =
    layoutProfile.mode === "tv" ? premiumDesignTokens.safeArea.tvOverscan : 0;
  const paddingLeft = Math.min(
    container / 4,
    layoutProfile.horizontalPadding + overscan + layoutProfile.safeArea.left,
  );
  const paddingRight = Math.min(
    container / 4,
    layoutProfile.horizontalPadding + overscan + layoutProfile.safeArea.right,
  );
  const contentWidth = Math.max(1, container - paddingLeft - paddingRight);
  const scale = Math.sqrt(
    Math.max(
      1,
      Math.min(2, Number.isFinite(options.fontScale) ? options.fontScale! : 1),
    ),
  );
  const metrics = computePremiumPosterGridMetrics({
    ...layoutProfile,
    effectiveContentWidth: contentWidth,
    densityScale: layoutProfile.densityScale * scale,
  });
  // Cards include a 6dp gutter on each side; larger text must not squeeze the title.
  const minCell =
    premiumDesignTokens.poster.minWidth[layoutProfile.mode] * scale;
  const columns = Math.max(
    1,
    Math.min(metrics.columns, Math.floor(contentWidth / minCell) || 1),
  );
  return {
    columns,
    columnWidth: Math.max(1, contentWidth / columns - 12),
    cellWidth: contentWidth / columns,
    contentWidth,
    outerPadding: layoutProfile.horizontalPadding,
    paddingLeft,
    paddingRight,
  };
}

/** Stable identity, never a raw pixel offset or a TMDB playback identifier. */
export function catalogAnchorRow(
  id: string | null,
  ids: readonly string[],
  columns: number,
): number | null {
  const index = id === null ? -1 : ids.indexOf(id);
  return index < 0 || columns < 1 ? null : Math.floor(index / columns);
}
