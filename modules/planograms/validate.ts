import { allSlots, slotKey, type Geometry } from "./geometry";
import { coveredSlots, skuFacings, type Layout, type SkuInfo } from "./layout";

export type RuleKind =
  "MANDATORY_SKUS" | "FACINGS" | "BRAND_BLOCKS" | "BRAND_ORDER" | "NEW_ITEMS" | "ALL_SLOTS_DECIDED";
export type Severity = "CRITICAL" | "WARNING";

export type Rule = {
  kind: RuleKind;
  severity: Severity;
  enabled: boolean;
  params: Record<string, unknown>;
};

export type Violation = {
  kind: RuleKind;
  severity: Severity;
  // Message key + params for the i18n dictionary (planograms.violations.*).
  message: string;
  params: Record<string, string | number>;
  cells: string[];
};

export const DEFAULT_BRAND_ORDER = ["ESSE", "BOHEM", "PINE", "Blooming", "Simple"];

// Rules a new planogram starts with (they can be changed per planogram).
export const DEFAULT_RULES: Rule[] = [
  { kind: "MANDATORY_SKUS", severity: "CRITICAL", enabled: true, params: { shelves: null } },
  { kind: "ALL_SLOTS_DECIDED", severity: "CRITICAL", enabled: true, params: {} },
  { kind: "FACINGS", severity: "WARNING", enabled: true, params: { min: 1, max: 4 } },
  { kind: "BRAND_BLOCKS", severity: "WARNING", enabled: true, params: {} },
  {
    kind: "NEW_ITEMS",
    severity: "WARNING",
    enabled: true,
    params: { shelves: [0], badge: "YANGI" },
  },
  {
    kind: "BRAND_ORDER",
    severity: "WARNING",
    enabled: false,
    params: { order: DEFAULT_BRAND_ORDER },
  },
];

const numbers = (value: unknown): number[] | null =>
  Array.isArray(value) && value.every((v) => typeof v === "number") ? (value as number[]) : null;

type Context = { layout: Layout; geometry: Geometry; skus: Map<string, SkuInfo> };

// Which SKUs must stand on a model: its own list when it has one (they differ by equipment), else
// the SKUs marked mandatory. A delisted (archived) SKU never is: it can't block an approval.
export function withMandatory<T extends SkuInfo>(skus: T[], modelList: string[] = []): T[] {
  const own = modelList.length > 0 ? new Set(modelList) : null;
  return skus.map((s) => ({
    ...s,
    isMandatory: !s.archived && (own ? own.has(s.id) : s.isMandatory),
  }));
}

function checkMandatory(rule: Rule, { layout, geometry, skus }: Context): Violation[] {
  const shelves = numbers(rule.params.shelves);
  const present = new Set(
    skuFacings(layout, geometry)
      .filter((f) => !shelves || shelves.includes(f.shelf))
      .map((f) => f.content.skuId),
  );
  const mandatory = [...skus.values()].filter((s) => s.isMandatory && !s.archived);
  const missing = mandatory.filter((s) => !present.has(s.id));
  if (missing.length === 0) return [];
  return [
    {
      kind: rule.kind,
      severity: rule.severity,
      message: shelves ? "mandatoryOnShelves" : "mandatory",
      params: {
        count: missing.length,
        total: mandatory.length,
        names: missing.map((s) => s.name).join(", "),
        shelves: shelves ? shelves.map((s) => s + 1).join(", ") : "",
      },
      cells: [],
    },
  ];
}

function checkFacings(rule: Rule, { layout, geometry, skus }: Context): Violation[] {
  const min = typeof rule.params.min === "number" ? rule.params.min : 1;
  const max = typeof rule.params.max === "number" ? rule.params.max : Infinity;
  const perSku = (rule.params.perSku ?? {}) as Record<string, { min?: number; max?: number }>;
  const counts = new Map<string, string[]>();
  for (const f of skuFacings(layout, geometry)) {
    counts.set(f.content.skuId, [
      ...(counts.get(f.content.skuId) ?? []),
      slotKey(f.shelf, f.position),
    ]);
  }
  const violations: Violation[] = [];
  for (const [skuId, cells] of counts) {
    const sku = skus.get(skuId);
    const limits = (sku && perSku[sku.code]) ?? {};
    const lo = limits.min ?? min;
    const hi = limits.max ?? max;
    if (cells.length < lo || cells.length > hi) {
      violations.push({
        kind: rule.kind,
        severity: rule.severity,
        message: cells.length < lo ? "facingsMin" : "facingsMax",
        params: {
          name: sku?.name ?? skuId,
          count: cells.length,
          limit: cells.length < lo ? lo : hi,
        },
        cells,
      });
    }
  }
  return violations;
}

// On every shelf, SKUs of one brand stand next to each other (POSM / empty cells don't break a block).
function checkBrandBlocks(rule: Rule, { layout, geometry, skus }: Context): Violation[] {
  const violations: Violation[] = [];
  geometry.shelves.forEach((_, shelf) => {
    const facings = skuFacings(layout, geometry).filter((f) => f.shelf === shelf);
    const closed = new Set<string>();
    let current: string | null = null;
    for (const f of facings) {
      const brand = skus.get(f.content.skuId)?.brand ?? "?";
      if (brand === current) continue;
      if (closed.has(brand)) {
        violations.push({
          kind: rule.kind,
          severity: rule.severity,
          message: "brandBlock",
          params: { brand, shelf: shelf + 1 },
          cells: facings
            .filter((x) => skus.get(x.content.skuId)?.brand === brand)
            .map((x) => slotKey(x.shelf, x.position)),
        });
        return;
      }
      if (current) closed.add(current);
      current = brand;
    }
  });
  return violations;
}

// Brands appear in the given order (by their first facing in reading order); new items are exempt.
function checkBrandOrder(rule: Rule, { layout, geometry, skus }: Context): Violation[] {
  const order = Array.isArray(rule.params.order)
    ? (rule.params.order as string[])
    : DEFAULT_BRAND_ORDER;
  const first = new Map<string, number>();
  skuFacings(layout, geometry).forEach((f, index) => {
    const sku = skus.get(f.content.skuId);
    if (sku && !sku.isNew && !first.has(sku.brand)) first.set(sku.brand, index);
  });
  const present = order.filter((b) => first.has(b));
  for (let i = 1; i < present.length; i++) {
    if (first.get(present[i])! < first.get(present[i - 1])!) {
      return [
        {
          kind: rule.kind,
          severity: rule.severity,
          message: "brandOrder",
          params: { expected: present.join(" → "), brand: present[i], before: present[i - 1] },
          cells: [],
        },
      ];
    }
  }
  return [];
}

function checkNewItems(rule: Rule, { layout, geometry, skus }: Context): Violation[] {
  const badge = typeof rule.params.badge === "string" ? rule.params.badge : "YANGI";
  const shelves = numbers(rule.params.shelves);
  const violations: Violation[] = [];
  const facings = skuFacings(layout, geometry).filter((f) => skus.get(f.content.skuId)?.isNew);
  const noBadge = facings.filter((f) => !f.content.badges.includes(badge));
  if (noBadge.length > 0) {
    violations.push({
      kind: rule.kind,
      severity: rule.severity,
      message: "newBadge",
      params: { badge, count: noBadge.length },
      cells: noBadge.map((f) => slotKey(f.shelf, f.position)),
    });
  }
  const wrongShelf = shelves ? facings.filter((f) => !shelves.includes(f.shelf)) : [];
  if (wrongShelf.length > 0) {
    violations.push({
      kind: rule.kind,
      severity: rule.severity,
      message: "newShelf",
      params: { shelves: shelves!.map((s) => s + 1).join(", "), count: wrongShelf.length },
      cells: wrongShelf.map((f) => slotKey(f.shelf, f.position)),
    });
  }
  return violations;
}

function checkAllDecided(rule: Rule, { layout, geometry }: Context): Violation[] {
  const covered = coveredSlots(layout);
  const open = allSlots(geometry)
    .map(({ shelf, position }) => slotKey(shelf, position))
    .filter((key) => !layout[key] && !covered.has(key));
  if (open.length === 0) return [];
  return [
    {
      kind: rule.kind,
      severity: rule.severity,
      message: "undecided",
      params: { count: open.length },
      cells: open,
    },
  ];
}

const CHECKS: Record<RuleKind, (rule: Rule, ctx: Context) => Violation[]> = {
  MANDATORY_SKUS: checkMandatory,
  FACINGS: checkFacings,
  BRAND_BLOCKS: checkBrandBlocks,
  BRAND_ORDER: checkBrandOrder,
  NEW_ITEMS: checkNewItems,
  ALL_SLOTS_DECIDED: checkAllDecided,
};

export function validatePlanogram(
  layout: Layout,
  geometry: Geometry,
  skus: SkuInfo[],
  rules: Rule[],
): Violation[] {
  const ctx = { layout, geometry, skus: new Map(skus.map((s) => [s.id, s])) };
  return rules.filter((r) => r.enabled).flatMap((rule) => CHECKS[rule.kind](rule, ctx));
}

export function hasCritical(violations: Violation[]): boolean {
  return violations.some((v) => v.severity === "CRITICAL");
}
