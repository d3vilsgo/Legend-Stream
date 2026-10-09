export type HomeHeroLayoutInput = {
  width: number;
  height: number;
  isTv?: boolean;
};

export type HomeHeroLayout = {
  cardWidth: number;
  compactLandscape: boolean;
  frameStyle: {
    width: number;
    aspectRatio?: number;
    minHeight?: number;
    maxHeight?: number;
    height?: number;
  };
  emptyStyle: {
    width: number | "100%";
    aspectRatio?: number;
    minHeight?: number;
    maxHeight?: number;
    height?: number;
    padding: number;
  };
  captionStyle: {
    paddingHorizontal: number;
    paddingBottom: number;
    paddingTop: number;
    maxWidth: number;
  };
  imageTitleStyle: {
    fontSize: number;
    lineHeight: number;
  };
};

const HERO_ASPECT_RATIO = 2.25;
const DEFAULT_MIN_HEIGHT = 190;
const DEFAULT_MAX_HEIGHT = 520;
const DEFAULT_EMPTY_MAX_HEIGHT = 420;
const MAX_CARD_WIDTH = 1464;
const MIN_CARD_WIDTH = 280;

export function computeHomeHeroLayout({ width, height, isTv = false }: HomeHeroLayoutInput): HomeHeroLayout {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : MIN_CARD_WIDTH + 36;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;
  const cardWidth = Math.max(MIN_CARD_WIDTH, Math.min(safeWidth - 36, MAX_CARD_WIDTH));
  const compactLandscape = !isTv && safeWidth > safeHeight && safeHeight > 0 && safeHeight <= 520 && safeWidth >= 600;

  if (!compactLandscape) {
    return {
      cardWidth,
      compactLandscape: false,
      frameStyle: {
        width: cardWidth,
        aspectRatio: HERO_ASPECT_RATIO,
        minHeight: DEFAULT_MIN_HEIGHT,
        maxHeight: DEFAULT_MAX_HEIGHT,
      },
      emptyStyle: {
        width: "100%",
        aspectRatio: HERO_ASPECT_RATIO,
        minHeight: DEFAULT_MIN_HEIGHT,
        maxHeight: DEFAULT_EMPTY_MAX_HEIGHT,
        padding: 24,
      },
      captionStyle: {
        paddingHorizontal: 24,
        paddingBottom: 24,
        paddingTop: 70,
        maxWidth: 760,
      },
      imageTitleStyle: {
        fontSize: 30,
        lineHeight: 35,
      },
    };
  }

  const aspectHeight = cardWidth / HERO_ASPECT_RATIO;
  const heightTarget = safeHeight * 0.34;
  const compactHeight = Math.round(Math.max(132, Math.min(190, heightTarget, aspectHeight)));

  return {
    cardWidth,
    compactLandscape: true,
    frameStyle: {
      width: cardWidth,
      height: compactHeight,
    },
    emptyStyle: {
      width: "100%",
      height: compactHeight,
      padding: 16,
    },
    captionStyle: {
      paddingHorizontal: 16,
      paddingBottom: 14,
      paddingTop: 34,
      maxWidth: Math.min(560, Math.max(240, cardWidth - 32)),
    },
    imageTitleStyle: {
      fontSize: 22,
      lineHeight: 26,
    },
  };
}
