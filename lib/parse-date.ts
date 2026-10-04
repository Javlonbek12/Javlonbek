import { addDays, isDateString, startOfMonth, addMonths } from "./dates";

// Weekday words (Russian and Uzbek, Latin and Cyrillic), Monday = 0.
const WEEKDAYS: [RegExp, number][] = [
  [/^(пн|понедельник\S*|dushanba|душанба)$/, 0],
  [/^(вт|вторник\S*|seshanba|сешанба)$/, 1],
  [/^(ср|сред[ау]|chorshanba|чоршанба)$/, 2],
  [/^(чт|четверг\S*|payshanba|пайшанба)$/, 3],
  [/^(пт|пятниц[аеуы]|juma|жума)$/, 4],
  [/^(сб|суббот[аеуы]|shanba|шанба)$/, 5],
  [/^(вс|воскресень[еяю]|yakshanba|якшанба)$/, 6],
];

function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

// The next date (today included) that falls on the given weekday.
export function nextWeekday(today: string, weekday: number): string {
  return addDays(today, (weekday - weekdayIndex(today) + 7) % 7);
}

// Understands what people type when asked for a due date:
// "сегодня", "завтра", "ertaga", "пятница", "5.10", "05.10.2026", "2026-10-05", "+3".
export function parseUserDate(input: string, today: string): string | null {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/^(в|во|на|до)\s+/, "");
  if (["сегодня", "bugun", "бугун"].includes(text)) return today;
  if (["завтра", "ertaga", "эртага"].includes(text)) return addDays(today, 1);
  if (["послезавтра", "indinga", "индинга"].includes(text)) return addDays(today, 2);
  if (/^(конец месяца|oy oxiri)$/.test(text)) return addDays(addMonths(startOfMonth(today), 1), -1);
  for (const [re, day] of WEEKDAYS) if (re.test(text)) return nextWeekday(today, day);

  const plus = /^\+(\d{1,3})$/.exec(text);
  if (plus) return addDays(today, Number(plus[1]));
  if (isDateString(text)) return text;

  const dm = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/.exec(text);
  if (dm) {
    const year = dm[3] ? (dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : today.slice(0, 4);
    const date = `${year}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
    if (!isDateString(date)) return null;
    // Without a year, a date that already passed means next year.
    if (!dm[3] && date < today) return `${Number(year) + 1}${date.slice(4)}`;
    return date;
  }
  return null;
}
