import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";

import type { ConnectReport } from "./report";
import { DEFAULT_RULES } from "./rules";
import { lineTone, targetTone, type Tone } from "./tone";
import { NO_VISITS_REGION, type TsmRow } from "./visits";

// «Худшие результаты»: the lowest numbers of each kind next to each other (asked by the owner on
// 23.11.2026). Pure, so the page and the Excel file show the same lists.

export type WorstRow = {
  key: string;
  // A code and, under it, a name (or just a region).
  title: string;
  note?: string | null;
  // The share shown as a bar, and what it is of («142 из 342»).
  value: number;
  of?: string | null;
  tone: Tone | null;
  href?: string;
};

export type WorstList = {
  key: string;
  title: string;
  // The norm the colours are counted against: «цель 95%».
  norm: string;
  rows: WorstRow[];
};

// How many products it takes to judge a TSM's recovery (as «Требует внимания» does).
const MIN_COMPARED = 10;

type Region = NonNullable<ConnectReport["exec"]>["regions"][number];

// The lists of «Худшие результаты» for a level, each the lowest first: the TSMs' attendance and
// the reps' hit rate (route analysis), the recovery of stock by who checked, and Connect on the
// visits — by TSM for a manager, by region for the leadership (it has no row per TSM).
export function worstLists(input: {
  routes: NonNullable<ConnectReport["exec"]>["routes"];
  insights: ConnectReport["insights"] | undefined;
  people?: TsmRow[];
  regions?: Region[];
  // A TSM's or a zone's own page (none: the names are not links).
  href?: (code: string) => string;
}): WorstList[] {
  const { routes, insights, href } = input;
  const rules = insights?.rules ?? DEFAULT_RULES;
  const of = (part: number, whole: number) =>
    t("connect.worst.of", { part: formatNumber(part), whole: formatNumber(whole) });
  const lists: WorstList[] = [];

  if (routes) {
    const a = routes.analysis;
    lists.push({
      key: "attendance",
      title: t("connect.worst.attendance"),
      norm: t("connect.worst.target", { value: a.targets.attendance }),
      rows: a.ranking
        .filter((z) => z.attendance !== null)
        .map((z) => ({
          key: z.zone,
          title: z.zone,
          note: z.person,
          value: z.attendance!,
          of: of(z.visited, z.planned),
          tone: targetTone(z.attendance, a.targets.attendance),
          href: href?.(z.zone),
        })),
    });
    lists.push({
      key: "hitRate",
      title: t("connect.worst.hitRate"),
      norm: t("connect.worst.target", { value: a.targets.hitRate }),
      rows: a.zones
        .filter((z) => z.kind === "DR" && z.hitRate !== null)
        .sort((x, y) => x.hitRate! - y.hitRate! || y.visits - x.visits)
        .map((z) => ({
          key: z.zone,
          title: z.zone,
          note: z.person ?? z.organization,
          value: z.hitRate!,
          of: of(z.orders, z.visits),
          tone: targetTone(z.hitRate, a.targets.hitRate),
          href: href?.(z.zone),
        })),
    });
  }

  if (insights)
    lists.push({
      key: "recovery",
      title: t("connect.worst.recovery"),
      norm: t("connect.worst.line", { value: rules.recovery }),
      rows: insights.recovery.byTsm
        .filter((r) => r.rate !== null && r.wasOut >= MIN_COMPARED)
        .sort((x, y) => x.rate! - y.rate! || y.wasOut - x.wasOut)
        .map((r) => ({
          key: r.code,
          title: r.code,
          note: r.name,
          value: r.rate!,
          of: of(r.restored, r.wasOut),
          tone: lineTone(r.rate, rules.recovery),
          href: href?.(r.code),
        })),
    });

  if (input.people)
    lists.push({
      key: "connect",
      title: t("connect.worst.connect"),
      norm: t("connect.worst.line", { value: rules.connect }),
      rows: input.people
        .filter((r) => r.visited > 0)
        .sort((x, y) => x.connectRate - y.connectRate || y.visited - x.visited)
        .map((r) => ({
          key: r.code,
          title: r.code,
          note: r.name,
          value: r.connectRate,
          of: of(r.withConnect, r.visited),
          tone: lineTone(r.connectRate, rules.connect),
          href: href?.(r.code),
        })),
    });
  else if (input.regions)
    lists.push({
      key: "connectRegions",
      title: t("connect.worst.connectRegions"),
      norm: t("connect.worst.line", { value: rules.connect }),
      rows: input.regions
        .filter((r) => r.region !== NO_VISITS_REGION && r.visited > 0)
        .sort((x, y) => x.connectRate - y.connectRate || y.visited - x.visited)
        .map((r) => ({
          key: r.region,
          title: r.region,
          note: t("connect.worst.people", { count: r.people }),
          value: r.connectRate,
          of: of(r.withConnect, r.visited),
          tone: lineTone(r.connectRate, rules.connect),
        })),
    });

  return lists;
}
