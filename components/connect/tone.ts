// How a number stands against its norm, the same on every block of «Аналитика Connect»: green —
// the norm is met, amber — close to it, red — far below (the owner asked on 23.11.2026 for the
// worst to be seen at once, see docs/DECISIONS.md). Never colour alone: the number is always
// written next to it. The rules themselves are in modules/connect/tone.ts (the Excel file counts
// its colours with them too); here is how the page paints them.

import type { Tone } from "@/modules/connect/tone";

export { lineTone, targetTone, toneRank, type Tone } from "@/modules/connect/tone";

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
