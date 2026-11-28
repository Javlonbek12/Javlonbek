import { render, screen, within } from "@testing-library/react";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The pages read the session through next/headers: the test hands it a token (and no picked
// upload, so the pages show the current one).
const jar = vi.hoisted(() => ({ token: "", cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === jar.cookie && jar.token ? { name, value: jar.token } : undefined,
  }),
  headers: async () => new Headers(),
}));

import { GET as downloadXlsx } from "@/app/api/sop/xlsx/route";
import SopLayout from "@/app/(app)/sop/layout";
import SopOverviewPage from "@/app/(app)/sop/page";
import SopStockPage from "@/app/(app)/sop/stock/page";
import { CapsView } from "@/components/sop/caps";
import { CompareView } from "@/components/sop/compare";
import { FindingsView } from "@/components/sop/findings";
import { MaterialsView } from "@/components/sop/materials";
import { OrderView } from "@/components/sop/order";
import { SkuCardView } from "@/components/sop/sku-card";
import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { DEFAULT_ROLE_CONFIG, saveRoleConfig } from "@/modules/core/access/config";
import { canOpenPath } from "@/modules/core/access/paths";
import { createSessionToken, SESSION_COOKIE } from "@/modules/core/auth/session";
import { MODULES, modulesForRole } from "@/modules/core/registry";
import { helpPagesFor } from "@/modules/ai/help-shared";
import { compareUploads, forecastAccuracy } from "@/modules/sop/compare";
import { filterFindings, parseFindingsFilter } from "@/modules/sop/filter";
import { loadSopDataFor } from "@/modules/sop/load";
import {
  baselineOf,
  canUseSop,
  deleteSopUpload,
  inspectSopFile,
  listSopUploads,
  loadSopChecklist,
  loadSopModel,
  loadSopSettings,
  saveSopSettings,
  setSopMark,
  SopError,
  tickSopChecklist,
  uploadSop,
} from "@/modules/sop/service";
import { DEFAULT_SOP_SETTINGS } from "@/modules/sop/settings";
import { skuCard } from "@/modules/sop/sku";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { makeMaterial, makeModel, makeSku, MONTHS, sopWorkbook } from "@/tests/helpers/sop";

// «S&OP» end to end on a synthetic workbook: upload → pages → marks → another upload; access.
// Factories AAA and BBB, products «SKU …» — nothing real.

const SECRET = "test-session-secret-test-session-secret";
const TODAY = "2026-11-28";
const noop = async () => {};
const all = (value: number) => MONTHS.map(() => value);

// November's sheet. SKU A is in order; SKU B is ordered under the minimum batch in January and
// its distributor runs dry; SKU OLD is delisted but still ordered; SKU N is not launched.
const november = (change: { bJanuary?: number } = {}) =>
  makeModel(
    [
      makeSku("SKU A", {
        po: [0, 200, 0, 200, 0, 200, 0, 200, 0, 200, 0],
        sellIn: all(100),
        sellThru: all(100),
        entityStock: [200, 300, 200, 300, 200],
        distStock: [150, 150, 150, 150, 150],
      }),
      makeSku("SKU B", {
        factory: "BBB",
        type: "83 S",
        po: [0, 0, 0, 0, 0, 0, 0, change.bJanuary ?? 150, 0, 0, 0],
        sellIn: all(50),
        sellThru: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 300],
        entityStock: [300, 300, 300, 300, 300],
        distStock: [100, 100, 100, 100, 100],
      }),
      makeSku("SKU OLD", { status: "Delist", po: [0, 0, 0, 0, 0, 0, 250] }),
      makeSku("SKU N", {
        status: "New (not launched)",
        po: [0, 0, 0, 0, 0, 0, 300],
        sellIn: [0, 0, 0, 0, 0, 0, 0, 200],
      }),
    ],
    {
      materials: {
        sheet: "3. Materials",
        planMonths: MONTHS.slice(5),
        rows: [
          makeMaterial("SKU A", { totalBox: 900, planTotal: 600, plan: [200, 0, 200, 0, 200, 0] }),
          makeMaterial("SKU OLD", { status: "Delist", totalBox: 300, planTotal: 250 }),
        ],
      },
    },
  );

const owner = async () => withAccess(await createTestUser("OWNER", { firstName: "Тествладелец" }));
const signIn = (userId: string) => {
  jar.cookie = SESSION_COOKIE;
  jar.token = createSessionToken(userId, SECRET);
};
const request = (url: string, userId: string) =>
  new Request(url, {
    headers: { cookie: `${SESSION_COOKIE}=${createSessionToken(userId, SECRET)}` },
  });

describe("S&OP", () => {
  beforeEach(async () => {
    await resetDb();
    jar.token = "";
  });

  it("reads a file before it is saved and says which cycle it is", async () => {
    const user = await owner();
    await saveSopSettings(user, { ...DEFAULT_SOP_SETTINGS, market: "TST" });
    const file = await sopWorkbook(november(), { extraSheets: ["Other"] });
    expect(
      await inspectSopFile(user, { name: "Plan_One Document_261113.xlsx", buffer: file }),
    ).toEqual({
      sheet: "PSI TST (test)",
      skus: 4,
      materials: 2,
      months: MONTHS,
      lastActual: "2026-10",
      detected: "2026-11",
      fileDate: "2026-11-13",
      cycle: "2026-11",
    });
    // Nothing is saved by a look.
    expect(await listSopUploads()).toEqual([]);
  });

  it("stores an upload as the parsed sheet and shows it on the pages", async () => {
    const user = await owner();
    await saveSopSettings(user, {
      ...DEFAULT_SOP_SETTINGS,
      market: "TST",
      containerFactory: "BBB",
    });
    const file = await sopWorkbook(november());
    const upload = await uploadSop(user, {
      name: "Plan_261113.xlsx",
      buffer: file,
      kind: "HQ_DRAFT",
      note: "  первый   вариант ",
    });
    expect(upload).toMatchObject({
      cycle: "2026-11",
      kind: "HQ_DRAFT",
      fileDate: "2026-11-13",
      market: "TST",
      note: "первый вариант",
      skuCount: 4,
      fileSize: file.length,
    });
    expect(upload.dataSize).toBeGreaterThan(1000);
    const [row] = await listSopUploads();
    expect(row).toMatchObject({ id: upload.id, uploaderName: "Тествладелец" });
    const stored = await loadSopModel(upload.id);
    expect(stored?.skus.map((s) => s.name)).toEqual(["SKU A", "SKU B", "SKU OLD", "SKU N"]);

    signIn(user.id);
    render(await SopOverviewPage());
    expect(screen.getByText("Plan_261113.xlsx")).toBeInTheDocument();
    expect(screen.getByText("Что сделать сейчас")).toBeInTheDocument();
    expect(screen.getByText("Чек-лист цикла Nov'26")).toBeInTheDocument();
    // The order of the month whose materials are ordered now (February): nothing is ordered.
    expect(screen.getByText("Заказ на Feb'27")).toBeInTheDocument();
    expect(screen.getAllByText("PO на SKU, который выводят (Delist)").length).toBeGreaterThan(0);
    // The calendar marks today's step (the 28th: the final).
    expect(
      within(
        screen.getByText("Календарь месяца").closest("[data-slot='card']") as HTMLElement,
      ).getByText("сейчас"),
    ).toBeInTheDocument();
  });

  it("finds the sheet's errors and risks, and a mark on a finding survives a re-upload", async () => {
    const user = await owner();
    await saveSopSettings(user, {
      ...DEFAULT_SOP_SETTINGS,
      market: "TST",
      containerFactory: "BBB",
    });
    const first = await uploadSop(user, {
      name: "Plan_261109.xlsx",
      buffer: await sopWorkbook(november()),
      kind: "OURS",
    });
    const data = await loadSopDataFor(TODAY);
    expect(data.upload?.id).toBe(first.id);
    const found = data.report!.findings;
    const keys = found.map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "moq|BBB|SKU B|2027-01",
        "poDelist|AAA|SKU OLD|2026-12",
        "negativeDist|BBB|SKU B|2027-04",
        // Our own version: the closed month must be typed as sums.
        "m1SellInTyped|all|2026-10",
        // 150 cases in a container of 1 300.
        "containerFill|2027-01|2027-01",
        "materialsDelist|AAA|SKU OLD|",
      ]),
    );

    const view = (params: Record<string, string>, marks = data.marks) => {
      const filter = parseFindingsFilter(params);
      return render(
        <FindingsView
          findings={filterFindings(found, filter, new Set(marks.keys()))}
          all={found}
          marks={marks}
          cycle="2026-11"
          filter={filter}
          factories={["AAA", "BBB"]}
          skuName={null}
          baseline={null}
          markAction={noop}
          timeZone="Asia/Tashkent"
        />,
      );
    };
    const page = view({ severity: "error" });
    expect(screen.getByText("Заказ меньше минимальной партии (MOQ)")).toBeInTheDocument();
    expect(screen.getByText("Jan'27: PO 150 кор.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Поднимите заказ до 200 кор. или уберите его и объедините с соседним месяцем.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Контейнер заполнен не полностью")).not.toBeInTheDocument();
    page.unmount();

    // «Так и задумано» with a note.
    await setSopMark(user, {
      cycle: "2026-11",
      key: "moq|BBB|SKU B|2027-01",
      status: "ACCEPTED",
      note: "согласовано с заводом",
    });
    // The same sheet comes back from HQ: the mark is still on the finding.
    const second = await uploadSop(user, {
      name: "Plan_261113.xlsx",
      buffer: await sopWorkbook(november()),
      kind: "HQ_DRAFT",
    });
    const again = await loadSopDataFor(TODAY);
    expect(again.upload?.id).toBe(second.id);
    expect(again.baseline?.id).toBe(first.id);
    expect(again.report!.findings.map((f) => f.key)).toContain("moq|BBB|SKU B|2027-01");
    expect(again.marks.get("moq|BBB|SKU B|2027-01")).toMatchObject({
      status: "ACCEPTED",
      note: "согласовано с заводом",
      userName: "Тествладелец",
    });
    // HQ's copy is not checked for the sums of the closed month.
    expect(again.report!.findings.map((f) => f.rule)).not.toContain("m1SellInTyped");
    const marked = view({ severity: "error" }, again.marks);
    expect(screen.getByText(/Так и задумано · Тествладелец/)).toBeInTheDocument();
    expect(screen.getByText("«согласовано с заводом»")).toBeInTheDocument();
    marked.unmount();
    view({ severity: "error", hide: "1" }, again.marks);
    expect(screen.queryByText("Jan'27: PO 150 кор.")).not.toBeInTheDocument();

    // A changed finding is a new one: the order moved to 120 in the next version.
    await uploadSop(user, {
      name: "Plan_261114.xlsx",
      buffer: await sopWorkbook(november({ bJanuary: 120 })),
      kind: "HQ_DRAFT",
    });
    const third = await loadSopDataFor(TODAY);
    expect(third.marks.size).toBe(1);
    const moq = third.report!.findings.find((f) => f.rule === "moq")!;
    expect(moq.key).toBe("moq|BBB|SKU B|2027-01");
    // Against the version before, the order of a frozen month was changed.
    expect(third.report!.findings.map((f) => f.key)).toContain("frozenChanged|BBB|SKU B|2027-01");
    // Taking the mark off.
    await setSopMark(user, { cycle: "2026-11", key: moq.key, status: null });
    expect((await loadSopDataFor(TODAY)).marks.size).toBe(0);
  });

  it("renders every tab of an upload", async () => {
    const user = await owner();
    await saveSopSettings(user, {
      ...DEFAULT_SOP_SETTINGS,
      market: "TST",
      truckFactory: "AAA",
      containerFactory: "BBB",
      kaShare: 20,
    });
    await uploadSop(user, {
      name: "p.xlsx",
      buffer: await sopWorkbook(november()),
      kind: "HQ_DRAFT",
    });
    const data = await loadSopDataFor(TODAY);
    const report = data.report!;

    signIn(user.id);
    const stock = render(
      await SopStockPage({
        searchParams: Promise.resolve({ view: "leaving" }),
        params: Promise.resolve({}),
      }),
    );
    expect(screen.getByRole("link", { name: "SKU OLD" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "SKU A" })).not.toBeInTheDocument();
    stock.unmount();

    const order = render(
      <OrderView
        factories={report.factories}
        hints={report.hints}
        stamps={report.stamps}
        settings={data.settings}
        showAll
      />,
    );
    expect(screen.getByText("Завод AAA")).toBeInTheDocument();
    expect(screen.getByText("машина — 1 600 кор.")).toBeInTheDocument();
    expect(screen.getByText("контейнер — 1 300 кор.")).toBeInTheDocument();
    expect(screen.getAllByText("заказываем сейчас").length).toBe(2);
    expect(screen.getByText("Акцизные марки")).toBeInTheDocument();
    // December's production (550 cases) needs its stamps by November 21st: a week ago.
    expect(screen.getByText("срок прошёл 7 дн. назад")).toBeInTheDocument();
    expect(screen.getByText("275 000")).toBeInTheDocument();
    order.unmount();

    const caps = render(<CapsView rows={report.caps} settings={data.settings} />);
    expect(
      screen.getByText("Доля «KA» посчитана по настройке: 20 % от Sell-in."),
    ).toBeInTheDocument();
    // SKU A in November: 100 planned, 20 of them the key accounts', 80 for the distributor.
    const row = screen.getByRole("link", { name: "SKU A" }).closest("tr")!;
    expect(
      within(row)
        .getAllByRole("cell")
        .slice(1, 4)
        .map((c) => c.textContent),
    ).toEqual(["100", "20", "80"]);
    caps.unmount();

    const materials = render(
      <MaterialsView rows={report.materials} sheet="3. Materials" onlyFlagged={false} />,
    );
    expect(screen.getByText("остаток — риск списания")).toBeInTheDocument();
    expect(screen.getByText("SKU выводят — риск списания")).toBeInTheDocument();
    materials.unmount();
    const none = render(<MaterialsView rows={null} sheet={null} onlyFlagged={false} />);
    expect(screen.getByText("Листа материалов в этом файле нет")).toBeInTheDocument();
    none.unmount();

    const card = skuCard(report, "BBB|SKU B")!;
    render(
      <SkuCardView
        card={card}
        settings={data.settings}
        marks={data.marks}
        cycle="2026-11"
        back="/sop"
        markAction={noop}
        timeZone="Asia/Tashkent"
      />,
    );
    expect(screen.getByRole("heading", { name: "SKU B" })).toBeInTheDocument();
    expect(screen.getByText("Запас дистрибьютора уходит в минус")).toBeInTheDocument();
    expect(screen.getByText("Подсказка по заказу")).toBeInTheDocument();
  });

  it("keeps the checklist's ticks for the cycle", async () => {
    const user = await owner();
    await saveSopSettings(user, { ...DEFAULT_SOP_SETTINGS, market: "TST" });
    await uploadSop(user, { name: "p.xlsx", buffer: await sopWorkbook(november()), kind: "OURS" });
    await tickSopChecklist(user, { cycle: "2026-11", item: 1, done: true });
    await tickSopChecklist(user, { cycle: "2026-11", item: 9, done: true });
    await tickSopChecklist(user, { cycle: "2026-11", item: 9, done: false });
    expect(Object.keys(await loadSopChecklist("2026-11"))).toEqual(["1"]);
    expect((await loadSopChecklist("2026-11"))["1"]!.by).toBe(user.id);
    // Another upload of the cycle, and the ticks are still there; another cycle has its own.
    await uploadSop(user, {
      name: "p2.xlsx",
      buffer: await sopWorkbook(november()),
      kind: "HQ_FINAL",
    });
    expect((await loadSopDataFor(TODAY)).checklist).toHaveProperty("1");
    expect(await loadSopChecklist("2026-12")).toEqual({});
    await expect(
      tickSopChecklist(user, { cycle: "2026-11", item: 12, done: true }),
    ).rejects.toThrow(SopError);
    signIn(user.id);
    render(await SopOverviewPage());
    expect(screen.getByText("1 из 9")).toBeInTheDocument();
  });

  it("compares uploads: the cycle before as the baseline, the final against what was sent", async () => {
    const user = await owner();
    await saveSopSettings(user, { ...DEFAULT_SOP_SETTINGS, market: "TST" });
    // October's final forecast November's order of SKU A at 300; in November it is 200.
    const october = makeModel(
      [
        makeSku(
          "SKU A",
          {
            po: [0, 200, 0, 200, 0, 300, 0, 200],
            sellIn: [100, 100, 100, 100, 90, 100, 100],
            sellThru: [100, 100, 100, 100, 140, 100, 100],
            entityStock: [200, 300, 200, 300],
            distStock: [150, 150, 150, 150],
          },
          MONTHS,
          "2026-10",
        ),
      ],
      {},
      "2026-10",
    );
    const before = await uploadSop(user, {
      name: "Plan_261020.xlsx",
      buffer: await sopWorkbook(october),
      kind: "HQ_FINAL",
    });
    expect(before.cycle).toBe("2026-10");
    const ours = await uploadSop(user, {
      name: "Plan_261109.xlsx",
      buffer: await sopWorkbook(november()),
      kind: "OURS",
    });
    const uploads = await listSopUploads();
    // The latest cycle first: November's upload is the current one, October's is its baseline.
    expect(uploads.map((u) => u.cycle)).toEqual(["2026-11", "2026-10"]);
    expect(baselineOf(uploads, uploads[0]!)?.id).toBe(before.id);
    const data = await loadSopDataFor(TODAY);
    expect(data.report!.findings.map((f) => f.key)).toContain("frozenChanged|AAA|SKU A|2026-11");
    expect(data.report!.overview.closed).toMatchObject({
      sellIn: 150,
      forecastSellIn: 90,
      sellThru: 150,
      forecastSellThru: 140,
    });

    const final = await uploadSop(user, {
      name: "Plan_261120.xlsx",
      buffer: await sopWorkbook(november({ bJanuary: 200 })),
      kind: "HQ_FINAL",
    });
    const [oursModel, finalModel, octoberModel] = await Promise.all(
      [ours.id, final.id, before.id].map((id) => loadSopModel(id)),
    );
    const sides = [
      { model: oursModel!, cycle: "2026-11", kind: "OURS" as const },
      { model: finalModel!, cycle: "2026-11", kind: "HQ_FINAL" as const },
    ] as const;
    const comparison = compareUploads(...sides);
    expect(comparison.reconcile).toBe(true);
    expect(comparison.changes.map((c) => [c.name, c.month, c.metric, c.was, c.now])).toEqual([
      ["SKU B", "2027-01", "po", 150, 200],
      ["SKU B", "2027-01", "plan", 150, 200],
      ["SKU B", "2027-01", "out", 150, 200],
    ]);
    const accuracy = forecastAccuracy(
      { model: octoberModel!, cycle: "2026-10", kind: "HQ_FINAL" },
      sides[1],
    );
    render(
      <CompareView
        options={(await listSopUploads()).map((u) => ({ id: u.id, label: u.fileName }))}
        older={ours.id}
        newer={final.id}
        comparison={comparison}
        accuracy={accuracy}
      />,
    );
    expect(screen.getByText("Сверка финала 1:1")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Финал отличается от отправленного: ячеек — 3. Проверьте каждую и после этого обновите годовой файл.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Точность прогноза")).toBeInTheDocument();
    // October: 90 forecast for SKU A, 100 sold by it — within the norm; the sheet as a whole is not
    // (the other rows were not in October's file).
    expect(accuracy.rows.find((r) => r.name === "SKU A" && r.metric === "sellIn")).toMatchObject({
      forecast: 90,
      actual: 100,
      off: false,
    });
  });

  it("refuses files it cannot use, with a reason", async () => {
    const user = await owner();
    await saveSopSettings(user, { ...DEFAULT_SOP_SETTINGS, market: "TST" });
    const good = await sopWorkbook(november());
    const code = (promise: Promise<unknown>) =>
      promise.then(
        () => "ok",
        (error) => (error instanceof SopError ? error.code : `other: ${error}`),
      );
    const upload = (buffer: Buffer, extra: { kind?: string; cycle?: string } = {}) =>
      code(
        uploadSop(user, { name: "p.xlsx", buffer, kind: extra.kind ?? "OURS", cycle: extra.cycle }),
      );
    expect(await upload(Buffer.from("это не книга"))).toBe("notXlsx");
    expect(await upload(Buffer.alloc(0))).toBe("empty");
    expect(await upload(await sopWorkbook(november(), { market: "ZZZ" }))).toBe("noSheet");
    expect(await upload(good, { kind: "ЧТО-ТО" })).toBe("kind");
    // The cycle must be a month of the sheet with a closed month before it.
    expect(await upload(good, { cycle: "2031-01" })).toBe("cycle");
    expect(await upload(good, { cycle: MONTHS[0] })).toBe("cycle");
    expect(await listSopUploads()).toEqual([]);
    // The person may correct the cycle.
    expect(await upload(good, { cycle: "2026-12" })).toBe("ok");
    expect((await listSopUploads())[0]!.cycle).toBe("2026-12");
    expect((await loadSopDataFor(TODAY)).report!.months.closed).toBe("2026-11");
  });

  it("deletes an upload but keeps the cycle's marks and ticks", async () => {
    const user = await owner();
    await saveSopSettings(user, { ...DEFAULT_SOP_SETTINGS, market: "TST" });
    const upload = await uploadSop(user, {
      name: "p.xlsx",
      buffer: await sopWorkbook(november()),
      kind: "OURS",
    });
    await setSopMark(user, { cycle: "2026-11", key: "moq|BBB|SKU B|2027-01", status: "CHECKED" });
    await tickSopChecklist(user, { cycle: "2026-11", item: 4, done: true });
    await deleteSopUpload(user, upload.id);
    expect(await listSopUploads()).toEqual([]);
    expect(await db.sopMark.count()).toBe(1);
    expect(await loadSopChecklist("2026-11")).toHaveProperty("4");
    await expect(deleteSopUpload(user, upload.id)).rejects.toMatchObject({ code: "notFound" });
    const empty = await loadSopDataFor(TODAY);
    expect([empty.upload, empty.report, empty.broken]).toEqual([null, null, false]);
    signIn(user.id);
    render(await SopOverviewPage());
    expect(screen.getByText("Файл S&OP ещё не загружен")).toBeInTheDocument();
  });

  it("downloads the upload as Excel: findings, stock, order, hints, caps", async () => {
    const user = await owner();
    await saveSopSettings(user, { ...DEFAULT_SOP_SETTINGS, market: "TST", kaShare: 20 });
    expect((await downloadXlsx(request("http://localhost/api/sop/xlsx", user.id))).status).toBe(
      404,
    );
    await uploadSop(user, { name: "p.xlsx", buffer: await sopWorkbook(november()), kind: "OURS" });
    await setSopMark(user, {
      cycle: "2026-11",
      key: "moq|BBB|SKU B|2027-01",
      status: "CHECKED",
      note: "посмотрел",
    });
    const response = await downloadXlsx(request("http://localhost/api/sop/xlsx", user.id));
    expect(response.status).toBe(200);
    expect(decodeURIComponent(response.headers.get("content-disposition")!)).toContain(
      "S&OP Nov'26.xlsx",
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    expect(book.worksheets.map((ws) => ws.name)).toEqual([
      "Ошибки и риски",
      "Запасы",
      "Заказ",
      "Подсказка по заказу",
      "Лимиты отгрузки",
    ]);
    const findings = book.getWorksheet("Ошибки и риски")!;
    const rows: unknown[][] = [];
    findings.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
    const moq = rows.find((row) => row[1] === "Заказ меньше минимальной партии (MOQ)")!;
    expect(moq.slice(0, 6)).toEqual([
      "Ошибка",
      "Заказ меньше минимальной партии (MOQ)",
      "SKU B",
      "BBB",
      "Jan'27",
      "Jan'27: PO 150 кор.",
    ]);
    expect(moq[8]).toBe("Проверено: посмотрел");
    expect(book.getWorksheet("Запасы")!.getRow(2).getCell(1).value).toBe("SKU A");

    // The caps alone, for the sales team.
    const caps = await downloadXlsx(request("http://localhost/api/sop/xlsx?part=caps", user.id));
    const capsBook = new ExcelJS.Workbook();
    await capsBook.xlsx.load(await caps.arrayBuffer());
    expect(capsBook.worksheets.map((ws) => ws.name)).toEqual(["Лимиты отгрузки"]);
    expect((capsBook.worksheets[0]!.getRow(2).values as unknown[]).slice(1, 6)).toEqual([
      "SKU A",
      "AAA",
      100,
      20,
      80,
    ]);
  });

  it("saves the norms and counts with them", async () => {
    const user = await owner();
    expect(await loadSopSettings()).toEqual(DEFAULT_SOP_SETTINGS);
    await saveSopSettings(user, { ...DEFAULT_SOP_SETTINGS, market: "TST", moq: 100 });
    expect((await loadSopSettings()).moq).toBe(100);
    await uploadSop(user, {
      name: "p.xlsx",
      buffer: await sopWorkbook(november()),
      kind: "HQ_DRAFT",
    });
    expect((await loadSopDataFor(TODAY)).report!.findings.map((f) => f.rule)).not.toContain("moq");
    await saveSopSettings(user, null);
    expect(await loadSopSettings()).toEqual(DEFAULT_SOP_SETTINGS);
  });
});

describe("S&OP access", () => {
  beforeEach(async () => {
    await resetDb();
    jar.token = "";
  });

  const layout = () =>
    SopLayout({ children: null, params: Promise.resolve({}) }).then(
      () => "shown",
      (error: { digest?: string }) => String(error.digest),
    );

  it("is the owner's by default; nobody else has the section until it is switched on", async () => {
    const boss = await owner();
    const manager = await withAccess(await createTestUser("MANAGER"));
    const member = await withAccess(await createTestUser("MEMBER"));
    expect([boss, manager, member].map(canUseSop)).toEqual([true, false, false]);
    const sections = (user: typeof member) =>
      modulesForRole(user.role, MODULES, user.access.modules).map((m) => m.id);
    expect(sections(boss)).toContain("sop");
    expect(sections(manager)).not.toContain("sop");
    expect(sections(member)).not.toContain("sop");
    expect(canOpenPath(member, "/sop/findings")).toBe(false);
    expect(canOpenPath(boss, "/sop/findings")).toBe(true);
    expect(helpPagesFor(member).map((p) => p.href)).not.toContain("/sop/guide");
    expect(helpPagesFor(boss).map((p) => p.href)).toEqual(
      expect.arrayContaining(["/sop", "/sop/uploads", "/sop/guide"]),
    );

    // Without the section: no page, no upload, no norms, no marks, no download.
    signIn(member.id);
    expect(await layout()).toContain("/?denied=sop");
    const file = await sopWorkbook(november());
    await expect(
      uploadSop(member, { name: "p.xlsx", buffer: file, kind: "OURS" }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(inspectSopFile(member, { name: "p.xlsx", buffer: file })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(saveSopSettings(member, DEFAULT_SOP_SETTINGS)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      setSopMark(member, { cycle: "2026-11", key: "moq|x", status: "CHECKED" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      tickSopChecklist(member, { cycle: "2026-11", item: 1, done: true }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await downloadXlsx(request("http://localhost/api/sop/xlsx", member.id))).status).toBe(
      403,
    );
    expect((await downloadXlsx(new Request("http://localhost/api/sop/xlsx"))).status).toBe(401);

    signIn(boss.id);
    expect(await layout()).toBe("shown");
  });

  it("opens to a role the owner switched it on for — with everything in it", async () => {
    const boss = await owner();
    await saveRoleConfig(boss, {
      ...DEFAULT_ROLE_CONFIG,
      MEMBER: {
        ...DEFAULT_ROLE_CONFIG.MEMBER,
        modules: [...DEFAULT_ROLE_CONFIG.MEMBER.modules, "sop"],
      },
    });
    const member = await withAccess(await createTestUser("MEMBER", { firstName: "Тестсотрудник" }));
    const manager = await withAccess(await createTestUser("MANAGER"));
    expect([canUseSop(member), canUseSop(manager)]).toEqual([true, false]);
    signIn(member.id);
    expect(await layout()).toBe("shown");
    await saveSopSettings(member, { ...DEFAULT_SOP_SETTINGS, market: "TST" });
    const upload = await uploadSop(member, {
      name: "p.xlsx",
      buffer: await sopWorkbook(november()),
      kind: "OURS",
    });
    await setSopMark(member, { cycle: "2026-11", key: "moq|BBB|SKU B|2027-01", status: "CHECKED" });
    await tickSopChecklist(member, { cycle: "2026-11", item: 1, done: true });
    expect((await listSopUploads())[0]).toMatchObject({
      id: upload.id,
      uploaderName: "Тестсотрудник",
    });
    expect((await downloadXlsx(request("http://localhost/api/sop/xlsx", member.id))).status).toBe(
      200,
    );
    await deleteSopUpload(member, upload.id);
    expect(await listSopUploads()).toEqual([]);
  });
});
