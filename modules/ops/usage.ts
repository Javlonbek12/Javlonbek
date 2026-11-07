import { db } from "@/lib/db";
import { displayName } from "@/modules/core/users/display-name";

// Usage report for the owner (workflow Server → usage): who really works in the app and which
// modules are alive. Read-only. Counts only, no task titles or other contents.

export const DEFAULT_USAGE_DAYS = 30;

export type PersonUsage = {
  name: string;
  role: string;
  lastActiveAt: Date | null;
  // Everything below is for the period only.
  tasksCreated: number;
  // Team tasks given to the person (personal ones are in tasksCreated).
  tasksAssigned: number;
  tasksDone: number;
  comments: number;
  stepsDone: number;
  botDrafts: number;
  aiCalls: number;
};

export type ModuleUsage = {
  label: string;
  period: number;
  total: number;
};

export type UsageReport = {
  from: Date;
  to: Date;
  days: number;
  people: PersonUsage[];
  modules: ModuleUsage[];
  ai: { calls: number; inputTokens: number; outputTokens: number; failed: number };
  notifications: { created: number; sentToTelegram: number; read: number };
};

type CountBy = Record<string, number>;

function byKey<T extends { _count: { _all: number } }>(
  rows: T[],
  key: (row: T) => string | null | undefined,
): CountBy {
  const out: CountBy = {};
  for (const row of rows) {
    const k = key(row);
    if (k) out[k] = (out[k] ?? 0) + row._count._all;
  }
  return out;
}

function later(a: Date | null, b: Date | null | undefined): Date | null {
  if (!b) return a;
  if (!a) return b;
  return b > a ? b : a;
}

export async function collectUsage(
  now = new Date(),
  days = DEFAULT_USAGE_DAYS,
): Promise<UsageReport> {
  const from = new Date(now.getTime() - days * 86_400_000);
  const since = { gte: from, lte: now };

  const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });

  // Per person.
  const [
    created,
    assigned,
    done,
    comments,
    stepsDone,
    drafts,
    ai,
    lastActivity,
    lastTaskCreated,
    lastTaskAssigned,
    lastComment,
    lastDraft,
    lastAi,
  ] = await Promise.all([
    db.task.groupBy({ by: ["creatorId"], where: { createdAt: since }, _count: { _all: true } }),
    db.task.groupBy({
      by: ["assigneeId"],
      where: { isPersonal: false, createdAt: since },
      _count: { _all: true },
    }),
    db.task.groupBy({
      by: ["assigneeId"],
      where: { status: "DONE", completedAt: since },
      _count: { _all: true },
    }),
    db.comment.groupBy({ by: ["authorId"], where: { createdAt: since }, _count: { _all: true } }),
    db.taskStep.groupBy({ by: ["doneById"], where: { doneAt: since }, _count: { _all: true } }),
    db.botDraft.groupBy({ by: ["userId"], where: { createdAt: since }, _count: { _all: true } }),
    db.aiUsage.groupBy({ by: ["userId"], where: { createdAt: since }, _count: { _all: true } }),
    db.activityLog.groupBy({ by: ["actorId"], _max: { createdAt: true } }),
    db.task.groupBy({ by: ["creatorId"], _max: { updatedAt: true } }),
    db.task.groupBy({ by: ["assigneeId"], _max: { updatedAt: true } }),
    db.comment.groupBy({ by: ["authorId"], _max: { createdAt: true } }),
    db.botDraft.groupBy({ by: ["userId"], _max: { updatedAt: true } }),
    db.aiUsage.groupBy({ by: ["userId"], _max: { createdAt: true } }),
  ]);

  const lastBy = new Map<string, Date | null>();
  const note = (id: string | null, at: Date | null | undefined) => {
    if (id) lastBy.set(id, later(lastBy.get(id) ?? null, at));
  };
  for (const row of lastActivity) note(row.actorId, row._max.createdAt);
  for (const row of lastTaskCreated) note(row.creatorId, row._max.updatedAt);
  for (const row of lastTaskAssigned) note(row.assigneeId, row._max.updatedAt);
  for (const row of lastComment) note(row.authorId, row._max.createdAt);
  for (const row of lastDraft) note(row.userId, row._max.updatedAt);
  for (const row of lastAi) note(row.userId, row._max.createdAt);

  const createdBy = byKey(created, (r) => r.creatorId);
  const assignedBy = byKey(assigned, (r) => r.assigneeId);
  const doneBy = byKey(done, (r) => r.assigneeId);
  const commentsBy = byKey(comments, (r) => r.authorId);
  const stepsBy = byKey(stepsDone, (r) => r.doneById);
  const draftsBy = byKey(drafts, (r) => r.userId);
  const aiBy = byKey(ai, (r) => r.userId);

  const people: PersonUsage[] = users.map((u) => ({
    name: displayName(u),
    role: u.role,
    lastActiveAt: lastBy.get(u.id) ?? null,
    tasksCreated: createdBy[u.id] ?? 0,
    tasksAssigned: assignedBy[u.id] ?? 0,
    tasksDone: doneBy[u.id] ?? 0,
    comments: commentsBy[u.id] ?? 0,
    stepsDone: stepsBy[u.id] ?? 0,
    botDrafts: draftsBy[u.id] ?? 0,
    aiCalls: aiBy[u.id] ?? 0,
  }));

  // Per module: created in the period / all time.
  const pair = async (
    label: string,
    period: () => Promise<number>,
    total: () => Promise<number>,
  ): Promise<ModuleUsage> => ({ label, period: await period(), total: await total() });

  const modules = await Promise.all([
    pair(
      "Задачи командные",
      () => db.task.count({ where: { isPersonal: false, createdAt: since } }),
      () => db.task.count({ where: { isPersonal: false } }),
    ),
    pair(
      "Задачи личные",
      () => db.task.count({ where: { isPersonal: true, createdAt: since } }),
      () => db.task.count({ where: { isPersonal: true } }),
    ),
    pair(
      "Задачи выполнены",
      () => db.task.count({ where: { status: "DONE", completedAt: since } }),
      () => db.task.count({ where: { status: "DONE" } }),
    ),
    pair(
      "Шаги задач",
      () => db.taskStep.count({ where: { createdAt: since } }),
      () => db.taskStep.count(),
    ),
    pair(
      "Комментарии к задачам",
      () => db.comment.count({ where: { createdAt: since } }),
      () => db.comment.count(),
    ),
    pair(
      "Встречи",
      () => db.meeting.count({ where: { createdAt: since } }),
      () => db.meeting.count(),
    ),
    pair(
      "Минутки встреч",
      () => db.meetingNotes.count({ where: { updatedAt: since } }),
      () => db.meetingNotes.count(),
    ),
    pair(
      "Планограммы (версии)",
      () => db.planogram.count({ where: { createdAt: since } }),
      () => db.planogram.count(),
    ),
    pair(
      "Планограммы утверждены",
      () => db.planogram.count({ where: { approvedAt: since } }),
      () => db.planogram.count({ where: { approvedAt: { not: null } } }),
    ),
    pair(
      "Прайс-листы",
      () => db.priceList.count({ where: { createdAt: since } }),
      () => db.priceList.count(),
    ),
    pair(
      "Проекты",
      () => db.project.count({ where: { createdAt: since } }),
      () => db.project.count(),
    ),
    pair(
      "Контент-план: посты",
      () => db.contentPost.count({ where: { createdAt: since } }),
      () => db.contentPost.count(),
    ),
    pair(
      "Контент-план: отправлено",
      () => db.contentPost.count({ where: { sentAt: since } }),
      () => db.contentPost.count({ where: { sentAt: { not: null } } }),
    ),
    pair(
      "Connect: загрузки выгрузок",
      () => db.connectImport.count({ where: { createdAt: since } }),
      () => db.connectImport.count(),
    ),
    pair(
      "POSM: кампании",
      () => db.distOrder.count({ where: { createdAt: since } }),
      () => db.distOrder.count(),
    ),
    pair(
      "POSM: отгрузки",
      () => db.distShipment.count({ where: { createdAt: since } }),
      () => db.distShipment.count(),
    ),
    pair(
      "POSM: отметки о замене",
      () => db.distReplacement.count({ where: { updatedAt: since } }),
      () => db.distReplacement.count(),
    ),
  ]);

  const [aiRows, aiFailed, notifCreated, notifSent, notifRead] = await Promise.all([
    db.aiUsage.aggregate({
      where: { createdAt: since },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    db.aiUsage.count({ where: { createdAt: since, ok: false } }),
    db.notification.count({ where: { createdAt: since } }),
    db.notification.count({ where: { createdAt: since, sentToTelegramAt: { not: null } } }),
    db.notification.count({ where: { createdAt: since, readAt: { not: null } } }),
  ]);
  return {
    from,
    to: now,
    days,
    people,
    modules,
    ai: {
      calls: aiRows._count._all,
      inputTokens: aiRows._sum.inputTokens ?? 0,
      outputTokens: aiRows._sum.outputTokens ?? 0,
      failed: aiFailed,
    },
    notifications: { created: notifCreated, sentToTelegram: notifSent, read: notifRead },
  };
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: "владелец",
  MANAGER: "руководитель",
  MEMBER: "сотрудник",
  LAWYER: "юрист",
};

const dateOf = (d: Date) => d.toISOString().slice(0, 10);

function daysAgo(at: Date | null, now: Date): string {
  if (!at) return "не заходил(а)";
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return `${days} дн. назад`;
}

function pad(value: string | number, width: number): string {
  const text = String(value);
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

// Plain-language report for the owner. Pure: tested without the database.
export function formatUsage(report: UsageReport): string {
  const lines: string[] = [];
  lines.push(
    `Использование Assistant за ${report.days} дн. (${dateOf(report.from)} — ${dateOf(report.to)})`,
  );
  lines.push("");

  lines.push("Люди (за период; «последнее действие» — за всё время):");
  const people = [...report.people].sort((a, b) => {
    const scoreA = a.tasksCreated + a.tasksAssigned + a.comments + a.stepsDone + a.botDrafts;
    const scoreB = b.tasksCreated + b.tasksAssigned + b.comments + b.stepsDone + b.botDrafts;
    return scoreB - scoreA || a.name.localeCompare(b.name, "ru");
  });
  const nameWidth = Math.max(
    4,
    ...people.map((p) => `${p.name} (${ROLE_LABEL[p.role] ?? p.role})`.length),
  );
  lines.push(
    `  ${pad("Кто", nameWidth)}  поставил  получил  закрыл  коммент.  шаги  бот  ИИ   последнее действие`,
  );
  for (const p of people) {
    const who = `${p.name} (${ROLE_LABEL[p.role] ?? p.role})`;
    lines.push(
      `  ${pad(who, nameWidth)}  ${pad(p.tasksCreated, 8)}  ${pad(p.tasksAssigned, 7)}  ${pad(p.tasksDone, 6)}  ${pad(p.comments, 8)}  ${pad(p.stepsDone, 4)}  ${pad(p.botDrafts, 3)}  ${pad(p.aiCalls, 3)}  ${daysAgo(p.lastActiveAt, report.to)}`,
    );
  }
  const active = people.filter(
    (p) => p.tasksCreated + p.tasksAssigned + p.comments + p.stepsDone + p.botDrafts > 0,
  );
  const silent = people.filter((p) => !active.includes(p));
  lines.push(
    `  Итого: активны ${active.length} из ${people.length}` +
      (silent.length ? `; без действий за период: ${silent.map((p) => p.name).join(", ")}` : ""),
  );
  lines.push("");

  lines.push("Разделы (создано за период / всего):");
  const labelWidth = Math.max(...report.modules.map((m) => m.label.length));
  for (const m of report.modules) {
    const mark = m.period > 0 ? "●" : "○";
    lines.push(`  ${mark} ${pad(m.label, labelWidth)}  ${pad(m.period, 5)} / ${m.total}`);
  }
  const alive = report.modules.filter((m) => m.period > 0).length;
  lines.push(
    `  Живых разделов за период: ${alive} из ${report.modules.length} (● есть движение, ○ тишина)`,
  );
  lines.push("");

  lines.push("Бот и ИИ за период:");
  lines.push(
    `  Обращений к ИИ: ${report.ai.calls} (ошибок ${report.ai.failed}), токены: ${report.ai.inputTokens} на вход, ${report.ai.outputTokens} на выход`,
  );
  lines.push(`  Карточек задач из бота: ${people.reduce((s, p) => s + p.botDrafts, 0)}`);
  lines.push("");

  lines.push("Уведомления за период:");
  lines.push(
    `  Создано ${report.notifications.created}, ушло в Telegram ${report.notifications.sentToTelegram}, прочитано в приложении ${report.notifications.read}`,
  );
  return lines.join("\n");
}

export async function usageReport(now = new Date(), days = DEFAULT_USAGE_DAYS) {
  return formatUsage(await collectUsage(now, days));
}
