import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { TaskView } from "@/modules/tasks/service";
import { isLateWork } from "@/modules/tasks/today";

import { bold, escapeHtml } from "./keyboard";

// A numbered task line for the bot's lists (Telegram HTML): «2. Отчёт — 20 сент. 🔥». The 🔥 is
// left out where the whole block is «🔥 Просрочено».
export function taskLine(
  task: Pick<TaskView, "title" | "dueDate" | "status">,
  today: string,
  n: number,
  { fire = true }: { fire?: boolean } = {},
) {
  const late = fire && isLateWork(task, today) ? " 🔥" : "";
  const due = task.dueDate ? ` — ${formatDay(task.dueDate)}${late}` : "";
  return `${n}. ${escapeHtml(task.title)}${due}`;
}

// A list's bold header with the count: «<b>📋 На сегодня (3)</b>».
export const listHeader = (title: string, count: number) => bold(`${title} (${count})`);

export const moreLine = (count: number) => escapeHtml(t("bot.lists.more", { count }));
