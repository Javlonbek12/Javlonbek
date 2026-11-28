import { z } from "zod";

// The norms S&OP is checked against, set on «Настройки» of the section (stored in SystemState
// under SOP_SETTINGS_KEY). Pure: reading and saving are in service.ts.

export const SOP_SETTINGS_KEY = "sop.settings";

const count = (min: number, max: number) => z.number().int().min(min).max(max);
const months = z.number().min(0).max(36);
const percent = z.number().min(0).max(100);
const code = z.string().trim().min(1).max(20);
const label = z.string().trim().min(1).max(40);

export const sopSettingsSchema = z.object({
  // The smallest production order of one SKU, cases.
  moq: count(1, 100_000),
  // Stock norms in months of sales to the market.
  entityMin: months,
  distMin: months,
  targetTotal: months,
  maxTotal: months,
  // What a truck from the first factory and a container from the second one take, cases.
  truckFactory: code,
  truckCases: count(1, 100_000),
  containerFactory: code,
  containerCases: count(1, 100_000),
  // A container filled below this share is worth a warning, %.
  containerWarn: percent,
  // The product type whose line runs every other month.
  regularType: code,
  // How many months from M on are already in production and must not be changed.
  frozenMonths: count(0, 6),
  // A new product is ordered no further than M + this.
  newPoHorizon: count(0, 12),
  firstBatch: count(1, 100_000),
  // Months from ordering the materials to the product.
  leadTime: count(0, 12),
  packsPerCase: count(1, 100_000),
  // How far the planned sales may be from the recent ones, %.
  runRateDeviation: percent,
  // Stock that lasts longer than this many months is slow.
  slowMonths: months,
  // The key accounts' share of Sell-in, %; null: not set.
  kaShare: percent.nullable(),
  distributorLabel: label,
  kaLabel: label,
  market: code,
});
export type SopSettings = z.infer<typeof sopSettingsSchema>;

export const DEFAULT_SOP_SETTINGS: SopSettings = {
  moq: 200,
  entityMin: 2,
  distMin: 1,
  targetTotal: 4,
  maxTotal: 5,
  truckFactory: "RUS",
  truckCases: 1600,
  containerFactory: "KAZ",
  containerCases: 1300,
  containerWarn: 80,
  regularType: "84 R",
  frozenMonths: 3,
  newPoHorizon: 3,
  firstBatch: 300,
  leadTime: 3,
  packsPerCase: 500,
  runRateDeviation: 30,
  slowMonths: 8,
  kaShare: null,
  distributorLabel: "Дистрибьютор",
  kaLabel: "KA",
  market: "UZB",
};

// The fields of the form in its order: the groups, and what kind of value each takes.
export const SOP_SETTING_GROUPS = ["stock", "order", "logistics", "newProducts", "names"] as const;
export type SopSettingGroup = (typeof SOP_SETTING_GROUPS)[number];
export type SopSettingKind = "cases" | "months" | "percent" | "count" | "text";

export const SOP_SETTING_FIELDS = [
  { key: "entityMin", group: "stock", kind: "months" },
  { key: "distMin", group: "stock", kind: "months" },
  { key: "targetTotal", group: "stock", kind: "months" },
  { key: "maxTotal", group: "stock", kind: "months" },
  { key: "slowMonths", group: "stock", kind: "months" },
  { key: "runRateDeviation", group: "stock", kind: "percent" },
  { key: "moq", group: "order", kind: "cases" },
  { key: "frozenMonths", group: "order", kind: "count" },
  { key: "leadTime", group: "order", kind: "count" },
  { key: "regularType", group: "order", kind: "text" },
  { key: "packsPerCase", group: "order", kind: "count" },
  { key: "truckFactory", group: "logistics", kind: "text" },
  { key: "truckCases", group: "logistics", kind: "cases" },
  { key: "containerFactory", group: "logistics", kind: "text" },
  { key: "containerCases", group: "logistics", kind: "cases" },
  { key: "containerWarn", group: "logistics", kind: "percent" },
  { key: "newPoHorizon", group: "newProducts", kind: "count" },
  { key: "firstBatch", group: "newProducts", kind: "cases" },
  { key: "market", group: "names", kind: "text" },
  { key: "distributorLabel", group: "names", kind: "text" },
  { key: "kaLabel", group: "names", kind: "text" },
  { key: "kaShare", group: "names", kind: "percent" },
] as const satisfies { key: keyof SopSettings; group: SopSettingGroup; kind: SopSettingKind }[];

// The saved norms; whatever is missing or not a value of its field is the standard one.
export function parseSopSettings(saved: unknown): SopSettings {
  const values = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const settings: Record<string, unknown> = { ...DEFAULT_SOP_SETTINGS };
  for (const key of Object.keys(DEFAULT_SOP_SETTINGS) as (keyof SopSettings)[]) {
    if (!(key in values)) continue;
    const parsed = sopSettingsSchema.shape[key].safeParse(values[key]);
    if (parsed.success) settings[key] = parsed.data;
  }
  return settings as SopSettings;
}

// A form's fields: the norms, or the names of the fields that are not a value (nothing is saved).
// Numbers may be typed with a comma; the optional share is empty when not set.
export function readSopSettings(
  input: Record<string, unknown>,
): { settings: SopSettings; invalid: null } | { settings: null; invalid: (keyof SopSettings)[] } {
  const settings: Record<string, unknown> = {};
  const invalid: (keyof SopSettings)[] = [];
  for (const field of SOP_SETTING_FIELDS) {
    const text = typeof input[field.key] === "string" ? (input[field.key] as string).trim() : "";
    let value: unknown = text;
    if (field.kind !== "text") {
      if (text === "") value = field.key === "kaShare" ? null : undefined;
      else value = /^\d+(?:[.,]\d+)?$/.test(text) ? Number(text.replace(",", ".")) : undefined;
    }
    const parsed = sopSettingsSchema.shape[field.key].safeParse(value);
    if (parsed.success) settings[field.key] = parsed.data;
    else invalid.push(field.key);
  }
  if (invalid.length) return { settings: null, invalid };
  const all = settings as SopSettings;
  // The norms must stand in their order: minimum ≤ target ≤ maximum.
  if (all.targetTotal > all.maxTotal)
    return { settings: null, invalid: ["targetTotal", "maxTotal"] };
  if (all.entityMin + all.distMin > all.maxTotal)
    return { settings: null, invalid: ["entityMin", "distMin", "maxTotal"] };
  return { settings: { ...all, market: all.market.toUpperCase() }, invalid: null };
}

export const isDefaultSopSettings = (settings: SopSettings) =>
  (Object.keys(DEFAULT_SOP_SETTINGS) as (keyof SopSettings)[]).every(
    (key) => settings[key] === DEFAULT_SOP_SETTINGS[key],
  );
