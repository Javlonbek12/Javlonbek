"use client";

import { Square, Timer, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { stopRunningTimerAction } from "@/app/(app)/timer-actions";
import { useT } from "@/components/locale-provider";
import { ForgottenTimer, TIMER_TONE, useTimer } from "@/components/timer-pill";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RunningTimer } from "@/modules/tasks/time";

// First thing on «Сегодня» while a timer runs (the header pill hides there): what the time is
// going to, and «Остановить». A forgotten one asks «Забыли остановить?» with «Остановить» and
// «Исправить время».
export function TimerCard({ timer }: { timer: RunningTimer }) {
  const t = useT();
  const { clock, minutes, forgotten } = useTimer(timer);
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-4",
        TIMER_TONE,
        forgotten && "border-amber-400 dark:border-amber-600",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
            {forgotten ? (
              <TriangleAlert className="size-5" />
            ) : (
              <Timer className="size-5 animate-pulse" />
            )}
          </span>
          <Link href={`/?task=${timer.taskId}`} className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs font-medium">{t("home.today.timer")}</span>
            <span className="line-clamp-2 font-semibold hover:underline">{timer.title}</span>
          </Link>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-2xl font-semibold tabular-nums" suppressHydrationWarning>
            {clock}
          </span>
          {!forgotten && (
            <form action={stopRunningTimerAction}>
              <input type="hidden" name="taskId" value={timer.taskId} />
              <Button type="submit" className="bg-amber-600 text-white hover:bg-amber-700">
                <Square className="size-3.5 fill-current" />
                {t("home.today.stop")}
              </Button>
            </form>
          )}
        </div>
      </div>
      {forgotten && <ForgottenTimer timer={timer} minutes={minutes} />}
    </section>
  );
}
