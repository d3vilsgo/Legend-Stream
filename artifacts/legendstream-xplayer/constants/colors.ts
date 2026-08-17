/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#f4f7fb',
    tint: '#19d8e8',

    // Core surfaces
    background: '#07101f',
    foreground: '#f4f7fb',

    // Cards / elevated surfaces
    card: '#101c2e',
    cardForeground: '#f4f7fb',

    // Primary action color (buttons, links, active states)
    primary: '#19d8e8',
    primaryForeground: '#06111d',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#17253a',
    secondaryForeground: '#d9e5f0',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#142137',
    mutedForeground: '#91a5ba',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#4678ff',
    accentForeground: '#f4f7fb',

    // Destructive actions (delete, error states)
    destructive: '#f06b78',
    destructiveForeground: '#19090d',

    // Borders and input outlines
    border: '#29415b',
    input: '#29415b',
  },

  dark: {
    text: '#f4f7fb',
    tint: '#19d8e8',
    background: '#07101f',
    foreground: '#f4f7fb',
    card: '#101c2e',
    cardForeground: '#f4f7fb',
    primary: '#19d8e8',
    primaryForeground: '#06111d',
    secondary: '#17253a',
    secondaryForeground: '#d9e5f0',
    muted: '#142137',
    mutedForeground: '#91a5ba',
    accent: '#4678ff',
    accentForeground: '#f4f7fb',
    destructive: '#f06b78',
    destructiveForeground: '#19090d',
    border: '#29415b',
    input: '#29415b',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
