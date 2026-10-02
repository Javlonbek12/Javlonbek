import { addDays, daysBetween, isDateString, startOfWeek } from "@/lib/dates";

export const TIMELINE_DAYS = 28;

export type TimelineBar = {
  id: string;
  startCol: number;
  span: number;
  clippedStart: boolean;
  clippedEnd: boolean;
};

// Column of the first day and how many day-columns the bar covers, clipped to the visible window.
export function layoutBars(
  tasks: { id: string; startDate: string | null; dueDate: string | null }[],
  from: string,
  days = TIMELINE_DAYS,
): TimelineBar[] {
  return tasks
    .filter((task) => task.dueDate !== null)
    .map((task) => {
      const start = daysBetween(from, task.startDate ?? task.dueDate!);
      const end = daysBetween(from, task.dueDate!);
      const startCol = Math.max(0, start);
      const endCol = Math.min(days - 1, end);
      return {
        id: task.id,
        startCol,
        span: Math.max(1, endCol - startCol + 1),
        clippedStart: start < 0,
        clippedEnd: end > days - 1,
      };
    });
}

// The window starts on a Monday, one week before the requested date.
export function timelineStart(
  params: Record<string, string | string[] | undefined>,
  today: string,
) {
  const date =
    typeof params.from === "string" && isDateString(params.from) ? params.from : addDays(today, -7);
  return startOfWeek(date);
}
