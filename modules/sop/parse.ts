import { openSopWorkbook, SopReadError, type SheetCell, type SheetGrid } from "./reader";
import {
  FLOWS,
  METRICS,
  STOCKS,
  type FormulaCode,
  type Metric,
  type SopMaterial,
  type SopModel,
  type SopSku,
  type SopSubtotal,
} from "./types";

// From the uploaded workbook to the model the engine counts on. Everything is found by the text
// of the headers, never by column letters: HQ adds months and columns every cycle.

export class SopFileError extends Error {
  constructor(
    public readonly code: "notXlsx" | "tooBig" | "noSheet" | "noHeader" | "noMonths" | "noSkus",
  ) {
    super(code);
    this.name = "SopFileError";
  }
}

export const MAX_SOP_FILE_MB = 30;
const MAX_SKUS = 2000;
const MAX_MONTHS = 240;
const MAX_MATERIALS = 5000;

// «Nov'26\r\nProduction\r\nOrder» → «Nov'26 Production Order».
export const cleanText = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\s+/g, " ").trim()
    : "";

const MONTH_NUMBER: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

// The month of a header and what follows it: «Nov'26 Production Order», «Dec`23 Entity Stock».
const MONTH_HEADER = /^([A-Za-z]{3})[a-z]*\.?\s*[`'’‘ʼ´]\s*(\d{4}|\d{2})\s+(.+)$/;

const METRIC_NAMES: [RegExp, Metric][] = [
  [/^production order$/i, "po"],
  [/^production plan$/i, "plan"],
  // «Inbound Plan» is what the older months call the shipment from the factory.
  [/^(outbound|inbound) plan$/i, "out"],
  [/^distributor sell[- ]?in$/i, "sellIn"],
  [/^distributor sell[- ]?(thru|through)$/i, "sellThru"],
  [/^factory stock$/i, "factoryStock"],
  [/^entity stock$/i, "entityStock"],
  [/^distributor stock$/i, "distStock"],
  [/^dis\.? ?level$/i, "distLevel"],
  [/^market level$/i, "marketLevel"],
  [/^total level$/i, "totalLevel"],
];

export function monthHeader(text: string): { month: string; rest: string } | null {
  const match = MONTH_HEADER.exec(cleanText(text));
  if (!match) return null;
  const number = MONTH_NUMBER[match[1]!.toLowerCase()];
  if (!number) return null;
  const year = match[2]!.length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  return { month: `${year}-${String(number).padStart(2, "0")}`, rest: match[3]!.trim() };
}

const metricOf = (rest: string): Metric | null =>
  METRIC_NAMES.find(([pattern]) => pattern.test(rest))?.[1] ?? null;

const round = (value: number) => Math.round(value * 1000) / 1000;
const numberOf = (cell: SheetCell | undefined): number | null =>
  typeof cell?.v === "number" && Number.isFinite(cell.v) ? round(cell.v) : null;

const codeOf = (cell: SheetCell | undefined): FormulaCode => {
  if (!cell) return "-";
  if (cell.f === "sum") return "s";
  if (cell.f === "lookup") return "l";
  if (cell.f === "other") return "o";
  return typeof cell.v === "number" ? "n" : "-";
};

// The row of the column titles: the one with «PRODUCT NAME».
function findHeader(grid: SheetGrid, extra?: RegExp): number | null {
  const last = Math.min(grid.maxRow, 60);
  for (let row = 1; row <= last; row++) {
    const cells = [...(grid.rows.get(row)?.values() ?? [])].map((cell) =>
      cleanText(cell.v).toUpperCase(),
    );
    if (cells.includes("PRODUCT NAME") && (!extra || cells.some((text) => extra.test(text))))
      return row;
  }
  return null;
}

// The column whose header is one of `names` (exactly, then by its beginning).
function columnBy(header: Map<number, SheetCell>, ...names: RegExp[]): number | null {
  for (const name of names)
    for (const [column, cell] of header) if (name.test(cleanText(cell.v))) return column;
  return null;
}

export function parsePsiSheet(grid: SheetGrid, market: string): SopModel {
  const headerRow = findHeader(grid);
  if (headerRow === null) throw new SopFileError("noHeader");
  const header = grid.rows.get(headerRow)!;
  const columns = {
    factory: columnBy(header, /^FAC$/i, /^FACTORY$/i),
    code: columnBy(header, /^CODE$/i, /^CODE\b/i),
    name: columnBy(header, /^PRODUCT NAME$/i)!,
    type: columnBy(header, /^TYPE$/i),
    status: columnBy(header, /^RATIONALI[SZ]ATION PLAN$/i, /RATIONALI[SZ]ATION/i),
  };

  // The months and their columns, in the file's order of months.
  const byMonth = new Map<string, Partial<Record<Metric, number>>>();
  let firstMonthColumn = Infinity;
  for (const [column, cell] of [...header].sort((a, b) => a[0] - b[0])) {
    const found = typeof cell.v === "string" ? monthHeader(cell.v) : null;
    const metric = found && metricOf(found.rest);
    if (!found || !metric) continue;
    const month = byMonth.get(found.month) ?? {};
    // The first column with this title wins (a repeated header is not read twice).
    month[metric] ??= column;
    byMonth.set(found.month, month);
    firstMonthColumn = Math.min(firstMonthColumn, column);
  }
  const months = [...byMonth.keys()].sort().slice(-MAX_MONTHS);
  // A month with stocks only (the opening balance) is a month; one without any of what the
  // engine needs is not.
  if (!months.some((month) => FLOWS.some((flow) => byMonth.get(month)![flow] !== undefined)))
    throw new SopFileError("noMonths");

  const skus: SopSku[] = [];
  const keys = new Map<string, number>();
  for (let row = headerRow + 1; row <= grid.maxRow; row++) {
    const cells = grid.rows.get(row);
    const name = cleanText(cells?.get(columns.name)?.v);
    if (!cells || !name) continue;
    if (skus.length >= MAX_SKUS) throw new SopFileError("tooBig");
    const text = (column: number | null) =>
      column === null ? "" : cleanText(cells.get(column)?.v).slice(0, 200);
    const factory = text(columns.factory).toUpperCase();
    const base = `${factory}|${name.slice(0, 200)}`;
    const seen = (keys.get(base) ?? 0) + 1;
    keys.set(base, seen);
    const sku: SopSku = {
      key: seen === 1 ? base : `${base}#${seen}`,
      row,
      factory,
      code: text(columns.code),
      name: name.slice(0, 200),
      type: text(columns.type),
      status: text(columns.status),
      values: {} as SopSku["values"],
      formulas: {} as SopSku["formulas"],
      parts: {},
    };
    for (const metric of METRICS) {
      const values: (number | null)[] = [];
      let formulas = "";
      months.forEach((month, index) => {
        const column = byMonth.get(month)![metric];
        const cell = column === undefined ? undefined : cells.get(column);
        values.push(numberOf(cell));
        formulas += codeOf(cell);
        if (cell?.f === "sum" && cell.parts)
          sku.parts[`${metric}:${index}`] = cell.parts.map(round);
      });
      sku.values[metric] = values;
      sku.formulas[metric] = formulas;
    }
    skus.push(sku);
  }
  if (skus.length === 0) throw new SopFileError("noSkus");

  // The sheet's own totals above the header: a row with a short label on the left (a factory
  // code, «Total») and numbers under the months.
  const subtotals: SopSubtotal[] = [];
  for (let row = 1; row < headerRow; row++) {
    const cells = grid.rows.get(row);
    if (!cells) continue;
    const label = [...cells]
      .filter(([column, cell]) => column < firstMonthColumn && typeof cell.v === "string")
      .map(([, cell]) => cleanText(cell.v))
      .find((text) => /^[A-Za-z][A-Za-z .-]{1,19}$/.test(text));
    if (!label) continue;
    const values: SopSubtotal["values"] = {};
    let any = false;
    for (const metric of [...FLOWS, ...STOCKS]) {
      values[metric] = months.map((month) => {
        const column = byMonth.get(month)![metric];
        const value = column === undefined ? null : numberOf(cells.get(column));
        if (value !== null) any = true;
        return value;
      });
    }
    if (any) subtotals.push({ row, label, values });
  }

  const model: SopModel = {
    version: 1,
    sheet: grid.name,
    market,
    headerRow,
    months,
    lastActual: null,
    detectedCycle: null,
    skus,
    subtotals,
    materials: null,
  };
  const detected = detectCycle(model);
  model.lastActual = detected.lastActual;
  model.detectedCycle = detected.cycle;
  return model;
}

// M-1 is the last month whose Entity Stock is mostly typed (a closed month has the counted
// stock; a forecast month has the balance formula), M is the month after it. A month in the
// middle of the history may carry formulas too, so the LAST typed month is taken. When the file
// has no formulas at all (a copy pasted as values), it cannot tell: null.
export function detectCycle(model: Pick<SopModel, "months" | "skus">): {
  lastActual: string | null;
  cycle: string | null;
} {
  let lastTyped = -1;
  let anyFormula = false;
  model.months.forEach((_, index) => {
    let typed = 0;
    let formula = 0;
    for (const sku of model.skus) {
      const code = sku.formulas.entityStock[index];
      // «=warehouse+in transit» is a typed closing stock too, not a balance formula.
      if (code === "n" || code === "s") typed++;
      else if (code && code !== "-") formula++;
    }
    if (formula > 0) anyFormula = true;
    if (typed + formula > 0 && typed > formula) lastTyped = index;
  });
  if (lastTyped < 0 || !anyFormula || lastTyped === model.months.length - 1)
    return { lastActual: null, cycle: null };
  return { lastActual: model.months[lastTyped]!, cycle: model.months[lastTyped + 1]! };
}

// The date HQ puts at the end of the file name: «…_261113.xlsx» → 2026-11-13.
export function fileDateOf(name: string): string | null {
  const found = [...name.matchAll(/(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/g)]
    .map((m) => ({ year: 2000 + Number(m[1]), month: Number(m[2]), day: Number(m[3]) }))
    .filter((d) => d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= 31)
    .at(-1);
  if (!found) return null;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${found.year}-${two(found.month)}-${two(found.day)}`;
}

// The materials sheet: the header row has «PRODUCT NAME» and «Total (Box)».
const TOTAL_BOX = /^TOTAL \(BOX\)$/i;

export function parseMaterialsSheet(grid: SheetGrid, market: string): SopModel["materials"] {
  const headerRow = findHeader(grid, TOTAL_BOX);
  if (headerRow === null) return null;
  const header = grid.rows.get(headerRow)!;
  const columns = {
    factory: columnBy(header, /^FAC$/i, /^FACTORY$/i),
    market: columnBy(header, /^MKT$/i, /^MARKET$/i),
    // The sheet keeps the old and the new code of a product: the newest one is the one in use.
    code: columnBy(header, /^CODE \(new\b/i, /^CODE$/i, /^CODE\b/i),
    name: columnBy(header, /^PRODUCT NAME$/i)!,
    type: columnBy(header, /^TYPE$/i),
    status: columnBy(header, /^RATIONALI[SZ]ATION PLAN$/i, /RATIONALI[SZ]ATION/i),
    totalKsh: columnBy(header, /^TOTAL \(KSH\)$/i),
    totalBox: columnBy(header, TOTAL_BOX)!,
    planTotal: columnBy(header, /^TOTAL PRODUCTION PLAN/i),
    salesForecast: columnBy(header, /^SALES FORECAST/i),
    turnover: columnBy(header, /^INVENTORY TURNOVER/i),
    note: columnBy(header, /^(notes?|remarks?|comments?|비고)$/i),
  };
  const plans: { month: string; column: number }[] = [];
  for (const [column, cell] of [...header].sort((a, b) => a[0] - b[0])) {
    const found = typeof cell.v === "string" ? monthHeader(cell.v) : null;
    if (found && metricOf(found.rest) === "plan" && !plans.some((p) => p.month === found.month))
      plans.push({ month: found.month, column });
  }
  plans.sort((a, b) => a.month.localeCompare(b.month));
  const rows: SopMaterial[] = [];
  for (let row = headerRow + 1; row <= grid.maxRow; row++) {
    const cells = grid.rows.get(row);
    const name = cleanText(cells?.get(columns.name)?.v);
    if (!cells || !name) continue;
    const text = (column: number | null) =>
      column === null ? "" : cleanText(cells.get(column)?.v).slice(0, 300);
    if (columns.market !== null && text(columns.market).toUpperCase() !== market.toUpperCase())
      continue;
    if (rows.length >= MAX_MATERIALS) throw new SopFileError("tooBig");
    const number = (column: number | null) =>
      column === null ? null : numberOf(cells.get(column));
    const plan = plans.map((p) => number(p.column));
    rows.push({
      row,
      factory: text(columns.factory).toUpperCase(),
      code: text(columns.code),
      name: name.slice(0, 200),
      type: text(columns.type),
      status: text(columns.status),
      totalKsh: number(columns.totalKsh),
      totalBox: number(columns.totalBox),
      plan,
      planTotal:
        number(columns.planTotal) ?? round(plan.reduce<number>((sum, v) => sum + (v ?? 0), 0)),
      salesForecast: number(columns.salesForecast),
      turnover: number(columns.turnover),
      note: text(columns.note),
    });
  }
  return { sheet: grid.name, planMonths: plans.map((p) => p.month), rows };
}

// «PSI UZB (…)»: the name starts with PSI and has the market code as a word of its own.
export function isPsiSheet(name: string, market: string): boolean {
  const code = market.trim().toUpperCase();
  if (!code) return false;
  const words = name.toUpperCase().split(/[^A-Z0-9]+/);
  return words[0] === "PSI" && words.includes(code);
}

// Reads the workbook: the market's PSI sheet and, when the file has it, the materials sheet.
export async function parseSopWorkbook(file: Buffer, market: string): Promise<SopModel> {
  if (file.length > MAX_SOP_FILE_MB * 1024 * 1024) throw new SopFileError("tooBig");
  try {
    const sheets = await openSopWorkbook(file);
    const psi = sheets.find((sheet) => isPsiSheet(sheet.name, market));
    if (!psi) throw new SopFileError("noSheet");
    const model = parsePsiSheet(await psi.read(), market.trim().toUpperCase());
    // The materials sheet is told by its header, so the top of every other sheet is looked at
    // (a dozen rows each, not the sheet).
    for (const sheet of sheets) {
      if (sheet === psi || /^PSI\b/i.test(sheet.name)) continue;
      const top = await sheet.read({ maxRow: 12 });
      if (findHeader(top, TOTAL_BOX) === null) continue;
      model.materials = parseMaterialsSheet(await sheet.read(), model.market);
      break;
    }
    return model;
  } catch (error) {
    if (error instanceof SopReadError) throw new SopFileError(error.code);
    throw error;
  }
}

// The months the plan covers when the cycle is `cycle`: M … the last month of the file (the
// sheet shows M+5).
export const horizonOf = (months: string[], cycle: string): string[] =>
  months.filter((month) => month >= cycle).slice(0, 12);
