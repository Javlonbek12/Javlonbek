import type { ExtractedTask } from "@/modules/ai/prompts";

// Meeting minutes examples. The meeting is on Thursday 2026-10-01.
export const MEETING_DATE = "2026-10-01";

type Expected = { assignee: "me" | "aziz" | "dilnoza" | "sardor"; dueDate: string | null };

export const MINUTES: { text: string; model: ExtractedTask[]; expect: Expected[] }[] = [
  {
    text: "Обсудили запуск ESSE Change 1. Азиз — до пятницы согласует макеты с агентством. Дильноза к 10 октября заказывает POSM. Я договорюсь с дистрибьютором на следующей неделе.",
    model: [
      {
        title: "Согласовать макеты с агентством",
        assigneeName: "Азиз",
        dueDate: "2026-10-02",
        priority: null,
        project: "ESSE Change 1",
        personal: false,
      },
      {
        title: "Заказать POSM",
        assigneeName: "Дильноза",
        dueDate: "2026-10-10",
        priority: null,
        project: "ESSE Change 1",
        personal: false,
      },
      {
        title: "Договориться с дистрибьютором",
        assigneeName: null,
        dueDate: null,
        priority: null,
        project: null,
        personal: false,
      },
    ],
    expect: [
      { assignee: "aziz", dueDate: "2026-10-02" },
      { assignee: "dilnoza", dueDate: "2026-10-10" },
      { assignee: "me", dueDate: null },
    ],
  },
  {
    text: "Sardor dushanbagacha barcha do'konlarda narxlarni tekshiradi. Dilnoza hisobotni juma kuni yuboradi.",
    model: [
      {
        title: "Do'konlarda narxlarni tekshirish",
        assigneeName: "Sardor",
        dueDate: "2026-10-05",
        priority: null,
        project: null,
        personal: false,
      },
      {
        title: "Hisobotni yuborish",
        assigneeName: "Dilnoza",
        dueDate: "2026-10-02",
        priority: null,
        project: null,
        personal: false,
      },
    ],
    expect: [
      { assignee: "sardor", dueDate: "2026-10-05" },
      { assignee: "dilnoza", dueDate: "2026-10-02" },
    ],
  },
  {
    text: "Решили перенести промо на ноябрь. Действий нет.",
    model: [],
    expect: [],
  },
];
