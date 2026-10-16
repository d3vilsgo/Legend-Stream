/** All measurements are React Native dp, never output pixels. Native TV only. */
export type TvInsets = { top: number; right: number; bottom: number; left: number };
export type TvWindow = { width: number; height: number; fontScale?: number; safeArea?: Partial<TvInsets>; overscan?: Partial<TvInsets> };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const finite = (n: number | undefined, fallback: number) => n !== undefined && Number.isFinite(n) ? n : fallback;
export function nativeTvLayout(input: TvWindow, controlCount = 0) {
  const width = Math.max(1, finite(input.width, 960));
  const height = Math.max(1, finite(input.height, 540));
  const fontScale = clamp(finite(input.fontScale, 1), 0.5, 3);
  const edge = (side: keyof TvInsets, dimension: number, ratio: number) =>
    clamp(Math.max(0, finite(input.safeArea?.[side], 0), finite(input.overscan?.[side], dimension * ratio)) + 8, 8, dimension / 4);
  const left = edge('left', width, .025), right = edge('right', width, .025);
  const top = edge('top', height, .035), bottom = edge('bottom', height, .035);
  const usableWidth = width - left - right, usableHeight = height - top - bottom;
  const scale = clamp(Math.min(usableWidth / 1200, usableHeight / 680), .9, 1.35);
  const target = Math.round(clamp(64 * scale, 56, 86));
  const icon = Math.round(clamp(28 * scale, 26, 38));
  const labelFont = Math.round(clamp(16 * scale, 16, 22));
  const metaFont = Math.round(clamp(12 * scale, 12, 16));
  const gap = 8, gutter = 12;
  const count = Math.max(1, Math.floor(finite(controlCount, 1)));
  const minimumToolWidth = Math.round(88 * Math.sqrt(fontScale));
  const desiredToolWidth = Math.round(clamp(104 * scale * Math.sqrt(fontScale), minimumToolWidth, 190));
  const fitWidth = Math.floor((usableWidth - gutter * 2 - gap * (count - 1)) / count);
  const toolWidth = Math.min(usableWidth - gutter * 2, Math.max(minimumToolWidth, Math.min(desiredToolWidth, fitWidth)));
  const toolHeight = Math.ceil(icon + (labelFont + metaFont) * fontScale * 1.3 + 44);
  const focusLabelHeight = Math.ceil(20 * fontScale + 12);
  const dockHeight = Math.max(toolHeight, target + focusLabelHeight) + gutter * 2;
  const playSize = Math.round(clamp(target * 1.18, 68, 100));
  // Reserve seek/status above the dock; center controls cannot overlap either tier.
  const centerTop = top + Math.max(target + 12, (usableHeight - dockHeight - 64 - playSize) / 2);
  const navWidth = Math.max(120, Math.min(240, Math.floor((usableWidth - (count - 1) * 10) / count)));
  const posterTarget = clamp(usableHeight * .28 * Math.sqrt(fontScale), 144, 280);
  const columns = Math.max(1, Math.min(12, Math.floor(usableWidth / posterTarget)));
  return { width, height, left, right, top, bottom, usableWidth, usableHeight, scale, target, icon, labelFont, metaFont,
    gap, gutter, toolWidth, toolHeight, dockHeight, focusLabelHeight, playSize, centerTop, navWidth, columns,
    dockScrolls: count * toolWidth + (count - 1) * gap + gutter * 2 > usableWidth,
    panelWidth: Math.min(usableWidth, Math.max(320, usableWidth * .5)),
  };
}
/** FlatList scroll indexes refer to rows with numColumns. Missing targets never select a replacement. */
export function tvGridAnchorRow(id: string | null, ids: readonly string[], columns: number): number | null {
  const index = id === null ? -1 : ids.indexOf(id);
  return index < 0 ? null : Math.floor(index / Math.max(1, Math.floor(columns)));
}
