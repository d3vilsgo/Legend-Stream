import colors from '../../constants/colors';

export type PremiumUiMode = 'mobilePortrait' | 'mobileLandscape' | 'phonePortrait' | 'tabletPortrait' | 'tabletLandscape' | 'tv';

type ModeScale = Record<PremiumUiMode, number>;

const palette = colors.dark ?? colors.light;

export const premiumDesignTokens = {
  colors: {
    ...palette,
    focusRing: palette.accent,
    selectedSurface: palette.secondary,
    scrim: 'rgba(7, 16, 31, 0.72)',
    heroGradientStart: 'rgba(7, 16, 31, 0)',
    heroGradientMiddle: 'rgba(7, 16, 31, 0.42)',
    heroGradientEnd: 'rgba(7, 16, 31, 0.9)',
  },
  typography: {
    navLabel: { fontSize: 12, lineHeight: 16, fontWeight: '700' as const },
    scale: { mobilePortrait: 1, phonePortrait: 1, mobileLandscape: 0.94, tabletPortrait: 1.12, tabletLandscape: 1.08, tv: 1.4 },
    metadata: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const },
    cardTitle: { fontSize: 13, lineHeight: 17, fontWeight: '700' as const },
    heroTitle: {
      mobilePortrait: { fontSize: 26, lineHeight: 31, fontWeight: '800' as const },
      phonePortrait: { fontSize: 26, lineHeight: 31, fontWeight: '800' as const },
      tabletPortrait: { fontSize: 32, lineHeight: 38, fontWeight: '800' as const },
      tabletLandscape: { fontSize: 28, lineHeight: 34, fontWeight: '800' as const },
      mobileLandscape: { fontSize: 22, lineHeight: 26, fontWeight: '800' as const },
      tv: { fontSize: 36, lineHeight: 42, fontWeight: '800' as const },
    },
  },
  spacing: {
    xxs: 4,
    xs: 6,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radius: {
    sm: colors.radius,
    md: 12,
    lg: 18,
    xl: 24,
  },
  icon: {
    sm: 18,
    md: 22,
    lg: 28,
    tv: 32,
  },
  touchTarget: {
    minimum: 44,
    tablet: 48,
    compact: 48,
    tv: 56,
  },
  poster: {
    aspectRatio: 2 / 3,
    minWidth: {
      mobilePortrait: 132,
      phonePortrait: 132,
      tabletPortrait: 150,
      tabletLandscape: 132,
      mobileLandscape: 104,
      tv: 188,
    } satisfies ModeScale,
    targetWidth: {
      mobilePortrait: 158,
      phonePortrait: 158,
      tabletPortrait: 180,
      tabletLandscape: 170,
      mobileLandscape: 132,
      tv: 220,
    } satisfies ModeScale,
    maxWidth: {
      mobilePortrait: 190,
      phonePortrait: 190,
      tabletPortrait: 228,
      tabletLandscape: 210,
      mobileLandscape: 162,
      tv: 260,
    } satisfies ModeScale,
    minColumns: {
      mobilePortrait: 2,
      phonePortrait: 2,
      tabletPortrait: 3,
      tabletLandscape: 4,
      mobileLandscape: 4,
      tv: 5,
    } satisfies ModeScale,
    maxColumns: {
      mobilePortrait: 4,
      phonePortrait: 4,
      tabletPortrait: 6,
      tabletLandscape: 8,
      mobileLandscape: 8,
      tv: 9,
    } satisfies ModeScale,
  },
  grid: {
    columnGap: {
      mobilePortrait: 10,
      phonePortrait: 10,
      tabletPortrait: 14,
      tabletLandscape: 14,
      mobileLandscape: 10,
      tv: 18,
    } satisfies ModeScale,
    rowGap: {
      mobilePortrait: 16,
      phonePortrait: 16,
      tabletPortrait: 20,
      tabletLandscape: 18,
      mobileLandscape: 12,
      tv: 24,
    } satisfies ModeScale,
  },
  contentPadding: {
    horizontal: {
      mobilePortrait: 18,
      phonePortrait: 18,
      tabletPortrait: 28,
      tabletLandscape: 36,
      mobileLandscape: 16,
      tv: 64,
    } satisfies ModeScale,
    vertical: {
      mobilePortrait: 14,
      phonePortrait: 14,
      tabletPortrait: 20,
      tabletLandscape: 20,
      mobileLandscape: 10,
      tv: 32,
    } satisfies ModeScale,
  },
  hero: {
    aspectRatio: 2.25,
    maxTitleLines: 2,
    minHeight: {
      mobilePortrait: 190,
      phonePortrait: 190,
      tabletPortrait: 230,
      tabletLandscape: 180,
      mobileLandscape: 128,
      tv: 340,
    } satisfies ModeScale,
    maxHeight: {
      mobilePortrait: 420,
      phonePortrait: 420,
      tabletPortrait: 480,
      tabletLandscape: 320,
      mobileLandscape: 190,
      tv: 560,
    } satisfies ModeScale,
    heightFraction: {
      mobilePortrait: 0.42,
      phonePortrait: 0.42,
      tabletPortrait: 0.36,
      tabletLandscape: 0.32,
      mobileLandscape: 0.36,
      tv: 0.48,
    } satisfies Record<PremiumUiMode, number>,
    captionMaxWidth: {
      mobilePortrait: 620,
      phonePortrait: 620,
      tabletPortrait: 760,
      tabletLandscape: 760,
      mobileLandscape: 560,
      tv: 760,
    } satisfies ModeScale,
  },
  focus: {
    ringWidth: {
      mobilePortrait: 1,
      phonePortrait: 1,
      tabletPortrait: 1,
      tabletLandscape: 1,
      mobileLandscape: 1,
      tv: 3,
    } satisfies ModeScale,
    selectedBorderWidth: 1,
    scale: {
      mobilePortrait: 1,
      phonePortrait: 1,
      tabletPortrait: 1,
      tabletLandscape: 1,
      mobileLandscape: 1,
      tv: 1.055,
    } satisfies Record<PremiumUiMode, number>,
  },
  motion: {
    fast: 120,
    standard: 190,
    slow: 260,
  },
  safeArea: {
    minTop: 0,
    minBottom: 0,
    tvOverscan: 48,
  },
} as const;

export type PremiumDesignTokens = typeof premiumDesignTokens;
