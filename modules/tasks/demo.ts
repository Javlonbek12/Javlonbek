import { db } from "@/lib/db";
import { addDays, fromDateString, startOfWeek, todayInTimezone } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import type { TaskPriority, TaskStatus } from "@/lib/generated/prisma/client";

// Test data for trying the app on a real server: test employees and tasks around today.
// Everything is marked so it can be removed in one go: tasks and plans carry DEMO_PROJECT,
// test employees use Telegram ids from DEMO_TELEGRAM_BASE and have no bot chat (no messages).
export const DEMO_PROJECT = "Тестовые данные";
const DEMO_TELEGRAM_BASE = 9_000_000_000n;
const PEOPLE = [
  {
    key: "boss",
    firstName: "Тестовый руководитель",
    role: "MANAGER",
    position: "Тестовая должность: руководитель",
  },
  {
    key: "e1",
    firstName: "Тестовый сотрудник 1",
    role: "MEMBER",
    position: "Тестовая должность: мерчендайзер",
  },
  {
    key: "e2",
    firstName: "Тестовый сотрудник 2",
    role: "MEMBER",
    position: "Тестовая должность: аналитик",
  },
  {
    key: "e3",
    firstName: "Тестовый сотрудник 3",
    role: "MEMBER",
    position: "Тестовая должность: торговый представитель",
  },
] as const;
type Who = "owner" | (typeof PEOPLE)[number]["key"];

type DemoTask = {
  title: string;
  creator: Who;
  assignee: Who;
  status: TaskStatus;
  // Days from today; null = no due date.
  due: number | null;
  priority?: TaskPriority;
  hours?: number;
  personal?: boolean;
  // For DONE tasks: completed this many days from today (negative = in the past).
  doneAt?: number;
  inPlan?: boolean;
};

const TASKS: DemoTask[] = [
  // Overdue
  {
    title: "Тест: сверить остатки на складе",
    creator: "owner",
    assignee: "e1",
    status: "IN_PROGRESS",
    due: -3,
    priority: "HIGH",
    hours: 3,
  },
  {
    title: "Тест: отчёт по продажам за неделю",
    creator: "owner",
    assignee: "e2",
    status: "APPROVED",
    due: -1,
    hours: 2,
  },
  {
    title: "Тест: позвонить тестовому дистрибьютору",
    creator: "owner",
    assignee: "owner",
    status: "APPROVED",
    due: -2,
    priority: "HIGH",
  },
  // Today
  {
    title: "Тест: проверить ценники в тестовом магазине",
    creator: "boss",
    assignee: "e1",
    status: "IN_PROGRESS",
    due: 0,
    hours: 2,
    inPlan: true,
  },
  {
    title: "Тест: подготовить презентацию для встречи",
    creator: "owner",
    assignee: "owner",
    status: "IN_PROGRESS",
    due: 0,
    priority: "HIGH",
    hours: 2,
  },
  {
    title: "Тест: согласовать график выкладки",
    creator: "owner",
    assignee: "e3",
    status: "APPROVED",
    due: 0,
    hours: 1,
  },
  // Waiting for the owner: approval and acceptance
  {
    title: "Тест: заказать новые POSM-материалы",
    creator: "e1",
    assignee: "e1",
    status: "PENDING_APPROVAL",
    due: 3,
    hours: 1,
  },
  {
    title: "Тест: обучить нового сотрудника выкладке",
    creator: "boss",
    assignee: "e3",
    status: "PENDING_APPROVAL",
    due: 5,
    hours: 4,
  },
  {
    title: "Тест: собрать фотоотчёт с точек",
    creator: "owner",
    assignee: "e1",
    status: "IN_REVIEW",
    due: 1,
    hours: 3,
    inPlan: true,
  },
  {
    title: "Тест: обновить базу клиентов",
    creator: "owner",
    assignee: "e2",
    status: "IN_REVIEW",
    due: 2,
    hours: 2,
  },
  // This week and later
  {
    title: "Тест: проанализировать продажи новинок",
    creator: "owner",
    assignee: "e2",
    status: "APPROVED",
    due: 2,
    priority: "HIGH",
    hours: 4,
    inPlan: true,
  },
  {
    title: "Тест: объехать тестовые торговые точки",
    creator: "boss",
    assignee: "e3",
    status: "IN_PROGRESS",
    due: 4,
    hours: 6,
    inPlan: true,
  },
  {
    title: "Тест: подготовить планограмму для акции",
    creator: "owner",
    assignee: "boss",
    status: "APPROVED",
    due: 6,
    hours: 3,
  },
  {
    title: "Тест: квартальный отчёт",
    creator: "owner",
    assignee: "boss",
    status: "APPROVED",
    due: 12,
    priority: "HIGH",
    hours: 8,
  },
  {
    title: "Тест: план закупок на следующий месяц",
    creator: "owner",
    assignee: "e2",
    status: "APPROVED",
    due: 18,
    hours: 5,
  },
  {
    title: "Тест: идея — программа лояльности",
    creator: "owner",
    assignee: "owner",
    status: "DRAFT",
    due: null,
    priority: "LOW",
  },
  // Personal (visible only to the owner)
  {
    title: "Тест (личная): записаться к врачу",
    creator: "owner",
    assignee: "owner",
    status: "APPROVED",
    due: 1,
    personal: true,
  },
  // Done: on time and late, for the employee statistics
  {
    title: "Тест: инвентаризация витрины",
    creator: "owner",
    assignee: "e1",
    status: "DONE",
    due: -6,
    doneAt: -7,
    hours: 2,
  },
  {
    title: "Тест: отчёт по конкурентам",
    creator: "owner",
    assignee: "e2",
    status: "DONE",
    due: -10,
    doneAt: -8,
    hours: 3,
  },
  {
    title: "Тест: расстановка новинок",
    creator: "boss",
    assignee: "e3",
    status: "DONE",
    due: -4,
    doneAt: -4,
    hours: 2,
  },
  {
    title: "Тест: проверка сроков годности",
    creator: "owner",
    assignee: "e1",
    status: "DONE",
    due: -15,
    doneAt: -16,
    hours: 1,
  },
  {
    title: "Тест: старая отменённая задача",
    creator: "owner",
    assignee: "e3",
    status: "CANCELLED",
    due: -9,
  },
];

export async function hasDemoData() {
  return (await db.task.count({ where: { project: DEMO_PROJECT } })) > 0;
}

// Adds the test data. Needs an OWNER (the first person who logged in). Safe to call twice.
export async function addDemoData(now = new Date()) {
  const owner = await db.user.findFirst({
    where: { role: "OWNER" },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("No OWNER yet: log in to the site first.");
  if (await hasDemoData()) return { tasks: 0, people: 0 };

  const today = todayInTimezone(getEnv().DEFAULT_TIMEZONE, now);
  const day = (offset: number) => fromDateString(addDays(today, offset));
  const at = (offset: number) => new Date(now.getTime() + offset * 86_400_000);

  const ids: Record<Who, string> = { owner: owner.id } as Record<Who, string>;
  for (const [i, p] of PEOPLE.entries()) {
    const telegramId = DEMO_TELEGRAM_BASE + BigInt(i + 1);
    const user = await db.user.upsert({
      where: { telegramId },
      create: {
        telegramId,
        firstName: p.firstName,
        role: p.role,
        position: p.position,
        botChatId: null,
      },
      update: {},
    });
    ids[p.key] = user.id;
  }
  // Reporting lines: the test manager reports to the owner, employees to the test manager.
  await db.user.update({ where: { id: ids.boss }, data: { managerId: owner.id } });
  await db.user.updateMany({
    where: { id: { in: [ids.e1, ids.e2, ids.e3] } },
    data: { managerId: ids.boss },
  });

  const plan = await db.plan.create({
    data: {
      title: `${DEMO_PROJECT}: план недели`,
      level: "WEEK",
      periodStart: fromDateString(startOfWeek(today)),
      createdById: owner.id,
    },
  });

  const created: Record<string, string> = {};
  for (const task of TASKS) {
    const approved = !["DRAFT", "PENDING_APPROVAL"].includes(task.status) && !task.personal;
    const row = await db.task.create({
      data: {
        title: task.title,
        project: DEMO_PROJECT,
        isPersonal: task.personal ?? false,
        creatorId: ids[task.creator],
        assigneeId: ids[task.assignee],
        status: task.status,
        priority: task.priority ?? "MEDIUM",
        dueDate: task.due === null ? null : day(task.due),
        startDate:
          task.due === null ? null : day(task.due - Math.max(1, Math.ceil((task.hours ?? 2) / 4))),
        estimateMinutes: task.hours ? task.hours * 60 : null,
        planId: task.inPlan ? plan.id : null,
        approvedAt: approved ? at(Math.min(-1, (task.due ?? 0) - 7)) : null,
        completedAt: task.doneAt !== undefined ? at(task.doneAt) : null,
        createdAt: at(Math.min(-2, (task.due ?? 0) - 8)),
      },
    });
    created[task.title] = row.id;
  }

  // A dependency and a short discussion, so the task card shows them too.
  await db.taskDependency.create({
    data: {
      blockerId: created["Тест: сверить остатки на складе"],
      blockedId: created["Тест: план закупок на следующий месяц"],
    },
  });
  const photoTask = created["Тест: собрать фотоотчёт с точек"];
  await db.comment.createMany({
    data: [
      {
        taskId: photoTask,
        authorId: ids.e1,
        body: "Тестовый комментарий: фото с 5 точек загружены, проверьте, пожалуйста.",
      },
      {
        taskId: photoTask,
        authorId: owner.id,
        body: "Тестовый комментарий: спасибо, посмотрю сегодня.",
      },
    ],
  });
  return { tasks: TASKS.length, people: PEOPLE.length };
}

// Removes everything addDemoData created (and anything else linked to the test employees).
export async function removeDemoData() {
  const people = await db.user.findMany({
    where: { telegramId: { gt: DEMO_TELEGRAM_BASE, lte: DEMO_TELEGRAM_BASE + 100n } },
    select: { id: true },
  });
  const peopleIds = people.map((p) => p.id);
  const byPeople = { in: peopleIds };
  return db.$transaction(async (tx) => {
    const tasks = await tx.task.deleteMany({
      where: { OR: [{ project: DEMO_PROJECT }, { creatorId: byPeople }, { assigneeId: byPeople }] },
    });
    await tx.plan.deleteMany({ where: { title: { startsWith: DEMO_PROJECT } } });
    if (peopleIds.length) {
      await tx.comment.deleteMany({ where: { authorId: byPeople } });
      await tx.taskAttachment.deleteMany({ where: { uploadedById: byPeople } });
      await tx.employeeNote.deleteMany({ where: { authorId: byPeople } });
      await tx.meetingNotes.deleteMany({ where: { authorId: byPeople } });
      await tx.meeting.deleteMany({ where: { createdById: byPeople } });
      await tx.plan.deleteMany({ where: { createdById: byPeople } });
      await tx.user.updateMany({ where: { managerId: byPeople }, data: { managerId: null } });
      await tx.user.deleteMany({ where: { id: byPeople } });
    }
    return { tasks: tasks.count, people: peopleIds.length };
  });
}
