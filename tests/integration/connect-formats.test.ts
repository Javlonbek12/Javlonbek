import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { parseWorkbook, routeMonth, type RecordOf } from "@/modules/connect/parse";
import { connectDataDate, importConnectFiles } from "@/modules/connect/service";
import { withAccess } from "@/modules/core/access/actor";
import { createTestUser, resetDb } from "@/tests/helpers/db";

// The exports added on 23.11.2026: the orders export without «Тип заказа», BDM audits apart from
// Market Visits, ISM checklists, Smart Up's client base and its route analysis. Synthetic data
// only: TSM_TST_* / DR_TST_* codes, «Тест …» people, stores 9000xx, SKU-TEST products.

type Row = (string | number | null)[];

const book = async (rows: Row[], created?: Date) => {
  const wb = new ExcelJS.Workbook();
  if (created) wb.created = created;
  const ws = wb.addWorksheet("Тест");
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
};

const ORDERS: Row[] = [
  [
    "Номер заказа",
    "Магазин",
    "Код точки",
    "Регион",
    "Город",
    "Канал",
    "Тип контракта",
    "Дата заказа",
    "Месяц",
    "Статус заказа",
    "Статус доставки",
    "Создал",
    "ID проверки-источника",
    "Позиций в заказе",
    "Заказано всего, пач.",
    "Сумма",
    "SKU-TEST 1",
    "SKU-TEST 2",
    "Позиции вне колонок, шт.",
  ],
  [
    "ORD-TEST-1",
    "Тест магазин 1",
    900001,
    "Тест",
    "Тестоград",
    "Retail",
    null,
    "05.11.2026 10:45",
    "2026-11",
    "Отправлен",
    "Точка не ответила",
    "TSM_TST_1 - Тест Первый",
    701,
    2,
    30,
    450000,
    10,
    20,
    null,
  ],
];

const VISIT_HEADERS = [
  "ID проверки",
  "Магазин",
  "Код точки",
  "Регион",
  "Город",
  "Канал",
  "Тип контракта",
  "Статус проверки",
  "Выполнение, %",
  "Исполнитель",
  "Создатель",
  "Дата создания",
  "Месяц",
  "Дата выполнения",
  "Проблемных вопросов",
  "Проблемные вопросы",
  "Фото 1",
  "Шаблон",
  "Вопрос теста?",
];
const visit = (id: number, creator: string, template: string): Row => [
  id,
  "Тест магазин 1",
  900001,
  "Тест",
  "Тестоград",
  "Retail",
  null,
  "Выполнено",
  50,
  null,
  creator,
  "05.11.2026 11:00",
  "2026-11",
  "05.11.2026 11:05",
  0,
  null,
  "https://example.test/1.jpg",
  template,
  "Да",
];

const CHECKLISTS: Row[] = [
  [
    "ID чек-листа",
    "Магазин",
    "Код точки",
    "Регион",
    "Город",
    "Канал",
    "Тип контракта",
    "Заполнил",
    "Дата заполнения",
    "Месяц",
    "Выполнение, %",
    "ROI-статус",
    "Рекомендованный статус оплаты",
    "Номер заявки на оплату",
    "Статус оплаты (TSM)",
    "Процент оплаты",
    "Сумма по контракту",
    "Сумма к оплате",
    "Комментарий чек-листа",
    "Фото 1",
    "Шаблон",
    "Ассортимент на месте?",
    "Оборудование на месте?",
  ],
  [
    801,
    "Тест магазин 1",
    900001,
    "Тест",
    "Тестоград",
    "Retail",
    null,
    "TSM_TST_1 - Тест Первый",
    "06.11.2026 09:30",
    "2026-11",
    50,
    "negative",
    "Частичная оплата",
    1,
    "Оплатить частично",
    50,
    400000,
    200000,
    "тест",
    "https://example.test/2.jpg",
    "Проверка LEGO",
    "Да",
    "Нет",
  ],
];

const CLIENTS: Row[] = [
  [
    "ИД",
    "Название",
    "Организации",
    "GPS координаты",
    "KT&G Grade NEW",
    "(TSM) Коммуникация / Key Visual",
    "Promotion / промоакция",
    "Сумма контракта / Contract budget",
    "BDM KTNG",
    "Responsible DR",
    "Тип оборудования 1 |Backwall / POG",
    "NEW Launch promotion",
    "(TSM;DR) Основной канал / POS channel",
    "Responsible TSM",
    "Регион",
    "Статус",
    "ИНН",
  ],
  [
    900001,
    "Тест магазин 1",
    "Тестоград, Тестобад",
    "41.311081,69.240562,12",
    "XL",
    "Нет коммуникации/No key visual",
    "2%",
    400000,
    "BDM 99 (Тест Руководитель)",
    "DR_TST_1",
    "Display M (6*9) POSI",
    "1 order",
    "Розница (Retail)",
    "TSM_TST_1",
    "Тестовый район",
    "Активный",
    "000000000",
  ],
  [
    900002,
    "Тест магазин 2",
    "Тестоград",
    "0,0",
    null,
    null,
    null,
    null,
    null,
    null,
    "No BW",
    null,
    "Не указан канал / Channel not specified",
    null,
    null,
    "Активный",
    null,
  ],
];

// A legend, then weekdays over days of the month; totals under the clients.
const ROUTES: Row[] = [
  [],
  ["Предстоящий плановый визит:", null, null, "O"],
  ["Невыполненный плановый визит:", null, null, "X"],
  [],
  [
    "Номер заказа",
    "Организация",
    "Рабочая зона",
    "Штат",
    "ИД клиента",
    "Клиент",
    "Характеристика клиента",
    "Итог за неделю",
    "Пн",
    "Вт",
    "Итог за неделю",
    "Пн",
    "Количество визитов",
  ],
  [null, null, null, null, null, null, null, "1 неделя", 2, 3, "2 неделя", 9, "U"],
  [
    1,
    "Тестоград",
    "DR_TST_1",
    "DR_TST_1",
    900001,
    "Тест магазин 1",
    null,
    null,
    "PD",
    "X",
    null,
    "O",
    0,
  ],
  [
    2,
    "Тестоград",
    "TSM_TST_1",
    "TSM_TST_1",
    900001,
    "Тест магазин 1",
    null,
    null,
    "P",
    null,
    null,
    "UD",
    1,
  ],
  [
    "Итоговое количество визитов в день:",
    null,
    null,
    null,
    "Итоговое количество визитов в день:",
    null,
    "U",
    null,
    1,
    1,
    null,
    1,
  ],
];

describe("new export formats", () => {
  it("reads the orders export that has no «Тип заказа»", async () => {
    const [sheet] = await parseWorkbook(await book(ORDERS));
    expect(sheet?.kind).toBe("ORDER");
    const order = sheet!.rows[0]!.record as RecordOf<"ORDER">;
    expect(order).toMatchObject({
      id: "ORD-TEST-1",
      storeCode: "900001",
      // Where the delivery stands, not «Отправлен».
      status: "Точка не ответила",
      sourceCheck: "701",
      packs: 30,
      sum: 450000,
      skus: { "SKU-TEST 1": 10, "SKU-TEST 2": 20 },
      express: false,
    });
  });

  it("keeps BDM audits apart from the TSMs' Market Visits", async () => {
    const sheets = await parseWorkbook(
      await book([
        VISIT_HEADERS,
        visit(1, "TSM_TST_1 - Тест Первый", "Regular_visit_questionnaire_TSM_09.2026"),
        visit(2, "BDM 99 - Тест Руководитель", "BDM Audit Опросник  11.2026"),
      ]),
    );
    expect(sheets.map((s) => [s.kind, s.rows.map((r) => r.record.id)])).toEqual([
      ["VISIT", ["1"]],
      ["AUDIT", ["2"]],
    ]);
  });

  it("reads an ISM checklist with its questions", async () => {
    const [sheet] = await parseWorkbook(await book(CHECKLISTS));
    expect(sheet?.kind).toBe("ISM_CHECK");
    expect(sheet!.rows[0]!.record).toMatchObject({
      id: "801",
      day: "2026-11-06",
      person: "TSM_TST_1 - Тест Первый",
      template: "Проверка LEGO",
      percent: 50,
      roi: "negative",
      recommended: "Частичная оплата",
      tsmDecision: "Оплатить частично",
      contractSum: 400000,
      toPay: 200000,
      photos: 1,
      checks: [
        { q: "Ассортимент на месте?", ok: true },
        { q: "Оборудование на месте?", ok: false },
      ],
    });
  });

  it("reads Smart Up's client base: coordinates, grade, equipment, who is responsible", async () => {
    const [sheet] = await parseWorkbook(await book(CLIENTS));
    expect(sheet?.kind).toBe("CLIENT");
    const [first, second] = sheet!.rows.map((r) => r.record as RecordOf<"CLIENT">);
    expect(first).toMatchObject({
      id: "900001",
      storeCode: "900001",
      storeName: "Тест магазин 1",
      city: "Тестовый район",
      channel: "Розница (Retail)",
      person: "TSM_TST_1",
      organizations: ["Тестоград", "Тестобад"],
      gps: { lat: 41.311081, lng: 69.240562 },
      grade: "XL",
      equipment: "Display M (6*9) POSI",
      dr: "DR_TST_1",
      contractSum: 400000,
    });
    // «0,0» is no place; an unnamed channel is none.
    expect(second).toMatchObject({ gps: null, channel: null, person: null, grade: null });
  });

  it("reads Smart Up's route analysis: a row per client of a zone, a code per day", async () => {
    // Made on 9 November, 18:00 in Tashkent.
    const [sheet] = await parseWorkbook(await book(ROUTES, new Date("2026-11-09T13:00:00Z")));
    expect(sheet).toMatchObject({ kind: "ROUTE", skipped: 0 });
    expect(sheet!.rows.map((r) => r.record)).toMatchObject([
      {
        id: "2026-11|DR_TST_1|900001",
        person: "DR_TST_1",
        storeCode: "900001",
        city: "Тестоград",
        month: "2026-11",
        day: "2026-11-09",
        days: { "02": "PD", "03": "X", "09": "O" },
      },
      { id: "2026-11|TSM_TST_1|900001", person: "TSM_TST_1", days: { "02": "P", "09": "UD" } },
    ]);
  });

  it("takes the route analysis' month from when it was made", () => {
    expect(routeMonth(23, new Date("2026-11-23T13:00:00Z"))).toBe("2026-11");
    // November's sheet (to the 30th) exported on 1 December; January's from the year before.
    expect(routeMonth(30, new Date("2026-12-01T04:00:00Z"))).toBe("2026-11");
    expect(routeMonth(31, new Date("2027-01-02T04:00:00Z"))).toBe("2026-12");
    // 23:30 UTC on the 30th is already the 1st in Tashkent.
    expect(routeMonth(1, new Date("2026-11-30T23:30:00Z"))).toBe("2026-12");
  });
});

describe("saving the new exports", () => {
  beforeEach(resetDb);

  it("replaces the client base and the month's routes; an audit leaves the Market Visits", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const upload = (name: string, buffer: Buffer) => importConnectFiles(owner, [{ name, buffer }]);

    // Audits saved as Market Visits before: both rows come in as visits first.
    await db.connectRecord.createMany({
      data: [1, 2].map((id) => ({
        kind: "VISIT" as const,
        externalId: String(id),
        storeCode: "900001",
        storeName: "Тест магазин 1",
        day: "2026-11-05",
        month: "2026-11",
        data: {},
        importId: "old",
      })),
    });
    await upload(
      "visits.xlsx",
      await book([
        VISIT_HEADERS,
        visit(1, "TSM_TST_1 - Тест Первый", "Regular_visit_questionnaire_TSM_09.2026"),
        visit(2, "BDM 99 - Тест Руководитель", "BDM Audit Опросник  11.2026"),
      ]),
    );
    const kindsOf = async () =>
      (await db.connectRecord.groupBy({ by: ["kind"], _count: { _all: true } }))
        .map((g) => `${g.kind}:${g._count._all}`)
        .sort();
    expect(await kindsOf()).toEqual(["AUDIT:1", "VISIT:1"]);

    const [clients] = await upload("clients.xlsx", await book(CLIENTS));
    expect(clients!.sheets[0]).toMatchObject({ kind: "CLIENT", created: 2, replaced: 0 });
    // A new base replaces the old one whole.
    const [again] = await upload("clients.xlsx", await book(CLIENTS.slice(0, 2)));
    expect(again!.sheets[0]).toMatchObject({ created: 1, replaced: 2 });

    const made = new Date("2026-11-09T13:00:00Z");
    await upload("route.xlsx", await book(ROUTES, made));
    const [routes] = await upload("route.xlsx", await book(ROUTES.slice(0, 7), made));
    expect(routes!.sheets[0]).toMatchObject({ kind: "ROUTE", created: 1, replaced: 2 });
    expect(await kindsOf()).toEqual(["AUDIT:1", "CLIENT:1", "ROUTE:1", "VISIT:1"]);
    // «Данные по …» stays the bot's and the visits' day, not the route's.
    expect(await connectDataDate()).toBe("2026-11-05");
  });
});
