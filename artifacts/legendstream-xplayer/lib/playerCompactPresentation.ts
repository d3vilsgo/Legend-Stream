/** Display-only calculations. Never owns stream selection or playback state. */
export type LiveDrawerRow = { subtitle?: string };

export function compactInfoHeight(
  windowHeight: number,
  top = 0,
  bottom = 0,
): number {
  const usable = Math.max(
    0,
    windowHeight - Math.max(0, top) - Math.max(0, bottom),
  );
  return Math.floor(usable / 12);
}

export function liveDrawerWidth(
  windowWidth: number,
  left = 0,
  right = 0,
  nativeTv = false,
  portrait = false,
): number {
  const usable = Math.max(
    0,
    windowWidth - Math.max(0, left) - Math.max(0, right),
  );
  return Math.floor(usable * (nativeTv ? 0.4 : portrait ? 0.86 : 0.58));
}

export function realEpgProgress(
  start?: number,
  end?: number,
  now = Date.now(),
): number | null {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(now) ||
    !start ||
    !end ||
    end <= start
  )
    return null;
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
}

export function liveDrawerCategories(
  items: readonly LiveDrawerRow[],
): string[] {
  return [...new Set(items.map((item) => item.subtitle?.trim() || "Diğer"))];
}

export function categoryForRow(item: LiveDrawerRow): string {
  return item.subtitle?.trim() || "Diğer";
}
