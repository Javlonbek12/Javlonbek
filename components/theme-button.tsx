"use client";

import { Moon, Sun, SunMoon } from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "@/components/locale-provider";
import {
  DARK_QUERY,
  nextTheme,
  readTheme,
  STATUS_BAR,
  THEME_COOKIE,
  type Theme,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const CHANGED = "app:theme-change";

// Puts the theme on the page at once (class, status bar colour) and keeps it for the next visit.
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const dark = theme === "dark" || (theme === "system" && matchMedia(DARK_QUERY).matches);
  root.dataset.theme = theme;
  root.classList.toggle("dark", dark);
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    // With "system" the page may carry one colour per scheme; otherwise one for the chosen theme.
    const forDark = theme === "system" && meta.media ? meta.media === DARK_QUERY : dark;
    meta.content = forDark ? STATUS_BAR.dark : STATUS_BAR.light;
  }
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new Event(CHANGED));
}

const LABEL = {
  light: "shell.themeLight",
  dark: "shell.themeDark",
  system: "shell.themeSystem",
} as const;
const ICON = { light: Sun, dark: Moon, system: SunMoon };

// Light → dark → as on the phone → light. The icon and the label say what the next press does.
export function ThemeButton({ theme: initial, className }: { theme: Theme; className?: string }) {
  const t = useT();
  const [theme, setTheme] = useState(initial);

  // The phone header and the desktop bar each have a button: both show the same theme.
  useEffect(() => {
    const sync = () => setTheme(readTheme(document.documentElement.dataset.theme));
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, []);

  // "As on the phone" follows the device while the page is open (e.g. dark at sunset).
  useEffect(() => {
    if (theme !== "system") return;
    const media = matchMedia(DARK_QUERY);
    const follow = () => applyTheme("system");
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [theme]);

  const next = nextTheme(theme);
  const Icon = ICON[next];
  return (
    <button
      type="button"
      onClick={() => applyTheme(next)}
      aria-label={t(LABEL[next])}
      title={t(LABEL[next])}
      className={cn(
        "bg-card hover:bg-accent text-muted-foreground hover:text-foreground flex size-10 items-center justify-center rounded-full border",
        className,
      )}
    >
      <Icon className="size-[18px]" />
    </button>
  );
}
