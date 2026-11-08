import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { connectPptx } from "@/modules/connect/pptx";
import { buildConnectReport, parseConnectQuery, scopeConnectQuery } from "@/modules/connect/report";
import {
  clearConnectData,
  ConnectError,
  connectDataDate,
  connectPeopleLinks,
  importConnectFiles,
  linkConnectPerson,
  loadDataset,
} from "@/modules/connect/service";
import { connectXlsx } from "@/modules/connect/xlsx";
import { withAccess } from "@/modules/core/access/actor";
import { createTestUser, resetDb } from "@/tests/helpers/db";

async function workbook(headers: string[], rows: (string | number | null)[][]) {
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet("Тест");
  ws.addRow(headers);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

const OOS_HEADERS = [
  "ID проверки",
  "Магазин",
  "Код точки",
  "Регион",
  "Город",
  "Канал",
  "Тип контракта",
  "Дата проверки",
  "Месяц",
  "Проверил",
  "Нет в наличии, поз.",
  "Недостаточно, поз.",
  "Заказ создан",
  "Номер заказа",
  "Статус заказа",
  "Статус доставки",
  "SKU-TEST-001",
  "SKU-TEST-002",
  "Позиции вне колонок, шт.",
];
const PAYMENT_HEADERS = [
  "ID заявки",
  "Номер заявки",
  "Магазин",
  "Код точки",
  "Город",
  "Канал",
  "Дата заявки",
  "Месяц",
  "Выполнение чек-листа, %",
  "ROI-статус",
  "TSM",
  "Статус оплаты (TSM)",
  "Сумма по контракту",
  "Сумма к оплате",
  "Решение BDM",
  "Решение BUM",
  "Факт оплаты",
  "Дней до оплаты",
  "Тестовый пункт чек-листа",
];
const PERSON = "TSM_TEST_1 - Тестовый сотрудник 1";

const oosRow = (
  id: number,
  store: string,
  code: number,
  missing: number,
  status = "В наличии",
  at = "05.10.2026 10:00",
) => [
  id,
  store,
  code,
  null,
  "Тестоград",
  "Retail",
  null,
  at,
  "2026-10",
  PERSON,
  missing,
  0,
  "Нет",
  null,
  null,
  null,
  status,
  "В наличии",
  null,
];

describe("Connect analytics: upload and downloads", () => {
  beforeEach(resetDb);

  it("uploads exports, updates rows by ID and leaves test stores out", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const oos = await workbook(OOS_HEADERS, [
      oosRow(1, "Тестовый магазин 1", 101, 1, "Нет в наличии"),
      oosRow(2, "Тестовый магазин 2", 102, 0),
      oosRow(3, "[TEST] Тестовая торговая точка", 9999999999, 2, "Нет в наличии"),
    ]);
    const payments = await workbook(PAYMENT_HEADERS, [
      [
        1,
        1,
        "Тестовый магазин 1",
        101,
        "Тестоград",
        "Retail",
        "01.10.2026 09:00",
        "2026-10",
        50,
        "positive",
        PERSON,
        "Оплатить полную сумму",
        500000,
        null,
        "В ожидании",
        "В ожидании",
        null,
        null,
        "Нет",
      ],
    ]);
    const result = await importConnectFiles(owner, [
      { name: "oos.xlsx", buffer: oos },
      { name: "ism.xlsx", buffer: payments },
    ]);
    const sheet = { updated: 0, skipped: 0, kept: 0, newer: null, test: 0 };
    const oct5 = { from: "2026-10-05", to: "2026-10-05" };
    // The result says which days the file covers and how many test-store rows were left out.
    expect(result).toEqual([
      { name: "oos.xlsx", sheets: [{ ...sheet, ...oct5, kind: "OOS", created: 3, test: 1 }] },
      {
        name: "ism.xlsx",
        sheets: [{ ...sheet, kind: "PAYMENT", created: 1, from: "2026-10-01", to: "2026-10-01" }],
      },
    ]);
    expect(await connectDataDate()).toBe("2026-10-05");

    // Uploading a newer export updates the row with the same ID.
    const newer = await workbook(OOS_HEADERS, [oosRow(2, "Тестовый магазин 2", 102, 3)]);
    expect(await importConnectFiles(owner, [{ name: "oos2.xlsx", buffer: newer }])).toEqual([
      { name: "oos2.xlsx", sheets: [{ ...sheet, ...oct5, kind: "OOS", created: 0, updated: 1 }] },
    ]);
    expect(await db.connectRecord.count()).toBe(4);

    // An older export (its latest row is earlier) doesn't overwrite the newer statuses: it says
    // so, and only adds rows that weren't there.
    const older = await workbook(OOS_HEADERS, [
      oosRow(2, "Тестовый магазин 2", 102, 0, "В наличии", "01.10.2026 09:00"),
      oosRow(4, "Тестовый магазин 4", 104, 0, "В наличии", "01.10.2026 09:30"),
    ]);
    expect(await importConnectFiles(owner, [{ name: "old.xlsx", buffer: older }])).toEqual([
      {
        name: "old.xlsx",
        sheets: [
          {
            ...sheet,
            kind: "OOS",
            created: 1,
            kept: 1,
            newer: "2026-10-05T10:00",
            from: "2026-10-01",
            to: "2026-10-01",
          },
        ],
      },
    ]);
    expect(
      (await db.connectImport.findFirstOrThrow({ where: { fileName: "old.xlsx" } })).kept,
    ).toBe(1);
    await db.connectRecord.deleteMany({ where: { externalId: "4" } });

    const data = await loadDataset({ from: "2026-10", to: "2026-10" });
    expect(data.oos.map((c) => [c.id, c.missing])).toEqual([
      ["1", 1],
      ["2", 3],
    ]);
    expect(data.payments[0]?.checks).toEqual([{ q: "Тестовый пункт чек-листа", ok: false }]);
    expect(await loadDataset({ city: "Другой город" })).toMatchObject({ oos: [], payments: [] });

    // All three levels download as Excel and PowerPoint.
    for (const view of ["exec", "manager", "executor"]) {
      const query = parseConnectQuery({ view, person: PERSON }, true);
      const report = await buildConnectReport(query, "2026-10-21");
      expect(report.empty).toBe(false);
      const xlsx = await connectXlsx(report);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(xlsx as unknown as ArrayBuffer);
      expect(book.worksheets.length).toBeGreaterThan(1);
      const pptx = await connectPptx(report);
      expect(pptx.subarray(0, 2).toString()).toBe("PK");
    }
    const exec = await buildConnectReport(parseConnectQuery({}, true), "2026-10-21");
    expect(exec.exec?.kpis).toMatchObject({ checks: 2, gapRate: 100, requests: 1, waiting: 1 });
    const mine = await buildConnectReport(
      parseConnectQuery({ view: "executor", person: PERSON }, true),
      "2026-10-21",
    );
    expect(mine.executor?.gapsWithoutOrder.map((g) => g.id)).toEqual(["1", "2"]);
    expect(mine.executor?.paymentIssues.map((p) => p.stage)).toEqual(["waitingBdm"]);
    // Without a person: everyone's open items.
    const everyone = await buildConnectReport(
      parseConnectQuery({ view: "executor" }, true),
      "2026-10-21",
    );
    expect(everyone.executors?.map((e) => [e.person, e.openCount])).toEqual([[PERSON, 3]]);
    // October against September: no data before, so no comparison.
    const october = await buildConnectReport(
      parseConnectQuery({ from: "2026-10", to: "2026-10" }, true),
      "2026-10-21",
    );
    expect(october.previous).toBeNull();

    expect(await clearConnectData(owner)).toBe(4);
  });

  it("an employee sees only their own list once names are linked to people", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const member = await withAccess(await createTestUser("MEMBER"));
    const query = parseConnectQuery({ view: "executor", person: "Другой (тест)" }, false);
    // No links yet: works as before.
    expect(scopeConnectQuery(query, false, await connectPeopleLinks(), member.id).own).toBeNull();
    await expect(linkConnectPerson(member, PERSON, member.id)).rejects.toBeInstanceOf(ConnectError);
    await linkConnectPerson(owner, PERSON, member.id);
    expect(await connectPeopleLinks()).toEqual({ [PERSON]: member.id });
    const scoped = scopeConnectQuery(query, false, await connectPeopleLinks(), member.id);
    expect(scoped).toMatchObject({ own: [PERSON], query: { view: "executor", person: PERSON } });
    // Somebody not linked sees nothing of others.
    const other = await createTestUser("MEMBER");
    expect(scopeConnectQuery(query, false, await connectPeopleLinks(), other.id)).toMatchObject({
      own: [],
      query: { person: null },
    });
    // The owner and managers are not limited.
    expect(scopeConnectQuery(query, true, await connectPeopleLinks(), owner.id).own).toBeNull();
    await linkConnectPerson(owner, PERSON, null);
    expect(await connectPeopleLinks()).toEqual({});
  });

  it("only the owner and managers upload; unknown files are refused", async () => {
    const member = await withAccess(await createTestUser("MEMBER"));
    const manager = await withAccess(await createTestUser("MANAGER"));
    const file = await workbook(OOS_HEADERS, [oosRow(1, "Тестовый магазин", 1, 0)]);
    await expect(importConnectFiles(member, [{ name: "a.xlsx", buffer: file }])).rejects.toEqual(
      new ConnectError("forbidden"),
    );
    const other = await workbook(["Колонка", "Другая"], [["a", "b"]]);
    await expect(importConnectFiles(manager, [{ name: "b.xlsx", buffer: other }])).rejects.toEqual(
      new ConnectError("unknown"),
    );
    await expect(clearConnectData(manager)).rejects.toEqual(new ConnectError("forbidden"));
  });
});
