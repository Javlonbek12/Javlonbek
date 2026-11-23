import type { Recovery } from "./recovery";
import type { VisitSections } from "./visits";

// The leadership tiles against the previous period of the same length: the same shares counted for
// it, and the difference in percentage points (rules of 23.11.2026, see docs/DECISIONS.md).

export const TREND_KEYS = ["planDone", "connectUsed", "mvFull", "oosStores", "recovery"] as const;
export type TrendKey = (typeof TREND_KEYS)[number];

// For these a lower share is the better one.
export const LOWER_IS_BETTER: Record<TrendKey, boolean> = {
  planDone: false,
  connectUsed: false,
  mvFull: false,
  oosStores: true,
  recovery: false,
};

// The tiles' shares in %; null where there is nothing to take a share of.
export type Headline = Record<TrendKey, number | null>;

export function headline(
  sections: Pick<VisitSections, "visits" | "oos" | "mv">,
  recovery: Pick<Recovery, "totals"> | null,
): Headline {
  const { visits: v, oos: o, mv: m } = sections;
  return {
    planDone: v.planned > 0 ? v.visitedRate : null,
    connectUsed: v.visited > 0 ? v.connectRate : null,
    mvFull: m.unique - m.results.closed > 0 ? m.fullRate : null,
    oosStores: o.checked > 0 ? o.gapRate : null,
    recovery: recovery?.totals.rate ?? null,
  };
}

// The change in percentage points and what it was; null when either period has no number.
export type Change = { delta: number; was: number } | null;
export type Trend = Record<TrendKey, Change>;

export function trendOf(now: Headline, was: Headline | null): Trend {
  return Object.fromEntries(
    TREND_KEYS.map((key) => {
      const [a, b] = [now[key], was?.[key] ?? null];
      return [key, a === null || b === null ? null : { delta: a - b, was: b }];
    }),
  ) as Trend;
}

// Better, worse or the same, by the sign of the change and which way is good.
export function trendTone(delta: number, lowerIsBetter = false): "better" | "worse" | "same" {
  if (delta === 0) return "same";
  return delta > 0 !== lowerIsBetter ? "better" : "worse";
}
