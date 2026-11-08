"use client";

import { Square, Timer, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { stopRunningTimerAction } from "@/app/(app)/timer-actions";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { clockText, durationText, isForgottenTimer } from "@/modules/tasks/time-format";
import type { RunningTimer } from "@/modules/tasks/time";

// The current time, ticking every second (for a running timer).
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// The running clock and whether the timer looks forgotten (more than 10 hours, or since an
// earlier day): then the app asks «Забыли остановить?» instead of a plain «Стоп».
export function useTimer(timer: RunningTimer) {
  const now = useNow();
  const elapsed = now - new Date(timer.startedAt).getTime();
  return {
    clock: clockText(elapsed),
    minutes: Math.max(0, Math.round(elapsed / 60_000)),
    forgotten: isForgottenTimer(timer.startedAt, new Date(now), timer.timezone),
  };
}

// Amber, not red: a running timer is work going on, red is kept for overdue and errors.
export const TIMER_TONE =
  "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100";
const STOP_BUTTON = "bg-amber-600 text-white hover:bg-amber-700";

// «Забыли остановить?»: stop with the time the timer counted, or say how long the work really
// took («Исправить время») — nothing is written down without the person seeing the number.
export function ForgottenTimer({ timer, minutes }: { timer: RunningTimer; minutes: number }) {
  const t = useT();
  const [fixing, setFixing] = useState(false);
  const counted = durationText(minutes);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-medium">
        {t("tasks.time.forgottenLong", { duration: t(counted.key, counted.values) })}
      </p>
      <div className="flex flex-wrap gap-2">
        <form action={stopRunningTimerAction}>
          <input type="hidden" name="taskId" value={timer.taskId} />
          <Button type="submit" size="sm" className={STOP_BUTTON}>
            <Square className="size-3 fill-current" />
            {t("tasks.time.stop")}
          </Button>
        </form>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={fixing}
          onClick={() => setFixing((value) => !value)}
        >
          {t("tasks.time.fix")}
        </Button>
      </div>
      {fixing && (
        <form action={stopRunningTimerAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="taskId" value={timer.taskId} />
          <span className="w-full text-xs">{t("tasks.time.fixHint")}</span>
          <label className="flex flex-col gap-1 text-xs">
            {t("tasks.time.hours")}
            <Input
              type="number"
              name="hours"
              min={0}
              max={24}
              defaultValue={0}
              className="bg-card w-20"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t("tasks.time.minutes")}
            <Input
              type="number"
              name="minutes"
              min={0}
              max={59}
              step={5}
              defaultValue={30}
              className="bg-card w-20"
            />
          </label>
          <Button type="submit" size="sm" className={STOP_BUTTON}>
            {t("tasks.time.fixSave")}
          </Button>
        </form>
      )}
    </div>
  );
}

// «⏱ 0:42:10 · task · Стоп» in the header of every page, so a running timer is never forgotten.
// Not on «Сегодня»: the timer card there is the one place for it. A forgotten timer shows
// «Забыли остановить?», which opens the choice under the pill.
export function TimerPill({ timer, className }: { timer: RunningTimer; className?: string }) {
  const t = useT();
  const pathname = usePathname();
  const { clock, minutes, forgotten } = useTimer(timer);
  const [open, setOpen] = useState(false);
  if (pathname === "/") return null;
  return (
    <div className={cn("relative min-w-0", className)}>
      <div
        className={cn(
          "flex min-w-0 items-center gap-1 rounded-full border py-1 pr-1 pl-3 text-sm",
          TIMER_TONE,
          forgotten && "border-amber-400 dark:border-amber-600",
        )}
      >
        <Link
          href={`/tasks/${timer.taskId}`}
          title={t("shell.timer.open")}
          className="flex min-w-0 items-center gap-2"
        >
          {forgotten ? (
            <TriangleAlert className="size-4 shrink-0" />
          ) : (
            <Timer className="size-4 shrink-0 animate-pulse" />
          )}
          <span className="font-semibold tabular-nums" suppressHydrationWarning>
            {clock}
          </span>
          <span className="truncate">{timer.title}</span>
        </Link>
        {forgotten ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
              STOP_BUTTON,
            )}
          >
            {t("tasks.time.forgotten")}
          </button>
        ) : (
          <form action={stopRunningTimerAction} className="shrink-0">
            <input type="hidden" name="taskId" value={timer.taskId} />
            <button
              type="submit"
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
                STOP_BUTTON,
              )}
            >
              <Square className="size-3 fill-current" />
              {t("shell.timer.stop")}
            </button>
          </form>
        )}
      </div>
      {forgotten && open && (
        <div
          className={cn(
            "absolute top-full right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border p-3 shadow-lg",
            TIMER_TONE,
          )}
        >
          <ForgottenTimer timer={timer} minutes={minutes} />
        </div>
      )}
    </div>
  );
}
