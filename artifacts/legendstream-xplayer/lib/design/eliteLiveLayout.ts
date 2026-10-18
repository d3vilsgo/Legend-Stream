import { nativeTvLayout, type TvWindow } from "../nativeTvResponsive";
/** Uses measured content bounds, after the existing navigation has taken its space. */
export function eliteLiveLayout(input: TvWindow) {
  const base = nativeTvLayout(input);
  const width = Math.max(1, base.usableWidth);
  const scale = Math.max(1, Math.min(3, input.fontScale ?? 1));
  const stacked = width < 1050 * Math.sqrt(scale);
  // In stacked mode the channel viewport must retain usable width even on small TVs.
  const categoryWidth = stacked
    ? Math.max(96, Math.min(220, width * 0.28))
    : Math.min(260, Math.max(180, width * 0.19));
  const channelWidth = stacked
    ? Math.max(96, width - categoryWidth - 24)
    : Math.min(480, Math.max(300, width * 0.31));
  return {
    ...base,
    stacked,
    categoryWidth,
    channelWidth,
    rowHeight: Math.ceil(Math.max(76, 54 * scale + 24)),
    bodyFont: Math.round(Math.max(16, Math.min(24, 18 * Math.sqrt(scale)))),
    metaFont: Math.round(Math.max(13, Math.min(20, 15 * Math.sqrt(scale)))),
    detailWidth: stacked
      ? width
      : Math.max(1, width - categoryWidth - channelWidth - 24),
  };
}
export const eliteLiveSurfaces = {
  outer: "rgba(9,12,16,0.72)",
  information: "rgba(9,12,16,0.92)",
  focus: "#1C2530",
} as const;
/** Selection never follows focus. Removed/page-replaced selections have no replacement. */
export function eliteLiveSelection<T extends { id: string }>(
  items: readonly T[],
  id: string | null,
): T | null {
  return items.find((item) => item.id === id) ?? null;
}

export type EliteLiveState = { panelOpen: boolean; selectedId: string | null };
export type EliteLiveEvent =
  | { type: "togglePanel" }
  | { type: "select"; id: string }
  | { type: "reset" }
  | { type: "focus"; id: string };
export const eliteLiveInitial: EliteLiveState = {
  panelOpen: true,
  selectedId: null,
};
export function eliteLiveReduce(
  state: EliteLiveState,
  event: EliteLiveEvent,
): EliteLiveState {
  switch (event.type) {
    case "togglePanel":
      return { ...state, panelOpen: !state.panelOpen };
    case "select":
      return { ...state, selectedId: event.id };
    case "reset":
      return { ...state, selectedId: null };
    case "focus":
      return state;
  }
}
