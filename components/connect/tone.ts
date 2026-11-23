// How a number stands against its norm, the same on every block of «Аналитика Connect»: green —
// the norm is met, amber — close to it, red — far below (the owner asked on 23.11.2026 for the
// worst to be seen at once, see docs/DECISIONS.md). Never colour alone: the number is always
// written next to it.

export type Tone = "good" | "warn" | "bad";

// How far under a target is still «close»: within this share of it (95% → from 80.75%).
const CLOSE = 0.85;

// A share against a target it should reach (attendance, hit rate).
export function targetTone(value: number | null | undefined, target: number): Tone | null {
  if (value === null || value === undefined) return null;
  if (value >= target) return "good";
  return value >= target * CLOSE ? "warn" : "bad";
}

// A share against a line it must not fall under («Требует внимания»): under the line is red,
// the lower half of what is above it amber, the rest green. A line of 0% is switched off.
export function lineTone(value: number | null | undefined, line: number): Tone | null {
  if (value === null || value === undefined || line <= 0) return null;
  if (value < line) return "bad";
  return value < line + (100 - line) / 2 ? "warn" : "good";
}

export const TONE_COLOR: Record<Tone, string> = {
  good: "#1f9d55",
  warn: "#d69e2e",
  bad: "#dc2626",
};

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
};

// A cell's background (a heat table) with its text.
export const TONE_CELL: Record<Tone, string> = {
  good: "bg-emerald-500/15 text-emerald-900 dark:text-emerald-200",
  warn: "bg-amber-400/25 text-amber-900 dark:text-amber-200",
  bad: "bg-red-500/20 text-red-900 dark:text-red-200",
};

// The worst first: red, amber, green, then what has no number.
export const toneRank = (tone: Tone | null) =>
  tone === "bad" ? 0 : tone === "warn" ? 1 : tone === "good" ? 2 : 3;
