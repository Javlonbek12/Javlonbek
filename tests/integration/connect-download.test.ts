// @vitest-environment node
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";

import { GET as download } from "@/app/api/connect/[format]/route";
import { withAccess } from "@/modules/core/access/actor";
import { importConnectFiles } from "@/modules/connect/service";
import { createSessionToken, SESSION_COOKIE } from "@/modules/core/auth/session";
import { updateSettings } from "@/modules/core/settings/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";

// Connect downloads in the language chosen before downloading (synthetic data: TSM_TST_* codes,
// stores 9000xx). Russian data values known to the files are translated; stores stay.

type Row = (string | number | null)[];
const SECRET = "test-session-secret-test-session-secret";
const TSM = "TSM_TST_1";
const PERSON = `${TSM} - Тест TSM 1`;
const OPEN = "Торговая точка открыта?";
const EQUIPMENT = "Какой тип оборудования KT&G установлен в торговой точке?";
const PRICE = "Цена на полке на продукцию KT&G соответствует рекомендованной цене?";
const PERIOD = "from=2026-11-02&to=2026-11-08";

const workbook = async () => {
  const book = new ExcelJS.Workbook();
  const sheet = (name: string, rows: Row[]) => {
    const ws = book.addWorksheet(name);
    for (const row of rows) ws.addRow(row);
  };
  sheet("Visit Detailization (Smart up)", [
    [
      "Organization",
      "Working Zone",
      "Employee",
      "Client ID",
      "Client",
      "Visit ID",
      "Visit Plan Date",
      "Fact Visit Date",
      "Start of visit time",
      "Finish the visit time",
      "Visit Comment",
    ],
    [
      "Тестоград",
      "Тестовая зона",
      TSM,
      900001,
      "Тестовая точка 900001",
      7001,
      "02.11.2026",
      "02.11.2026",
      "10:00:00",
      "10:20:00",
      null,
    ],
  ]);
  sheet("Market Visit (Connect Bot)", [
    [
      "ID visit",
      "Client",
      "Client ID",
      "Region",
      "Status",
      "Employee who completed the questionnaire",
      "Date of start",
      "Month",
      "Problematic Answers",
      "Frequent Problematic Questions",
      "Фото 1",
      "Шаблон",
      OPEN,
      EQUIPMENT,
      PRICE,
    ],
    [
      501,
      "Тестовая точка 900001",
      900001,
      "Тестоград",
      "Выполнено",
      PERSON,
      "02.11.2026 10:05",
      "2026-11",
      1,
      PRICE,
      "https://example.test/photo.jpg",
      "Тестовая анкета",
      "Да",
      "M (9*6) POSI (Корейский белый)",
      "Выше рекомендованной",
    ],
  ]);
  sheet("OOS orders (Connect Bot)", [
    [
      "Order Number",
      "Client",
      "Client ID",
      "Region",
      "Date of creation",
      "Month",
      "Order Status",
      "Delivery Status",
      "Created by",
      "Total order (packs)",
      "Amount (UZS)",
    ],
    [
      "#TEST-1",
      "Тестовая точка 900001",
      900001,
      "Тестоград",
      "02.11.2026 10:12",
      "2026-11",
      "Отправлен",
      "Доставлено — ожидает подтверждения точки",
      PERSON,
      20,
      400000,
    ],
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
};

const request = (url: string, userId: string) =>
  new Request(url, {
    headers: { cookie: `${SESSION_COOKIE}=${createSessionToken(userId, SECRET)}` },
  });
const route = (format: string) => ({ params: Promise.resolve({ format }) });

async function xlsx(userId: string, query: string) {
  const response = await download(
    request(`http://localhost/api/connect/xlsx?${query}`, userId),
    route("xlsx"),
  );
  expect(response.status).toBe(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.arrayBuffer());
  const values = (name: string) =>
    book
      .getWorksheet(name)!
      .getSheetValues()
      .filter(Boolean)
      .map((row) => (row as ExcelJS.CellValue[]).slice(1));
  return {
    name: decodeURIComponent(response.headers.get("content-disposition")!),
    sheets: book.worksheets.map((ws) => ws.name),
    values,
  };
}

describe("Connect downloads in the chosen language", () => {
  beforeEach(resetDb);

  it("makes the file in Korean, English or the user's language", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await importConnectFiles(owner, [{ name: "report.xlsx", buffer: await workbook() }]);

    // Korean: sheet names, headers, answers, equipment, statuses and the file name.
    const ko = await xlsx(owner.id, `view=exec&${PERIOD}&lang=ko`);
    expect(ko.name).toContain("Connect 분석 — 경영진");
    expect(ko.sheets).toEqual(expect.arrayContaining(["요약", "지역별", "MV 질문", "집기"]));
    expect(ko.values("요약")[0]![0]).toBe("Connect 분석 — 경영진: 11월 2일~8일");
    expect(ko.values("요약")[1]).toEqual(["지표", "값"]);
    expect(ko.values("MV 질문")).toContainEqual(["매장이 영업 중입니까?", "예", 1, 0]);
    expect(ko.values("MV 질문")).toContainEqual([
      "KT&G 제품의 진열 가격이 권장 가격과 일치합니까?",
      "권장가보다 높음",
      1,
      100,
    ]);
    expect(ko.values("집기")).toContainEqual(["M (9*6) POSI (한국산 흰색)", 1]);
    expect(ko.values("상태별 주문")).toContainEqual(["배송 완료 — 매장 확인 대기", 1, 20, 400000]);
    // Regions stay as they came.
    expect(ko.values("지역별")[1]![0]).toBe("Тестоград");

    // One TSM's list in Korean: the problem with its answer, the order's status; the store stays.
    const one = await xlsx(owner.id, `view=executor&person=${TSM}&${PERIOD}&lang=ko`);
    expect(one.values("MV 문제")).toContainEqual([
      "Тестовая точка 900001",
      "2026-11-02",
      "KT&G 제품의 진열 가격이 권장 가격과 일치합니까? — 권장가보다 높음",
    ]);
    expect(one.values("주문")).toContainEqual([
      "#TEST-1",
      "Тестовая точка 900001",
      "2026-11-02",
      "배송 완료 — 매장 확인 대기",
      20,
      400000,
    ]);

    // English.
    const en = await xlsx(owner.id, `view=exec&${PERIOD}&lang=en`);
    expect(en.name).toContain("Connect analytics — Leadership");
    expect(en.sheets).toContain("Summary");
    expect(en.values("MV questions")).toContainEqual(["Is the outlet open?", "Yes", 1, 0]);

    // No language, or an unknown one: the user's (Russian), data as it came.
    for (const query of [`view=exec&${PERIOD}`, `view=exec&${PERIOD}&lang=xx`]) {
      const ru = await xlsx(owner.id, query);
      expect(ru.name).toContain("Аналитика Connect — Руководство");
      expect(ru.sheets).toContain("Сводка");
      expect(ru.values("Вопросы MV")).toContainEqual([OPEN, "Да", 1, 0]);
      expect(ru.values("Оборудование")).toContainEqual(["M (9*6) POSI (Корейский белый)", 1]);
    }

    // An English user without a choice gets English; Russian when chosen.
    await updateSettings(owner.id, {
      timezone: "Asia/Tashkent",
      telegramEnabled: true,
      quietHoursStart: null,
      quietHoursEnd: null,
      disabledTypes: [],
      digestTime: 510,
      locale: "en",
    });
    expect((await xlsx(owner.id, `view=exec&${PERIOD}`)).sheets).toContain("Summary");
    expect((await xlsx(owner.id, `view=exec&${PERIOD}&lang=ru`)).sheets).toContain("Сводка");
  });

  it("makes the PowerPoint in Korean", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await importConnectFiles(owner, [{ name: "report.xlsx", buffer: await workbook() }]);
    const response = await download(
      request(`http://localhost/api/connect/pptx?view=exec&${PERIOD}&lang=ko`, owner.id),
      route("pptx"),
    );
    expect(response.status).toBe(200);
    expect(decodeURIComponent(response.headers.get("content-disposition")!)).toContain(
      "Connect 분석 — 경영진",
    );
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const xml = (
      await Promise.all(
        Object.keys(zip.files)
          .filter((name) => /^ppt\/(slides|charts)\/[^/]+\.xml$/.test(name))
          .map((name) => zip.file(name)!.async("string")),
      )
    ).join("\n");
    expect(xml).toContain("방문 계획 달성");
    expect(xml).toContain("매장이 영업 중입니까?");
    expect(xml).toContain("예: 1");
    expect(xml).toContain("배송 완료 — 매장 확인 대기");
    expect(xml).not.toContain("Аналитика Connect");
  });
});
