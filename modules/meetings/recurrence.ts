import { addDays } from "@/lib/dates";

export const MAX_OCCURRENCES = 52;

// Local start times ("YYYY-MM-DDTHH:mm") of a weekly series, up to `until` (a date, inclusive).
export function weeklyOccurrences(firstLocal: string, until: string | null): string[] {
  const date = firstLocal.slice(0, 10);
  const time = firstLocal.slice(11);
  if (!until) return [firstLocal];
  const result: string[] = [];
  for (let day = date; day <= until && result.length < MAX_OCCURRENCES; day = addDays(day, 7)) {
    result.push(`${day}T${time}`);
  }
  return result.length > 0 ? result : [firstLocal];
}
