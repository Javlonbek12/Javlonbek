import { render } from "@testing-library/react";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { ExecView } from "@/components/connect/exec-view";
import { ExecutorView } from "@/components/connect/executor-view";
import { ManagerView } from "@/components/connect/manager-view";
import { t } from "@/lib/i18n";
import { withExportLocale } from "@/lib/i18n/server";
import {
  buildConnectReport,
  connectHref,
  monthsLabel,
  parseConnectQuery,
  type ConnectReport,
} from "@/modules/connect/report";
import { DEFAULT_RULES } from "@/modules/connect/rules";
import { importConnectFiles, saveConnectRules } from "@/modules/connect/service";
import { SHOWN } from "@/modules/connect/shown";
import { connectXlsx } from "@/modules/connect/xlsx";
import { withAccess } from "@/modules/core/access/actor";
import { fillOf, inkOf, readBook, said } from "@/tests/helpers/connect-page";
import { createTestUser, resetDb } from "@/tests/helpers/db";

// The Connect download as one sheet that is the page, plus the sheets of whole lists (decision of
// 25.11.2026): the first sheet has the level's blocks in the page's order, a list the page cuts
// shows the page's first rows and links to the sheet with all of them, that sheet links back,
// nothing is a sheet that no link opens, and the colours follow the owner's norms. Synthetic data
// only: TSM_TST_* / DR_TST_* zones, «Тест …» people, stores 9001xx / 9002xx.

type Row = (string | number | null)[];
const TODAY = "2026-11-16";
const WEEK = { from: "2026-11-09", to: "2026-11-15" };
// More zones than the page shows in a calendar (20) and in the TSMs' ranking (15).
const TSMS = 24;
const REPS = 22;
const tsm = (n: number) => `TSM_TST_${n}`;
const rep = (n: number) => `DR_TST_${n}`;

const book = async (sheets: { name: string; rows: Row[] }[], created?: Date) => {
  const wb = new ExcelJS.Workbook();
  if (created) wb.created = created;
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const row of s.rows) ws.addRow(row);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
};

const pos = (id: number, title: string, user: string, roles: string, boss: string | null): Row => [
  id,
  title,
  user,
  null,
  roles,
  boss,
  "01.10.2026 09:00:00",
  "Активный",
];
// BDM 99 → the TSMs; the distributor's supervisor → the sales reps.
const employees = () =>
  book([
    {
      name: "Sheet",
      rows: [
        [
          "ИД",
          "Название",
          "Пользователь",
          "Рабочие зоны",
          "Роли",
          "Руководитель",
          "Дата создания",
          "Статус",
        ],
        pos(900101, "BDM 99", "Тест Руководитель", "KT&G BDM", null),
        ...Array.from({ length: TSMS }, (_, i) =>
          pos(900200 + i, tsm(i + 1), `Тест Сотрудник ${i + 1}`, "Мерчендайзер", "BDM 99"),
        ),
        pos(900104, "Supervisor TST", "Тест Супервайзер", "Супервайзер", null),
        ...Array.from({ length: REPS }, (_, i) =>
          pos(
            900300 + i,
            rep(i + 1),
            `Тест Агент ${i + 1}`,
            "Торговый представитель",
            "Supervisor TST",
          ),
        ),
      ],
    },
  ]);

// The days of the sheet (no Sundays) and a row per client of a zone.
const DAYS = [2, 3, 9, 10, 11, 16];
const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const client = (zone: string, store: number, codes: Record<number, string>): Row => [
  null,
  "Тестоград",
  zone,
  zone,
  store,
  `Тест магазин ${store}`,
  null,
  null,
  ...DAYS.map((d) => codes[d] ?? null),
];
// Every TSM has three planned visits of the week and misses some of them (TSM n the 9th when n
// is odd, the 10th when n is a multiple of 3, TSM 12 the 11th too — two in a row by the end of
// the week); a rep visits every day and takes an order on some.
const routes = () =>
  book(
    [
      {
        name: "Анализ маршрута",
        rows: [
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
            ...DAYS.map((d) => WEEKDAYS[new Date(Date.UTC(2026, 10, d)).getUTCDay()]!),
          ],
          [null, null, null, null, null, null, null, "1 неделя", ...DAYS],
          ...Array.from({ length: TSMS }, (_, i) =>
            client(tsm(i + 1), 900101 + i, {
              2: "P",
              9: (i + 1) % 2 ? "X" : "P",
              10: (i + 1) % 3 ? "P" : "X",
              11: i + 1 === 12 ? "X" : "P",
            }),
          ),
          ...Array.from({ length: REPS }, (_, i) =>
            client(rep(i + 1), 900201 + i, {
              2: "PD",
              9: (i + 1) % 2 ? "PD" : "P",
              10: "P",
              11: (i + 1) % 5 ? "P" : "PD",
            }),
          ),
          ["Итоговое количество визитов в день:", null, null, null, "Итого", null, null, 1],
        ],
      },
    ],
    // Made on 16 November, 18:00 in Tashkent.
    new Date("2026-11-16T13:00:00Z"),
  );

// The bot: a Market Visit and a stock check of the first TSM at their store on the 9th.
const bot = () =>
  book([
    {
      name: "Market Visit (Connect Bot)",
      rows: [
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
          "Торговая точка открыта?",
        ],
        [
          501,
          "Тест магазин 900102",
          900102,
          "Тестоград",
          "Выполнено",
          `${tsm(2)} - Тест Сотрудник 2`,
          "09.11.2026 12:00",
          "2026-11",
          0,
          null,
          "https://example.test/photo.jpg",
          "Тестовая анкета",
          "Да",
        ],
      ],
    },
    {
      name: "OOS check (Connect Bot)",
      rows: [
        [
          "ID Check",
          "Client",
          "Client ID",
          "Region",
          "Date of check",
          "Month",
          "Employee who completed the OOS",
          "OOS issue",
          "Not enough issue",
          "Order Created",
          "Created Order Number",
          "Order Status",
          "Delivery status",
          "SKU-TEST-001",
        ],
        [
          601,
          "Тест магазин 900102",
          900102,
          "Тестоград",
          "09.11.2026 12:10",
          "2026-11",
          `${tsm(2)} - Тест Сотрудник 2`,
          0,
          0,
          "Нет",
          null,
          null,
          null,
          "В наличии",
        ],
      ],
    },
  ]);

async function setup() {
  const owner = await withAccess(await createTestUser("OWNER"));
  await importConnectFiles(owner, [
    { name: "employees.xlsx", buffer: await employees() },
    { name: "route.xlsx", buffer: await routes() },
    { name: "bot.xlsx", buffer: await bot() },
  ]);
  return owner;
}

// The three levels, and a rep's own page: a rep has a route and nothing in Connect Bot.
const LEVELS: Record<string, string>[] = [
  { view: "exec" },
  { view: "manager" },
  { view: "executor", person: tsm(2) },
  { view: "executor", person: rep(1) },
];

const report = (extra: Record<string, string> = {}) =>
  buildConnectReport(parseConnectQuery({ ...WEEK, ...extra }, true), TODAY);

async function open(source: ConnectReport, lang: "ru" | "en" | "ko" = "ru") {
  const wb = new ExcelJS.Workbook();
  await withExportLocale(lang, async () => {
    await wb.xlsx.load((await connectXlsx(source, TODAY)) as unknown as ArrayBuffer);
  });
  return { wb, ...readBook(wb) };
}

// The page of a level, as the browser gets it: its titles and its list of sections.
function page(source: ConnectReport) {
  const months = monthsLabel(source.months);
  const href = (change: Record<string, string | null>) =>
    connectHref("/connect", source.query, change);
  const personHref = (person: string) => `/connect?view=executor&person=${person}`;
  const view = source.exec ? (
    <ExecView data={source.exec} months={months} insights={source.insights} href={href} />
  ) : source.manager ? (
    <ManagerView
      data={source.manager}
      months={months}
      sales={source.salesDate !== null}
      insights={source.insights}
      href={href}
      personHref={personHref}
    />
  ) : (
    <ExecutorView data={source.executor!} months={months} insights={source.insights} href={href} />
  );
  const { container, unmount } = render(view);
  const text = (element: Element) => element.textContent!.replace(/\s+/g, " ").trim();
  const titles = [...container.querySelectorAll("h2")];
  // The first cells of the rows of the tables in the block under each title.
  const rows = new Map(
    titles.map((heading) => [
      text(heading),
      [...heading.closest('[data-slot="card"]')!.querySelectorAll("tbody tr")].map((tr) =>
        text(tr.children[0]!),
      ),
    ]),
  );
  const result = {
    titles: titles.map(text),
    sections: [...container.querySelectorAll("[data-connect-section]")].map((element) =>
      element.getAttribute("data-connect-section")!,
    ),
    rows: (title: string) => rows.get(title)!,
  };
  unmount();
  return result;
}

// A cell of two lines (a code and the name under it) as the page's cell reads.
const flat = (value: unknown) => String(value).replace(/\n/g, "").replace(/\s+/g, " ").trim();

describe("Connect: the Excel file is the page on one sheet, with the lists on their own", () => {
  beforeEach(resetDb);

  it("has the level's blocks in the page's order, and the page's links to them", async () => {
    await setup();
    for (const extra of LEVELS) {
      const source = await report(extra);
      const web = page(source);
      const file = await open(source);
      // The same titles, top to bottom; the file ends with the norms and what the colours mean.
      expect(file.page.titles).toEqual([...web.titles, "Нормы и цвета"]);
      // The links at the top are the page's list of sections (and the norms at the bottom),
      // and each opens its block.
      const chips = file.page.links.filter((link) => link.sheet === file.names[0]);
      expect(chips.map((chip) => chip.text)).toEqual(
        web.sections.length > 2 ? [...web.sections, "Нормы и цвета"] : [],
      );
      const headings = file.page.headings.map((h) => h.text);
      for (const chip of chips) {
        const at = String(said(file.page.ws.getRow(chip.row).getCell(1)));
        expect(headings).toContain(at);
        // «Требует внимания» opens «Требует внимания · 5»; «Путь OOS» the block of that name.
        expect(at.startsWith(chip.text) || at.includes(chip.text.split(" ")[0]!)).toBe(true);
      }
      // The first sheet is named as the level is, and is a page: no filter, nothing frozen.
      expect(file.names[0]).toBe(t(`connect.views.${source.query.view}`));
      expect(file.page.ws.autoFilter).toBeUndefined();
      expect(file.page.ws.views[0]?.state).not.toBe("frozen");
    }
  });

  it("shows the page's first rows of a list and links to the sheet with all of them", async () => {
    await setup();
    const source = await report({ view: "exec" });
    const web = page(source);
    const file = await open(source);
    const zones = source.exec!.routes!.analysis.zones;
    expect(zones).toHaveLength(TSMS + REPS);

    // The TSMs' ranking: the page's first 15 of 24, in its order; the rest are on the sheet.
    const ranking = file.page.block("TSM: посещаемость по зонам");
    const table = ranking.tables()[0]!;
    expect(table.head).toEqual([
      "Зона",
      "Организация",
      "План",
      "Посещаемость",
      "Пропущено",
      "Ни разу не посещено",
    ]);
    expect(table.rows).toHaveLength(SHOWN.ranking);
    expect(table.rows.map((row) => flat(row[0]))).toEqual(web.rows("TSM: посещаемость по зонам"));
    expect(ranking.links).toEqual([
      { text: `Весь список: ${TSMS + REPS} строк →`, sheet: "Маршруты", row: 1 },
    ]);
    // The sheet has every zone, a record a row, under the header.
    expect(file.rows("Маршруты")).toHaveLength(TSMS + REPS);
    expect(file.rows("Маршруты").map((row) => row[0])).toEqual(zones.map((z) => z.zone));

    // The calendar: the page's first 20 zones, the worst first, and the same link.
    const calendar = file.page.block("Календарь посещаемости TSM");
    const shown = calendar.rows.map((row) => flat(row[0])).filter((text) => /^TSM_TST_/.test(text));
    expect(shown).toHaveLength(SHOWN.calendar.exec);
    expect(shown).toEqual(web.rows("Календарь посещаемости TSM"));
    expect(calendar.links.map((link) => link.sheet)).toEqual(["Маршруты"]);
    // A calendar that shows every zone has no link.
    const hitRate = file.page.block("Календарь hit rate DR");
    expect(
      hitRate.rows.map((row) => flat(row[0])).filter((text) => /^DR_TST_/.test(text)),
    ).toHaveLength(SHOWN.calendar.exec);
    expect(hitRate.links.map((link) => link.sheet)).toEqual(["Маршруты"]);

    // The sheet's link goes back to the block the list belongs to.
    const back = file.back("Маршруты")!;
    expect(back).toMatchObject({
      text: "← Руководство: Маршруты и дисциплина",
      sheet: "Руководство",
      at: "Маршруты и дисциплина",
    });
    expect(file.page.titles).toContain(back.at);
    // The list stays a table to filter: the header in row 1, the records under it.
    const list = file.wb.getWorksheet("Маршруты")!;
    expect(list.autoFilter).toBe(`A1:T${TSMS + REPS + 1}`);
    expect(list.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });

    // A manager's page has the zones as a table (all 46 are under its limit of 100): the same
    // rows in the same order, and the sheet all the same — it is a list people work through,
    // with every column.
    const team = await report({ view: "manager" });
    const teamFile = await open(team);
    const teamZones = teamFile.page.block("Зоны").tables()[0]!;
    expect(teamZones.rows).toHaveLength(TSMS + REPS);
    expect(teamZones.rows.map((row) => flat(row[0]))).toEqual(page(team).rows("Зоны"));
    expect(teamZones.head).toEqual(
      expect.arrayContaining([
        "Зона",
        "Группа",
        "Руководитель",
        "Посещаемость",
        "Hit rate",
        "Класс",
      ]),
    );
    expect(teamFile.page.block("Зоны").links).toEqual([
      { text: `Весь список: ${TSMS + REPS} строк →`, sheet: "Маршруты", row: 1 },
    ]);
  });

  it("makes a sheet only of a whole list, and a link opens every one", async () => {
    await setup();
    for (const extra of LEVELS.slice(0, 3)) {
      const file = await open(await report(extra));
      expect(file.orphans).toEqual([]);
      // What the page shows in full is on the first sheet, not on a sheet of its own.
      for (const gone of [
        "Сводка",
        "Визиты и Connect",
        "По дням",
        "По регионам",
        "OOS и заказы",
        "Заказы по статусам",
        "Нехватка по товарам",
        "Market Visit",
        "Вопросы MV",
        "Оборудование",
      ])
        expect(file.names).not.toContain(gone);
      // Every list goes back to a heading of the first sheet.
      const headings = file.page.headings.map((h) => h.text);
      for (const name of file.names.slice(1)) {
        const back = file.back(name)!;
        expect(back.sheet).toBe(file.names[0]);
        expect(headings).toContain(back.at);
      }
    }
    // Leadership: the zones and the stores to act on are lists; a manager also has the tree and
    // the TSMs; one TSM their own stores.
    expect((await open(await report({ view: "exec" }))).names).toEqual([
      "Руководство",
      "Требует внимания",
      "Маршруты",
      "Пропущенные визиты",
      "DR без заказа",
    ]);
    expect((await open(await report({ view: "manager" }))).names).toEqual([
      "Менеджеры",
      "Требует внимания",
      "Иерархия",
      "По сотрудникам",
      "Маршруты",
      "Пропущенные визиты",
      "DR без заказа",
    ]);
    expect((await open(await report({ view: "executor", person: tsm(12) }))).names).toEqual([
      "Исполнители",
      "Пропущенные визиты",
      "Визиты внимание",
      "Не посещены",
    ]);
  });

  it("colours the first sheet by the owner's norms, as the page", async () => {
    const owner = await setup();
    const RED = "FFFED5D7";
    const AMBER = "FFFFEEBF";
    const GREEN = "FFD9F5EB";
    const read = async () => {
      const file = await open(await report({ view: "exec" }));
      const ranking = file.page.block("TSM: посещаемость по зонам").tables()[0]!;
      const calendar = file.page.block("Календарь посещаемости TSM");
      const zone = (code: string) =>
        calendar.cells.find((row) => flat(said(row[0]!)).startsWith(`${code}Тест`))!;
      return {
        // The worst zone of the ranking: its share and the mark on its left edge.
        worst: ranking.cells[0]!,
        // A day of the calendar and the period's share at the end of the row.
        day: (code: string) => zone(code)[1]!,
        total: (code: string) => zone(code).at(-2)!,
        tile: file.page.stat("План визитов выполнен").cell,
        routes: file.page.block("Маршруты и дисциплина").stat("Посещаемость").cell,
        norms: file.page.block("Нормы и цвета").tables()[0]!,
      };
    };

    // The standard norms: attendance 95% (amber from 80.75%).
    const standard = await read();
    // TSM 3 missed both the 9th and the 10th: 1 of 3.
    expect(flat(said(standard.worst[0]!))).toBe("TSM_TST_3Тест Сотрудник 3");
    expect([standard.worst[3]!.value, fillOf(standard.worst[3]!)]).toEqual([33.3, RED]);
    expect(standard.worst[0]!.border?.left).toMatchObject({
      style: "thick",
      color: { argb: "FFFB2C36" },
    });
    // A day: 0 of 1 planned is red, 1 of 1 green; the period's share in its colour.
    expect([standard.day("TSM_TST_3").value, fillOf(standard.day("TSM_TST_3"))]).toEqual([0, RED]);
    expect([standard.total("TSM_TST_3").value, fillOf(standard.total("TSM_TST_3"))]).toEqual([
      33.3,
      RED,
    ]);
    expect([standard.total("TSM_TST_2").value, fillOf(standard.total("TSM_TST_2"))]).toEqual([
      100,
      GREEN,
    ]);
    // The planned visits of everyone, the reps included: close to the target, in amber.
    expect([standard.routes.value, inkOf(standard.routes)]).toEqual([84.8, "FFBB4D00"]);
    expect(standard.norms.row("Посещаемость — цель")[1]!.value).toBe("95%");

    // The owner lowers the targets: the same numbers, other colours.
    await saveConnectRules(owner, { ...DEFAULT_RULES, attendance: 35 });
    const lowered = await read();
    // 33.3% is close to a target of 35%; the share of everyone reaches it.
    expect([lowered.worst[3]!.value, fillOf(lowered.worst[3]!)]).toEqual([33.3, AMBER]);
    expect(lowered.worst[0]!.border?.left?.color?.argb).toBe("FFFFB900");
    expect(fillOf(lowered.total("TSM_TST_3"))).toBe(AMBER);
    expect(fillOf(lowered.day("TSM_TST_3"))).toBe(RED);
    expect(inkOf(lowered.routes)).toBe("FF007A55");
    expect(lowered.norms.row("Посещаемость — цель")[1]!.value).toBe("35%");
  });

  it("builds the file for the three levels in Russian, English and Korean", async () => {
    await setup();
    for (const extra of LEVELS) {
      const source = await report(extra);
      const ru = await open(source);
      for (const lang of ["en", "ko"] as const) {
        const file = await open(source, lang);
        expect(file.names[0]).toBe(
          await withExportLocale(lang, async () => t(`connect.views.${source.query.view}`)),
        );
        // The same blocks, lists and links in every language.
        expect(file.page.titles).toHaveLength(ru.page.titles.length);
        expect(file.names).toHaveLength(ru.names.length);
        expect(file.page.tables().map((table) => table.rows.length)).toEqual(
          ru.page.tables().map((table) => table.rows.length),
        );
        expect(file.orphans).toEqual([]);
        expect(file.page.titles.join()).not.toMatch(/[А-Яа-яЁё]{4,}/);
      }
    }
    // One TSM's own file in Korean, with the route: «not visited» of the plan and of the route
    // are two lists with names of their own.
    const one = await open(await report({ view: "executor", person: tsm(12) }), "ko");
    expect(one.names).toEqual(["담당자", "미방문", "주의 필요 방문", "계획 미방문"]);
    expect(one.page.titles[0]).toBe("루트 TSM_TST_12");
  }, 60_000);
});
