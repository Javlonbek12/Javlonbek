import { addDays, formatDay } from "@/lib/dates";
import type { User } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { writeDigest, type DigestData } from "@/modules/ai/prompts";
import { AiError } from "@/modules/ai/run";
import { displayName } from "@/modules/core/users/display-name";
import { parseTaskFilters } from "@/modules/tasks/filters";
import { getTodayOverview, listTasks } from "@/modules/tasks/service";

export async function collectDigestData(user: User, today: string): Promise<DigestData> {
  const { dueToday, overdue, waiting } = await getTodayOverview(user, today);
  const tomorrow = addDays(today, 1);
  const upcoming = await listTasks(user, parseTaskFilters({ scope: "mine", due: "week" }), today);
  return {
    dueToday: dueToday.map((task) => ({ title: task.title })),
    overdue: overdue.map((task) => ({ title: task.title, dueDate: task.dueDate! })),
    waitingForDecision: waiting.map((task) => ({
      title: task.title,
      assignee: displayName(task.assignee),
      status: t(`tasks.status.${task.status}`),
    })),
    dueTomorrow: upcoming
      .filter((task) => task.dueDate === tomorrow)
      .map((task) => ({ title: task.title })),
  };
}

export function isDigestEmpty(data: DigestData) {
  return (
    data.dueToday.length +
      data.overdue.length +
      data.waitingForDecision.length +
      data.dueTomorrow.length ===
    0
  );
}

function section(header: string, lines: string[], limit = 5) {
  if (lines.length === 0) return [];
  const shown = lines.slice(0, limit).map((line) => `  • ${line}`);
  if (lines.length > limit) shown.push(t("digest.more", { count: lines.length - limit }));
  return [header, ...shown];
}

// Plain template, used when AI is off or fails.
export function digestTemplate(data: DigestData): string {
  return [
    ...section(
      t("digest.overdue", { count: data.overdue.length }),
      data.overdue.map((x) => `${x.title} (${formatDay(x.dueDate)})`),
    ),
    ...section(
      t("digest.dueToday", { count: data.dueToday.length }),
      data.dueToday.map((x) => x.title),
    ),
    ...section(
      t("digest.waiting", { count: data.waitingForDecision.length }),
      data.waitingForDecision.map((x) => `${x.title} — ${x.status}`),
    ),
    ...section(
      t("digest.tomorrow", { count: data.dueTomorrow.length }),
      data.dueTomorrow.map((x) => x.title),
    ),
  ].join("\n");
}

export type DigestWriter = (user: User, today: string, data: DigestData) => Promise<string>;

// AI text first; on any AI problem fall back to the template.
export const defaultDigestWriter: DigestWriter = async (user, today, data) => {
  try {
    return await writeDigest(user.id, today, data);
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return digestTemplate(data);
  }
};
