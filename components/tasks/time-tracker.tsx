"use client";

import { Play, Square, Timer } from "lucide-react";
import { useEffect, useState } from "react";

import { startTimerAction, stopTimerAction } from "@/app/(app)/tasks/actions";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { clockText, durationText } from "@/modules/tasks/time-format";

// The task's time in its card: how much was spent (with the plan), the viewer's timer ticking,
// and who else has a timer running. Start / Stop are plain forms (they work without JavaScript).
export function TimeTracker({
  taskId,
  back,
  totalMinutes,
  running,
  estimateMinutes,
  canTrack,
  workingNow,
}: {
  taskId: string;
  back: string;
  // Finished entries only; the running timer is added here, live.
  totalMinutes: number;
  // When the viewer's timer started (ISO), or null.
  running: string | null;
  estimateMinutes: number | null;
  canTrack: boolean;
  // Others whose timer runs on the task now.
  workingNow: string[];
}) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  const elapsed = running ? Math.max(0, now - new Date(running).getTime()) : 0;
  const total = totalMinutes + Math.floor(elapsed / 60_000);
  const duration = (minutes: number) => {
    const d = durationText(minutes);
    return t(d.key, d.values);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5">
          <Timer className="text-primary size-4 shrink-0" aria-hidden />
          <span suppressHydrationWarning>
            {total > 0 || running ? duration(total) : t("tasks.time.none")}
          </span>
          {estimateMinutes !== null && estimateMinutes > 0 && (
            <span className="text-muted-foreground">
              {t("tasks.time.ofEstimate", { estimate: duration(estimateMinutes) })}
            </span>
          )}
        </span>
        {workingNow.length > 0 && (
          <span className="text-muted-foreground text-xs">
            {t("tasks.time.workingNow", { names: workingNow.join(", ") })}
          </span>
        )}
      </span>
      {canTrack && (
        <form action={running ? stopTimerAction : startTimerAction}>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="back" value={back} />
          {running ? (
            <Button type="submit" size="sm" variant="destructive" className="gap-1.5">
              <Square className="size-3.5" aria-hidden />
              {t("tasks.time.stop")}
              <span className="tabular-nums" suppressHydrationWarning>
                {clockText(elapsed)}
              </span>
            </Button>
          ) : (
            <Button type="submit" size="sm" variant="outline" className="gap-1.5">
              <Play className="size-3.5" aria-hidden />
              {t("tasks.time.start")}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
