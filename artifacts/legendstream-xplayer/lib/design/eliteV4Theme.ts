/** Elite V4 is deliberately isolated from the shipped Elite V3 token system. */
export const eliteV4Theme = {
  color: {
    background: "#090B0F",
    surface: "#11151B",
    surfaceRaised: "#191F27",
    surfaceGlass: "rgba(17,21,27,0.92)",
    foreground: "#F5F7FA",
    muted: "#A5AFBC",
    quiet: "#6F7B89",
    accent: "#65D7C2",
    accentSoft: "rgba(101,215,194,0.16)",
    focus: "#72E3CE",
    border: "rgba(255,255,255,0.10)",
    scrim: "rgba(4,6,9,0.90)",
    danger: "#FF8179",
  },
  radius: { small: 10, medium: 16, large: 24, hero: 30, pill: 999 },
  spacing: { xxs: 4, xs: 8, sm: 12, md: 18, lg: 26, xl: 36, xxl: 52 },
  type: { eyebrow: 12, body: 16, subtitle: 20, title: 34, hero: 52 },
  layout: {
    sidebarCompact: 76,
    sidebarExpanded: 238,
    railCardWidth: 190,
    railCardHeight: 116,
  },
} as const;

export type EliteV4Theme = typeof eliteV4Theme;
