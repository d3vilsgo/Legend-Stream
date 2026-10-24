/** Elite V4 tokens stay isolated from the shipped Elite V3 design system. */
export const eliteV4Theme = {
  color: {
    background: "#080D14",
    surface: "#101823",
    surfaceRaised: "#172332",
    surfaceGlass: "rgba(13,20,30,0.94)",
    foreground: "#F3F6FA",
    muted: "#A7B4C4",
    quiet: "#728195",
    accent: "#70D8D0",
    accentSoft: "rgba(112,216,208,0.13)",
    focus: "#82E2DA",
    border: "rgba(199,218,238,0.12)",
    scrim: "rgba(4,8,14,0.82)",
    danger: "#FF8179",
  },
  radius: { small: 8, medium: 14, large: 20, hero: 24, pill: 999 },
  spacing: { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 44 },
  type: { eyebrow: 11, body: 15, subtitle: 19, title: 30, hero: 38 },
  layout: {
    sidebarCompact: 68,
    sidebarExpanded: 208,
    railCardMin: 144,
    railCardMax: 224,
    railCardHeight: 190,
    heroMinHeight: 196,
    heroMaxHeight: 330,
  },
} as const;

export type EliteV4Theme = typeof eliteV4Theme;
