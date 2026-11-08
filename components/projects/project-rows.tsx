import Link from "next/link";

import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { listProjectCards } from "@/modules/projects/service";

import { HealthBadge } from "./health-badge";
import { ProgressBar } from "./progress-bar";

type Card = Awaited<ReturnType<typeof listProjectCards>>[number];

export const projectColor = (index: number) => `var(--series-${(index % 8) + 1})`;

// The projects list: one row per project, readable with any number of projects and on a phone —
// the name and the lead, the done bar with the plan's tick and in words how far behind it is, the
// next milestone and the overdue tasks (a link to them).
export function ProjectRows({ cards }: { cards: Card[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {cards.map((card) => {
        const { stats } = card;
        const overdueHref = `/tasks?${new URLSearchParams({
          project: card.name,
          scope: "team",
          due: "overdue",
        })}`;
        return (
          <li
            key={card.id}
            className="bg-card shadow-card grid gap-x-6 gap-y-2 rounded-2xl border p-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)] md:items-center"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <Link
                href={`/projects/${card.id}`}
                className="flex min-w-0 items-center gap-2 font-semibold hover:underline"
              >
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ background: projectColor(card.color) }}
                  aria-hidden
                />
                <span className="truncate">{card.name}</span>
              </Link>
              <span className="text-muted-foreground truncate text-xs">
                {[card.lead && t("projects.leadName", { name: card.lead }), card.team]
                  .filter(Boolean)
                  .join(" · ") || t("projects.rows.noLead")}
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium tabular-nums">
                  {t("projects.rows.done", {
                    percent: stats.percent,
                    done: stats.done,
                    total: stats.total,
                  })}
                </span>
                {card.finishedAt ? null : <HealthBadge health={stats.health} />}
              </div>
              <ProgressBar
                percent={stats.percent}
                planned={stats.plannedPercent}
                late={stats.health === "late"}
                color={projectColor(card.color)}
                className="h-2"
              />
              <span className="text-muted-foreground text-xs">
                {stats.behind > 0
                  ? t("projects.rows.behind", { count: stats.behind })
                  : t("projects.rows.onPlan")}
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-1 text-xs">
              {card.next ? (
                <span className="truncate">
                  <span className="text-muted-foreground">{t("projects.next")}: </span>
                  {formatDay(card.next.date)} · {card.next.title}
                </span>
              ) : (
                <span className="text-muted-foreground">{t("projects.rows.noMilestone")}</span>
              )}
              {stats.overdue > 0 ? (
                <Link href={overdueHref} className="text-destructive font-medium hover:underline">
                  {t("projects.rows.overdue", { count: stats.overdue })}
                </Link>
              ) : (
                <span className="text-muted-foreground">{t("projects.rows.noOverdue")}</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
