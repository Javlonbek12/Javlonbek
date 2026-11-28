// The parsed S&OP workbook: what one upload keeps (SopUpload.data). Everything is in cases
// («короба»), months are "YYYY-MM". Pure types: the reader fills them, the engine counts on them.

// What we type in (the order, the shipments, the sales) and what HQ returns (the plan).
export const FLOWS = ["po", "plan", "out", "sellIn", "sellThru"] as const;
export const STOCKS = ["factoryStock", "entityStock", "distStock"] as const;
// The sheet's own «months of stock» columns. Kept as the file has them; the engine counts its own.
export const LEVELS = ["distLevel", "marketLevel", "totalLevel"] as const;
export const METRICS = [...FLOWS, ...STOCKS, ...LEVELS] as const;

export type Flow = (typeof FLOWS)[number];
export type Stock = (typeof STOCKS)[number];
export type Metric = (typeof METRICS)[number];

// How a cell was filled: «-» empty, «n» a typed number, «s» a plain sum of numbers (=a+b),
// «l» a lookup into another sheet, «o» any other formula.
export type FormulaCode = "-" | "n" | "s" | "l" | "o";

export type SopSku = {
  // Stable between uploads: the factory and the name (rows move, codes are re-issued).
  key: string;
  row: number;
  factory: string;
  code: string;
  name: string;
  type: string;
  status: string;
  // One number per month of the model, null where the cell is empty.
  values: Record<Metric, (number | null)[]>;
  // One FormulaCode per month.
  formulas: Record<Metric, string>;
  // The addends of the «=a+b» cells: "sellIn:33" → [4010, 596.36].
  parts: Record<string, number[]>;
};

// A row above the header with the sheet's own totals (by factory, and the grand total).
export type SopSubtotal = {
  row: number;
  label: string;
  values: Partial<Record<Metric, (number | null)[]>>;
};

// One product of the materials sheet: the packaging bought for it against the production plan.
export type SopMaterial = {
  row: number;
  factory: string;
  code: string;
  name: string;
  type: string;
  status: string;
  // The materials in thousand sheets (as the sheet has them) and in cases they are enough for.
  totalKsh: number | null;
  totalBox: number | null;
  // The production plan by month (see planMonths) and its sum.
  plan: (number | null)[];
  planTotal: number | null;
  salesForecast: number | null;
  turnover: number | null;
  note: string;
};

export type SopModel = {
  version: 1;
  sheet: string;
  market: string;
  headerRow: number;
  months: string[];
  // The last closed month and the month being planned, as the file itself shows them (null when
  // it cannot tell); the cycle the upload is saved with may be changed by the person.
  lastActual: string | null;
  detectedCycle: string | null;
  skus: SopSku[];
  subtotals: SopSubtotal[];
  materials: { sheet: string; planMonths: string[]; rows: SopMaterial[] } | null;
};

export const SOP_KINDS = ["OURS", "HQ_DRAFT", "HQ_FINAL"] as const;
export type SopKind = (typeof SOP_KINDS)[number];

// --- Months -----------------------------------------------------------------------------------

export const isMonth = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

// "2026-11" + 3 → "2027-02".
export function addMonths(month: string, count: number): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export const monthsBetween = (from: string, to: string): number => {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
};
