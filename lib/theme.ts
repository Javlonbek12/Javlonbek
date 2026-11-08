// The colour theme: light, dark, or "system" (as set on the phone or computer). Kept in the `theme`
// cookie, so the server draws the right one at once; no cookie is the light theme.
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = "theme";

export const readTheme = (value: string | undefined): Theme =>
  THEMES.includes(value as Theme) ? (value as Theme) : "light";

// The button goes round: light → dark → system → light.
export const nextTheme = (theme: Theme): Theme =>
  THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;

// The phone's status bar and the browser's toolbar take the colour of the app's header (white,
// or the dark theme's card colour).
export const STATUS_BAR = { light: "#ffffff", dark: "#131927" } as const;
export const DARK_QUERY = "(prefers-color-scheme: dark)";

// For "system": run in <head> before the first paint, so a dark phone never flashes white.
export const SYSTEM_THEME_SCRIPT = `(function(){try{if(matchMedia("${DARK_QUERY}").matches)document.documentElement.classList.add("dark")}catch(e){}})()`;
