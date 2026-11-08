"use client";

import { Square, Timer } from "lucide-react";
import Link from "next/link";

import { stopRunningTimerAction } from "@/app/(app)/timer-actions";
import { useT } from "@/components/locale-provider";
import { useClock } from "@/components/timer-pill";
import type { RunningTimer } from "@/modules/tasks/time";

// First thing on «Сегодня» while a timer runs: what the time is going to, and «Остановить».
export function TimerCard({ timer }: { timer: RunningTimer }) {
  const t = useT();
  const clock = useClock(timer.startedAt);
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 sm:flex-row sm:items-center dark:border-red-900 dark:bg-red-950 dark:text-red-100">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white">
          <Timer className="size-5 animate-pulse" />
        </span>
        <Link href={`/tasks/${timer.taskId}`} className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs font-medium">{t("home.today.timer")}</span>
          <span className="line-clamp-2 font-semibold hover:underline">{timer.title}</span>
        </Link>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xl font-semibold tabular-nums" suppressHydrationWarning>
          {clock}
        </span>
        <form action={stopRunningTimerAction}>
          <input type="hidden" name="taskId" value={timer.taskId} />
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            <Square className="size-3.5 fill-current" />
            {t("home.today.stop")}
          </button>
        </form>
      </div>
    </section>
  );
}
