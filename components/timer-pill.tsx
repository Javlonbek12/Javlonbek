"use client";

import { Square, Timer } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { stopRunningTimerAction } from "@/app/(app)/timer-actions";
import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import { clockText } from "@/modules/tasks/time-format";
import type { RunningTimer } from "@/modules/tasks/running-timer";

// The running clock: ticks every second from the timer's start.
export function useClock(startedAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return clockText(now - new Date(startedAt).getTime());
}

// «⏱ 0:42:10 · task · Стоп» in the header of every page, so a running timer is never forgotten.
export function TimerPill({ timer, className }: { timer: RunningTimer; className?: string }) {
  const t = useT();
  const clock = useClock(timer.startedAt);
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-full border border-red-200 bg-red-50 py-1 pr-1 pl-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
        className,
      )}
    >
      <Link
        href={`/tasks/${timer.taskId}`}
        title={t("shell.timer.open")}
        className="flex min-w-0 items-center gap-2"
      >
        <Timer className="size-4 shrink-0 animate-pulse" />
        <span className="font-semibold tabular-nums" suppressHydrationWarning>
          {clock}
        </span>
        <span className="truncate">{timer.title}</span>
      </Link>
      <form action={stopRunningTimerAction} className="shrink-0">
        <input type="hidden" name="taskId" value={timer.taskId} />
        <button
          type="submit"
          className="flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700"
        >
          <Square className="size-3 fill-current" />
          {t("shell.timer.stop")}
        </button>
      </form>
    </div>
  );
}
