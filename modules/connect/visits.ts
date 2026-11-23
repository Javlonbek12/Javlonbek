import { hasGap, percent, skuGaps } from "./analytics";
import {
  personCode,
  titleKey,
  type OosRecord,
  type OrderRecord,
  type SaleRecord,
  type SuPersonRecord,
  type SuVisitRecord,
  type VisitRecord,
} from "./parse";
import { isRouteVisit } from "./route-visits";
import {
  checkOrders,
  indexSales,
  SALES_COUNTS,
  salesCounts,
  salesSummary,
  unsoldOrders,
  type OrderCheck,
  type SalesCounts,
  type SalesRange,
} from "./sales";

// Smart Up visits × Connect Bot, as pure functions (rules approved by the owner on 09.11.2026,
// see docs/DECISIONS.md). Smart Up says where a TSM had to go and went; Connect Bot says what was
// done there: the Market Visit questionnaire (MV), the stock check (OOS) and orders. A Smart Up
// visit and the bot's records meet on the store (Client ID) and the day.

export type VisitData = {
  suVisits: SuVisitRecord[];
  // The days whose visits are read from the route analysis (no visit detail loaded for them).
  routeDays?: string[];
  mv: VisitRecord[];
  oos: OosRecord[];
  orders: OrderRecord[];
  people: SuPersonRecord[];
  // The CRM's sales of the stores ordered from (order days … + 3) and the days all loaded sales
  // cover; without them there is no sales cross-check.
  sales?: SaleRecord[];
  salesRange?: SalesRange | null;
};

// A MV / OOS counts as done during the visit within Smart Up start − 15 min … finish + 15 min.
export const TOLERANCE_MINUTES = 15;

export const STORE_OPEN_QUESTION = "Торговая точка открыта?";
export const EQUIPMENT_QUESTION = "Какой тип оборудования KT&G установлен в торговой точке?";
export const NO_EQUIPMENT = "No BWD";
// Not required when the equipment answer is «No BWD».
export const EQUIPMENT_QUESTIONS = [
  "Подсветка оборудования KT&G включена?",
  "Установлены ли актуальные вставки в оборудование KT&G?",
  "Установлены ли временные POSM-материалы KT&G?",
  "Установлены ли фирменные ценники KT&G с актуальными на момент визита ценами?",
  "Оборудование KT&G в чистом состоянии на момент завершения визита?",
];
// The bot's Russian questionnaire (09.2026) asks first whether there is KT&G equipment at all and
// then goes one of two ways: these questions are asked only where there is equipment…
export const HAS_EQUIPMENT_QUESTION = "Установлено ли оборудование KT&G в торговой точке?";
export const NO_EQUIPMENT_ANSWER = "Нет оборудования";
const WITH_EQUIPMENT_ONLY = [
  "Какой тип оборудования KT&G установлен",
  "Фото оборудование",
  "Подсветка оборудования",
  "Цена на полке на продукцию KT&G",
  "Соблюдаются ли условия контракта",
  "Выставлен ли весь обязательный ассортимент",
  "Все необходимые документы от торговой точки",
  "Установлены ли актуальные вставки",
  "Установлены ли фирменные ценники",
  "Оборудование KT&G в чистом состоянии",
];
// …and this one only where there is none.
const WITHOUT_EQUIPMENT_ONLY = ["Фото оборудования конкурентов"];
const startsWithAny = (q: string, starts: string[]) => starts.some((s) => q.startsWith(s));
// Question 1.1 is always blank in the export and is ignored; so is the misspelt copy of the
// contacts question («…что и зачем вы делайте…»), which the bot never asks.
const IGNORED_QUESTION = /^1\.1\s|зачем вы делайте во время визита/;
const CLOSED_COMMENT = /закрыт|closed/i;

export const storeDay = (storeCode: string, day: string) => `${storeCode}|${day}`;
const sameCode = (a: string | null, b: string | null) =>
  Boolean(a && b && a.toUpperCase() === b.toUpperCase());
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// --- Market Visit -----------------------------------------------------------------------------

const answerOf = (v: VisitRecord, q: string) => v.answers.find((a) => a.q === q)?.a ?? null;

// The questions of the questionnaire (answered or left blank), without question 1.1.
export function questionsOf(v: VisitRecord): string[] {
  return [...v.answers.map((a) => a.q), ...(v.unanswered ?? [])].filter(
    (q) => !IGNORED_QUESTION.test(q),
  );
}

// «Нет оборудования» to the first equipment question, or «No BWD» alone as the type (a list with
// an installed type besides it is equipment).
export function hasNoEquipment(v: VisitRecord) {
  if (answerOf(v, HAS_EQUIPMENT_QUESTION) === NO_EQUIPMENT_ANSWER) return true;
  const answer = answerOf(v, EQUIPMENT_QUESTION);
  if (!answer) return false;
  const parts = answer
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((p) => p === NO_EQUIPMENT);
}

export type StoreStatus = "open" | "closed" | "unknown";
export const MV_RESULTS = [
  "full",
  "partial",
  "noPhoto",
  "partialNoPhoto",
  "skipped",
  "closed",
] as const;
export type MvResult = (typeof MV_RESULTS)[number];

type MvInfo = {
  questions: string[];
  required: string[];
  answered: number;
  status: StoreStatus;
  result: MvResult;
};
// Records are read-only once parsed: what is derived from one is kept for the next question.
const infoCache = new WeakMap<VisitRecord, MvInfo>();

function mvInfo(v: VisitRecord): MvInfo {
  const cached = infoCache.get(v);
  if (cached) return cached;
  const questions = questionsOf(v);
  // Every question except the store status (judged on its own); the equipment questions are not
  // required when there is no equipment.
  // …and a question the questionnaire does not ask on this store's way (with equipment or
  // without) is not required either.
  const noEquipment = hasNoEquipment(v);
  const hasEquipment = !noEquipment && answerOf(v, HAS_EQUIPMENT_QUESTION) !== null;
  const required = questions.filter(
    (q) =>
      q !== STORE_OPEN_QUESTION &&
      !(
        noEquipment &&
        (EQUIPMENT_QUESTIONS.includes(q) || startsWithAny(q, WITH_EQUIPMENT_ONLY))
      ) &&
      !(hasEquipment && startsWithAny(q, WITHOUT_EQUIPMENT_ONLY)),
  );
  const given = new Set(v.answers.map((a) => a.q));
  const answered = required.filter((q) => given.has(q)).length;
  // Open, closed («Нет») or not answered; a questionnaire without the question counts as open.
  const storeAnswer = answerOf(v, STORE_OPEN_QUESTION);
  const status: StoreStatus =
    storeAnswer === "Нет"
      ? "closed"
      : storeAnswer !== null || !questions.includes(STORE_OPEN_QUESTION)
        ? "open"
        : "unknown";
  const photo = v.photos > 0;
  const result: MvResult =
    status === "closed"
      ? "closed"
      : status === "unknown"
        ? "skipped"
        : answered === required.length
          ? photo
            ? "full"
            : "noPhoto"
          : photo
            ? "partial"
            : "partialNoPhoto";
  const info = { questions, required, answered, status, result };
  infoCache.set(v, info);
  return info;
}

export const storeStatus = (v: VisitRecord) => mvInfo(v).status;
export const requiredQuestions = (v: VisitRecord) => mvInfo(v).required;
export const answeredRequired = (v: VisitRecord) => ({
  required: mvInfo(v).required.length,
  answered: mvInfo(v).answered,
});
// Closed (store open = «Нет») / skipped (not answered) / full (every required question and a
// photo) / partial / no photo / partial, no photo.
export const mvResult = (v: VisitRecord) => mvInfo(v).result;

export type Final<T> = { final: T; copies: number };

// One record per store-day: the best by `better` (negative when a is better); the others are
// copies («дубли»).
function finalPerStoreDay<T extends { storeCode: string; day: string }>(
  rows: T[],
  better: (a: T, b: T) => number,
): Map<string, Final<T>> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = storeDay(row.storeCode, row.day);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const result = new Map<string, Final<T>>();
  for (const [key, list] of groups)
    result.set(key, { final: [...list].sort(better)[0]!, copies: list.length });
  return result;
}

const byId = (a: { id: string }, b: { id: string }) =>
  b.id.localeCompare(a.id, undefined, { numeric: true });

// The final MV of a store-day: (1) the store status answered, (2) the most required questions
// answered, (3) with a photo, (4) the latest.
export function finalMarketVisits(mv: VisitRecord[]) {
  const rank = (v: VisitRecord) => [
    storeStatus(v) === "unknown" ? 0 : 1,
    answeredRequired(v).answered,
    v.photos > 0 ? 1 : 0,
  ];
  return finalPerStoreDay(mv, (a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i]! - ra[i]!;
    return b.at.localeCompare(a.at) || byId(a, b);
  });
}

// The final OOS check of a store-day: the latest.
export function finalOosChecks(oos: OosRecord[]) {
  return finalPerStoreDay(oos, (a, b) => b.at.localeCompare(a.at) || byId(a, b));
}

// --- Timing -----------------------------------------------------------------------------------

const minutes = (time: string | null) => {
  const m = time ? /^(\d{1,2}):(\d{2})/.exec(time) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// Whether a record made at `at` (YYYY-MM-DDTHH:mm) falls in the visit's start − tolerance …
// finish + tolerance (minutes). A visit without times can't be checked and counts as in time.
export function inVisitWindow(
  at: string,
  start: string | null,
  finish: string | null,
  tolerance = TOLERANCE_MINUTES,
) {
  const [t, s, f] = [minutes(at.slice(11, 16)), minutes(start), minutes(finish)];
  if (t === null || s === null || f === null) return true;
  return t >= s - tolerance && t <= Math.max(s, f) + tolerance;
}

// --- One Smart Up visit -----------------------------------------------------------------------

export const VISIT_ISSUES = ["noMv", "noOos", "notInTime", "otherEmployee"] as const;
export type VisitIssue = (typeof VISIT_ISSUES)[number];
export type VisitStatus = "ok" | VisitIssue;

export type VisitCheck = {
  visit: SuVisitRecord;
  mv: Final<VisitRecord> | null;
  oos: Final<OosRecord> | null;
  closed: boolean;
  oosRequired: boolean;
  mvInTime: boolean | null;
  oosInTime: boolean | null;
  otherEmployee: boolean;
  issues: VisitIssue[];
  // The first issue in the order above, or «всё в Connect».
  status: VisitStatus;
  result: MvResult | null;
};

export function checkVisit(
  visit: SuVisitRecord,
  mv: Final<VisitRecord> | undefined,
  oos: Final<OosRecord> | undefined,
  tolerance = TOLERANCE_MINUTES,
): VisitCheck {
  const closed =
    (mv ? storeStatus(mv.final) === "closed" : false) || CLOSED_COMMENT.test(visit.comment ?? "");
  const window = (at: string) => inVisitWindow(at, visit.start, visit.finish, tolerance);
  // A visit read from the route analysis has no times: the day is enough, nothing to check.
  const timed = !isRouteVisit(visit);
  const mvInTime = mv && timed ? window(mv.final.at) : null;
  const oosInTime = oos && timed ? window(oos.final.at) : null;
  const byOther = (person: string | null) => !sameCode(personCode(person), visit.person);
  const otherEmployee = Boolean(
    (mv && byOther(mv.final.person)) || (oos && byOther(oos.final.person)),
  );
  const issues: VisitIssue[] = [];
  if (!mv) issues.push("noMv");
  if (!oos && !closed) issues.push("noOos");
  if (mvInTime === false || oosInTime === false) issues.push("notInTime");
  if (otherEmployee) issues.push("otherEmployee");
  return {
    visit,
    mv: mv ?? null,
    oos: oos ?? null,
    closed,
    oosRequired: !closed,
    mvInTime,
    oosInTime,
    otherEmployee,
    issues,
    status: issues[0] ?? "ok",
    result: mv ? mvResult(mv.final) : null,
  };
}

// A planned visit that needs the TSM's attention: an issue, or a MV that is not full.
export const needsAttention = (c: VisitCheck) =>
  c.visit.planned &&
  (c.issues.length > 0 || (c.result !== null && c.result !== "full" && c.result !== "closed"));

// --- The whole data -----------------------------------------------------------------------------

export type Analysis = ReturnType<typeof analyzeVisits>;

// Finals, the check of every made Smart Up visit and what links them; sections are then counted
// for everyone or for some TSMs (see visitSections).
export function analyzeVisits(data: VisitData, tolerance = TOLERANCE_MINUTES) {
  const mvFinals = finalMarketVisits(data.mv);
  const oosFinals = finalOosChecks(data.oos);
  const checks = data.suVisits
    .filter((v) => v.factDay)
    .map((v) =>
      checkVisit(
        v,
        mvFinals.get(storeDay(v.storeCode, v.factDay!)),
        oosFinals.get(storeDay(v.storeCode, v.factDay!)),
        tolerance,
      ),
    );
  const visited = new Set(
    data.suVisits.filter((v) => v.factDay).map((v) => storeDay(v.storeCode, v.factDay!)),
  );
  // Days Smart Up data exists for: only there can a MV be «without a Smart Up visit».
  const suDays = new Set(data.suVisits.map((v) => v.day));
  // Every auto-stock order checked against the sales once.
  const sales = indexSales(data.sales ?? [], data.salesRange ?? null);
  const orderChecks = new Map<OrderRecord, OrderCheck>(
    sales ? checkOrders(data.orders, sales).map((c) => [c.order, c]) : [],
  );
  return { data, mvFinals, oosFinals, checks, visited, suDays, sales, orderChecks };
}

// The TSM codes a section is counted for; null is everyone.
type Scope = Set<string> | null;
const scopeTest = (scope: Scope) => {
  if (!scope) return () => true;
  const codes = new Set([...scope].map(titleKey));
  return (person: string | null) => codes.has(titleKey(personCode(person) ?? ""));
};

// Counts of a list of made visits (planned or not).
function visitCounts(checks: VisitCheck[]) {
  const planned = checks.filter((c) => c.visit.planned);
  const connected = planned.filter((c) => c.mv || c.oos);
  // Those whose time can be checked (not the visits read from the route analysis).
  const timed = connected.filter((c) => !isRouteVisit(c.visit));
  const status = Object.fromEntries(
    (["ok", ...VISIT_ISSUES] as VisitStatus[]).map((s) => [
      s,
      planned.filter((c) => c.status === s).length,
    ]),
  ) as Record<VisitStatus, number>;
  return {
    visited: planned.length,
    withMv: planned.filter((c) => c.mv).length,
    withOos: planned.filter((c) => c.oos).length,
    both: planned.filter((c) => c.mv && c.oos).length,
    withConnect: connected.length,
    allGood: status.ok,
    // Of the visits with something in Connect: all of it in time (of those with a time to check
    // against) / by someone else.
    timed: timed.length,
    inTime: timed.filter((c) => !c.issues.includes("notInTime")).length,
    otherEmployee: connected.filter((c) => c.otherEmployee).length,
    closed: planned.filter((c) => c.closed).length,
    attention: planned.filter(needsAttention).length,
    status,
    unplanned: checks.length - planned.length,
    unplannedWithConnect: checks.filter((c) => !c.visit.planned && (c.mv || c.oos)).length,
  };
}

export function visitRates(c: ReturnType<typeof visitCounts> & { planned: number }) {
  return {
    visitedRate: percent(c.visited, c.planned),
    withMvRate: percent(c.withMv, c.visited),
    withOosRate: percent(c.withOos, c.visited),
    connectRate: percent(c.withConnect, c.visited),
    allGoodRate: percent(c.allGood, c.visited),
    inTimeRate: percent(c.inTime, c.timed),
    otherRate: percent(c.otherEmployee, c.withConnect),
  };
}

// Orders by delivery status: every status on its own, the most frequent first.
export function ordersByStatus(orders: OrderRecord[]) {
  const byStatus = new Map<string, { count: number; packs: number; sum: number }>();
  for (const o of orders) {
    const status = o.status ?? "";
    const entry = byStatus.get(status) ?? { count: 0, packs: 0, sum: 0 };
    entry.count++;
    entry.packs += o.packs;
    entry.sum += o.sum;
    byStatus.set(status, entry);
  }
  return [...byStatus.entries()]
    .map(([status, e]) => ({ status, ...e }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

// The answers of the final MVs per question: values, not answered (only where required), and how
// often the bot marked it a problem (of the answers).
function questionStats(finals: VisitRecord[]) {
  // The questionnaire's order: answers keep the column order, so the fullest questionnaire gives
  // it and the others only add a question after the one before it; questions nobody answered last.
  const order: string[] = [];
  for (const v of [...finals].sort((a, b) => b.answers.length - a.answers.length)) {
    let previous = -1;
    for (const { q } of v.answers) {
      if (IGNORED_QUESTION.test(q)) continue;
      let at = order.indexOf(q);
      if (at < 0) order.splice((at = previous + 1), 0, q);
      previous = at;
    }
  }
  for (const v of finals)
    for (const q of mvInfo(v).questions) if (!order.includes(q)) order.push(q);
  return order.map((q) => {
    // A closed store answers only the store status.
    const asked = finals.filter(
      (v) =>
        mvInfo(v).questions.includes(q) && (q === STORE_OPEN_QUESTION || mvResult(v) !== "closed"),
    );
    const counts = new Map<string, number>();
    let unanswered = 0;
    let problems = 0;
    for (const v of asked) {
      const answer = answerOf(v, q);
      if (answer === null) {
        if (q === STORE_OPEN_QUESTION || mvInfo(v).required.includes(q)) unanswered++;
        continue;
      }
      counts.set(answer, (counts.get(answer) ?? 0) + 1);
      if (v.problemList.includes(q)) problems++;
    }
    const rank = (a: string) => (a === "Да" ? 0 : a === "Нет" ? 1 : 2);
    const answers = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => rank(a.value) - rank(b.value) || b.count - a.count);
    const answered = sum(answers.map((a) => a.count));
    return {
      q,
      answers,
      answered,
      unanswered,
      problems,
      problemRate: percent(problems, answered),
    };
  });
}

// The most frequent answers and the rest summed: the equipment question has dozens of
// combinations, which would bury the bar under a wall of labels.
export const MAX_ANSWERS = 8;
export function topAnswers<T extends { value: string; count: number }>(
  answers: T[],
  max = MAX_ANSWERS,
) {
  if (answers.length <= max) return { shown: answers, other: 0, otherKinds: 0 };
  const rest = answers.slice(max);
  return {
    shown: answers.slice(0, max),
    other: sum(rest.map((a) => a.count)),
    otherKinds: rest.length,
  };
}

// Installed equipment types of the final MVs (a list counts each type).
function equipmentStats(finals: VisitRecord[]) {
  const counts = new Map<string, number>();
  for (const v of finals) {
    const answer = answerOf(v, EQUIPMENT_QUESTION);
    if (!answer) continue;
    for (const type of new Set(answer.split(",").map((p) => p.trim()))) {
      if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

// The records a section is counted from: visits by the route owner, MVs, checks and orders by
// who made them.
type Parts = {
  suVisits: SuVisitRecord[];
  checks: VisitCheck[];
  mvFinals: Final<VisitRecord>[];
  oosFinals: Final<OosRecord>[];
  oosAll: OosRecord[];
  orders: OrderRecord[];
};

function partsOf(a: Analysis, keep: (person: string | null) => boolean): Parts {
  return {
    suVisits: a.data.suVisits.filter((v) => keep(v.person)),
    checks: a.checks.filter((c) => keep(c.visit.person)),
    mvFinals: [...a.mvFinals.values()].filter((f) => keep(f.final.person)),
    oosFinals: [...a.oosFinals.values()].filter((f) => keep(f.final.person)),
    oosAll: a.data.oos.filter((c) => keep(c.person)),
    orders: a.data.orders.filter((o) => keep(o.person)),
  };
}

// The report's sections for everyone (scope null) or for the TSMs with these codes. `light`
// leaves out the lists (days, products, questions, equipment) for the per-TSM rows.
export function visitSections(a: Analysis, scope: Scope = null, light = false) {
  return sectionsOf(a, partsOf(a, scopeTest(scope)), light);
}

function sectionsOf(a: Analysis, parts: Parts, light: boolean) {
  const { suVisits, checks, mvFinals, oosFinals, oosAll, orders } = parts;
  const planned = suVisits.filter((v) => v.planned).length;
  const counts = { ...visitCounts(checks), planned };
  const withoutVisit = mvFinals.filter(
    (f) => a.suDays.has(f.final.day) && !a.visited.has(storeDay(f.final.storeCode, f.final.day)),
  );

  // Days: planned (by plan date), made planned visits and those with something in Connect (by
  // fact date).
  const dayList = light
    ? []
    : [
        ...new Set([
          ...suVisits.map((v) => v.planDay ?? v.day),
          ...checks.map((c) => c.visit.factDay!),
        ]),
      ];
  const days = dayList.sort().map((day) => {
    const made = checks.filter((c) => c.visit.planned && c.visit.factDay === day);
    return {
      day,
      planned: suVisits.filter((v) => v.planned && v.planDay === day).length,
      visited: made.length,
      withConnect: made.filter((c) => c.mv || c.oos).length,
    };
  });

  // Stock checks: one per store-day; an order counts when any check of that store-day made one.
  const ordered = new Set(
    oosAll.filter((c) => c.orderCreated).map((c) => storeDay(c.storeCode, c.day)),
  );
  const withGap = oosFinals.filter((f) => hasGap(f.final));
  const ledToOrder = withGap.filter((f) =>
    ordered.has(storeDay(f.final.storeCode, f.final.day)),
  ).length;

  const orderChecks = orders.flatMap((o) => a.orderChecks.get(o) ?? []);

  const finals = mvFinals.map((f) => f.final);
  const results = Object.fromEntries(
    MV_RESULTS.map((r) => [r, finals.filter((v) => mvResult(v) === r).length]),
  ) as Record<MvResult, number>;

  return {
    visits: {
      ...counts,
      ...visitRates(counts),
      notVisited: suVisits.filter((v) => v.planned && !v.factDay).length,
      mvWithoutVisit: withoutVisit.length,
      mvDuplicateDays: mvFinals.filter((f) => f.copies > 1).length,
      mvCopiesRemoved: sum(mvFinals.map((f) => f.copies - 1)),
      oosDuplicateDays: oosFinals.filter((f) => f.copies > 1).length,
      oosCopiesRemoved: sum(oosFinals.map((f) => f.copies - 1)),
      days,
    },
    oos: {
      checked: oosFinals.length,
      withGap: withGap.length,
      gapRate: percent(withGap.length, oosFinals.length),
      topSkus: light ? [] : skuGaps(oosFinals.map((f) => f.final)).slice(0, 10),
      ledToOrder,
      orderRate: percent(ledToOrder, withGap.length),
      orders: orders.length,
      packs: sum(orders.map((o) => o.packs)),
      sum: sum(orders.map((o) => o.sum)),
      byStatus: ordersByStatus(orders),
      // Sold after the order (null: no sales loaded).
      sales: a.sales ? salesSummary(orderChecks, a.sales, light) : null,
    },
    mv: {
      unique: finals.length,
      results,
      // Of the open stores (a closed store can't have a full questionnaire).
      fullRate: percent(results.full, finals.length - results.closed),
      problems: sum(finals.map((v) => v.problemList.length)),
      questions: light ? [] : questionStats(finals),
      equipment: light ? [] : equipmentStats(finals.filter((v) => mvResult(v) !== "closed")),
    },
  };
}
export type VisitSections = ReturnType<typeof visitSections>;

// --- People -------------------------------------------------------------------------------------

// Every TSM code in the data (Smart Up routes and whoever made a bot record), the busiest first.
export function tsmCodes(data: VisitData): string[] {
  const counts = new Map<string, { code: string; n: number }>();
  const add = (person: string | null) => {
    const code = personCode(person);
    if (!code) return;
    const key = code.toUpperCase();
    const entry = counts.get(key) ?? { code, n: 0 };
    entry.n++;
    counts.set(key, entry);
  };
  for (const v of data.suVisits) add(v.person);
  for (const r of [...data.mv, ...data.oos, ...data.orders]) add(r.person);
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.code.localeCompare(b.code))
    .map((e) => e.code);
}

// A TSM's name, zone and region: Smart Up's totals first, then the bot's "CODE - Name" and the
// route's working zone and organization.
export function tsmInfo(data: VisitData, code: string) {
  const person = data.people.find((p) => sameCode(p.person, code));
  const visit = data.suVisits.find((v) => sameCode(v.person, code));
  const record = [...data.mv, ...data.oos, ...data.orders].find((r) =>
    sameCode(personCode(r.person), code),
  );
  const botName = record?.person?.split(" - ").slice(1).join(" - ").trim() || null;
  return {
    code,
    name: person?.name ?? botName,
    zone: person?.zone ?? visit?.city ?? null,
    region: person?.organization ?? visit?.organization ?? record?.city ?? null,
  };
}

// One row per TSM for the managers' table (and, summed by region, the leadership's).
export function tsmRows(a: Analysis, codes: string[]) {
  // Everyone's records split by TSM once, not filtered again for each.
  const groups = new Map<string, Parts>();
  const partOf = (person: string | null) => {
    const key = personCode(person)?.toUpperCase() ?? "";
    let part = groups.get(key);
    if (!part) {
      part = { suVisits: [], checks: [], mvFinals: [], oosFinals: [], oosAll: [], orders: [] };
      groups.set(key, part);
    }
    return part;
  };
  for (const v of a.data.suVisits) partOf(v.person).suVisits.push(v);
  for (const c of a.checks) partOf(c.visit.person).checks.push(c);
  for (const f of a.mvFinals.values()) partOf(f.final.person).mvFinals.push(f);
  for (const f of a.oosFinals.values()) partOf(f.final.person).oosFinals.push(f);
  for (const c of a.data.oos) partOf(c.person).oosAll.push(c);
  for (const o of a.data.orders) partOf(o.person).orders.push(o);
  return codes.map((code) => {
    const s = sectionsOf(a, partOf(code), true);
    return {
      ...tsmInfo(a.data, code),
      planned: s.visits.planned,
      visited: s.visits.visited,
      visitedRate: s.visits.visitedRate,
      notVisited: s.visits.notVisited,
      unplanned: s.visits.unplanned,
      withMv: s.visits.withMv,
      withMvRate: s.visits.withMvRate,
      withOos: s.visits.withOos,
      withOosRate: s.visits.withOosRate,
      withConnect: s.visits.withConnect,
      connectRate: s.visits.connectRate,
      timed: s.visits.timed,
      inTime: s.visits.inTime,
      inTimeRate: s.visits.inTimeRate,
      otherEmployee: s.visits.otherEmployee,
      closed: s.visits.closed,
      attention: s.visits.attention,
      mvWithoutVisit: s.visits.mvWithoutVisit,
      mvUnique: s.mv.unique,
      mvFull: s.mv.results.full,
      mvOpen: s.mv.unique - s.mv.results.closed,
      mvFullRate: s.mv.fullRate,
      problems: s.mv.problems,
      oosChecked: s.oos.checked,
      oosFound: s.oos.withGap,
      orders: s.oos.orders,
      packs: s.oos.packs,
      sum: s.oos.sum,
      statuses: s.oos.byStatus,
      sales: s.oos.sales ? pickCounts(s.oos.sales) : salesCounts([]),
      salesRate: s.oos.sales?.anyRate ?? 0,
    };
  });
}
export type TsmRow = ReturnType<typeof tsmRows>[number];

const pickCounts = (c: SalesCounts) =>
  Object.fromEntries(SALES_COUNTS.map((k) => [k, c[k]])) as SalesCounts;

// TSM rows summed (a region, a position and those under it); rates counted again from the sums.
export function aggregateRows(list: TsmRow[]) {
  const total = (pick: (r: TsmRow) => number) => sum(list.map(pick));
  const planned = total((r) => r.planned);
  const visited = total((r) => r.visited);
  const withConnect = total((r) => r.withConnect);
  const mvFull = total((r) => r.mvFull);
  const mvOpen = total((r) => r.mvOpen);
  const sales = Object.fromEntries(
    SALES_COUNTS.map((k) => [k, total((r) => r.sales[k])]),
  ) as SalesCounts;
  return {
    planned,
    visited,
    visitedRate: percent(visited, planned),
    withConnect,
    connectRate: percent(withConnect, visited),
    withMvRate: percent(
      total((r) => r.withMv),
      visited,
    ),
    withOosRate: percent(
      total((r) => r.withOos),
      visited,
    ),
    timed: total((r) => r.timed),
    inTimeRate: percent(
      total((r) => r.inTime),
      total((r) => r.timed),
    ),
    otherEmployee: total((r) => r.otherEmployee),
    closed: total((r) => r.closed),
    attention: total((r) => r.attention),
    mvFull,
    mvOpen,
    mvFullRate: percent(mvFull, mvOpen),
    problems: total((r) => r.problems),
    oosFound: total((r) => r.oosFound),
    orders: total((r) => r.orders),
    packs: total((r) => r.packs),
    sum: total((r) => r.sum),
    sales,
    salesRate: percent(sales.anySold, sales.checked),
  };
}
export type RowTotals = ReturnType<typeof aggregateRows>;

// The TSM rows summed by region (rates counted again from the sums).
export function regionRows(rows: TsmRow[]) {
  const groups = new Map<string, TsmRow[]>();
  for (const r of rows) {
    const region = r.region ?? "—";
    groups.set(region, [...(groups.get(region) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([region, list]) => ({ region, people: list.length, ...aggregateRows(list) }))
    .sort((a, b) => b.planned - a.planned || a.region.localeCompare(b.region));
}

// --- One TSM ------------------------------------------------------------------------------------

const timeOf = (at: string) => at.slice(11, 16);

// What one TSM has to look at: visits needing attention (with Smart Up and Connect times),
// duplicates, problem answers by store, orders with their statuses, MVs without a visit and
// plans not visited.
export function tsmDetail(a: Analysis, code: string) {
  const mine = (person: string | null) => sameCode(personCode(person), code);
  const checks = a.checks.filter((c) => sameCode(c.visit.person, code));
  const attention = checks
    .filter(needsAttention)
    .map((c) => ({
      id: c.visit.id,
      store: c.visit.storeName,
      storeCode: c.visit.storeCode,
      day: c.visit.factDay!,
      smartUp: c.visit.start ? `${c.visit.start}–${c.visit.finish ?? "?"}` : null,
      mvAt: c.mv ? timeOf(c.mv.final.at) : null,
      oosAt: c.oos ? timeOf(c.oos.final.at) : null,
      issues: c.issues,
      result: c.result,
      closed: c.closed,
      // Who filled it when not the route owner.
      by: c.otherEmployee
        ? ([c.mv?.final.person, c.oos?.final.person].find((p) => p && !mine(p)) ?? null)
        : null,
    }))
    .sort((x, y) => y.day.localeCompare(x.day) || x.store.localeCompare(y.store));

  const mvFinals = [...a.mvFinals.values()].filter((f) => mine(f.final.person));
  const oosFinals = [...a.oosFinals.values()].filter((f) => mine(f.final.person));
  const duplicates = new Map<string, { store: string; day: string; mv: number; oos: number }>();
  for (const f of mvFinals.filter((x) => x.copies > 1))
    duplicates.set(storeDay(f.final.storeCode, f.final.day), {
      store: f.final.storeName,
      day: f.final.day,
      mv: f.copies,
      oos: 0,
    });
  for (const f of oosFinals.filter((x) => x.copies > 1)) {
    const key = storeDay(f.final.storeCode, f.final.day);
    const entry = duplicates.get(key) ?? {
      store: f.final.storeName,
      day: f.final.day,
      mv: 0,
      oos: 0,
    };
    entry.oos = f.copies;
    duplicates.set(key, entry);
  }

  const problems = mvFinals
    .filter((f) => f.final.problemList.length > 0)
    .map(({ final: v }) => ({
      id: v.id,
      store: v.storeName,
      day: v.day,
      // A problem with the answer given («Цена … — Выше рекомендованной»).
      problems: v.problemList.map((q) => {
        const answer = answerOf(v, q);
        return answer && answer !== "Нет" && answer !== "Да" ? `${q} — ${answer}` : q;
      }),
    }))
    .sort((x, y) => y.day.localeCompare(x.day) || x.store.localeCompare(y.store));

  const orders = a.data.orders
    .filter((o) => mine(o.person))
    .map((o) => ({
      id: o.id,
      store: o.storeName,
      day: o.day,
      packs: o.packs,
      sum: o.sum,
      status: o.status,
    }))
    .sort((x, y) => y.day.localeCompare(x.day) || x.id.localeCompare(y.id));

  const withoutVisit = mvFinals
    .filter(
      (f) => a.suDays.has(f.final.day) && !a.visited.has(storeDay(f.final.storeCode, f.final.day)),
    )
    .map(({ final: v }) => ({ id: v.id, store: v.storeName, day: v.day, at: timeOf(v.at) }))
    .sort((x, y) => y.day.localeCompare(x.day) || x.store.localeCompare(y.store));

  // Orders with nothing sold in a closed window (the sales cross-check).
  const unsold = unsoldOrders(
    a.data.orders.filter((o) => mine(o.person)).flatMap((o) => a.orderChecks.get(o) ?? []),
  );

  const notVisited = a.data.suVisits
    .filter((v) => sameCode(v.person, code) && v.planned && !v.factDay)
    .map((v) => ({ id: v.id, store: v.storeName, day: v.planDay! }))
    .sort((x, y) => y.day.localeCompare(x.day) || x.store.localeCompare(y.store));

  return {
    attention,
    duplicates: [...duplicates.values()].sort(
      (x, y) => y.day.localeCompare(x.day) || x.store.localeCompare(y.store),
    ),
    problems,
    orders,
    unsold,
    withoutVisit,
    notVisited,
  };
}
export type TsmDetail = ReturnType<typeof tsmDetail>;
