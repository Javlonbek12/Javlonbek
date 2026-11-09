import type { OosRecord, OrderRecord, PaymentRecord, VisitRecord } from "./parse";

// Connect analytics over the bot's exports, as pure functions: stages of orders and ISM payments,
// stock-check gaps and the ISM payments block. The visits analytics (Smart Up × Connect Bot) is in
// visits.ts.

export type Dataset = {
  oos: OosRecord[];
  orders: OrderRecord[];
  payments: PaymentRecord[];
  visits: VisitRecord[];
};

// Test stores of the bot are left out of every number.
const TEST_STORE = /\[test\]|trade_test|^kt&g office$/i;
export const isTestStore = (name: string, code: string) =>
  TEST_STORE.test(name.trim()) || code === "9999999999";

export const percent = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 100) : 0;
const average = (values: number[]) =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// Whole days between two YYYY-MM-DD dates.
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000);

// --- Orders ---------------------------------------------------------------------------------

export type OrderStage = "delivered" | "refused" | "noAnswer" | "inProgress";
export const ORDER_STAGES: OrderStage[] = ["delivered", "inProgress", "noAnswer", "refused"];

export function orderStage(o: Pick<OrderRecord, "status" | "outcome" | "storeAnswer">): OrderStage {
  const status = o.status ?? "";
  if (o.outcome === "Не доставлено") return "refused";
  if (/^Доставлено/.test(status) || /^Доставлено/.test(o.outcome ?? "")) return "delivered";
  if (/отказ|отмен/i.test(status) || o.storeAnswer === "Отказался") return "refused";
  if (status === "Точка не ответила") return "noAnswer";
  return "inProgress";
}

// --- Payments -------------------------------------------------------------------------------

export type PaymentStage =
  "waitingBdm" | "waitingBum" | "rejected" | "approved" | "blocked" | "paid";
export const PAYMENT_STAGES: PaymentStage[] = [
  "paid",
  "approved",
  "blocked",
  "waitingBum",
  "waitingBdm",
  "rejected",
];
// Accounting statuses that hold a payment back until the store fixes its documents.
const BLOCKED = /счёт-фактура|счет-фактура|didox|не подписан/i;

export function paymentStage(p: PaymentRecord): PaymentStage {
  if (p.paid === "Оплачено") return "paid";
  if (p.bdmDecision === "Отклонено" || p.bumDecision === "Отклонено" || p.paid === "Не одобрено")
    return "rejected";
  if (p.paid && BLOCKED.test(p.paid)) return "blocked";
  // Accounting already pays it, whatever the decision columns still say.
  if (p.paid === "В процессе оплаты") return "approved";
  if (p.bdmDecision !== "Подтверждено") return "waitingBdm";
  if (p.bumDecision !== "Подтверждено") return "waitingBum";
  return "approved";
}
// What the store gets: a partial sum when the TSM set one, otherwise the contract sum;
// nothing for requests the TSM decided not to pay.
export const payable = (p: PaymentRecord) =>
  /^Не оплатить/.test(p.tsmDecision ?? "") ? 0 : (p.toPay ?? p.contractSum);

// --- Stock checks ---------------------------------------------------------------------------

export const hasGap = (c: OosRecord) => c.missing + c.low > 0;

// The brand of a product name ("ESSE Change Up" → "ESSE").
export function brandOf(sku: string) {
  const first = sku.trim().split(/\s+/)[0] ?? "";
  return first.toUpperCase() === "ESSE" ? "ESSE" : first.charAt(0).toUpperCase() + first.slice(1);
}

export function skuGaps(checks: OosRecord[]) {
  const counts = new Map<string, { out: number; low: number }>();
  for (const c of checks)
    for (const [sku, status] of Object.entries(c.skus)) {
      if (status === "NOT_BOUGHT") continue;
      const entry = counts.get(sku) ?? { out: 0, low: 0 };
      if (status === "OUT") entry.out++;
      else entry.low++;
      counts.set(sku, entry);
    }
  return [...counts.entries()]
    .map(([sku, c]) => ({
      sku,
      brand: brandOf(sku),
      out: c.out,
      low: c.low,
      total: c.out + c.low,
      rate: percent(c.out + c.low, checks.length),
    }))
    .sort((a, b) => b.total - a.total || a.sku.localeCompare(b.sku));
}

// "Yes/no" questions answered "no" most often (payment checklists and visit questionnaires).
export function failedQuestions(items: { q: string; ok: boolean }[], minAnswers = 3) {
  const byQ = new Map<string, { no: number; total: number }>();
  for (const { q, ok } of items) {
    const e = byQ.get(q) ?? { no: 0, total: 0 };
    e.total++;
    if (!ok) e.no++;
    byQ.set(q, e);
  }
  return [...byQ.entries()]
    .filter(([, e]) => e.total >= minAnswers && e.no > 0)
    .map(([q, e]) => ({ q, no: e.no, total: e.total, rate: percent(e.no, e.total) }))
    .sort((a, b) => b.rate - a.rate || b.no - a.no);
}

const visitDone = (v: VisitRecord) => v.status === "Выполнено";

// --- ISM payments ---------------------------------------------------------------------------

// The ISM payments block (built from the bot's payment requests, by months): the money by stage,
// what waits for whose decision, the checklist points not done, one TSM's requests to see through.
export function ismBlock(payments: PaymentRecord[], today: string) {
  const stages = countBy(payments, paymentStage);
  const stageSum = (stage: PaymentStage) =>
    sum(payments.filter((p) => paymentStage(p) === stage).map(payable));
  const roiKnown = payments.filter((p) => p.roi);
  const waiting = payments
    .filter((p) => /^waiting/.test(paymentStage(p)))
    .map((p) => ({
      id: p.id,
      store: p.storeName,
      city: p.city,
      person: p.person,
      // Who has to decide now: the BDM, then the BUM.
      decider: paymentStage(p) === "waitingBdm" ? p.bdm : p.bum,
      stage: paymentStage(p),
      sum: payable(p),
      days: daysBetween(p.at, today),
    }))
    .sort((a, b) => b.days - a.days);
  return {
    requests: payments.length,
    contractSum: sum(payments.map((p) => p.contractSum)),
    paidSum: stageSum("paid"),
    paidRate: percent(stages.paid ?? 0, payments.length),
    waiting: waiting.length,
    waitingSum: stageSum("waitingBdm") + stageSum("waitingBum"),
    checklist: average(payments.flatMap((p) => (p.checklist === null ? [] : [p.checklist]))),
    roiPositive: percent(roiKnown.filter((p) => p.roi === "positive").length, roiKnown.length),
    stages: PAYMENT_STAGES.map((id) => ({ id, value: stages[id] ?? 0, sum: stageSum(id) })),
    waitingList: waiting,
    checklistFails: failedQuestions(payments.flatMap((p) => p.checks)).slice(0, 8),
  };
}
export type IsmBlock = ReturnType<typeof ismBlock>;

// One person's requests that are not paid yet: what holds each back.
export function paymentIssues(payments: PaymentRecord[]) {
  return payments
    .filter((p) => ["blocked", "rejected", "waitingBdm", "waitingBum"].includes(paymentStage(p)))
    .map((p) => ({
      id: p.id,
      store: p.storeName,
      city: p.city,
      day: p.day,
      stage: paymentStage(p),
      note: p.paid,
      sum: payable(p),
      failed: p.checks.filter((c) => !c.ok).map((c) => c.q),
    }))
    .sort((a, b) => PAYMENT_STAGES.indexOf(a.stage) - PAYMENT_STAGES.indexOf(b.stage));
}

// --- Reports page ---------------------------------------------------------------------------

// The headline numbers of a dataset by months (the reports page's «Главное»).
export function connectKpis(d: Dataset) {
  const stores = new Set(
    [...d.oos, ...d.orders, ...d.payments, ...d.visits].map((r) => r.storeCode),
  );
  const withGaps = d.oos.filter(hasGap);
  const orderStages = countBy(d.orders, orderStage);
  const paymentStages = countBy(d.payments, paymentStage);
  const stageSum = (stage: PaymentStage) =>
    sum(d.payments.filter((p) => paymentStage(p) === stage).map(payable));
  const roiKnown = d.payments.filter((p) => p.roi);
  const doneVisits = d.visits.filter(visitDone);
  return {
    stores: stores.size,
    checks: d.oos.length,
    gapRate: percent(withGaps.length, d.oos.length),
    avgGaps: d.oos.length
      ? Math.round((sum(d.oos.map((c) => c.missing + c.low)) / d.oos.length) * 10) / 10
      : 0,
    conversion: percent(withGaps.filter((c) => c.orderCreated).length, withGaps.length),
    orders: d.orders.length,
    ordersSum: sum(d.orders.map((o) => o.sum)),
    delivered: orderStages.delivered ?? 0,
    deliveredRate: percent(orderStages.delivered ?? 0, d.orders.length),
    noAnswerRate: percent(orderStages.noAnswer ?? 0, d.orders.length),
    requests: d.payments.length,
    contractSum: sum(d.payments.map((p) => p.contractSum)),
    paidSum: stageSum("paid"),
    paidRate: percent(paymentStages.paid ?? 0, d.payments.length),
    waiting: (paymentStages.waitingBdm ?? 0) + (paymentStages.waitingBum ?? 0),
    waitingSum: stageSum("waitingBdm") + stageSum("waitingBum"),
    blocked: paymentStages.blocked ?? 0,
    checklist: average(d.payments.flatMap((p) => (p.checklist === null ? [] : [p.checklist]))),
    roiPositive: percent(roiKnown.filter((p) => p.roi === "positive").length, roiKnown.length),
    visits: d.visits.length,
    visitsDone: doneVisits.length,
    visitScore: average(doneVisits.flatMap((v) => (v.percent === null ? [] : [v.percent]))),
  };
}
export type Kpis = ReturnType<typeof connectKpis>;

// --- helpers --------------------------------------------------------------------------------

function countBy<T, K extends string>(rows: T[], key: (row: T) => K) {
  const counts: Partial<Record<K, number>> = {};
  for (const row of rows) {
    const k = key(row);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}
