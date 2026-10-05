import Link from "next/link";
import type { ReactNode } from "react";

import { Ring } from "@/components/dashboard/ring";
import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { listProjectCards } from "@/modules/projects/service";

import { HealthBadge } from "./health-badge";

type Card = Awaited<ReturnType<typeof listProjectCards>>[number];

export const projectColor = (index: number) => `var(--series-${(index % 8) + 1})`;
// Aqua, yellow and magenta are too light for white text.
const darkText = (index: number) => [2, 3, 4].includes(index % 8);

// Severity shades of the project's colour: the more important, the stronger.
const SHADES = [1, 0.75, 0.5, 0.3];

function Dates({ card }: { card: Card }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      <dt className="text-muted-foreground">{t("projects.board.start")}</dt>
      <dd className="font-medium">{card.range ? formatDay(card.range.from) : "—"}</dd>
      <dt className="text-muted-foreground">{t("projects.board.end")}</dt>
      <dd className="font-medium">{card.range ? formatDay(card.range.to) : "—"}</dd>
    </dl>
  );
}

function Progress({ card }: { card: Card }) {
  const { stats } = card;
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <Ring percent={stats.percent} color={projectColor(card.color)} />
      <span className="text-muted-foreground text-xs">
        {t("projects.board.inWork", {
          active: stats.inProgress,
          done: stats.done,
          total: stats.total,
        })}
      </span>
      <HealthBadge health={stats.health} />
    </div>
  );
}

function PlanFact({ card, max, compact }: { card: Card; max: number; compact?: boolean }) {
  const color = projectColor(card.color);
  const bars = [
    { key: "plan", value: card.stats.plannedDone, opacity: 0.4 },
    { key: "fact", value: card.stats.done, opacity: 1 },
  ] as const;
  return (
    <div className={cn("flex items-end justify-center", compact ? "h-24 gap-2" : "h-28 gap-4")}>
      {bars.map((bar) => (
        <div
          key={bar.key}
          className={cn("flex flex-col items-center gap-1", compact ? "w-9" : "w-12")}
        >
          <span className="text-xs font-semibold">{bar.value}</span>
          <div
            className="w-full rounded-t-[4px]"
            style={{
              height: `${Math.max(2, (bar.value / max) * (compact ? 52 : 64))}px`,
              background: color,
              opacity: bar.opacity,
            }}
          />
          <span className="text-muted-foreground text-[11px]">
            {t(`projects.board.${bar.key}`)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Problems({ card, max }: { card: Card; max: number }) {
  const color = projectColor(card.color);
  return (
    <div className="flex flex-col gap-1 text-xs">
      {card.problems.map((row, i) => (
        <div key={row.priority} className="grid grid-cols-[4.5rem_1fr_1.5rem] items-center gap-2">
          <span className="text-muted-foreground">{t(`tasks.priority.${row.priority}`)}</span>
          <span className="bg-muted h-2 rounded-full">
            {row.count > 0 && (
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${(row.count / max) * 100}%`,
                  background: color,
                  opacity: SHADES[i],
                }}
              />
            )}
          </span>
          <span className={cn("text-right", row.count > 0 && "font-semibold")}>{row.count}</span>
        </div>
      ))}
    </div>
  );
}

function Next({ card }: { card: Card }) {
  if (!card.next)
    return <span className="text-muted-foreground text-xs">{t("projects.board.none")}</span>;
  const { next } = card;
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <span className="line-clamp-2 font-medium" title={next.title}>
        ◆ {next.title}
      </span>
      <span className={next.daysLeft < 0 ? "text-destructive" : "text-muted-foreground"}>
        {formatDay(next.date)} ·{" "}
        {next.daysLeft === 0
          ? t("projects.today")
          : next.daysLeft > 0
            ? t("projects.inDays", { count: next.daysLeft })
            : t("projects.lateDays", { count: -next.daysLeft })}
      </span>
    </div>
  );
}

function Header({ card, className }: { card: Card; className?: string }) {
  return (
    <Link
      href={`/projects/${card.id}`}
      className={cn(
        "flex flex-col gap-0.5 rounded-t-xl px-3 py-2.5 hover:opacity-90",
        darkText(card.color) ? "text-black/85" : "text-white",
        className,
      )}
      style={{ background: projectColor(card.color) }}
    >
      <span className="truncate font-semibold">{card.name}</span>
      <span className="truncate text-xs opacity-85">
        {[card.team, card.lead].filter(Boolean).join(" · ") || " "}
      </span>
    </Link>
  );
}

const ROWS = ["dates", "progress", "planFact", "problems", "next"] as const;
const ROW_HEIGHT: Record<(typeof ROWS)[number], string> = {
  dates: "h-16",
  progress: "h-44",
  planFact: "h-32",
  problems: "h-28",
  next: "h-20",
};

// The portfolio board: one column per project (colour = the project), the same rows for each,
// so projects compare at a glance. On phones every project is a card with the same rows.
export function Portfolio({ cards }: { cards: Card[] }) {
  const planMax = Math.max(1, ...cards.flatMap((c) => [c.stats.plannedDone, c.stats.done]));
  const problemMax = Math.max(1, ...cards.flatMap((c) => c.problems.map((p) => p.count)));
  const cell = (card: Card, row: (typeof ROWS)[number]): ReactNode =>
    row === "dates" ? (
      <Dates card={card} />
    ) : row === "progress" ? (
      <Progress card={card} />
    ) : row === "planFact" ? (
      <PlanFact card={card} max={planMax} />
    ) : row === "problems" ? (
      <Problems card={card} max={problemMax} />
    ) : (
      <Next card={card} />
    );

  return (
    <>
      {/* Phones: one compact card per project. */}
      <div className="flex flex-col gap-3 md:hidden">
        {cards.map((card) => (
          <div key={card.id} className="bg-card rounded-xl border">
            <Header card={card} />
            <div className="flex items-center gap-3 p-3">
              <Ring percent={card.stats.percent} color={projectColor(card.color)} size={76} />
              <div className="flex min-w-0 flex-col gap-1.5">
                <Dates card={card} />
                <span className="text-muted-foreground text-xs">
                  {t("projects.board.inWork", {
                    active: card.stats.inProgress,
                    done: card.stats.done,
                    total: card.stats.total,
                  })}
                </span>
                <div>
                  <HealthBadge health={card.stats.health} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-3 border-t p-3">
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-[11px] font-medium uppercase">
                  {t("projects.board.rows.planFact")}
                </span>
                <PlanFact card={card} max={planMax} compact />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-muted-foreground text-[11px] font-medium uppercase">
                  {t("projects.board.rows.problems")}
                </span>
                <Problems card={card} max={problemMax} />
              </div>
            </div>
            <div className="flex flex-col gap-1 border-t p-3">
              <span className="text-muted-foreground text-[11px] font-medium uppercase">
                {t("projects.board.rows.next")}
              </span>
              <Next card={card} />
            </div>
          </div>
        ))}
      </div>

      {/* Larger screens: rows of the board, projects side by side. */}
      <div className="hidden overflow-x-auto md:block">
        <div className="bg-card flex w-max min-w-full rounded-xl border">
          <div className="bg-muted/40 sticky left-0 z-10 w-36 shrink-0 rounded-l-xl border-r">
            <div className="h-[60px] border-b" />
            {ROWS.map((row) => (
              <div
                key={row}
                className={cn(
                  "flex items-center border-b px-3 text-sm font-semibold last:border-b-0",
                  ROW_HEIGHT[row],
                )}
                title={
                  row === "planFact"
                    ? t("projects.board.planHint")
                    : row === "problems"
                      ? t("projects.board.problemsHint")
                      : undefined
                }
              >
                {t(`projects.board.rows.${row}`)}
              </div>
            ))}
          </div>
          {cards.map((card) => (
            <div key={card.id} className="w-56 min-w-56 flex-1 border-r last:border-r-0">
              <div className="h-[60px] border-b">
                <Header card={card} className="h-full justify-center rounded-none" />
              </div>
              {ROWS.map((row) => (
                <div
                  key={row}
                  className={cn(
                    "flex flex-col justify-center border-b px-3 last:border-b-0",
                    ROW_HEIGHT[row],
                  )}
                >
                  {cell(card, row)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
