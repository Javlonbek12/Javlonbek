// The order builder: pick equipment types and POSM elements, get what to order — pieces, print
// sizes, prices. Pure functions over the catalog (print sizes differ by equipment, so every
// element × type pair has its own size, pieces per unit and price).
import { typeInfo, TYPE_CODES } from "./types";

export type TypeSize = {
  type: string;
  heightMm: number | null;
  widthMm: number | null;
  depthMm: number | null;
  note: string | null;
};

export type ElementSize = {
  type: string;
  heightMm: number | null;
  widthMm: number | null;
  perUnit: number | null;
  price: number | null;
  material: string | null;
  note: string | null;
  verified: boolean;
};

export type CatalogElement = {
  id: string;
  name: string;
  material: string | null;
  sizes: ElementSize[];
};

export type Catalog = { types: TypeSize[]; elements: CatalogElement[] };

// What is missing for a pair: print size, pieces per unit, price; "check" = not confirmed yet.
export type Gap = "size" | "perUnit" | "price" | "check";

export function gapsOf(size: ElementSize | undefined): Gap[] {
  if (!size) return ["size", "perUnit", "price"];
  // 0 pieces per unit = the element isn't used on this equipment: nothing to fill.
  if (size.perUnit === 0) return [];
  const out: Gap[] = [];
  if (size.heightMm === null || size.widthMm === null) out.push("size");
  if (size.perUnit === null) out.push("perUnit");
  if (size.price === null) out.push("price");
  // A size taken from an old list: to be confirmed for this equipment.
  if (!size.verified && !out.includes("size")) out.push("check");
  return out;
}

export const typeLabel = (type: string) => typeInfo(type)?.label ?? type;

export const mm = (h: number | null, w: number | null) =>
  h === null || w === null ? null : `${trim(h)}×${trim(w)}`;
const trim = (n: number) => String(Math.round(n * 10) / 10);

export function equipmentSize(size: TypeSize | undefined) {
  if (!size || size.heightMm === null || size.widthMm === null) return null;
  return [size.heightMm, size.widthMm, size.depthMm]
    .filter((n): n is number => n !== null)
    .map(trim)
    .join("×");
}

export type BuilderLine = {
  key: string;
  elementId: string;
  element: string;
  name: string;
  types: string[];
  // Equipment units of these types.
  units: number;
  heightMm: number | null;
  widthMm: number | null;
  perUnit: number | null;
  // units × pieces per unit + the reserve, rounded up; null while pieces per unit are unknown.
  quantity: number | null;
  // The reserve in the quantity (the type's own, else the campaign's).
  reservePct: number;
  price: number | null;
  sum: number | null;
  material: string | null;
  gaps: Gap[];
};

export type BuilderInput = {
  catalog: Catalog;
  // Equipment units by type.
  units: Record<string, number>;
  types: string[];
  elements: string[];
  reservePct: number;
  // Reserve by type, where it differs from reservePct.
  reserveByType?: Record<string, number>;
  // One line for the types that share the same print size, pieces and price.
  merge: boolean;
  // Pieces per unit for this order, by "elementId.type": one or several, as the case needs.
  perUnit?: Record<string, number>;
};

export const perUnitKey = (elementId: string, type: string) => `${elementId}.${type}`;

// A type's reserve: its own, else the campaign's.
export const reserveOf = (
  input: { reservePct: number; reserveByType?: Record<string, number> | null },
  type: string,
) => input.reserveByType?.[type] ?? input.reservePct;

// The reserve as a label: "10%", or "10–20%" when it differs by type.
export function reserveLabel(input: {
  reservePct: number;
  reserveByType?: Record<string, number> | null;
}) {
  const all = [input.reservePct, ...Object.values(input.reserveByType ?? {})].map((r) =>
    Math.round(r * 100),
  );
  const low = Math.min(...all);
  const high = Math.max(...all);
  return low === high ? `${low}%` : `${low}–${high}%`;
}

const quantity = (units: number, perUnit: number | null, reservePct: number) =>
  perUnit === null ? null : Math.ceil(units * perUnit * (1 + reservePct) - 1e-9);

export function buildOrder(input: BuilderInput): BuilderLine[] {
  const { catalog, units } = input;
  const types = TYPE_CODES.filter((t) => input.types.includes(t));
  const lines: BuilderLine[] = [];
  for (const element of catalog.elements.filter((e) => input.elements.includes(e.id))) {
    const mine: BuilderLine[] = [];
    for (const type of types) {
      const size = element.sizes.find((s) => s.type === type);
      const own = input.perUnit?.[perUnitKey(element.id, type)];
      if ((own ?? size?.perUnit) === 0) continue;
      const n = units[type] ?? 0;
      const perUnit = own ?? size?.perUnit ?? null;
      const reservePct = reserveOf(input, type);
      const line: BuilderLine = {
        key: `${element.id}:${type}`,
        elementId: element.id,
        element: element.name,
        name: "",
        types: [type],
        units: n,
        heightMm: size?.heightMm ?? null,
        widthMm: size?.widthMm ?? null,
        perUnit,
        quantity: quantity(n, perUnit, reservePct),
        reservePct,
        price: size?.price ?? null,
        sum: null,
        material: size?.material ?? element.material,
        gaps: gapsOf(size).filter((g) => g !== "perUnit" || own === undefined),
      };
      const same = input.merge
        ? mine.find(
            (l) =>
              l.heightMm !== null &&
              l.heightMm === line.heightMm &&
              l.widthMm === line.widthMm &&
              l.perUnit === line.perUnit &&
              l.reservePct === line.reservePct &&
              l.price === line.price &&
              l.material === line.material,
          )
        : undefined;
      if (same) {
        same.types.push(type);
        same.units += n;
        same.quantity = quantity(same.units, same.perUnit, same.reservePct);
        same.gaps = [...new Set([...same.gaps, ...line.gaps])];
      } else mine.push(line);
    }
    lines.push(...mine);
  }
  for (const line of lines) {
    line.name = `${line.element} (${line.types.map(typeLabel).join(" / ")})`;
    line.key = `${line.elementId}:${line.types.join("+")}`;
    line.sum = line.quantity === null || line.price === null ? null : line.quantity * line.price;
  }
  return lines;
}

// Every element × type pair with something still to fill, and the types with no dimensions.
export function missing(catalog: Catalog) {
  const pairs = catalog.elements.flatMap((element) =>
    TYPE_CODES.map((type) => ({
      element,
      type,
      size: element.sizes.find((s) => s.type === type),
    })).filter((p) => gapsOf(p.size).length > 0),
  );
  const types = TYPE_CODES.filter(
    (type) => !equipmentSize(catalog.types.find((t) => t.type === type)),
  );
  return { pairs, types };
}
