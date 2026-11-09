import { describe, expect, it } from "vitest";

import type { OosRecord, OrderRecord, SuVisitRecord, VisitRecord } from "./parse";
import {
  analyzeVisits,
  checkVisit,
  EQUIPMENT_QUESTION,
  EQUIPMENT_QUESTIONS,
  finalMarketVisits,
  finalOosChecks,
  inVisitWindow,
  mvResult,
  needsAttention,
  ordersByStatus,
  regionRows,
  STORE_OPEN_QUESTION,
  storeDay,
  tsmCodes,
  tsmDetail,
  tsmRows,
  visitSections,
  type VisitData,
} from "./visits";

// Synthetic data only: TSM_TST_* codes, «Тест TSM» names, stores 9000xx.
const DAY = "2026-11-02";
const OWNER = "TSM_TST_1";
const OTHER = "TSM_TST_2 - Тест TSM 2";
const QUESTIONS = [
  "1.1 Тестовый вопрос перед визитом",
  STORE_OPEN_QUESTION,
  "Тестовый вопрос 1",
  EQUIPMENT_QUESTION,
  ...EQUIPMENT_QUESTIONS,
  "Тестовый вопрос 2",
];
// Every required question answered «Да», equipment installed, the store open.
const FULL: Record<string, string> = Object.fromEntries(
  QUESTIONS.slice(1).map((q) => [q, q === EQUIPMENT_QUESTION ? "Тестовое оборудование" : "Да"]),
);

const visit = (extra: Partial<SuVisitRecord> = {}): SuVisitRecord => ({
  id: "SU-1",
  storeCode: "900001",
  storeName: "Тестовая точка 1",
  city: OWNER,
  channel: null,
  at: `${DAY}T10:00`,
  day: DAY,
  month: "2026-11",
  person: OWNER,
  planned: true,
  planDay: DAY,
  factDay: DAY,
  start: "10:00",
  finish: "10:20",
  backwall: null,
  comment: null,
  organization: "Тестоград",
  ...extra,
});

function mv(
  id: string,
  answers: Record<string, string>,
  extra: Partial<VisitRecord> = {},
): VisitRecord {
  return {
    id,
    storeCode: "900001",
    storeName: "Тестовая точка 1",
    city: "Тестоград",
    channel: null,
    at: `${DAY}T10:05`,
    day: DAY,
    month: "2026-11",
    person: `${OWNER} - Тест TSM 1`,
    template: "Тестовая анкета",
    status: "Выполнено",
    percent: null,
    creator: null,
    doneAt: null,
    taskStatus: null,
    problems: 0,
    problemList: [],
    photos: 1,
    answers: QUESTIONS.filter((q) => answers[q] !== undefined).map((q) => ({ q, a: answers[q]! })),
    unanswered: QUESTIONS.filter((q) => answers[q] === undefined),
    ...extra,
  };
}

const oos = (id: string, extra: Partial<OosRecord> = {}): OosRecord => ({
  id,
  storeCode: "900001",
  storeName: "Тестовая точка 1",
  city: "Тестоград",
  channel: null,
  at: `${DAY}T10:10`,
  day: DAY,
  month: "2026-11",
  person: `${OWNER} - Тест TSM 1`,
  missing: 0,
  low: 0,
  orderCreated: false,
  orderNo: null,
  delivery: null,
  skus: {},
  ...extra,
});

const order = (
  id: string,
  status: string | null,
  extra: Partial<OrderRecord> = {},
): OrderRecord => ({
  id,
  storeCode: "900001",
  storeName: "Тестовая точка 1",
  city: "Тестоград",
  channel: null,
  at: `${DAY}T10:15`,
  day: DAY,
  month: "2026-11",
  person: `${OWNER} - Тест TSM 1`,
  status,
  express: false,
  payment: null,
  sourceCheck: null,
  storeAnswer: null,
  storeAnswerAt: null,
  agent: null,
  agentAnswer: null,
  deliveredAt: null,
  outcome: null,
  daysToDeliver: null,
  positions: 1,
  adjusted: false,
  packs: 10,
  sum: 100_000,
  skus: {},
  ...extra,
});

const data = (extra: Partial<VisitData> = {}): VisitData => ({
  suVisits: [],
  mv: [],
  oos: [],
  orders: [],
  people: [],
  ...extra,
});

const without = (answers: Record<string, string>, ...questions: string[]) =>
  Object.fromEntries(Object.entries(answers).filter(([q]) => !questions.includes(q)));

describe("Market Visit: the final questionnaire of a store-day", () => {
  const key = storeDay("900001", DAY);

  it("keeps the most complete one and counts the copies", () => {
    const finals = finalMarketVisits([
      mv("1", without(FULL, "Тестовый вопрос 1", "Тестовый вопрос 2"), { at: `${DAY}T10:01` }),
      mv("2", FULL, { at: `${DAY}T10:02` }),
      mv("3", without(FULL, "Тестовый вопрос 2"), { at: `${DAY}T10:03` }),
    ]);
    expect(finals.get(key)).toMatchObject({ final: { id: "2" }, copies: 3 });
  });

  it("an answered store status comes before more answers", () => {
    const finals = finalMarketVisits([
      mv("1", without(FULL, STORE_OPEN_QUESTION)),
      mv("2", { [STORE_OPEN_QUESTION]: "Да" }),
    ]);
    expect(finals.get(key)?.final.id).toBe("2");
  });

  it("on a tie the one with a photo wins, then the latest", () => {
    const photo = finalMarketVisits([
      mv("1", FULL, { at: `${DAY}T10:01`, photos: 1 }),
      mv("2", FULL, { at: `${DAY}T10:09`, photos: 0 }),
    ]);
    expect(photo.get(key)?.final.id).toBe("1");
    const latest = finalMarketVisits([
      mv("1", FULL, { at: `${DAY}T10:01` }),
      mv("2", FULL, { at: `${DAY}T10:09` }),
    ]);
    expect(latest.get(key)?.final.id).toBe("2");
  });

  it("the latest stock check is the final one", () => {
    const finals = finalOosChecks([
      oos("1", { at: `${DAY}T10:01`, missing: 3 }),
      oos("2", { at: `${DAY}T10:12` }),
      oos("3", { at: `${DAY}T10:05`, missing: 1 }),
    ]);
    expect(finals.get(key)).toMatchObject({ final: { id: "2" }, copies: 3 });
  });

  it("results: closed, skipped, full, partial, no photo", () => {
    expect(mvResult(mv("1", { [STORE_OPEN_QUESTION]: "Нет" }))).toBe("closed");
    expect(mvResult(mv("1", without(FULL, STORE_OPEN_QUESTION)))).toBe("skipped");
    expect(mvResult(mv("1", FULL))).toBe("full");
    expect(mvResult(mv("1", without(FULL, "Тестовый вопрос 2")))).toBe("partial");
    expect(mvResult(mv("1", FULL, { photos: 0 }))).toBe("noPhoto");
    expect(mvResult(mv("1", without(FULL, "Тестовый вопрос 2"), { photos: 0 }))).toBe(
      "partialNoPhoto",
    );
    // Question 1.1 is never required; «Нет контракта KT&G» is an answer like any other.
    expect(mvResult(mv("1", { ...FULL, "Тестовый вопрос 1": "Нет контракта KT&G" }))).toBe("full");
  });

  it("«No BWD»: the equipment questions are not required", () => {
    const noEquipment = without(
      { ...FULL, [EQUIPMENT_QUESTION]: "No BWD" },
      ...EQUIPMENT_QUESTIONS,
    );
    expect(mvResult(mv("1", noEquipment))).toBe("full");
    // Equipment listed besides «No BWD» is equipment: its questions are required.
    expect(
      mvResult(mv("1", { ...noEquipment, [EQUIPMENT_QUESTION]: "Тестовое оборудование, No BWD" })),
    ).toBe("partial");
  });
});

describe("A Smart Up visit and Connect Bot", () => {
  const key = storeDay("900001", DAY);
  const finalMv = (record: VisitRecord) => finalMarketVisits([record]).get(key);
  const finalOos = (record: OosRecord) => finalOosChecks([record]).get(key);

  it("counts a record done during the visit within 15 minutes of its start and end", () => {
    expect(inVisitWindow(`${DAY}T09:45`, "10:00", "10:20")).toBe(true);
    expect(inVisitWindow(`${DAY}T09:44`, "10:00", "10:20")).toBe(false);
    expect(inVisitWindow(`${DAY}T10:35`, "10:00", "10:20")).toBe(true);
    expect(inVisitWindow(`${DAY}T10:36`, "10:00", "10:20")).toBe(false);
    expect(inVisitWindow(`${DAY}T10:36`, null, null)).toBe(true);
    const late = checkVisit(
      visit(),
      finalMv(mv("1", FULL, { at: `${DAY}T10:36` })),
      finalOos(oos("1")),
    );
    expect(late.issues).toEqual(["notInTime"]);
    const edge = checkVisit(
      visit(),
      finalMv(mv("1", FULL, { at: `${DAY}T10:35` })),
      finalOos(oos("1")),
    );
    expect(edge.status).toBe("ok");
  });

  it("flags a MV or OOS by another employee than the route owner", () => {
    const check = checkVisit(
      visit(),
      finalMv(mv("1", FULL, { person: OTHER })),
      finalOos(oos("1")),
    );
    expect(check).toMatchObject({ status: "otherEmployee", otherEmployee: true });
    const byOos = checkVisit(
      visit(),
      finalMv(mv("1", FULL)),
      finalOos(oos("1", { person: OTHER })),
    );
    expect(byOos.issues).toEqual(["otherEmployee"]);
  });

  it("no MV, no OOS", () => {
    expect(checkVisit(visit(), undefined, undefined)).toMatchObject({
      issues: ["noMv", "noOos"],
      status: "noMv",
    });
    expect(checkVisit(visit(), finalMv(mv("1", FULL)), undefined).status).toBe("noOos");
  });

  it("a closed store needs no OOS (by the MV or the Smart Up comment); one filled anyway is fine", () => {
    const closed = checkVisit(
      visit(),
      finalMv(mv("1", { [STORE_OPEN_QUESTION]: "Нет" })),
      undefined,
    );
    expect(closed).toMatchObject({ closed: true, oosRequired: false, status: "ok" });
    const byComment = checkVisit(
      visit({ comment: "Торговая точка была закрыта на момент визита" }),
      finalMv(mv("1", FULL)),
      undefined,
    );
    expect(byComment).toMatchObject({ closed: true, issues: [] });
    expect(
      checkVisit(visit({ comment: "closed" }), finalMv(mv("1", FULL)), finalOos(oos("1"))).issues,
    ).toEqual([]);
  });

  it("an unplanned visit is shown, not counted as a miss", () => {
    const a = analyzeVisits(
      data({ suVisits: [visit({ id: "SU-2", planned: false, planDay: null })] }),
    );
    const s = visitSections(a);
    expect(s.visits).toMatchObject({ planned: 0, visited: 0, unplanned: 1, attention: 0 });
    expect(Object.values(s.visits.status).every((n) => n === 0)).toBe(true);
    expect(a.checks.filter(needsAttention)).toEqual([]);
  });
});

describe("Sections", () => {
  const d = data({
    suVisits: [
      // Store 1: everything in Connect. Store 2: MV by another TSM, no OOS. Store 3: not visited.
      visit(),
      visit({ id: "SU-2", storeCode: "900002", storeName: "Тестовая точка 2" }),
      visit({
        id: "plan|TSM_TST_1|900003|2026-11-02",
        storeCode: "900003",
        storeName: "Тестовая точка 3",
        factDay: null,
        start: null,
        finish: null,
      }),
      visit({ id: "SU-4", person: "TSM_TST_2", storeCode: "900004", organization: "Другой город" }),
    ],
    mv: [
      mv("1", FULL),
      mv("2", FULL, { at: `${DAY}T10:01`, photos: 0 }),
      mv(
        "3",
        { ...FULL, "Тестовый вопрос 2": "Выше рекомендованной" },
        {
          storeCode: "900002",
          storeName: "Тестовая точка 2",
          person: OTHER,
          problemList: ["Тестовый вопрос 2"],
        },
      ),
      // A MV at a store without a Smart Up visit that day.
      mv("4", FULL, { storeCode: "900009" }),
      // A MV on a day Smart Up has no data for.
      mv("5", FULL, { storeCode: "900009", day: "2026-11-20", at: "2026-11-20T10:00" }),
    ],
    oos: [
      oos("1", { missing: 2, skus: { "SKU-TEST-001": "OUT" } }),
      oos("2", {
        at: `${DAY}T10:11`,
        missing: 1,
        orderCreated: true,
        skus: { "SKU-TEST-001": "OUT" },
      }),
      oos("3", { storeCode: "900004", person: "TSM_TST_2 - Тест TSM 2" }),
    ],
    orders: [
      order("#TEST-1", "Точка не ответила"),
      order("#TEST-2", "Доставлено — ожидает подтверждения точки", { packs: 5, sum: 50_000 }),
      order("#TEST-3", "Точка не ответила"),
      order("#TEST-4", null, { person: "TSM_TST_2 - Тест TSM 2" }),
    ],
    people: [
      {
        id: OWNER,
        storeCode: "",
        storeName: "",
        city: null,
        channel: null,
        at: "",
        day: "",
        month: "",
        person: OWNER,
        name: "Тест TSM 1",
        zone: "Тестовая зона",
        organization: "Тестоград",
      },
    ],
  });
  const a = analyzeVisits(d);

  it("visits, duplicates and MVs without a visit", () => {
    const s = visitSections(a);
    expect(s.visits).toMatchObject({
      planned: 4,
      visited: 3,
      notVisited: 1,
      withMv: 2,
      withOos: 2,
      both: 1,
      withConnect: 3,
      otherEmployee: 1,
      mvWithoutVisit: 1,
      mvDuplicateDays: 1,
      mvCopiesRemoved: 1,
      oosDuplicateDays: 1,
      oosCopiesRemoved: 1,
      status: { ok: 1, noMv: 1, noOos: 1, notInTime: 0, otherEmployee: 0 },
    });
    expect(s.visits.days).toEqual([{ day: DAY, planned: 4, visited: 3, withConnect: 3 }]);
  });

  it("stock checks and orders by every delivery status", () => {
    const s = visitSections(a);
    expect(s.oos).toMatchObject({
      checked: 2,
      withGap: 1,
      ledToOrder: 1,
      orderRate: 100,
      orders: 4,
      packs: 35,
      sum: 350_000,
    });
    expect(s.oos.byStatus.map((b) => [b.status, b.count])).toEqual([
      ["Точка не ответила", 2],
      ["", 1],
      ["Доставлено — ожидает подтверждения точки", 1],
    ]);
    expect(ordersByStatus([order("1", "Ожидает экспресс-доставщика")])[0]).toMatchObject({
      status: "Ожидает экспресс-доставщика",
      count: 1,
      packs: 10,
    });
  });

  it("MV results and answers by question", () => {
    const s = visitSections(a);
    expect(s.mv).toMatchObject({ unique: 4, fullRate: 100, problems: 1 });
    const q2 = s.mv.questions.find((q) => q.q === "Тестовый вопрос 2");
    expect(q2).toMatchObject({ answered: 4, unanswered: 0, problems: 1, problemRate: 25 });
    // The questionnaire's order, without question 1.1.
    expect(s.mv.questions.map((q) => q.q)).toEqual(QUESTIONS.slice(1));
    expect(s.mv.equipment).toEqual([{ type: "Тестовое оборудование", count: 4 }]);
  });

  it("one TSM: visits by the route owner, records by who made them", () => {
    const mine = visitSections(a, new Set([OWNER]));
    expect(mine.visits).toMatchObject({ planned: 3, visited: 2, otherEmployee: 1 });
    // TSM_TST_2's MV at store 2 counts in their MV section, not in TSM_TST_1's.
    expect(mine.mv.unique).toBe(3);
    expect(mine.oos.orders).toBe(3);
    const rows = tsmRows(a, tsmCodes(d));
    expect(rows.map((r) => r.code)).toEqual([OWNER, "TSM_TST_2"]);
    expect(rows[0]).toMatchObject({
      name: "Тест TSM 1",
      zone: "Тестовая зона",
      region: "Тестоград",
      planned: 3,
      visitedRate: 67,
      orders: 3,
    });
    expect(rows[1]).toMatchObject({ name: "Тест TSM 2", planned: 1, visited: 1 });
    expect(regionRows(rows).map((r) => [r.region, r.planned])).toEqual([
      ["Тестоград", 3],
      ["Другой город", 1],
    ]);
  });

  it("one TSM's lists", () => {
    const x = tsmDetail(a, OWNER);
    expect(x.attention.map((v) => [v.store, v.issues])).toEqual([
      ["Тестовая точка 2", ["noOos", "otherEmployee"]],
    ]);
    expect(x.attention[0]).toMatchObject({ smartUp: "10:00–10:20", mvAt: "10:05", by: OTHER });
    expect(x.notVisited.map((v) => v.store)).toEqual(["Тестовая точка 3"]);
    expect(x.withoutVisit.map((v) => v.id)).toEqual(["4"]);
    expect(x.duplicates).toEqual([{ store: "Тестовая точка 1", day: DAY, mv: 2, oos: 2 }]);
    expect(x.orders.map((o) => o.status)).toContain("Точка не ответила");
    expect(tsmDetail(a, "TSM_TST_2").problems).toEqual([
      {
        id: "3",
        store: "Тестовая точка 2",
        day: DAY,
        problems: ["Тестовый вопрос 2 — Выше рекомендованной"],
      },
    ]);
  });
});
