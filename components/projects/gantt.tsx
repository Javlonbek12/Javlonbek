import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { addDays, daysBetween, formatDay, fromDateString } from "@/lib/dates";
import { t, dateFormat } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ganttBar, type PhaseState, type ProjectTask } from "@/modules/projects/progress";
import { isOverdue } from "@/modules/tasks/today";

type Phase = {
  id: string | null;
  title: string | null;
  from: string | null;
  to: string | null;
  percent: number;
  state: PhaseState;
};

const ROW = "h-8";
const monthShort = {
  format: (date: Date) => dateFormat({ month: "short", timeZone: "UTC" }).format(date),
};

function taskColor(task: ProjectTask, today: string) {
  if (task.status === "DONE") return "bg-emerald-500";
  if (isOverdue(task, today)) return "bg-destructive";
  if (task.atRisk) return "bg-amber-500";
  if (task.status === "IN_PROGRESS" || task.status === "IN_REVIEW") return "bg-blue-500";
  return "bg-blue-500/40";
}

const PHASE_BORDER: Record<PhaseState, string> = {
  done: "border-emerald-500",
  late: "border-destructive",
  active: "border-blue-500",
  upcoming: "border-border",
  empty: "border-border",
};

// Phases with their tasks on a time scale. The labels stay put while the dates scroll sideways.
export function Gantt({
  phases,
  tasks,
  range,
  today,
}: {
  phases: Phase[];
  tasks: ProjectTask[];
  range: { from: string; to: string };
  today: string;
}) {
  const from = addDays(range.from, -2);
  const days = daysBetween(from, range.to) + 5;
  const px = Math.min(28, Math.max(6, Math.round(1000 / days)));
  const width = days * px;
  const todayLeft = daysBetween(from, today) * px + px / 2;
  const showToday = todayLeft > 0 && todayLeft < width;
  const months: { left: number; label: string }[] = [];
  for (let day = 0; day < days; day++) {
    const date = addDays(from, day);
    if (day === 0 || date.endsWith("-01"))
      months.push({ left: day * px, label: monthShort.format(fromDateString(date)) });
  }
  // The chart's first day is a label too, unless a month begins right after it.
  if (months.length > 1 && months[1]!.left < 40) months.shift();

  const grid = (
    <>
      {months.map((m) => (
        <span
          key={m.left}
          className="bg-border absolute top-0 bottom-0 w-px"
          style={{ left: m.left }}
        />
      ))}
      {showToday && (
        <span
          className="bg-primary/60 absolute top-0 bottom-0 z-[1] w-0.5"
          style={{ left: todayLeft }}
        />
      )}
    </>
  );
  const label =
    "bg-card sticky left-0 z-20 flex w-40 shrink-0 items-center gap-1 border-r px-2 md:w-64";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3 text-xs">
        {(
          [
            ["bg-emerald-500", "done"],
            ["bg-blue-500/40", "open"],
            ["bg-destructive", "late"],
            ["bg-amber-500", "risk"],
          ] as const
        ).map(([color, key]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={cn("h-2.5 w-4 rounded-sm", color)} />
            {t(`projects.gantt.${key}`)}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border text-xs">
        <div className="min-w-max">
          <div className={cn("flex border-b", ROW)}>
            <div className={label} />
            <div className="relative" style={{ width }}>
              {months.map((m) => (
                <span
                  key={m.left}
                  className="text-muted-foreground absolute top-2 pl-1"
                  style={{ left: m.left }}
                >
                  {m.label}
                </span>
              ))}
              {showToday && (
                <span
                  className="text-primary absolute bottom-0 -translate-x-1/2 font-medium"
                  style={{ left: todayLeft }}
                >
                  ▼
                </span>
              )}
            </div>
          </div>
          {phases.map((phase) => {
            const own = tasks.filter(
              (task) => task.phaseId === phase.id && task.status !== "CANCELLED",
            );
            const bar = ganttBar(phase, from);
            return (
              <details
                key={phase.id ?? "none"}
                className="group border-b last:border-b-0"
                open={phase.state === "late" || phase.state === "active"}
              >
                <summary
                  className={cn(
                    "flex cursor-pointer list-none",
                    ROW,
                    "[&::-webkit-details-marker]:hidden",
                  )}
                >
                  <div className={cn(label, "font-medium")}>
                    <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
                    <span className="truncate" title={phase.title ?? undefined}>
                      {phase.title ?? t("projects.phases.noPhase")}
                    </span>
                    <span className="text-muted-foreground ml-auto pl-1">{phase.percent}%</span>
                  </div>
                  <div className="bg-muted/30 relative" style={{ width }}>
                    {grid}
                    {bar && (
                      <span
                        className={cn(
                          "bg-muted absolute top-2 bottom-2 z-[2] overflow-hidden rounded border-2",
                          PHASE_BORDER[phase.state],
                        )}
                        style={{ left: bar.offset * px, width: bar.length * px }}
                        title={`${phase.title ?? ""} · ${formatDay(phase.from!)} – ${formatDay(phase.to!)} · ${phase.percent}%`}
                      >
                        <span
                          className="block h-full bg-emerald-500/70"
                          style={{ width: `${phase.percent}%` }}
                        />
                      </span>
                    )}
                  </div>
                </summary>
                {own.map((task) => {
                  const taskBar = ganttBar({ from: task.startDate, to: task.dueDate }, from);
                  const tip = [
                    task.code,
                    task.title,
                    task.dueDate &&
                      `${formatDay(task.startDate ?? task.dueDate)} – ${formatDay(task.dueDate)}`,
                    t(`tasks.status.${task.status}`),
                    task.responsible,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <div key={task.id} className={cn("flex border-t border-dashed", ROW)}>
                      <Link
                        href={`/tasks/${task.id}`}
                        className={cn(label, "pl-6 hover:underline")}
                        title={tip}
                      >
                        {task.code && (
                          <span className="text-muted-foreground shrink-0">{task.code}</span>
                        )}
                        <span
                          className={cn(
                            "truncate",
                            task.status === "DONE" && "text-muted-foreground line-through",
                          )}
                        >
                          {task.title}
                        </span>
                      </Link>
                      <div className="relative" style={{ width }}>
                        {grid}
                        {taskBar &&
                          (task.isMilestone ? (
                            <Link
                              href={`/tasks/${task.id}`}
                              title={tip}
                              className={cn(
                                "absolute top-1/2 z-[2] size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]",
                                taskColor(task, today),
                              )}
                              style={{ left: (taskBar.offset + taskBar.length / 2) * px }}
                            />
                          ) : (
                            <Link
                              href={`/tasks/${task.id}`}
                              title={tip}
                              className={cn(
                                "absolute top-2.5 bottom-2.5 z-[2] rounded-sm",
                                taskColor(task, today),
                                task.openBlockers > 0 && "ring-1 ring-amber-500",
                              )}
                              style={{
                                left: taskBar.offset * px + 1,
                                width: Math.max(4, taskBar.length * px - 2),
                              }}
                            />
                          ))}
                      </div>
                    </div>
                  );
                })}
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}
