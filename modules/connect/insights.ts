import { addDays } from "@/lib/dates";
import { db } from "@/lib/db";
import { previousPeriod } from "@/modules/reports/period";

import { isTestStore } from "./analytics";
import { attentionList } from "./attention";
import type { Hierarchy } from "./hierarchy";
import { titleKey, type OosRecord } from "./parse";
import {
  analyzeRecovery,
  FOLLOW_UP_DAYS,
  followUps,
  recoveryFrom,
  type RecoveryBase,
} from "./recovery";
import { loadRoutes, loadVisitData } from "./service";
import { headline, trendOf } from "./trend";
import {
  analyzeVisits,
  visitSections,
  type TsmRow,
  type VisitData,
  type VisitSections,
} from "./visits";

// What the Connect page adds to its sections on 23.11.2026: whether the products that were out came
// back («Восстановление наличия»), whether the distributor's rep brought an order after a check
// found an OOS, who needs a manager's attention, and the leadership tiles against the period
// before. Read here, so the report itself only says which level asks.

// The stock checks before the period, back to `from` (test stores left out).
async function loadChecksBefore(from: string, before: string): Promise<OosRecord[]> {
  if (from >= before) return [];
  const rows = await db.connectRecord.findMany({
    where: { kind: "OOS", day: { gte: from, lt: before } },
    select: { data: true, storeName: true, storeCode: true },
    orderBy: { day: "asc" },
  });
  return rows
    .filter((r) => !isTestStore(r.storeName, r.storeCode))
    .map((r) => r.data as unknown as OosRecord);
}

export async function connectInsights(input: {
  view: "exec" | "manager" | "executor";
  base: RecoveryBase;
  period: { from: string; to: string };
  // The period's records, already loaded for the sections.
  data: VisitData;
  // Who the viewer may see (null: everyone) and, on the executors' level, the TSM chosen.
  scope: Set<string> | null;
  person: string | null;
  hierarchy: Hierarchy | null;
  // The level's TSM rows (leadership: everyone's; managers: those in the scope).
  rows: TsmRow[];
  // The leadership's sections, for the tiles' change.
  sections: VisitSections | null;
  // Planned visits made, % by TSM code, when the route analysis gives it.
  attendance?: Map<string, number> | null;
}) {
  const { view, base, period, data, hierarchy } = input;
  if (view === "executor" && !input.person) return null;
  const lead = view !== "executor";
  // Leadership sees the whole picture; an executor only their own checks.
  const scope =
    view === "exec" ? null : view === "manager" ? input.scope : new Set([input.person!]);
  const before = view === "exec" ? previousPeriod(period) : null;
  const [earlier, routes, was] = await Promise.all([
    loadChecksBefore(recoveryFrom(before?.from ?? period.from), period.from),
    // A rep's order counts up to three days after the check.
    lead ? loadRoutes({ from: period.from, to: addDays(period.to, FOLLOW_UP_DAYS) }) : [],
    before ? loadVisitData(before) : null,
  ]);
  const checks = [...earlier, ...data.oos];
  const recovery = analyzeRecovery(checks, { ...period, baseline: base, scope });
  const followUp =
    lead && routes.length ? followUps(checks, routes, { ...period, hierarchy, scope }) : null;

  const allowed = input.scope ? new Set([...input.scope].map(titleKey)) : null;
  const attention = lead
    ? attentionList({
        rows: input.rows,
        recovery: recovery.byTsm,
        followUp: followUp?.byTsm,
        sales: Boolean(data.salesRange),
        attendance: input.attendance,
        hierarchy,
      }).map((row) => ({
        ...row,
        // Leadership sees everyone here, but opens only the TSMs of their own scope.
        canOpen: !allowed || allowed.has(titleKey(row.code)),
      }))
    : null;

  // The same shares for the period before, when it has any data.
  let trend = null;
  if (before && was && input.sections) {
    const hasData = was.suVisits.length + was.mv.length + was.oos.length > 0;
    const previous = hasData
      ? headline(
          visitSections(analyzeVisits(was), null, true),
          analyzeRecovery(checks, { ...before, baseline: base }),
        )
      : null;
    trend = { previous: before, changes: trendOf(headline(input.sections, recovery), previous) };
  }
  return {
    base,
    recovery,
    followUp,
    attention,
    // Whether the share of planned visits made was among the attention rules.
    attendance: Boolean(input.attendance),
    trend,
  };
}
export type ConnectInsights = NonNullable<Awaited<ReturnType<typeof connectInsights>>>;
