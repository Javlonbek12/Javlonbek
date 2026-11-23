// The lines «Аналитика Connect» measures against, set by the owner on «Нормы» (decision of
// 23.11.2026, see docs/DECISIONS.md): the two targets of «Маршруты и дисциплина» and the lines of
// «Требует внимания». Pure: reading and saving are in service.ts.

export type ConnectRules = {
  // «Маршруты и дисциплина»: the planned visits made and the DRs' visits with an order, % — the
  // lines of the matrix and of the tiles' colour.
  attendance: number;
  hitRate: number;
  // «Требует внимания»: Connect used on fewer than this share (%) of the planned stores visited.
  connect: number;
  // Fewer than this share (%) of the products that were out came back.
  recovery: number;
  // Fewer than this share (%) of the checks with an OOS were followed by a rep's order.
  followUp: number;
  // This many auto-stock orders (or more) with nothing sold in a closed window.
  unsold: number;
  // Fewer than this share (%) of the planned visits made.
  visited: number;
};

export const DEFAULT_RULES: ConnectRules = {
  attendance: 95,
  hitRate: 90,
  connect: 70,
  recovery: 15,
  followUp: 50,
  unsold: 3,
  visited: 85,
};

// The fields of the form in its order, each with the values it takes (whole numbers).
export const RULE_FIELDS = [
  { key: "attendance", group: "targets", min: 1, max: 100, percent: true },
  { key: "hitRate", group: "targets", min: 1, max: 100, percent: true },
  { key: "connect", group: "attention", min: 0, max: 100, percent: true },
  { key: "recovery", group: "attention", min: 0, max: 100, percent: true },
  { key: "followUp", group: "attention", min: 0, max: 100, percent: true },
  { key: "visited", group: "attention", min: 0, max: 100, percent: true },
  { key: "unsold", group: "attention", min: 1, max: 99, percent: false },
] as const satisfies {
  key: keyof ConnectRules;
  group: "targets" | "attention";
  min: number;
  max: number;
  percent: boolean;
}[];

export const RULE_GROUPS = ["targets", "attention"] as const;

// What was typed (or saved) as a number of a field, or null when it is not one of its values.
export function ruleValue(field: (typeof RULE_FIELDS)[number], value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  if (!/^\s*\d{1,3}\s*$/.test(text)) return null;
  const number = Number(text);
  return number >= field.min && number <= field.max ? number : null;
}

// The saved lines; whatever is missing or not a value of its field is the standard one.
export function parseRules(saved: unknown): ConnectRules {
  const values = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const rules = { ...DEFAULT_RULES };
  for (const field of RULE_FIELDS) {
    const value = ruleValue(field, values[field.key]);
    if (value !== null) rules[field.key] = value;
  }
  return rules;
}

// A form's fields: the lines, or the names of the fields that are not a value (nothing is saved).
export function readRules(
  input: Record<string, unknown>,
): { rules: ConnectRules; invalid: null } | { rules: null; invalid: (keyof ConnectRules)[] } {
  const rules = { ...DEFAULT_RULES };
  const invalid: (keyof ConnectRules)[] = [];
  for (const field of RULE_FIELDS) {
    const value = ruleValue(field, input[field.key]);
    if (value === null) invalid.push(field.key);
    else rules[field.key] = value;
  }
  return invalid.length ? { rules: null, invalid } : { rules, invalid: null };
}

export const isDefaultRules = (rules: ConnectRules) =>
  RULE_FIELDS.every((field) => rules[field.key] === DEFAULT_RULES[field.key]);
