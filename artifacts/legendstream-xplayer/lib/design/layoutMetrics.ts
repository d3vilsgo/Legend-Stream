import { PremiumScreenProfile } from './screenProfiles';
import { premiumDesignTokens } from './tokens';

export type PremiumPosterGridMetrics = {
  columns: number;
  posterWidth: number;
  posterHeight: number;
  columnGap: number;
  rowGap: number;
  aspectRatio: number;
};

export type PremiumHomeHeroMetrics = {
  width: number;
  height: number;
  aspectRatio: number;
  compact: boolean;
  maxTitleLines: number;
  captionMaxWidth: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeRound(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

export function computePremiumPosterGridMetrics(profile: PremiumScreenProfile): PremiumPosterGridMetrics {
  const poster = premiumDesignTokens.poster;
  const availableWidth = Math.max(1, profile.effectiveContentWidth);
  const columnGap = premiumDesignTokens.grid.columnGap[profile.mode];
  const rowGap = premiumDesignTokens.grid.rowGap[profile.mode];
  const minColumns = poster.minColumns[profile.mode];
  const maxColumns = poster.maxColumns[profile.mode];
  const minWidth = poster.minWidth[profile.mode];
  const targetWidth = poster.targetWidth[profile.mode] * profile.densityScale;
  const maxWidth = poster.maxWidth[profile.mode] * profile.densityScale;
  const rawColumns = Math.floor((availableWidth + columnGap) / (targetWidth + columnGap));
  let columns = clamp(rawColumns || minColumns, minColumns, maxColumns);
  let posterWidth = (availableWidth - columnGap * (columns - 1)) / columns;

  while (columns < maxColumns && posterWidth > maxWidth) {
    columns += 1;
    posterWidth = (availableWidth - columnGap * (columns - 1)) / columns;
  }

  while (columns > 1 && posterWidth < minWidth) {
    columns -= 1;
    posterWidth = (availableWidth - columnGap * (columns - 1)) / columns;
  }

  posterWidth = clamp(posterWidth, Math.min(minWidth, availableWidth), maxWidth);

  return {
    columns,
    posterWidth: safeRound(posterWidth),
    posterHeight: safeRound(posterWidth / poster.aspectRatio),
    columnGap,
    rowGap,
    aspectRatio: poster.aspectRatio,
  };
}

export function computePremiumHomeHeroMetrics(profile: PremiumScreenProfile): PremiumHomeHeroMetrics {
  const hero = premiumDesignTokens.hero;
  const width = Math.max(1, profile.effectiveContentWidth);
  const availableHeight = Math.max(1, profile.effectiveContentHeight);
  const compact = profile.mode === 'mobileLandscape';
  const maxByHeight = availableHeight * hero.heightFraction[profile.mode];
  const maxHeight = Math.min(hero.maxHeight[profile.mode], maxByHeight);
  const minHeight = Math.min(hero.minHeight[profile.mode], maxHeight);
  const aspectHeight = width / hero.aspectRatio;
  const height = clamp(aspectHeight, minHeight, maxHeight);

  return {
    width: safeRound(width),
    height: safeRound(height),
    aspectRatio: hero.aspectRatio,
    compact,
    maxTitleLines: hero.maxTitleLines,
    captionMaxWidth: Math.min(hero.captionMaxWidth[profile.mode], safeRound(width * 0.72)),
  };
}
