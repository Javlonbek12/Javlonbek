import {
  coverFlags,
  coverOf,
  demandAt,
  isDelist,
  isNew,
  isNotLaunched,
  launchIndex,
  MIN_DEMAND,
  ownStocks,
  planRateOf,
  round,
  runRateOf,
  SLOW_MIN_STOCK,
  valueOf,
  type SopContext,
} from "./calc";
import { FLOWS, STOCKS, type Metric, type SopModel, type SopSku } from "./types";

// The checks of the uploaded sheet. Every finding has a stable key (the rule, the SKU and its
// months), so a mark put on it («Проверено», «Так и задумано») survives a re-upload of the same
// cycle as long as the finding itself is the same. Texts are in the dictionary (sop.rules.<rule>):
// a finding carries only the rule, the numbers and where they are.

export type Severity = "error" | "risk" | "note";

// Each rule: how serious it is and which point of the monthly checklist it belongs to (1–9).
export const RULES = {
  poDelist: { severity: "error", checklist: 5 },
  poOldRow: { severity: "error", checklist: 5 },
  newBeyond: { severity: "error", checklist: 7 },
  negativeEntity: { severity: "error", checklist: null },
  negativeDist: { severity: "error", checklist: null },
  moq: { severity: "error", checklist: 6 },
  stockBalance: { severity: "error", checklist: null },
  typedFormula: { severity: "error", checklist: null },
  noFormula: { severity: "error", checklist: null },
  subtotal: { severity: "error", checklist: null },
  poVsPlanFrozen: { severity: "error", checklist: 4 },
  newNoPlan: { severity: "error", checklist: 7 },
  frozenChanged: { severity: "error", checklist: 4 },
  m1EntityTyped: { severity: "error", checklist: 2 },
  m1SellInTyped: { severity: "error", checklist: 3 },
  m1SellThruTyped: { severity: "error", checklist: 3 },
  m1Outbound: { severity: "error", checklist: 2 },
  entityLow: { severity: "risk", checklist: null },
  distLow: { severity: "risk", checklist: null },
  totalHigh: { severity: "risk", checklist: null },
  slowStock: { severity: "risk", checklist: null },
  regularRun: { severity: "risk", checklist: 6 },
  containerFill: { severity: "risk", checklist: 6 },
  containerRun: { severity: "risk", checklist: 6 },
  runRate: { severity: "risk", checklist: null },
  launchTiming: { severity: "risk", checklist: 7 },
  materialsDelist: { severity: "risk", checklist: null },
  materialsLeftover: { severity: "risk", checklist: null },
  poVsPlanLater: { severity: "note", checklist: null },
  noCode: { severity: "note", checklist: null },
  balanceFormula: { severity: "note", checklist: null },
  flattened: { severity: "note", checklist: null },
} as const satisfies Record<string, { severity: Severity; checklist: number | null }>;

export type RuleId = keyof typeof RULES;
export const RULE_IDS = Object.keys(RULES) as RuleId[];

// A line of numbers under a finding: usually one month. `metric` names a column of the sheet.
export type FindingRow = { month?: string; metric?: Metric } & Record<
  string,
  string | number | undefined
>;

export type FindingSku = { key: string; name: string; factory: string; code: string };

export type Finding = {
  key: string;
  rule: RuleId;
  severity: Severity;
  // The product it is about; null for a finding about a factory, a month or the whole sheet.
  sku: FindingSku | null;
  // The products of an aggregated finding (M-1 closing, a line's run).
  skus: FindingSku[];
  factory: string | null;
  months: string[];
  // Numbers and names for the texts (see sop.rules.<rule>.title / .do).
  params: Record<string, string | number>;
  rows: FindingRow[];
};

// What the engine compares with: the upload before this one.
export type Baseline = { model: SopModel; cycle: string } | null;

const TOLERANCE = 1;
// How many differing cells of a subtotal row are listed (the rest are only counted).
const SUBTOTAL_ROWS = 12;
// Materials left after the six months of the plan are worth a word from this many cases on: a
// few dozen are the usual gap between the batch of the product and of its packaging.
export const MATERIAL_LEFTOVER_MIN = 50;
const skuOf = (sku: SopSku): FindingSku => ({
  key: sku.key,
  name: sku.name,
  factory: sku.factory,
  code: sku.code,
});

// «[RE] SKU A» is the renewed row of «SKU A»: the name without the mark.
const RENEWED = /^\[\s*RE\s*\]\s*/i;
const nameKey = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

export function findIssues(ctx: SopContext, baseline: Baseline = null): Finding[] {
  const { model, settings, horizon, frozen, m, m1 } = ctx;
  const months = model.months;
  const found: Finding[] = [];

  const add = (
    rule: RuleId,
    target: { sku?: SopSku; scope?: string; factory?: string; skus?: SopSku[] },
    rows: FindingRow[],
    params: Finding["params"] = {},
  ) => {
    const monthsOf = [...new Set(rows.map((r) => r.month).filter((x) => x !== undefined))].sort();
    found.push({
      key: [rule, target.sku?.key ?? target.scope ?? "all", monthsOf.join(",")].join("|"),
      rule,
      severity: RULES[rule].severity,
      sku: target.sku ? skuOf(target.sku) : null,
      skus: (target.skus ?? []).map(skuOf),
      factory: target.sku?.factory ?? target.factory ?? null,
      months: monthsOf,
      params,
      rows,
    });
  };

  const renewedNames = new Set(
    model.skus.filter((s) => RENEWED.test(s.name)).map((s) => nameKey(s.name.replace(RENEWED, ""))),
  );
  const newLimit = m + settings.newPoHorizon;
  const later = horizon.filter((i) => !frozen.includes(i));

  // A column of the plan that is typed almost everywhere is a file pasted as values: said once,
  // not on every SKU.
  const FORMULA_METRICS = ["entityStock", "distStock", "plan", "factoryStock"] as const;
  const flat = new Set<Metric>();
  for (const metric of FORMULA_METRICS) {
    let typed = 0;
    let filled = 0;
    for (const sku of model.skus)
      for (const i of horizon) {
        const code = sku.formulas[metric][i];
        if (code === "n") typed++;
        if (code && code !== "-") filled++;
      }
    if (filled >= 5 && typed / filled >= 0.8) {
      flat.add(metric);
      add("flattened", { scope: metric }, [{ metric, count: typed }], { count: typed });
    }
  }

  for (const sku of model.skus) {
    const own = ownStocks(ctx, sku);
    const delist = isDelist(sku.status);
    const fresh = isNew(sku.status);
    const notLaunched = isNotLaunched(sku.status);
    const po = (i: number) => valueOf(sku, "po", i);
    const plan = (i: number) => valueOf(sku, "plan", i);
    const poRows = (indexes: number[]): FindingRow[] =>
      indexes.map((i) => ({ month: months[i]!, po: po(i) }));
    const ordered = horizon.filter((i) => po(i) > 0);

    // --- Orders that cost money -----------------------------------------------------------
    if (delist && ordered.length) add("poDelist", { sku }, poRows(ordered));
    if (!RENEWED.test(sku.name) && renewedNames.has(nameKey(sku.name)) && ordered.length)
      add("poOldRow", { sku }, poRows(ordered), { twin: `[RE] ${sku.name}` });
    const beyond = ordered.filter((i) => i > newLimit);
    if (fresh && beyond.length)
      add("newBeyond", { sku }, poRows(beyond), { limit: months[newLimit] ?? "" });
    const small = ordered.filter((i) => po(i) < settings.moq);
    if (small.length) add("moq", { sku }, poRows(small), { moq: settings.moq });
    if (!sku.code && ordered.length) add("noCode", { sku }, poRows(ordered));

    // --- Stocks -----------------------------------------------------------------------------
    const negativeEntity = horizon.filter((i) => (own.entity[i] ?? 0) < -0.5);
    if (negativeEntity.length)
      add(
        "negativeEntity",
        { sku },
        negativeEntity.map((i) => ({ month: months[i]!, stock: own.entity[i]! })),
      );
    const negativeDist = horizon.filter((i) => (own.dist[i] ?? 0) < -0.5);
    if (negativeDist.length)
      add(
        "negativeDist",
        { sku },
        negativeDist.map((i) => ({ month: months[i]!, stock: own.dist[i]! })),
      );

    // A stock of a forecast month against the balance of the file's own neighbouring cells.
    const balanceRows: FindingRow[] = [];
    const formulaRows: FindingRow[] = [];
    const typedRows: FindingRow[] = [];
    for (const metric of ["entityStock", "distStock"] as const) {
      for (const i of horizon) {
        const code = sku.formulas[metric][i];
        const value = sku.values[metric][i];
        if (value === null || value === undefined || !code || code === "-") continue;
        const previous = i > 0 ? valueOf(sku, metric, i - 1) : 0;
        const expected = round(
          metric === "entityStock"
            ? previous + valueOf(sku, "out", i) - valueOf(sku, "sellIn", i)
            : previous + valueOf(sku, "sellIn", i) - valueOf(sku, "sellThru", i),
        );
        const off = Math.abs(value - expected) > TOLERANCE;
        const row = { month: months[i]!, metric, value, expected };
        if (code === "n" && off) balanceRows.push(row);
        else if (code === "n" && !flat.has(metric)) typedRows.push({ month: months[i]!, metric });
        else if (code !== "n" && off) formulaRows.push(row);
      }
    }
    for (const metric of ["plan", "factoryStock"] as const) {
      if (flat.has(metric)) continue;
      for (const i of horizon)
        if (sku.formulas[metric][i] === "n")
          typedRows.push({ month: months[i]!, metric, value: valueOf(sku, metric, i) });
    }
    // An empty stock cell in a month the row has movements in: the formula was not pulled down,
    // and the sheet's totals miss this row.
    const emptyRows: FindingRow[] = [];
    for (const [metric, mine] of [
      ["entityStock", own.entity],
      ["distStock", own.dist],
    ] as const)
      for (const i of horizon)
        if (sku.formulas[metric][i] === "-" && Math.abs(mine[i] ?? 0) > 0.5)
          emptyRows.push({ month: months[i]!, metric, value: mine[i]! });
    if (emptyRows.length) add("noFormula", { sku }, emptyRows);
    if (balanceRows.length) add("stockBalance", { sku }, balanceRows);
    if (typedRows.length) add("typedFormula", { sku }, typedRows);
    if (formulaRows.length) add("balanceFormula", { sku }, formulaRows);

    // --- Order against the factory's plan -----------------------------------------------------
    const removed = (i: number) => notLaunched && po(i) > 0 && Math.abs(plan(i)) < 0.5;
    const noPlan = horizon.filter(removed);
    if (noPlan.length) add("newNoPlan", { sku }, poRows(noPlan));
    const differs = (i: number) => Math.abs(po(i) - plan(i)) > 0.5 && !removed(i);
    const planRows = (indexes: number[]): FindingRow[] =>
      indexes.map((i) => ({ month: months[i]!, po: po(i), plan: plan(i) }));
    if (frozen.some(differs)) add("poVsPlanFrozen", { sku }, planRows(frozen.filter(differs)));
    if (later.some(differs)) add("poVsPlanLater", { sku }, planRows(later.filter(differs)));

    // The frozen months against what the upload before had for them.
    const before = baseline?.model.skus.find((s) => s.key === sku.key);
    if (baseline && before) {
      const changed: FindingRow[] = [];
      for (const i of frozen) {
        const j = baseline.model.months.indexOf(months[i]!);
        if (j < 0) continue;
        const was = valueOf(before, "po", j);
        if (Math.abs(was - po(i)) > 0.5) changed.push({ month: months[i]!, was, now: po(i) });
      }
      if (changed.length) add("frozenChanged", { sku }, changed);
    }

    // --- Stock norms --------------------------------------------------------------------------
    const launch = launchIndex(sku, own);
    if (!delist) {
      const judged = horizon
        .filter((i) => i >= launch && demandAt(sku, i) >= MIN_DEMAND)
        .map((i) => {
          const demand = demandAt(sku, i);
          const entity = own.entity[i] ?? 0;
          const dist = own.dist[i] ?? 0;
          const total = valueOf(sku, "factoryStock", i) + entity + dist;
          return {
            month: months[i]!,
            demand: round(demand),
            entityStock: entity,
            distStock: dist,
            totalStock: round(total),
            entity: coverOf(entity, demand) ?? 0,
            dist: coverOf(dist, demand) ?? 0,
            total: coverOf(total, demand) ?? 0,
          };
        });
      const lowEntity = judged.filter((c) => coverFlags(c, settings).entityLow);
      if (lowEntity.length)
        add(
          "entityLow",
          { sku },
          lowEntity.map((c) => ({ month: c.month, cover: c.entity, stock: c.entityStock })),
          { min: settings.entityMin, first: lowEntity[0]!.month, count: lowEntity.length },
        );
      const lowDist = judged.filter((c) => coverFlags(c, settings).distLow);
      if (lowDist.length)
        add(
          "distLow",
          { sku },
          lowDist.map((c) => ({ month: c.month, cover: c.dist, stock: c.distStock })),
          { min: settings.distMin, first: lowDist[0]!.month, count: lowDist.length },
        );
      const high = judged.filter((c) => coverFlags(c, settings).high);
      if (high.length)
        add(
          "totalHigh",
          { sku },
          high.map((c) => ({ month: c.month, cover: c.total, stock: c.totalStock })),
          { max: settings.maxTotal, peak: Math.max(...high.map((c) => c.total)) },
        );
    }

    // --- Sales --------------------------------------------------------------------------------
    const runRate = runRateOf(ctx, sku);
    if (runRate !== null && m1 >= 0) {
      const stock = valueOf(sku, "entityStock", m1) + valueOf(sku, "distStock", m1);
      const cover = runRate > 0 ? stock / runRate : null;
      const slow =
        stock >= SLOW_MIN_STOCK &&
        !notLaunched &&
        (cover === null ? !fresh : cover > settings.slowMonths);
      if (slow)
        add("slowStock", { sku }, [{ month: months[m1]!, stock, rate: round(runRate) }], {
          stock,
          rate: round(runRate),
          // 999: nothing was sold at all, so the stock lasts «forever».
          cover: cover === null ? 999 : cover,
          limit: settings.slowMonths,
        });
      const planned = planRateOf(ctx, sku);
      if (runRate >= 30) {
        const percent = (planned / runRate - 1) * 100;
        if (Math.abs(percent) > settings.runRateDeviation)
          add("runRate", { sku }, [], {
            actual: round(runRate),
            plan: round(planned),
            percent,
            limit: settings.runRateDeviation,
          });
      }
    }

    // --- New products ---------------------------------------------------------------------------
    if (notLaunched) {
      const firstPo = ordered[0];
      const firstSale = horizon.find((i) => valueOf(sku, "sellIn", i) > 0);
      if (firstPo !== undefined && firstSale !== undefined && firstSale <= firstPo) {
        // Already produced and waiting: the first sale does not depend on this order.
        const ready =
          m1 >= 0 ? valueOf(sku, "entityStock", m1) + valueOf(sku, "factoryStock", m1) : 0;
        if (ready + 0.5 < valueOf(sku, "sellIn", firstSale))
          add(
            "launchTiming",
            { sku },
            [
              {
                month: months[firstSale]!,
                po: po(firstPo),
                sellIn: valueOf(sku, "sellIn", firstSale),
              },
            ],
            { poMonth: months[firstPo]!, saleMonth: months[firstSale]! },
          );
      }
    }

    // --- Closing M-1 ----------------------------------------------------------------------------
    if (m1 >= 1) {
      const expected = round(
        valueOf(sku, "factoryStock", m1 - 1) + plan(m1) - valueOf(sku, "factoryStock", m1),
      );
      const out = valueOf(sku, "out", m1);
      if (Math.abs(out - expected) > TOLERANCE)
        add("m1Outbound", { sku }, [{ month: months[m1]!, out, expected }], {
          out,
          expected,
          produced: plan(m1),
          left: valueOf(sku, "factoryStock", m1),
        });
    }
  }

  // --- Closing M-1: the three cells that must be typed as a sum of two numbers ------------------
  if (ctx.kind === "OURS" && m1 >= 0) {
    const closing = [
      ["m1EntityTyped", "entityStock"],
      ["m1SellInTyped", "sellIn"],
      ["m1SellThruTyped", "sellThru"],
    ] as const;
    for (const [rule, metric] of closing) {
      const typed = model.skus.filter(
        (sku) => Math.abs(valueOf(sku, metric, m1)) > 0.0001 && sku.formulas[metric][m1] !== "s",
      );
      if (typed.length)
        add(rule, { scope: "all", skus: typed }, [{ month: months[m1]!, metric }], {
          count: typed.length,
        });
    }
  }

  // --- The sheet's own totals above the header --------------------------------------------------
  const factories = new Set(model.skus.map((s) => s.factory));
  const checked = [m1, ...horizon].filter((i) => i >= 0);
  for (const subtotal of model.subtotals) {
    const label = subtotal.label.trim().toUpperCase();
    const isTotal = /TOTAL/.test(label);
    const rows: FindingRow[] = [];
    // The order first, month by month: that is what the eye checks against these rows.
    for (const metric of [...FLOWS, ...STOCKS]) {
      for (const i of checked) {
        const shown = subtotal.values[metric]?.[i];
        if (shown === null || shown === undefined) continue;
        const real = round(
          model.skus
            .filter((s) => isTotal || s.factory === label)
            .reduce((sum, s) => sum + valueOf(s, metric, i), 0),
        );
        if (Math.abs(shown - real) > TOLERANCE)
          rows.push({ month: months[i]!, metric, shown, real, diff: round(shown - real) });
      }
    }
    if (rows.length === 0) continue;
    add(
      "subtotal",
      { scope: label, factory: factories.has(label) ? label : undefined },
      rows.slice(0, SUBTOTAL_ROWS),
      {
        label: subtotal.label,
        row: subtotal.row,
        count: rows.length,
        // 1: the label is a factory of the sheet; 0: no SKU has such a factory.
        known: isTotal || factories.has(label) ? 1 : 0,
      },
    );
  }

  // --- Factory lines and transport --------------------------------------------------------------
  const runs = (indexes: number[]) => {
    const groups: number[][] = [];
    for (const i of indexes) {
      const last = groups.at(-1);
      if (last && last.at(-1) === i - 1) last.push(i);
      else groups.push([i]);
    }
    return groups.filter((group) => group.length >= 2);
  };
  const regularType = nameKey(settings.regularType);
  const regular = model.skus.filter((s) => nameKey(s.type) === regularType);
  const regularPo = (i: number) => round(regular.reduce((sum, s) => sum + valueOf(s, "po", i), 0));
  for (const run of runs(horizon.filter((i) => regularPo(i) > 0)))
    add(
      "regularRun",
      {
        scope: settings.regularType,
        skus: regular.filter((s) => run.some((i) => valueOf(s, "po", i) > 0)),
      },
      run.map((i) => ({ month: months[i]!, po: regularPo(i) })),
      { type: settings.regularType },
    );

  const containerFactory = settings.containerFactory.toUpperCase();
  const shipped = (i: number) =>
    round(
      model.skus
        .filter((s) => s.factory === containerFactory)
        .reduce((sum, s) => sum + valueOf(s, "out", i), 0),
    );
  const shippedMonths = horizon.filter((i) => shipped(i) > 0);
  for (const i of shippedMonths) {
    const load = loadOf(shipped(i), settings.containerCases);
    if (load.lastFill * 100 < settings.containerWarn)
      add(
        "containerFill",
        { scope: months[i]!, factory: containerFactory },
        [{ month: months[i]!, out: shipped(i) }],
        {
          factory: containerFactory,
          out: shipped(i),
          size: settings.containerCases,
          count: load.count,
          fill: load.lastFill * 100,
          missing: load.missing,
        },
      );
  }
  for (const run of runs(shippedMonths))
    add(
      "containerRun",
      { scope: containerFactory, factory: containerFactory },
      run.map((i) => ({ month: months[i]!, out: shipped(i) })),
      { factory: containerFactory },
    );

  // --- Materials ----------------------------------------------------------------------------
  for (const material of model.materials?.rows ?? []) {
    const boxes = material.totalBox ?? 0;
    if (boxes < 1) continue;
    const sku = model.skus.find(
      (s) => s.factory === material.factory && nameKey(s.name) === nameKey(material.name),
    );
    const target = sku ? { sku } : { scope: `${material.factory}|${material.name}` };
    const planned = material.planTotal ?? 0;
    if (isDelist(material.status))
      add("materialsDelist", target, [], { name: material.name, boxes, plan: planned });
    else if (boxes - planned >= MATERIAL_LEFTOVER_MIN)
      add("materialsLeftover", target, [], {
        name: material.name,
        boxes,
        plan: planned,
        leftover: boxes - planned,
      });
  }

  const order = { error: 0, risk: 1, note: 2 };
  const ruleOrder = new Map(RULE_IDS.map((rule, index) => [rule, index]));
  return found.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      ruleOrder.get(a.rule)! - ruleOrder.get(b.rule)! ||
      (a.sku?.name ?? "").localeCompare(b.sku?.name ?? "") ||
      a.key.localeCompare(b.key),
  );
}

// How many trucks or containers a month's shipment makes and how full the last one is.
export function loadOf(cases: number, size: number) {
  if (cases <= 0 || size <= 0) return { count: 0, lastFill: 0, missing: 0 };
  const count = Math.ceil(cases / size - 1e-9);
  const last = cases - (count - 1) * size;
  return { count, lastFill: last / size, missing: round(count * size - cases) };
}
