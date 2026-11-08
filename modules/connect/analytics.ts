import type { OosRecord, OrderRecord, PaymentRecord, VisitRecord } from "./parse";

// Connect analytics on three levels, as pure functions over the parsed exports:
// leadership (the whole picture), managers (cities, people, bottlenecks), executors (one person's to-do).

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

function skuGaps(checks: OosRecord[]) {
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
function failedQuestions(items: { q: string; ok: boolean }[], minAnswers = 3) {
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

const visitAnswers = (visits: VisitRecord[]) =>
  visits.flatMap((v) =>
    v.answers
      .filter((a) => a.a === "Да" || a.a === "Нет")
      .map((a) => ({ q: a.q, ok: a.a === "Да" })),
  );
const visitDone = (v: VisitRecord) => v.status === "Выполнено";

// --- Leadership -----------------------------------------------------------------------------

function funnelOf(d: Dataset) {
  const withGaps = d.oos.filter(hasGap);
  const fromChecks = d.orders.filter((o) => o.sourceCheck);
  return [
    { id: "checks", value: d.oos.length },
    { id: "gaps", value: withGaps.length },
    { id: "orders", value: withGaps.filter((c) => c.orderCreated).length },
    {
      id: "answered",
      value: fromChecks.filter((o) => o.storeAnswer && o.storeAnswer !== "Отказался").length,
    },
    { id: "delivered", value: fromChecks.filter((o) => orderStage(o) === "delivered").length },
  ] as const;
}

export type Insight = {
  tone: "bad" | "warn" | "good";
  key:
    | "noAnswer"
    | "conversion"
    | "topSku"
    | "waiting"
    | "blocked"
    | "checklist"
    | "visits"
    | "delivered";
  params: Record<string, string | number>;
};

// The headline numbers of a dataset (also of the previous period, for «к прошлому месяцу»).
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

export function executiveView(d: Dataset, months: string[]) {
  const kpis = connectKpis(d);
  const orderStages = countBy(d.orders, orderStage);
  const paymentStages = countBy(d.payments, paymentStage);
  const stageSum = (stage: PaymentStage) =>
    sum(d.payments.filter((p) => paymentStage(p) === stage).map(payable));
  const skus = skuGaps(d.oos);

  const trend = months.map((month) => {
    const oos = d.oos.filter((c) => c.month === month);
    const orders = d.orders.filter((o) => o.month === month);
    const payments = d.payments.filter((p) => p.month === month);
    return {
      month,
      checks: oos.length,
      gapRate: percent(oos.filter(hasGap).length, oos.length),
      orders: orders.length,
      delivered: orders.filter((o) => orderStage(o) === "delivered").length,
      requests: payments.length,
      contractSum: sum(payments.map((p) => p.contractSum)),
      paidSum: sum(payments.filter((p) => paymentStage(p) === "paid").map(payable)),
    };
  });

  const brands = [...groupBy(skus, (s) => s.brand).entries()]
    .map(([brand, list]) => ({ brand, total: sum(list.map((s) => s.total)) }))
    .sort((a, b) => b.total - a.total);
  const checklistFails = failedQuestions(d.payments.flatMap((p) => p.checks));

  return {
    kpis,
    funnel: funnelOf(d),
    orderStages: ORDER_STAGES.map((id) => ({ id, value: orderStages[id] ?? 0 })),
    paymentStages: PAYMENT_STAGES.map((id) => ({
      id,
      value: paymentStages[id] ?? 0,
      sum: stageSum(id),
    })),
    trend,
    topSkus: skus.slice(0, 8),
    brands,
    checklistFails: checklistFails.slice(0, 5),
    insights: insights(d, kpis, skus, checklistFails),
  };
}

function insights(
  d: Dataset,
  k: Kpis,
  skus: ReturnType<typeof skuGaps>,
  fails: ReturnType<typeof failedQuestions>,
): Insight[] {
  const list: Insight[] = [];
  if (d.orders.length && k.noAnswerRate >= 20)
    list.push({ tone: "bad", key: "noAnswer", params: { rate: k.noAnswerRate } });
  if (d.oos.length && k.gapRate > 0)
    list.push({
      tone: k.conversion < 50 ? "bad" : k.conversion < 80 ? "warn" : "good",
      key: "conversion",
      params: { gapRate: k.gapRate, conversion: k.conversion },
    });
  const top = skus[0];
  if (top) list.push({ tone: "warn", key: "topSku", params: { sku: top.sku, count: top.total } });
  if (k.waiting)
    list.push({
      tone: percent(k.waiting, d.payments.length) >= 30 ? "bad" : "warn",
      key: "waiting",
      params: { count: k.waiting, sum: k.waitingSum },
    });
  if (k.blocked) list.push({ tone: "warn", key: "blocked", params: { count: k.blocked } });
  const fail = fails[0];
  if (fail)
    list.push({ tone: "warn", key: "checklist", params: { question: fail.q, rate: fail.rate } });
  if (d.orders.length && k.deliveredRate >= 50)
    list.push({ tone: "good", key: "delivered", params: { rate: k.deliveredRate } });
  if (k.visits && k.visitScore !== null)
    list.push({
      tone: k.visitScore >= 80 ? "good" : "warn",
      key: "visits",
      params: { count: k.visits, score: k.visitScore },
    });
  return list.slice(0, 6);
}

// --- Managers -------------------------------------------------------------------------------

export function managerView(d: Dataset, today: string) {
  const cities = [
    ...new Set([...d.oos, ...d.orders, ...d.payments, ...d.visits].map((r) => r.city ?? "—")),
  ];
  const cityRows = cities
    .map((city) => {
      const of = <T extends { city: string | null }>(rows: T[]) =>
        rows.filter((r) => (r.city ?? "—") === city);
      const oos = of(d.oos);
      const orders = of(d.orders);
      const payments = of(d.payments);
      const visits = of(d.visits).filter(visitDone);
      return {
        city,
        stores: new Set([...oos, ...orders, ...payments, ...of(d.visits)].map((r) => r.storeCode))
          .size,
        checks: oos.length,
        gapRate: percent(oos.filter(hasGap).length, oos.length),
        orders: orders.length,
        delivered: orders.filter((o) => orderStage(o) === "delivered").length,
        requests: payments.length,
        contractSum: sum(payments.map((p) => p.contractSum)),
        waiting: payments.filter((p) => /^waiting/.test(paymentStage(p))).length,
        checklist: average(payments.flatMap((p) => (p.checklist === null ? [] : [p.checklist]))),
        visitScore: average(visits.flatMap((v) => (v.percent === null ? [] : [v.percent]))),
      };
    })
    .sort(
      (a, b) => b.checks + b.requests - (a.checks + a.requests) || a.city.localeCompare(b.city),
    );

  const people = listPeople(d).map((person) => {
    const v = executorView(d, person, today);
    return { person, ...v.kpis, open: v.openCount };
  });

  const age = (at: string) => daysBetween(at, today);
  const waitingPayments = d.payments
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
      days: age(p.at),
    }))
    .sort((a, b) => b.days - a.days);
  const stuckOrders = d.orders
    .filter((o) => ["noAnswer", "inProgress"].includes(orderStage(o)))
    .map((o) => ({
      id: o.id,
      store: o.storeName,
      city: o.city,
      person: o.person,
      status: o.status,
      agentAnswer: o.agentAnswer,
      sum: o.sum,
      days: age(o.at),
    }))
    .sort((a, b) => b.days - a.days);

  // Top products × biggest cities: the share of checks where the product was missing or low.
  const topSkus = skuGaps(d.oos).slice(0, 10);
  const topCities = cityRows
    .filter((c) => c.checks > 0)
    .slice(0, 6)
    .map((c) => c.city);
  const skuCity = topSkus.map((s) => ({
    sku: s.sku,
    cells: topCities.map((city) => {
      const checks = d.oos.filter((c) => (c.city ?? "—") === city);
      const gaps = checks.filter((c) => c.skus[s.sku] === "OUT" || c.skus[s.sku] === "LOW");
      return { city, rate: percent(gaps.length, checks.length), count: gaps.length };
    }),
  }));

  return {
    cities: cityRows,
    people: people.sort((a, b) => b.open - a.open || b.checks - a.checks),
    waitingPayments,
    stuckOrders,
    skuCity: { cities: topCities, rows: skuCity },
    checklistFails: failedQuestions(d.payments.flatMap((p) => p.checks)).slice(0, 8),
    visitFails: failedQuestions(visitAnswers(d.visits), 1).slice(0, 8),
  };
}

// --- Executors ------------------------------------------------------------------------------

// Everyone who did something in the data, the most active first.
export function listPeople(d: Dataset): string[] {
  const counts = new Map<string, number>();
  for (const r of [...d.oos, ...d.orders, ...d.payments, ...d.visits])
    if (r.person) counts.set(r.person, (counts.get(r.person) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([p]) => p);
}

export function executorView(d: Dataset, person: string, today: string) {
  const mine = <T extends { person: string | null }>(rows: T[]) =>
    rows.filter((r) => r.person === person);
  const oos = mine(d.oos);
  const orders = mine(d.orders);
  const payments = mine(d.payments);
  const visits = mine(d.visits);

  // Stores whose latest check (by anyone) still shows gaps and no order was created.
  const latest = new Map<string, OosRecord>();
  for (const c of [...d.oos].sort((a, b) => a.at.localeCompare(b.at))) latest.set(c.storeCode, c);
  const gapsWithoutOrder = [...latest.values()]
    .filter((c) => c.person === person && hasGap(c) && !c.orderCreated)
    .map((c) => ({
      id: c.id,
      store: c.storeName,
      city: c.city,
      day: c.day,
      skus: Object.entries(c.skus)
        .filter(([, s]) => s !== "NOT_BOUGHT")
        .map(([sku]) => sku),
    }))
    .sort((a, b) => b.day.localeCompare(a.day));

  const openOrders = orders
    .filter((o) => ["noAnswer", "inProgress"].includes(orderStage(o)))
    .map((o) => ({
      id: o.id,
      store: o.storeName,
      city: o.city,
      day: o.day,
      status: o.status,
      stage: orderStage(o),
      sum: o.sum,
      days: daysBetween(o.at, today),
    }))
    .sort((a, b) => b.days - a.days);

  const paymentIssues = payments
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

  const openVisits = visits
    .filter((v) => !visitDone(v) || v.problems > 0)
    .map((v) => ({
      id: v.id,
      store: v.storeName,
      city: v.city,
      day: v.day,
      done: visitDone(v),
      percent: v.percent,
      // A problem is shown with the answer given ("Что сообщает точка — Проблемы с доставкой").
      problems: v.problemList.map((q) => {
        const answer = v.answers.find((a) => a.q === q)?.a;
        return answer && answer !== "Нет" ? `${q} — ${answer}` : q;
      }),
    }))
    .sort((a, b) => Number(a.done) - Number(b.done) || b.day.localeCompare(a.day));

  const doneVisits = visits.filter(visitDone);
  const kpis = {
    checks: oos.length,
    gaps: oos.filter(hasGap).length,
    ordersFromChecks: oos.filter((c) => hasGap(c) && c.orderCreated).length,
    orders: orders.length,
    delivered: orders.filter((o) => orderStage(o) === "delivered").length,
    noAnswer: orders.filter((o) => orderStage(o) === "noAnswer").length,
    requests: payments.length,
    contractSum: sum(payments.map((p) => p.contractSum)),
    paid: payments.filter((p) => paymentStage(p) === "paid").length,
    checklist: average(payments.flatMap((p) => (p.checklist === null ? [] : [p.checklist]))),
    visits: visits.length,
    visitScore: average(doneVisits.flatMap((v) => (v.percent === null ? [] : [v.percent]))),
  };
  return {
    kpis,
    gapsWithoutOrder,
    openOrders,
    paymentIssues,
    openVisits,
    openCount:
      gapsWithoutOrder.length + openOrders.length + paymentIssues.length + openVisits.length,
  };
}

// --- helpers --------------------------------------------------------------------------------

function countBy<T, K extends string>(rows: T[], key: (row: T) => K) {
  const counts: Partial<Record<K, number>> = {};
  for (const row of rows) {
    const k = key(row);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}
