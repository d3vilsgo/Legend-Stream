/** Elite V3 production design contract. No new font, renderer, player or focus owner.
 * Focus, selected content and active route remain independent semantic states.
 * Measurements are logical dp; TV Preview uses the same density without owning Android input.
 */
export const eliteV3 = {
  color: {
    canvas: "#07101F",
    panel: "#101C2E",
    raised: "#172B42",
    elevated: "#20384F",
    primary: "#4678FF",
    focus: "#FFFFFF",
    selected: "#244B75",
    active: "#4678FF",
    text: "#F4F7FB",
    muted: "#A6B6C8",
    border: "#29415B",
    disabled: "#657487",
  },
  typography: {
    family: "Inter_400Regular",
    strong: "Inter_700Bold",
    tv: { title: 30, section: 21, body: 18, meta: 14 },
    tablet: { title: 27, section: 19, body: 16, meta: 13 },
    mobile: { title: 24, section: 18, body: 15, meta: 12 },
  },
  space: { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 28 },
  radius: { control: 10, card: 12, panel: 18, hero: 20 },
  icon: { compact: 20, control: 24, tv: 28 },
  focus: { width: 3, scale: 1 },
  target: { tv: 56, tablet: 48, mobile: 44 },
  home: {
    gradient: ["#07101FEE", "#07101F88", "#07101FEE"],
    overlay: "#07101FCC",
    posterWidth: { mobile: 124, tablet: 142, tv: 154 },
    landscapeWidth: { mobile: 184, tablet: 212, tv: 224 },
    posterRatio: 2 / 3,
    landscapeRatio: 16 / 9,
  },
  motion: { focus: 100, panel: 150, reduced: 0 },
} as const;

export type EliteV3Mode = "tv" | "tablet" | "mobile";
const clamp = (v: number, low: number, high: number) =>
  Math.max(low, Math.min(high, v));
export function eliteV3Mode(
  width: number,
  height: number,
  nativeTv = false,
): EliteV3Mode {
  if (nativeTv) return "tv";
  return Math.min(width, height) >= 600 ? "tablet" : "mobile";
}
export function eliteV3Frame(
  width: number,
  height: number,
  fontScale = 1,
  nativeTv = false,
  safe: { left?: number; right?: number; top?: number; bottom?: number } = {},
) {
  const mode = eliteV3Mode(width, height, nativeTv);
  const type = eliteV3.typography[mode];
  const left = Math.max(0, safe.left ?? 0);
  const right = Math.max(0, safe.right ?? 0);
  const innerWidth = Math.max(1, width - left - right);
  const scale = clamp(fontScale, 0.85, 2);
  const target = Math.ceil(
    Math.max(eliteV3.target[mode], type.body * scale * 2.4),
  );
  const rail = nativeTv ? clamp(target + 12, 64, 84) : 0;
  const gap = mode === "tv" ? 16 : mode === "tablet" ? 12 : 10;
  const contentWidth = Math.max(1, innerWidth - rail - (rail ? 12 : 0));
  const compact = innerWidth < 950 * Math.sqrt(scale);
  return { mode, type, scale, target, rail, gap, contentWidth, compact };
}
/** Layout target for the Live V3 Video Heavy variant. It is a planning
 * measurement only; never starts video or creates an independent VLC session.
 * Category width is inside the 32% browsing budget. */
export function eliteV3LivePanels(width: number, fontScale = 1) {
  const scale = clamp(fontScale, 0.85, 2);
  const stacked = width < 900 * Math.sqrt(scale);
  const gap = eliteV3.space.sm;
  if (stacked)
    return {
      stacked,
      categoryWidth: clamp(width * 0.26, 88, 180),
      channelWidth: Math.max(1, width - clamp(width * 0.26, 88, 180) - gap),
      videoWidth: width,
      gap,
    };
  const browseWidth = Math.round(width * 0.32);
  const categoryWidth = clamp(browseWidth * 0.32, 100, 200);
  const channelWidth = Math.max(1, browseWidth - categoryWidth - gap);
  const videoWidth = Math.max(1, width - browseWidth - gap);
  return { stacked, categoryWidth, channelWidth, videoWidth, gap };
}
export function eliteV3TargetVisual(
  focused: boolean,
  selected: boolean,
  active: boolean,
  disabled = false,
) {
  return {
    borderWidth: eliteV3.focus.width,
    borderColor: focused ? eliteV3.color.focus : "transparent",
    backgroundColor: selected ? eliteV3.color.selected : eliteV3.color.panel,
    activeIndicatorColor: active ? eliteV3.color.active : "transparent",
    opacity: disabled ? 0.55 : 1,
  };
}
