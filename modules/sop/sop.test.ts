import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { withLocale } from "@/lib/i18n/server";
import { CYCLE, makeMaterial, makeModel, makeSku, MONTHS } from "@/tests/helpers/sop";

import {
  CALENDAR_STEPS,
  checklistCounts,
  checklistRules,
  currentStep,
  parseChecklist,
} from "./calendar";
import { filterFindings, filterStock, parseFindingsFilter, parseStockView } from "./filter";
import { RULE_IDS, RULES, type Finding } from "./findings";
import { findingsHref, skuHref, skuKeyOf } from "./links";
import { buildSopReport } from "./report";
import {
  DEFAULT_SOP_SETTINGS,
  isDefaultSopSettings,
  parseSopSettings,
  readSopSettings,
  SOP_SETTING_FIELDS,
} from "./settings";
import { skuCard } from "./sku";
import { cases, coverText, describeFinding, monthLabel } from "./texts";
import { addMonths, isMonth, monthsBetween } from "./types";

const all = (value: number) => MONTHS.map(() => value);
const SETTINGS = { ...DEFAULT_SOP_SETTINGS, truckFactory: "AAA", containerFactory: "BBB" };

describe("months", () => {
  it("adds and counts months across years", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(monthsBetween("2026-11", "2027-02")).toBe(3);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-01")).toBe(true);
    expect(monthLabel("2026-11")).toBe("Nov'26");
    expect(monthLabel("не месяц")).toBe("не месяц");
  });
});

describe("the calendar and the checklist", () => {
  it("names the step today falls on", () => {
    expect(currentStep(1)).toEqual({ key: "newFile", state: "next" });
    expect(currentStep(3)).toEqual({ key: "newFile", state: "now" });
    expect(currentStep(8)).toEqual({ key: "closeMonth", state: "now" });
    expect(currentStep(18)).toEqual({ key: "meetings", state: "now" });
    expect(currentStep(28)).toEqual({ key: "final", state: "now" });
    expect(CALENDAR_STEPS.map((s) => s.day)).toEqual([3, 5, 9, 12, 17, 20]);
  });

  it("counts the unmarked findings behind each point", () => {
    const finding = (rule: Finding["rule"], key: string) => ({ rule, key }) as Finding;
    const counts = checklistCounts(
      [
        finding("moq", "a"),
        finding("regularRun", "b"),
        finding("poDelist", "c"),
        finding("runRate", "d"),
      ],
      new Set(["b"]),
    );
    expect(counts).toMatchObject({ 5: 1, 6: 1, 7: 0, 1: 0 });
    expect(checklistRules(6)).toEqual(["moq", "regularRun", "containerFill", "containerRun"]);
    // Points 1, 8 and 9 are for a person to confirm: the file cannot show them.
    expect([1, 8, 9].map((item) => checklistRules(item as 1 | 8 | 9))).toEqual([[], [], []]);
  });

  it("reads the saved ticks and drops what is not one", () => {
    expect(
      parseChecklist({
        1: { by: "u1", at: "2026-11-05T10:00:00.000Z" },
        2: "да",
        12: { by: "u1", at: "x" },
      }),
    ).toEqual({ 1: { by: "u1", at: "2026-11-05T10:00:00.000Z" } });
    expect(parseChecklist(null)).toEqual({});
  });
});

describe("settings", () => {
  const form = () =>
    Object.fromEntries(
      SOP_SETTING_FIELDS.map((field) => [
        field.key,
        DEFAULT_SOP_SETTINGS[field.key] === null ? "" : String(DEFAULT_SOP_SETTINGS[field.key]),
      ]),
    );

  it("reads the form back as the standard settings", () => {
    const read = readSopSettings(form());
    expect(read.invalid).toBeNull();
    expect(read.settings).toEqual(DEFAULT_SOP_SETTINGS);
    expect(isDefaultSopSettings(read.settings!)).toBe(true);
  });

  it("takes numbers with a comma, an optional share and an upper-cased market", () => {
    const read = readSopSettings({ ...form(), entityMin: "1,5", kaShare: "12.5", market: "tst" });
    expect(read.settings).toMatchObject({ entityMin: 1.5, kaShare: 12.5, market: "TST" });
    expect(isDefaultSopSettings(read.settings!)).toBe(false);
  });

  it("names the fields that are not a value, and saves nothing", () => {
    expect(readSopSettings({ ...form(), moq: "много", containerWarn: "120", market: "" })).toEqual({
      settings: null,
      invalid: ["moq", "containerWarn", "market"],
    });
    expect(readSopSettings({ ...form(), moq: "0" }).invalid).toEqual(["moq"]);
    // The norms must stand in their order.
    expect(readSopSettings({ ...form(), targetTotal: "6" }).invalid).toEqual([
      "targetTotal",
      "maxTotal",
    ]);
    expect(readSopSettings({ ...form(), entityMin: "5", distMin: "1" }).invalid).toEqual([
      "entityMin",
      "distMin",
      "maxTotal",
    ]);
  });

  it("falls back to the standard value for what was saved wrong", () => {
    expect(parseSopSettings({ moq: 300, entityMin: "два", kaShare: 15, extra: 1 })).toEqual({
      ...DEFAULT_SOP_SETTINGS,
      moq: 300,
      kaShare: 15,
    });
    expect(parseSopSettings("сломано")).toEqual(DEFAULT_SOP_SETTINGS);
  });
});

describe("the report of an upload", () => {
  const model = makeModel(
    [
      makeSku("SKU A", {
        po: [0, 200, 0, 200, 0, 200, 0, 200, 600, 200, 0],
        sellIn: all(100),
        sellThru: all(100),
        entityStock: [200, 300, 200, 300, 200],
        distStock: [150, 150, 150, 150, 150],
        formulas: { sellIn: "nnnsnnnnnnn" },
        parts: { "sellIn:3": [70, 30] },
      }),
      makeSku("SKU S", {
        factory: "BBB",
        status: "Delist",
        po: [0, 0, 0, 0, 0, 0, 0, 0, 150],
        sellThru: all(10),
        entityStock: [0, 0, 0, 0, 40],
      }),
    ],
    {
      materials: {
        sheet: "3. Materials",
        planMonths: MONTHS.slice(5),
        rows: [
          makeMaterial("SKU A", { totalBox: 1500, planTotal: 1200 }),
          makeMaterial("SKU S", { factory: "BBB", status: "Delist", totalBox: 90, planTotal: 150 }),
          makeMaterial("SKU GONE", { totalBox: 20, planTotal: 0 }),
        ],
      },
    },
  );
  // The upload before forecast October at 80 (Sell-in) and 125 (Sell-thru).
  const before = makeModel([
    makeSku("SKU A", { sellIn: [100, 100, 100, 100, 80], sellThru: [100, 100, 100, 100, 125] }),
  ]);
  const report = buildSopReport({
    model,
    cycle: CYCLE,
    kind: "HQ_DRAFT",
    settings: SETTINGS,
    baseline: { model: before, cycle: "2026-10" },
    today: "2026-11-28",
  });

  it("gives the headline numbers of the overview", () => {
    expect(report.months).toEqual({
      cycle: "2026-11",
      closed: "2026-10",
      horizon: MONTHS.slice(5),
      frozen: ["2026-11", "2026-12", "2027-01"],
    });
    expect(report.overview.ordering).toEqual({
      month: "2027-02",
      po: 750,
      byFactory: [
        { factory: "AAA", po: 600 },
        { factory: "BBB", po: 150 },
      ],
    });
    // 240 at the entity against 110 a month of both rows.
    expect(report.overview.entity.stock).toBe(240);
    expect(report.overview.entity.cover).toBeCloseTo(240 / 110);
    expect(report.overview.dist).toEqual({ stock: 150, cover: 150 / 110 });
    expect(report.overview.closed).toEqual({
      month: "2026-10",
      sellIn: 100,
      sellThru: 110,
      forecastSellIn: 80,
      forecastSellThru: 125,
    });
    expect(report.overview.counts).toEqual({
      error: report.findings.filter((f) => f.severity === "error").length,
      risk: report.findings.filter((f) => f.severity === "risk").length,
      note: 0,
    });
    expect(report.findings.map((f) => f.rule)).toEqual(
      expect.arrayContaining(["poDelist", "moq", "materialsLeftover", "materialsDelist"]),
    );
  });

  it("has no earlier forecast when the upload before is of the same cycle", () => {
    const same = buildSopReport({
      model,
      cycle: CYCLE,
      kind: "OURS",
      settings: SETTINGS,
      baseline: { model: before, cycle: CYCLE },
      today: "2026-11-28",
    });
    expect(same.overview.closed).toMatchObject({ forecastSellIn: null, forecastSellThru: null });
  });

  it("joins the materials to the SKUs and says what the plan does not cover", () => {
    expect(report.materials!.map((r) => [r.name, r.leftover, r.flag, r.skuKey])).toEqual([
      ["SKU A", 300, "leftover", "AAA|SKU A"],
      ["SKU S", -60, "delist", "BBB|SKU S"],
      ["SKU GONE", 20, null, null],
    ]);
  });

  it("builds an SKU's card: its months, findings, hint, materials and channel split", () => {
    const card = skuCard(report, "AAA|SKU A")!;
    expect(card.months.map((m) => m.month)).toEqual(MONTHS);
    expect(card.months[5]).toMatchObject({
      month: "2026-11",
      forecast: true,
      frozen: true,
      ordering: false,
      po: 200,
      entity: 300,
      dist: 150,
      cover: { entity: 3, dist: 1.5, total: 4.5 },
    });
    expect(card.months[8]).toMatchObject({ ordering: true, frozen: false });
    // The file's own stock is shown only where it differs from the balance.
    expect(card.months[5]!.fileEntity).toBeUndefined();
    expect(card.findings.every((f) => f.sku?.key === "AAA|SKU A")).toBe(true);
    expect(card.hint?.steps.map((s) => s.month)).toEqual(["2027-02", "2027-03", "2027-04"]);
    expect(card.material?.leftover).toBe(300);
    expect(card.split).toEqual([{ month: "2026-09", distributor: 70, ka: 30 }]);
    const delisted = skuCard(report, "BBB|SKU S")!;
    expect([delisted.hint, delisted.noHint]).toEqual([null, "delist"]);
    expect(skuCard(report, "AAA|НЕТ ТАКОГО")).toBeNull();
  });

  it("filters the findings and the stock list as the page's address says", () => {
    const filter = (params: Record<string, string>) =>
      filterFindings(
        report.findings,
        parseFindingsFilter(params),
        new Set([report.findings[0]!.key]),
      );
    expect(filter({})).toHaveLength(report.findings.length);
    expect(filter({ hide: "1" })).toHaveLength(report.findings.length - 1);
    expect(filter({ severity: "error" }).every((f) => f.severity === "error")).toBe(true);
    expect(filter({ factory: "bbb" }).every((f) => f.factory === "BBB")).toBe(true);
    expect(filter({ q: "sku s" }).every((f) => f.sku?.name === "SKU S")).toBe(true);
    expect(filter({ item: "5" }).every((f) => RULES[f.rule].checklist === 5)).toBe(true);
    expect(filter({ sku: "AAA|SKU A" }).every((f) => f.sku?.key === "AAA|SKU A")).toBe(true);
    expect(parseFindingsFilter({ severity: "ужас", item: "42" })).toMatchObject({
      severity: null,
      item: null,
    });
    expect(parseStockView("slow")).toBe("slow");
    expect(parseStockView("что-то")).toBe("all");
    expect(filterStock(report.stats, "leaving", "").map((s) => s.name)).toEqual(["SKU S"]);
    expect(filterStock(report.stats, "all", "t-skua").map((s) => s.name)).toEqual(["SKU A"]);
  });

  it("writes every finding in words, with no placeholder left unfilled", () => {
    for (const locale of ["ru", "en"] as const)
      withLocale(locale, () => {
        for (const finding of report.findings) {
          const text = describeFinding(finding);
          const whole = [text.name, text.why, text.todo, text.line, ...text.rows].join(" ");
          expect(whole, `${locale} ${finding.rule}`).not.toMatch(/\{\w+\}/);
          expect(whole, `${locale} ${finding.rule}`).not.toContain("sop.rules.");
          expect(text.name.length).toBeGreaterThan(5);
        }
      });
    const moq = describeFinding(report.findings.find((f) => f.rule === "moq")!);
    expect(moq.rows).toEqual(["Feb'27: PO 150 кор."]);
    expect(moq.todo).toBe(
      "Поднимите заказ до 200 кор. или уберите его и объедините с соседним месяцем.",
    );
  });
});

describe("texts and links", () => {
  it("has a name, a reason and an action for every rule in both languages", () => {
    for (const locale of ["ru", "en"] as const)
      for (const rule of RULE_IDS)
        for (const part of ["name", "why", "do"] as const) {
          const key = `sop.rules.${rule}.${part}` as Parameters<typeof t>[0];
          expect(t(key, undefined, locale), key).not.toBe(key);
          expect(t(key, undefined, locale).length, key).toBeGreaterThan(8);
        }
  });

  it("writes cases and months of stock the way the pages show them", () => {
    expect(cases(5546.22)).toBe("5 546");
    expect(cases(12.54)).toBe("12,5");
    expect(coverText(1.96)).toBe("2");
    expect(coverText(null)).toBe("—");
  });

  it("carries an SKU's key in a link and reads it back", () => {
    const key = "AAA|[RE] SKU A / 100 «тест»";
    const href = skuHref(key);
    expect(href).toMatch(/^\/sop\/sku\/[A-Za-z0-9_-]+$/);
    expect(skuKeyOf(href.split("/").at(-1)!)).toBe(key);
    expect(skuKeyOf("../../etc")).toBeNull();
    expect(findingsHref({ severity: "error", item: 5, q: "" })).toBe(
      "/sop/findings?severity=error&item=5",
    );
    expect(findingsHref()).toBe("/sop/findings");
  });
});
