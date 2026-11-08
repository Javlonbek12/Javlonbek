import { addDays, formatDay, todayInTimezone } from "@/lib/dates";
import type { User } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { writeDigest, type DigestData } from "@/modules/ai/prompts";
import { AiError } from "@/modules/ai/run";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { parseTaskFilters } from "@/modules/tasks/filters";
import {
  getTodayOverview,
  listDecisions,
  listOverdueAtDoers,
  listTasks,
  type Decisions,
} from "@/modules/tasks/service";
import { getRunningTimer } from "@/modules/tasks/time";

// «Ждут вашего решения» as lines: the same list as the «Ждут решения» tab (listDecisions), so the
// digest, the tab and the bot's /pending count alike.
export function decisionLines(decisions: Decisions) {
  return [
    ...decisions.approve.map((task) => ({
      title: task.title,
      status: t(`tasks.status.${task.status}`),
    })),
    ...decisions.accept.map((task) => ({
      title: task.title,
      status: t(`tasks.status.${task.status}`),
    })),
    ...decisions.remove.map((task) => ({ title: task.title, status: t("digest.removeRequest") })),
    ...decisions.coAssignees.map((r) => ({
      title: r.task.title,
      status: t("digest.coRequest", { name: r.name }),
    })),
  ];
}

export async function collectDigestData(user: User, today: string): Promise<DigestData> {
  const [{ dueToday, overdue }, decisions, atDoers, timer, { timezone }] = await Promise.all([
    getTodayOverview(user, today),
    listDecisions(user),
    listOverdueAtDoers(user, today),
    getRunningTimer(user.id),
    getSettings(user.id),
  ]);
  const tomorrow = addDays(today, 1);
  const upcoming = await listTasks(user, parseTaskFilters({ scope: "mine", due: "week" }), today);
  // A timer started on an earlier day and still running: likely forgotten.
  const timerDay = timer ? todayInTimezone(timezone, timer.startedAt) : null;
  return {
    dueToday: dueToday.map((task) => ({ title: task.title })),
    overdue: overdue.map((task) => ({ title: task.title, dueDate: task.dueDate! })),
    overdueAtDoers: atDoers.map((task) => ({
      title: task.title,
      dueDate: task.dueDate!,
      assignee: displayName(task.assignee),
    })),
    waitingForDecision: decisionLines(decisions),
    dueTomorrow: upcoming
      .filter((task) => task.dueDate === tomorrow && task.status !== "IN_REVIEW")
      .map((task) => ({ title: task.title })),
    runningTimer:
      timer && timerDay && timerDay < today
        ? { title: timer.title, since: formatDay(timerDay) }
        : null,
  };
}

export function isDigestEmpty(data: DigestData) {
  return (
    data.dueToday.length +
      data.overdue.length +
      data.overdueAtDoers.length +
      data.waitingForDecision.length +
      data.dueTomorrow.length ===
      0 && !data.runningTimer
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
      t("digest.overdueAtDoers", { count: data.overdueAtDoers.length }),
      data.overdueAtDoers.map((x) => `${x.title} — ${x.assignee} (${formatDay(x.dueDate)})`),
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
    ...(data.runningTimer
      ? [
          t("digest.runningTimer", {
            title: data.runningTimer.title,
            since: data.runningTimer.since,
          }),
        ]
      : []),
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
