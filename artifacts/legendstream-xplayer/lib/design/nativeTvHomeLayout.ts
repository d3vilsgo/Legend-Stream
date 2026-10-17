import { nativeTvLayout, type TvWindow } from "../nativeTvResponsive";
/** Native TV only. viewportHeight is the measured ScrollView AFTER header/navigation. */
export function nativeTvHomeLayout(
  input: TvWindow & { viewportHeight?: number },
) {
  const tv = nativeTvLayout(input);
  const finite = (n: number | undefined, fallback: number) =>
    typeof n === "number" && Number.isFinite(n) && n > 0 ? n : fallback;
  const fontScale = finite(input.fontScale, 1);
  const estimatedNav = 48 + tv.target + tv.top + tv.gutter + 16;
  const viewport = finite(
    input.viewportHeight,
    Math.max(1, input.height - estimatedNav),
  );
  // Parent content paddingTop=18, Home paddingTop=4; bottom overscan is reserved once.
  const availableHeight = Math.max(1, viewport - 22 - tv.bottom);
  const titleFont = Math.round(Math.max(24, Math.min(30, input.width / 50)));
  const titleLineHeight = titleFont + 4;
  const metaFont = Math.round(Math.max(14, Math.min(18, input.width / 80)));
  const padding = 12;
  const borderSpace = 8;
  const metaLineHeight = metaFont + 4;
  const shelfMargin = 24,
    shelfGap = 10,
    shellGap = 4;
  const shelfHeaderHeight = Math.max(26 * fontScale, 12 * fontScale + 6);
  const minimumCardPreview = Math.min(
    112,
    Math.max(72, availableHeight * 0.22),
  );
  const shelfReserve =
    shelfMargin + shelfHeaderHeight + shelfGap + shellGap + minimumCardPreview;
  const ceiling = Math.max(1, Math.min(320, availableHeight - shelfReserve));
  const twoLineCaption =
    padding * 2 +
    borderSpace +
    titleLineHeight * fontScale * 2 +
    metaLineHeight * fontScale +
    6;
  const titleLines: 1 | 2 = twoLineCaption <= ceiling ? 2 : 1;
  const showMeta =
    padding * 2 +
      borderSpace +
      titleLineHeight * fontScale * titleLines +
      metaLineHeight * fontScale +
      6 <=
    ceiling;
  const captionHeight =
    padding * 2 +
    borderSpace +
    titleLineHeight * fontScale * titleLines +
    (showMeta ? metaLineHeight * fontScale + 6 : 0);
  // Text safety wins over the initial 33% target on extreme accessibility windows.
  const heroHeight = Math.ceil(
    Math.max(captionHeight, Math.min(ceiling, availableHeight * 0.33)),
  );
  const firstCardTop =
    heroHeight + shellGap + shelfMargin + shelfHeaderHeight + shelfGap;
  return {
    viewport,
    availableHeight,
    heroHeight,
    titleFont,
    titleLineHeight,
    titleLines,
    metaFont,
    metaLineHeight,
    borderSpace,
    showMeta,
    padding,
    firstCardTop,
    visibleCardHeight: Math.max(0, availableHeight - firstCardTop),
    minimumCardPreview,
    shelfBudgetMet: availableHeight - firstCardTop >= minimumCardPreview - 1,
  };
}
