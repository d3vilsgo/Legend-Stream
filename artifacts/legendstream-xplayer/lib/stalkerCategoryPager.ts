export const STALKER_CATEGORY_SWIPE_THRESHOLD = 60;
export const STALKER_CATEGORY_HORIZONTAL_RATIO = 1.2;
export const STALKER_CATEGORY_INTENT_DISTANCE = 12;

export type StalkerCategorySwipeDirection = "previous" | "next";

export type StalkerCategoryPagerItem = {
  id: string;
  title: string;
};

export function isStalkerCategoryHorizontalIntent(dx: number, dy: number) {
  return Math.abs(dx) >= STALKER_CATEGORY_INTENT_DISTANCE
    && Math.abs(dx) > Math.abs(dy) * STALKER_CATEGORY_HORIZONTAL_RATIO;
}

export function resolveStalkerCategorySwipe(
  dx: number,
  dy: number,
  disabled = false,
): StalkerCategorySwipeDirection | null {
  if (disabled || Math.abs(dx) < STALKER_CATEGORY_SWIPE_THRESHOLD) return null;
  if (!isStalkerCategoryHorizontalIntent(dx, dy)) return null;
  return dx < 0 ? "next" : "previous";
}

export function adjacentStalkerCategoryIndex(
  activeIndex: number,
  count: number,
  direction: StalkerCategorySwipeDirection,
) {
  if (count <= 0 || activeIndex < 0 || activeIndex >= count) return -1;
  const delta = direction === "next" ? 1 : -1;
  return Math.min(count - 1, Math.max(0, activeIndex + delta));
}

export function adjacentStalkerCategoryId(
  categories: readonly StalkerCategoryPagerItem[],
  activeId: string | null,
  direction: StalkerCategorySwipeDirection,
) {
  if (!categories.length) return null;
  const activeIndex = categories.findIndex((item) => item.id === activeId);
  if (activeIndex < 0) return null;
  const nextIndex = adjacentStalkerCategoryIndex(activeIndex, categories.length, direction);
  if (nextIndex < 0 || nextIndex === activeIndex) return null;
  return categories[nextIndex]?.id ?? null;
}
