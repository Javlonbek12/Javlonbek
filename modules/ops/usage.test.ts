import { describe, expect, it } from "vitest";

import { formatUsage, type UsageReport } from "./usage";

const now = new Date("2026-11-07T10:00:00Z");

const report: UsageReport = {
  from: new Date("2026-10-08T10:00:00Z"),
  to: now,
  days: 30,
  people: [
    {
      name: "Тестовый сотрудник 2",
      role: "MEMBER",
      lastActiveAt: null,
      tasksCreated: 0,
      tasksAssigned: 0,
      tasksDone: 0,
      comments: 0,
      stepsDone: 0,
      botDrafts: 0,
      aiCalls: 0,
    },
    {
      name: "Тестовый владелец",
      role: "OWNER",
      lastActiveAt: new Date("2026-11-07T08:00:00Z"),
      tasksCreated: 12,
      tasksAssigned: 3,
      tasksDone: 1,
      comments: 4,
      stepsDone: 0,
      botDrafts: 2,
      aiCalls: 5,
    },
    {
      name: "Тестовый сотрудник 1",
      role: "MANAGER",
      lastActiveAt: new Date("2026-11-04T08:00:00Z"),
      tasksCreated: 1,
      tasksAssigned: 9,
      tasksDone: 2,
      comments: 0,
      stepsDone: 6,
      botDrafts: 0,
      aiCalls: 0,
    },
  ],
  modules: [
    { label: "Задачи командные", period: 10, total: 90 },
    { label: "Встречи", period: 0, total: 3 },
  ],
  ai: { calls: 5, inputTokens: 1200, outputTokens: 300, failed: 1 },
  notifications: { created: 40, sentToTelegram: 35, read: 12 },
};

describe("usage report text", () => {
  const text = formatUsage(report);
  const lines = text.split("\n");

  it("names the period and sorts people by activity, the silent ones last", () => {
    expect(lines[0]).toBe("Использование Assistant за 30 дн. (2026-10-08 — 2026-11-07)");
    const names = lines
      .filter((l) => /\((владелец|руководитель|сотрудник|юрист)\)/.test(l))
      .map((l) => l.trim().split(" (")[0]);
    expect(names.slice(0, 3)).toEqual([
      "Тестовый владелец",
      "Тестовый сотрудник 1",
      "Тестовый сотрудник 2",
    ]);
  });

  it("shows counts, roles in Russian and when the person was last active", () => {
    const owner = lines.find((l) => l.includes("Тестовый владелец"))!;
    expect(owner).toContain("(владелец)");
    expect(owner).toMatch(/12\s+3\s+1\s+4\s+0\s+2\s+5\s+сегодня$/);
    const manager = lines.find((l) => l.includes("Тестовый сотрудник 1"))!;
    expect(manager).toContain("(руководитель)");
    expect(manager).toMatch(/3 дн\. назад$/);
    const silent = lines.find((l) => l.includes("Тестовый сотрудник 2"))!;
    expect(silent).toMatch(/действий нет$/);
    expect(text).toContain("Итого: активны 2 из 3; без действий за период: Тестовый сотрудник 2");
  });

  it("does not count tasks given to a person as their action", () => {
    const receiver = {
      ...report.people[0]!,
      name: "Тестовый получатель",
      tasksAssigned: 7,
    };
    const only = formatUsage({ ...report, people: [receiver] });
    expect(only).toContain("Итого: активны 0 из 1; без действий за период: Тестовый получатель");
  });

  it("marks alive and silent modules and sums up bot, AI and notifications", () => {
    expect(text).toContain("● Задачи командные  10    / 90");
    expect(text).toContain("○ Встречи           0     / 3");
    expect(text).toContain("Живых разделов за период: 1 из 2");
    expect(text).toContain("Обращений к ИИ: 5 (ошибок 1), токены: 1200 на вход, 300 на выход");
    expect(text).toContain("Карточек задач из бота: 2");
    expect(text).toContain("Создано 40, ушло в Telegram 35, прочитано в приложении 12");
  });
});
