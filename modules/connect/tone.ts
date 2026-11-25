import { orderStage } from "./analytics";
import type { PathReason, PathRow } from "./oos-path";
import type { RouteTargets, RouteZone } from "./routes";
import type { ConnectRules } from "./rules";
import { NO_VISITS_REGION } from "./visits";

// How a number stands against its norm, the same on every block of «Аналитика Connect» and in its
// Excel file: green — the norm is met, amber — close to it, red — far below (the owner asked on
// 23.11.2026 for the worst to be seen at once, see docs/DECISIONS.md). Never colour alone: the
// number is always written next to it. Pure, so the page and the downloads count the same.

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

// Where the colours change, for a legend: a target is amber from `warn` and green from `good`,
// a line red under `warn` and green from `good` (null: the line is switched off).
export const targetBands = (target: number) => ({ warn: target * CLOSE, good: target });
export const lineBands = (line: number) =>
  line <= 0 ? null : { warn: line, good: line + (100 - line) / 2 };

// The worst first: red, amber, green, then what has no number.
export const toneRank = (tone: Tone | null) =>
  tone === "bad" ? 0 : tone === "warn" ? 1 : tone === "good" ? 2 : 3;

// As bad as the worst of them.
export const worstTone = (tones: (Tone | null)[]): Tone | null =>
  [...tones].sort((a, b) => toneRank(a) - toneRank(b))[0] ?? null;

// --- The blocks' own rules -----------------------------------------------------------------

// The planned visits made and Connect on the visits against the owner's lines; nothing to judge
// without a plan (or without a visit).
export const visitedTone = (
  r: { planned: number; visitedRate: number },
  rules: Pick<ConnectRules, "visited">,
) => (r.planned ? lineTone(r.visitedRate, rules.visited) : null);
export const connectTone = (
  r: { visited: number; connectRate: number },
  rules: Pick<ConnectRules, "connect">,
) => (r.visited ? lineTone(r.connectRate, rules.connect) : null);

// A region as bad as the worse of its two shares; those without Smart Up visits have neither.
export const regionTone = (
  r: { region: string; planned: number; visitedRate: number; connectRate: number },
  rules: Pick<ConnectRules, "visited" | "connect">,
): Tone | null =>
  r.region === NO_VISITS_REGION || !r.planned
    ? null
    : worstTone([lineTone(r.visitedRate, rules.visited), lineTone(r.connectRate, rules.connect)]);

// A zone's mark on the left edge: a rep by the class of the matrix, a TSM by attendance.
export const zoneTone = (z: RouteZone, targets: RouteTargets): Tone | null =>
  z.kind === "DR" && z.class ? classTone(z.class) : targetTone(z.attendance, targets.attendance);

// The DRs' matrix: both targets reached is good, one missed a warning, both missed a problem.
export const classTone = (value: NonNullable<RouteZone["class"]>): Tone =>
  value === "both" ? "bad" : value === "one" ? "warn" : "good";

// A share against the period before, in percentage points: up is green, down red.
export const deltaTone = (delta: number | null): Tone | null =>
  delta === null || delta === 0 ? null : delta > 0 ? "good" : "bad";

// «Продажи по зонам». A fall of sales has no norm of the owner's: a tenth and more is marked as
// far, any fall as close, growth as good.
const FAR_FALL = -10;
export const changeTone = (change: number | null): Tone | null =>
  change === null ? null : change <= FAR_FALL ? "bad" : change < 0 ? "warn" : "good";

// «Точки маршрута без продаж»: an order marked on the route and nothing delivered is what to look
// into (amber, not red: an order of the period's last days may be delivered after it).
export const idleTone = (store: { orders: number }): Tone | null =>
  store.orders > 0 ? "warn" : null;

// «Путь OOS». Why a chain is in the list: a delivery without a sale is the mismatch to look into
// first.
export const REASON_TONE: Record<PathReason, Tone | null> = {
  deliveredNoSale: "bad",
  agentWaiting: "warn",
  noOrderNoSale: null,
};

// A row with a delivery that Smart Up shows no sale for is marked red; a rep's row with orders
// they have not answered amber.
export const pathRowTone = (x: PathRow): Tone | null => (x.deliveredNoSale > 0 ? "bad" : null);
export const pathRepTone = (x: PathRow): Tone | null =>
  x.deliveredNoSale > 0 ? "bad" : x.agentWaiting > 0 ? "warn" : null;

// --- The status scale ----------------------------------------------------------------------

// Red is kept for errors and overdue items: a store that didn't answer or a rejected payment is
// a warning (amber / orange), not an error.
export const STAGE_COLOR: Record<string, string> = {
  delivered: "#1f9d55",
  paid: "#1f9d55",
  approved: "#2a78d6",
  inProgress: "#2a78d6",
  blocked: "#d69e2e",
  waitingBum: "#eb6834",
  waitingBdm: "#eb6834",
  noAnswer: "#d69e2e",
  refused: "#898781",
  rejected: "#898781",
  // Smart Up visits and Market Visit results.
  ok: "#1f9d55",
  noMv: "#eb6834",
  noOos: "#d69e2e",
  notInTime: "#b7791f",
  otherEmployee: "#8a6fd1",
  closed: "#b8b6ae",
  full: "#1f9d55",
  partial: "#d69e2e",
  noPhoto: "#eb6834",
  partialNoPhoto: "#b7791f",
  skipped: "#898781",
};

// An order's delivery status as the bot writes it, coloured by its stage.
export const deliveryColor = (status: string) =>
  STAGE_COLOR[orderStage({ status, outcome: null, storeAnswer: null })];
