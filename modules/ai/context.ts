import { addDays, addMonths, fromDateString, startOfMonth, startOfWeek } from "@/lib/dates";

const RU_WEEKDAYS = [
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
  "воскресенье",
];
const UZ_WEEKDAYS = [
  "dushanba",
  "seshanba",
  "chorshanba",
  "payshanba",
  "juma",
  "shanba",
  "yakshanba",
];

export type PromptContext = {
  today: string;
  timezone: string;
  speakerName: string;
  teamNames: string[];
  projects: string[];
};

function weekday(date: string) {
  return (fromDateString(date).getUTCDay() + 6) % 7;
}

// A small calendar so the model resolves "в пятницу", "через неделю", "oy oxirigacha"
// by lookup instead of date arithmetic.
export function calendarBlock(today: string): string {
  const lines = Array.from({ length: 21 }, (_, i) => {
    const date = addDays(today, i);
    const d = weekday(date);
    const label = i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : "";
    return `${date} ${RU_WEEKDAYS[d]} / ${UZ_WEEKDAYS[d]}${label}`;
  });
  const endOfWeek = addDays(startOfWeek(today), 6);
  const endOfMonth = addDays(addMonths(startOfMonth(today), 1), -1);
  return [
    ...lines,
    `End of this week (Sunday): ${endOfWeek}`,
    `End of this month: ${endOfMonth}`,
    `In one week: ${addDays(today, 7)}`,
  ].join("\n");
}

export function contextBlock(ctx: PromptContext): string {
  return [
    `Today: ${ctx.today} (${RU_WEEKDAYS[weekday(ctx.today)]}), timezone ${ctx.timezone}.`,
    `The speaker is: ${ctx.speakerName}.`,
    `Team members: ${ctx.teamNames.join(", ") || "(none)"}.`,
    `Known projects: ${ctx.projects.join(", ") || "(none)"}.`,
    "",
    "Calendar:",
    calendarBlock(ctx.today),
  ].join("\n");
}
