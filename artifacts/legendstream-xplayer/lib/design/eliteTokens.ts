/** Elite V1 is opt-in. Legacy tokens and useColors remain unchanged. All sizes are dp. */
export const eliteTokens = {
  color: {
    canvas: "#090C10",
    surface: "#12171E",
    raised: "#1C2530",
    border: "#34414F",
    text: "#F4F7FA",
    muted: "#ADB9C7",
    accent: "#67E8D1",
    onAccent: "#071916",
    focus: "#FFFFFF",
    selected: "#263D40",
    danger: "#FFB4AB",
  },
  typography: {
    family: "Inter_400Regular",
    strong: "Inter_700Bold",
    mobile: { body: 15, meta: 13, title: 28 },
    tablet: { body: 17, meta: 14, title: 34 },
    tv: { body: 20, meta: 16, title: 40 },
  },
  space: { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 },
  radius: { control: 12, card: 16, panel: 24, pill: 999 },
  elevation: { base: 0, card: 2, dock: 8, panel: 16, alert: 24 },
  opacity: {
    information: 0.84,
    interaction: 0.94,
    error: 0.98,
    scrim: 0.45,
    disabled: 0.55,
  },
  motion: { focus: 90, panel: 160, rail: 180, reduceMotion: 0 },
  focus: { width: 3, gutter: 8, scale: 1 },
  target: { mobile: 48, tablet: 52, tv: 64 },
  limit: {
    contentWidth: 1680,
    posterWidth: 240,
    heroHeight: 360,
    panelWidth: 560,
  },
} as const;
export type EliteMode = "mobile" | "tablet" | "preview" | "nativeTv";
export type EliteEdges = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
const bound = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export function eliteLayout(
  width: number,
  height: number,
  mode: EliteMode,
  fontScale = 1,
  safe: Partial<EliteEdges> = {},
  overscan = 0.025,
) {
  const tv = mode === "preview" || mode === "nativeTv";
  const gutter = eliteTokens.focus.gutter;
  const left = Math.max(safe.left ?? 0, tv ? width * overscan : 16) + gutter;
  const right = Math.max(safe.right ?? 0, tv ? width * overscan : 16) + gutter;
  const top = Math.max(safe.top ?? 0, tv ? height * overscan : 12) + gutter;
  const bottom =
    Math.max(safe.bottom ?? 0, tv ? height * overscan : 12) + gutter;
  const available = Math.max(1, width - left - right);
  const contentWidth = Math.min(available, eliteTokens.limit.contentWidth);
  // A narrow simulated TV window falls back to horizontal navigation; device identity does not change.
  const rail = tv && available >= 720 ? 76 : 0;
  const bodyWidth = Math.max(1, contentWidth - (rail ? rail + 24 : 0));
  const target =
    eliteTokens.target[tv ? "tv" : mode === "tablet" ? "tablet" : "mobile"];
  const scale = bound(fontScale, 0.85, 2);
  const type =
    eliteTokens.typography[tv ? "tv" : mode === "tablet" ? "tablet" : "mobile"];
  const posterMin = (tv ? 156 : 128) * Math.sqrt(scale);
  const columns = Math.max(1, Math.floor((bodyWidth + 16) / (posterMin + 16)));
  const posterWidth = Math.min(
    eliteTokens.limit.posterWidth,
    (bodyWidth - (columns - 1) * 16) / columns,
  );
  return {
    mode,
    tv,
    left,
    right,
    top,
    bottom,
    contentWidth,
    bodyWidth,
    rail,
    target,
    type,
    rowHeight: Math.ceil(Math.max(target, type.body * scale * 2.5 + 20)),
    columns,
    posterWidth,
    heroHeight: Math.round(
      Math.min(
        eliteTokens.limit.heroHeight,
        Math.max(160, (height - top - bottom) * (tv ? 0.32 : 0.28)),
      ),
    ),
    panelWidth: Math.min(bodyWidth, eliteTokens.limit.panelWidth),
    gap: 16,
  };
}
/** Orthogonal states: navigation focus never implies selection or activation. Constant border prevents reflow. */
export function eliteTargetVisual(
  focused: boolean,
  selected: boolean,
  active: boolean,
  disabled = false,
) {
  const t = eliteTokens;
  return {
    borderWidth: t.focus.width,
    borderColor: focused ? t.color.focus : "transparent",
    backgroundColor: focused
      ? t.color.raised
      : selected
        ? t.color.selected
        : t.color.surface,
    color: disabled ? t.color.muted : t.color.text,
    opacity: disabled ? t.opacity.disabled : 1,
    activeMarker: active,
    selectedMarker: selected,
    scale: t.focus.scale,
  };
}
export function eliteOverlaySurface(
  kind: "information" | "interaction" | "error",
) {
  const opacity = eliteTokens.opacity[kind];
  return { backgroundColor: `rgba(18,23,30,${opacity})`, opacity, blur: false };
}
