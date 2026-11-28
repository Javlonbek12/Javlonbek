import ExcelJS from "exceljs";

import {
  FLOWS,
  LEVELS,
  METRICS,
  STOCKS,
  type Metric,
  type SopMaterial,
  type SopModel,
  type SopSku,
} from "@/modules/sop/types";

// Synthetic S&OP data for the tests: a model built in code (for the engine) and the same model
// written as a workbook in the layout HQ sends (for the reader, the upload and the pages).
// Nothing here is real: «SKU A», «ALFA 100», factories AAA and BBB.

// June 2026 … April 2027: the cycle is November (index 5), the plan runs to April.
export const MONTHS = [
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
  "2026-11",
  "2026-12",
  "2027-01",
  "2027-02",
  "2027-03",
  "2027-04",
];
export const CYCLE = "2026-11";

type Series = Partial<Record<Metric, (number | null)[]>>;

export type SkuInput = Series & {
  factory?: string;
  code?: string;
  type?: string;
  status?: string;
  row?: number;
  // How cells were filled, by metric: one code per month («n» typed, «s» sum, «l» lookup,
  // «o» other formula, «-» empty). What is not given is as a correct sheet has it.
  formulas?: Partial<Record<Metric, string>>;
  parts?: Record<string, number[]>;
};

// An SKU of a sheet whose months are `months` and cycle `cycle`. Series may be shorter than the
// months (the rest is 0). Left out: the plan is the order, the shipment is the plan, the stocks
// of the plan's months follow the balance (as the sheet's formulas would give them).
export function makeSku(
  name: string,
  input: SkuInput = {},
  months: string[] = MONTHS,
  cycle: string = CYCLE,
): SopSku {
  const m = months.indexOf(cycle);
  const pad = (values: (number | null)[] | undefined, fallback: (number | null)[] = []) =>
    months.map((_, i) => values?.[i] ?? fallback[i] ?? 0);
  const po = pad(input.po);
  const plan = pad(input.plan, po);
  const out = pad(input.out, plan);
  const sellIn = pad(input.sellIn);
  const sellThru = pad(input.sellThru);
  const factoryStock = pad(input.factoryStock);
  const entityStock = pad(input.entityStock);
  const distStock = pad(input.distStock);
  for (let i = Math.max(m, 1); i < months.length; i++) {
    if (input.entityStock?.[i] === undefined)
      entityStock[i] = (entityStock[i - 1] ?? 0) + (out[i] ?? 0) - (sellIn[i] ?? 0);
    if (input.distStock?.[i] === undefined)
      distStock[i] = (distStock[i - 1] ?? 0) + (sellIn[i] ?? 0) - (sellThru[i] ?? 0);
  }
  const values = {
    po,
    plan,
    out,
    sellIn,
    sellThru,
    factoryStock,
    entityStock,
    distStock,
    distLevel: pad(input.distLevel),
    marketLevel: pad(input.marketLevel),
    totalLevel: pad(input.totalLevel),
  } satisfies Record<Metric, (number | null)[]>;
  const formulas = {} as Record<Metric, string>;
  for (const metric of METRICS) {
    const lookup = metric === "plan" || metric === "factoryStock";
    const stock = metric === "entityStock" || metric === "distStock";
    const level = (LEVELS as readonly string[]).includes(metric);
    formulas[metric] =
      input.formulas?.[metric] ??
      months.map((_, i) => (lookup ? "l" : level ? "o" : stock && i >= m ? "o" : "n")).join("");
  }
  return {
    key: `${input.factory ?? "AAA"}|${name}`,
    row: input.row ?? 8,
    factory: input.factory ?? "AAA",
    code: input.code ?? `T-${name.replace(/\W+/g, "")}`,
    name,
    type: input.type ?? "84 SS",
    status: input.status ?? "Steady",
    values,
    formulas,
    parts: input.parts ?? {},
  };
}

export function makeModel(
  skus: SopSku[],
  extra: Partial<Pick<SopModel, "subtotals" | "materials" | "months">> = {},
  cycle: string = CYCLE,
): SopModel {
  const months = extra.months ?? MONTHS;
  return {
    version: 1,
    sheet: "PSI TST (test)",
    market: "TST",
    headerRow: 7,
    months,
    lastActual: months[months.indexOf(cycle) - 1] ?? null,
    detectedCycle: cycle,
    skus: skus.map((sku, index) => ({ ...sku, row: 8 + index })),
    subtotals: extra.subtotals ?? [],
    materials: extra.materials ?? null,
  };
}

export const makeMaterial = (name: string, input: Partial<SopMaterial> = {}): SopMaterial => ({
  row: 5,
  factory: "AAA",
  code: `T-${name.replace(/\W+/g, "")}`,
  name,
  type: "84 SS",
  status: "Steady",
  totalKsh: null,
  totalBox: 0,
  plan: [],
  planTotal: 0,
  salesForecast: null,
  turnover: null,
  note: "",
  ...input,
});

// --- The same model as a workbook ---------------------------------------------------------------

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const TITLES: Record<Metric, string> = {
  po: "Production\r\nOrder",
  plan: "Production\r\nPlan",
  out: "Outbound\r\nPlan",
  sellIn: "Distributor\r\nSell-in",
  sellThru: "Distributor\r\nSell-thru",
  factoryStock: "Factory\r\nStock",
  entityStock: "Entity\r\nStock",
  distStock: "Distributor\r\nStock",
  distLevel: "Dis.\r\nLevel",
  marketLevel: "Market\r\nLevel",
  totalLevel: "Total\r\nLevel",
};

export type WorkbookOptions = {
  market?: string;
  // Rows above the header: a label and the totals to show; by default the true sums by factory
  // and the grand total.
  subtotals?: { label: string; values: Partial<Record<Metric, number[]>> }[];
  // Other sheets to add before the PSI sheet (a workbook has many).
  extraSheets?: string[];
  // Leave the materials sheet out even when the model has materials.
  noMaterials?: boolean;
};

// Writes the model the way HQ's workbook has it: labels on the left, an opening month with the
// three stocks only, eleven columns a month after it, the sheet's own totals above the header,
// and every cell filled the way its formula code says.
export async function sopWorkbook(model: SopModel, options: WorkbookOptions = {}): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const name of options.extraSheets ?? []) book.addWorksheet(name).addRow(["Other", 1, 2]);
  const market = options.market ?? model.market;
  const ws = book.addWorksheet(`PSI ${market} (test)`);
  const HEADER = 7;
  const fixed = [
    "Unique\r\nCode",
    "FAC",
    "MKT",
    "CODE",
    "PRODUCT NAME",
    "TYPE",
    "LEVEL 4 CODE (APS)",
    "RATIONALIZATION PLAN",
  ];
  fixed.forEach((title, i) => (ws.getCell(HEADER, i + 1).value = title));
  // The first month is the opening balance: stocks only.
  const columns: { month: number; metric: Metric; column: number }[] = [];
  let column = fixed.length + 1;
  model.months.forEach((month, index) => {
    const name = `${MONTH_NAMES[Number(month.slice(5)) - 1]}${index % 2 ? "'" : "`"}${month.slice(2, 4)}`;
    for (const metric of index === 0 ? STOCKS : METRICS) {
      ws.getCell(HEADER, column).value = `${name}\r\n${TITLES[metric]}`;
      columns.push({ month: index, metric, column });
      column++;
    }
  });
  const letter = (n: number) => ws.getColumn(n).letter;

  model.skus.forEach((sku, position) => {
    const row = HEADER + 1 + position;
    ws.getCell(row, 1).value = { formula: `B${row}&C${row}&E${row}`, result: sku.key };
    ws.getCell(row, 2).value = sku.factory;
    ws.getCell(row, 3).value = market;
    if (sku.code) ws.getCell(row, 4).value = sku.code;
    ws.getCell(row, 5).value = sku.name;
    ws.getCell(row, 6).value = sku.type;
    // The status is pulled from another sheet, as in the real workbook.
    ws.getCell(row, 8).value = {
      formula: `VLOOKUP(A${row},'Other'!A:H,8,FALSE)`,
      result: sku.status,
    };
    for (const { month, metric, column: at } of columns) {
      const code = sku.formulas[metric][month] ?? "n";
      const value = sku.values[metric][month];
      if (code === "-" || value === null) continue;
      const cell = ws.getCell(row, at);
      if (code === "n") cell.value = value;
      else if (code === "s")
        cell.value = {
          formula: (sku.parts[`${metric}:${month}`] ?? [value, 0]).join("+"),
          result: value,
        };
      else if (code === "l")
        cell.value = {
          formula: `VLOOKUP($A${row},'Other'!$A$8:$ZZ$99,${at},FALSE)`,
          result: value,
        };
      else cell.value = { formula: `${letter(at - 1)}${row}*1`, result: value };
    }
  });

  const factories = [...new Set(model.skus.map((s) => s.factory))];
  const subtotals =
    options.subtotals ??
    [...factories, "Total"].map((label) => ({
      label,
      values: Object.fromEntries(
        [...FLOWS, ...STOCKS].map((metric) => [
          metric,
          model.months.map((_, i) =>
            model.skus
              .filter((s) => label === "Total" || s.factory === label)
              .reduce((sum, s) => sum + (s.values[metric][i] ?? 0), 0),
          ),
        ]),
      ) as Partial<Record<Metric, number[]>>,
    }));
  subtotals.slice(0, 5).forEach((subtotal, index) => {
    const row = 2 + index;
    ws.getCell(row, 6).value = subtotal.label;
    for (const { month, metric, column: at } of columns) {
      const value = subtotal.values[metric]?.[month];
      if (value !== undefined)
        ws.getCell(row, at).value = {
          formula: `SUBTOTAL(9,${letter(at)}8:${letter(at)}99)`,
          result: value,
        };
    }
  });

  if (model.materials && !options.noMaterials) {
    const sheet = book.addWorksheet("3. Materials");
    const head = [
      "Unique\r\nCode",
      "FAC",
      "MKT",
      "CODE\r\n(old 2025)",
      "CODE\r\n(new 2026)",
      "PRODUCT NAME",
      "TYPE",
      "RATIONALIZATION PLAN",
      "Total\r\n(KSH)",
      "Total\r\n(Box)",
      ...model.materials.planMonths.map(
        (month) =>
          `${MONTH_NAMES[Number(month.slice(5)) - 1]}'${month.slice(2, 4)}\r\nProduction\r\nPlan`,
      ),
      "Total\r\nProduction\r\nPlan (6M)",
      "Sales\r\nforecast\r\n(box/M)",
      "Inventory\r\nturnover\r\nmonths",
      "Note",
    ];
    sheet.getRow(4).values = head;
    // A row of another market first: it must be left out.
    sheet.addRow(["x", "AAA", "ZZZ", "old", "new", "OTHER MARKET SKU", "84 SS", "Steady", 1, 999]);
    for (const row of model.materials.rows)
      sheet.addRow([
        `${row.factory}${market}${row.name}`,
        row.factory,
        market,
        "OLD",
        row.code,
        row.name,
        row.type,
        row.status,
        row.totalKsh,
        row.totalBox,
        ...model.materials.planMonths.map((_, i) => row.plan[i] ?? 0),
        row.planTotal,
        row.salesForecast,
        row.turnover,
        row.note,
      ]);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
