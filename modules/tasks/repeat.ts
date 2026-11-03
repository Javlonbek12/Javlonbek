import { z } from "zod";

import {
  addDays,
  addMonths,
  daysBetween,
  fromDateString,
  isDateString,
  startOfWeek,
} from "@/lib/dates";
import { RepeatFrequency } from "@/lib/generated/prisma/enums";

// Repeating tasks: when the next copy is due. Dates are calendar dates ("YYYY-MM-DD").

export const repeatInputSchema = z.object({
  frequency: z.enum(RepeatFrequency),
  interval: z.number().int().min(1).max(99),
  // 1 = Monday … 7 = Sunday.
  weekdays: z.array(z.number().int().min(1).max(7)).max(7),
  monthDay: z.number().int().min(1).max(31).nullable(),
  until: z
    .string()
    .nullable()
    .refine((v) => v === null || isDateString(v), "invalid date"),
});

export type RepeatInput = z.input<typeof repeatInputSchema>;

export type RepeatRule = z.output<typeof repeatInputSchema> & {
  // The due date of the first task.
  anchor: string;
};

// The day of the week: 1 = Monday … 7 = Sunday.
export function weekdayOf(value: string): number {
  return ((fromDateString(value).getUTCDay() + 6) % 7) + 1;
}

function daysInMonth(monthStart: string): number {
  return daysBetween(monthStart, addMonths(monthStart, 1));
}

// The given day of the month starting at monthStart; a shorter month gets its last day.
function dayOfMonth(monthStart: string, day: number): string {
  return addDays(monthStart, Math.min(day, daysInMonth(monthStart)) - 1);
}

function nextByMonths(anchor: string, stepMonths: number, day: number, after: string): string {
  const first = `${anchor.slice(0, 7)}-01`;
  for (let k = 0; k < 2000; k++) {
    const date = dayOfMonth(addMonths(first, k * stepMonths), day);
    if (date > after) return date;
  }
  throw new Error("No next date");
}

// The first due date of the series after `after` (itself a due date of the series or later),
// or null when the series has ended.
export function nextOccurrence(rule: RepeatRule, after: string): string | null {
  const { anchor, interval } = rule;
  let next: string;
  switch (rule.frequency) {
    case "DAILY": {
      const steps = Math.max(0, Math.floor(daysBetween(anchor, after) / interval)) + 1;
      next = addDays(anchor, steps * interval);
      break;
    }
    case "WEEKLY": {
      const days = rule.weekdays.length ? rule.weekdays : [weekdayOf(anchor)];
      const firstWeek = startOfWeek(anchor);
      next = "";
      for (let day = addDays(after, 1); !next; day = addDays(day, 1)) {
        const week = daysBetween(firstWeek, startOfWeek(day)) / 7;
        if (week >= 0 && week % interval === 0 && days.includes(weekdayOf(day))) next = day;
      }
      break;
    }
    case "MONTHLY":
      next = nextByMonths(anchor, interval, rule.monthDay ?? Number(anchor.slice(8)), after);
      break;
    case "YEARLY":
      next = nextByMonths(anchor, interval * 12, Number(anchor.slice(8)), after);
      break;
  }
  return rule.until && next > rule.until ? null : next;
}

// The day a copy is made: its start date (the same distance before the due date as in the task
// it is copied from), or its due date.
export function copyDay(dueDate: string, span: number): string {
  return addDays(dueDate, -span);
}
