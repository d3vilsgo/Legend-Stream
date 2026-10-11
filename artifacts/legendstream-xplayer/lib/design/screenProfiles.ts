import { PremiumUiMode, premiumDesignTokens } from './tokens';

export type PremiumNavState = 'open' | 'closed';

export type PremiumSafeAreaInsets = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

export type PremiumScreenProfileInput = {
  mode: PremiumUiMode;
  width: number;
  height: number;
  density?: number;
  navState?: PremiumNavState;
  safeArea?: PremiumSafeAreaInsets;
};

export type PremiumScreenProfile = {
  mode: PremiumUiMode;
  width: number;
  height: number;
  density: number;
  safeArea: Required<PremiumSafeAreaInsets>;
  isLandscape: boolean;
  shortSide: number;
  navState: PremiumNavState;
  navChromeHeight: number;
  horizontalPadding: number;
  verticalPadding: number;
  densityScale: number;
  effectiveContentWidth: number;
  effectiveContentHeight: number;
};

const FALLBACK_DIMENSIONS: Record<PremiumUiMode, { width: number; height: number }> = {
  mobilePortrait: { width: 390, height: 844 },
  mobileLandscape: { width: 844, height: 390 },
  tv: { width: 1920, height: 1080 },
};

const NAV_CHROME_HEIGHT: Record<PremiumUiMode, Record<PremiumNavState, number>> = {
  mobilePortrait: { closed: 58, open: 112 },
  mobileLandscape: { closed: 46, open: 70 },
  tv: { closed: 72, open: 72 },
};

function finitePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value && value > 0 ? value : fallback;
}

function finiteNonNegative(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveDensityScale(mode: PremiumUiMode, shortSide: number, density: number): number {
  const baseline = mode === 'tv' ? 720 : mode === 'mobileLandscape' ? 390 : 390;
  const sizeScale = shortSide > 0 ? shortSide / baseline : 1;
  const densityNudge = density >= 3 ? 0.96 : density <= 1.5 ? 1.04 : 1;
  return clamp(sizeScale * densityNudge, 0.86, mode === 'tv' ? 1.12 : 1.08);
}

export function resolvePremiumScreenProfile(input: PremiumScreenProfileInput): PremiumScreenProfile {
  const fallback = FALLBACK_DIMENSIONS[input.mode];
  const width = finitePositive(input.width, fallback.width);
  const height = finitePositive(input.height, fallback.height);
  const density = finitePositive(input.density, 1);
  const safeArea = {
    top: finiteNonNegative(input.safeArea?.top),
    right: finiteNonNegative(input.safeArea?.right),
    bottom: finiteNonNegative(input.safeArea?.bottom),
    left: finiteNonNegative(input.safeArea?.left),
  };
  const navState = input.mode === 'tv' ? 'open' : input.navState ?? 'closed';
  const usableWidth = Math.max(0, width - safeArea.left - safeArea.right);
  const usableHeight = Math.max(0, height - safeArea.top - safeArea.bottom);
  const shortSide = Math.min(usableWidth, usableHeight);
  const isLandscape = input.mode === 'mobileLandscape' || usableWidth >= usableHeight;
  const overscanAllowance = input.mode === 'tv' ? premiumDesignTokens.safeArea.tvOverscan : 0;
  const horizontalPadding = premiumDesignTokens.contentPadding.horizontal[input.mode];
  const verticalPadding = premiumDesignTokens.contentPadding.vertical[input.mode];
  const navChromeHeight = NAV_CHROME_HEIGHT[input.mode][navState];
  const densityScale = resolveDensityScale(input.mode, shortSide, density);

  return {
    mode: input.mode,
    width,
    height,
    density,
    safeArea,
    isLandscape,
    shortSide,
    navState,
    navChromeHeight,
    horizontalPadding,
    verticalPadding,
    densityScale,
    effectiveContentWidth: Math.max(
      0,
      usableWidth - horizontalPadding * 2 - overscanAllowance * 2,
    ),
    effectiveContentHeight: Math.max(
      0,
      usableHeight - navChromeHeight - verticalPadding * 2 - overscanAllowance * 2,
    ),
  };
}
