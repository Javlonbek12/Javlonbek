import type { ExtractedTask } from "@/modules/ai/prompts";

// Example messages for "text/voice → tasks". TODAY is a Thursday.
// `model` is what Claude is expected to return for the message (used by the offline tests);
// `expect` is what must end up in the confirmation card (checked offline and, with a key, live).
export const TODAY = "2026-10-01";

export const TEAM = [
  {
    firstName: "Тестовый владелец",
    lastName: null,
    telegramId: 9000001n,
    role: "OWNER" as const,
    key: "owner",
  },
  {
    firstName: "Азиз",
    lastName: "Каримов",
    telegramId: 9000002n,
    role: "MEMBER" as const,
    key: "aziz",
  },
  {
    firstName: "Дильноза",
    lastName: "Юсупова",
    telegramId: 9000003n,
    role: "MEMBER" as const,
    key: "dilnoza",
  },
  {
    firstName: "Sardor",
    lastName: "Rahimov",
    telegramId: 9000004n,
    role: "MANAGER" as const,
    key: "sardor",
  },
];

type Expected = {
  assignee: "me" | "aziz" | "dilnoza" | "sardor";
  dueDate: string | null;
  priority?: string;
  project?: string;
};

export type Phrase = {
  text: string;
  lang: "ru" | "uz" | "mixed";
  model: ExtractedTask[];
  expect: Expected[];
};

const task = (
  assigneeName: string | null,
  dueDate: string | null,
  extra: Partial<ExtractedTask> = {},
): ExtractedTask => ({
  title: "Задача",
  assigneeName,
  dueDate,
  priority: null,
  project: null,
  personal: false,
  ...extra,
});

export const PHRASES: Phrase[] = [
  {
    lang: "ru",
    text: "Азизу подготовить отчёт по продажам до пятницы",
    model: [task("Азиз", "2026-10-02")],
    expect: [{ assignee: "aziz", dueDate: "2026-10-02" }],
  },
  {
    lang: "ru",
    text: "Дильноза, завтра проверь выкладку в Макро",
    model: [task("Дильноза", "2026-10-02")],
    expect: [{ assignee: "dilnoza", dueDate: "2026-10-02" }],
  },
  {
    lang: "ru",
    text: "Напомни мне позвонить дистрибьютору в понедельник",
    model: [task(null, "2026-10-05")],
    expect: [{ assignee: "me", dueDate: "2026-10-05" }],
  },
  {
    lang: "uz",
    text: "Sardor ertaga do'konlarga borib narxlarni tekshirsin",
    model: [task("Sardor", "2026-10-02")],
    expect: [{ assignee: "sardor", dueDate: "2026-10-02" }],
  },
  {
    lang: "uz",
    text: "Dilnozaga juma kuni hisobotni tayyorlash",
    model: [task("Dilnoza", "2026-10-02")],
    expect: [{ assignee: "dilnoza", dueDate: "2026-10-02" }],
  },
  {
    lang: "mixed",
    text: "Азиз, ertaga ESSE дисплейларни проверь",
    model: [task("Азиз", "2026-10-02")],
    expect: [{ assignee: "aziz", dueDate: "2026-10-02" }],
  },
  {
    lang: "ru",
    text: "Сардору через неделю обновить планограммы",
    model: [task("Сардор", "2026-10-08")],
    expect: [{ assignee: "sardor", dueDate: "2026-10-08" }],
  },
  {
    lang: "ru",
    text: "До конца месяца собрать фотоотчёты по всем точкам, это для Дильнозы",
    model: [task("Дильноза", "2026-10-31")],
    expect: [{ assignee: "dilnoza", dueDate: "2026-10-31" }],
  },
  {
    lang: "ru",
    text: "Азизу подготовить презентацию к понедельнику, а Дильнозе заказать POSM до среды",
    model: [task("Азиз", "2026-10-05"), task("Дильноза", "2026-10-07")],
    expect: [
      { assignee: "aziz", dueDate: "2026-10-05" },
      { assignee: "dilnoza", dueDate: "2026-10-07" },
    ],
  },
  {
    lang: "ru",
    text: "Срочно! Сардор, сегодня отправь цены в офис",
    model: [task("Сардор", "2026-10-01", { priority: "URGENT" })],
    expect: [{ assignee: "sardor", dueDate: "2026-10-01", priority: "URGENT" }],
  },
  {
    lang: "ru",
    text: "По проекту ESSE Change 1 Азизу согласовать макеты до 10 октября",
    model: [task("Азиз", "2026-10-10", { project: "ESSE Change 1" })],
    expect: [{ assignee: "aziz", dueDate: "2026-10-10", project: "ESSE Change 1" }],
  },
  {
    lang: "uz",
    text: "Дилнозага эртага ҳисобот тайёрласин",
    model: [task("Дилноза", "2026-10-02")],
    expect: [{ assignee: "dilnoza", dueDate: "2026-10-02" }],
  },
  {
    lang: "ru",
    text: "Купить новые ценники",
    model: [task(null, null)],
    expect: [{ assignee: "me", dueDate: null }],
  },
  {
    lang: "mixed",
    text: "bugun menga distribyutorga qo'ng'iroq qilish, Sardorga ertaga hisobot, Азизу в пятницу встреча с клиентом",
    model: [task(null, "2026-10-01"), task("Sardor", "2026-10-02"), task("Азиз", "2026-10-02")],
    expect: [
      { assignee: "me", dueDate: "2026-10-01" },
      { assignee: "sardor", dueDate: "2026-10-02" },
      { assignee: "aziz", dueDate: "2026-10-02" },
    ],
  },
  {
    lang: "ru",
    text: "Через 3 дня Азизу сдать отчёт по остаткам",
    model: [task("Азиз", "2026-10-04")],
    expect: [{ assignee: "aziz", dueDate: "2026-10-04" }],
  },
  {
    lang: "uz",
    text: "hafta oxirigacha Sardor barcha do'konlarni aylanib chiqsin",
    model: [task("Sardor", "2026-10-04")],
    expect: [{ assignee: "sardor", dueDate: "2026-10-04" }],
  },
  {
    lang: "ru",
    text: "Важно: Дильнозе подготовить бюджет на ноябрь к 15 числу",
    model: [task("Дильноза", "2026-10-15", { priority: "HIGH" })],
    expect: [{ assignee: "dilnoza", dueDate: "2026-10-15", priority: "HIGH" }],
  },
  {
    lang: "mixed",
    text: "Sardor, на следующей неделе в среду встреча с дистрибьютором, tayyorlan",
    model: [task("Sardor", "2026-10-07")],
    expect: [{ assignee: "sardor", dueDate: "2026-10-07" }],
  },
];
