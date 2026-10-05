import { Check } from "lucide-react";

import { daysBetween, formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Milestone = { id: string; title: string; date: string; done: boolean; overdue: boolean };

// Key dates as steps on one line: passed, next (highlighted), later. Scrolls sideways on phones.
export function Milestones({ list, today }: { list: Milestone[]; today: string }) {
  const nextId = list.find((m) => !m.done)?.id;
  return (
    <ol className="flex overflow-x-auto pb-1">
      {list.map((m, i) => {
        const days = daysBetween(today, m.date);
        const next = m.id === nextId;
        return (
          <li
            key={m.id}
            className="relative flex min-w-36 flex-1 flex-col items-center px-2 text-center"
          >
            {/* The line to the neighbours. */}
            <span
              className={cn(
                "absolute top-3 right-1/2 left-0 h-0.5",
                i === 0 ? "hidden" : m.done ? "bg-emerald-500" : "bg-border",
              )}
            />
            <span
              className={cn(
                "absolute top-3 right-0 left-1/2 h-0.5",
                i === list.length - 1 ? "hidden" : m.done ? "bg-emerald-500" : "bg-border",
              )}
            />
            <span
              className={cn(
                "relative z-10 flex size-6 rotate-45 items-center justify-center rounded-sm border-2",
                m.done
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : m.overdue
                    ? "border-destructive bg-destructive text-white"
                    : next
                      ? "border-primary bg-background"
                      : "border-border bg-background",
              )}
              aria-hidden
            >
              {m.done && <Check className="size-3.5 -rotate-45" />}
            </span>
            <span className={cn("mt-2 text-xs", next ? "font-semibold" : "text-muted-foreground")}>
              {formatDay(m.date)}
            </span>
            <span
              className={cn("line-clamp-3 text-sm leading-tight", next && "font-semibold")}
              title={m.title}
            >
              {m.title}
            </span>
            <span
              className={cn(
                "mt-0.5 text-xs",
                m.overdue ? "text-destructive font-medium" : "text-muted-foreground",
              )}
            >
              {m.done
                ? t("projects.milestoneDone")
                : days === 0
                  ? t("projects.today")
                  : days > 0
                    ? t("projects.inDays", { count: days })
                    : t("projects.lateDays", { count: -days })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
