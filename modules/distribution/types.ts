// Equipment types of the POSM distribution file, in its column order, and how each maps to the
// planogram library's equipment (for slots and price tags).
export const DIST_TYPES = [
  {
    code: "POSI_XL",
    group: "POSI",
    size: "XL",
    label: "POSI XL (12*10)",
    slots: 120,
    equipment: "DISPLAY_XL_POSI",
  },
  {
    code: "POSI_L",
    group: "POSI",
    size: "L",
    label: "POSI L (10*9)",
    slots: 90,
    equipment: "DISPLAY_L_POSI",
  },
  {
    code: "POSI_M",
    group: "POSI",
    size: "M",
    label: "POSI M (6*9)",
    slots: 54,
    equipment: "DISPLAY_M_POSI",
  },
  {
    code: "POSI_C",
    group: "POSI",
    size: "C",
    label: "POSI C (10*6)",
    slots: 60,
    equipment: "DISPLAY_C_POSI",
  },
  {
    code: "DG_L",
    group: "Display Group",
    size: "L",
    label: "DG L (10*10)",
    slots: 100,
    equipment: "DISPLAY_L_MWDG",
  },
  {
    code: "DG_M",
    group: "Display Group",
    size: "M",
    label: "DG M (6*10)",
    slots: 60,
    equipment: "DISPLAY_M_MWDG",
  },
  {
    code: "DG_C",
    group: "Display Group",
    size: "C",
    label: "DG C (10*6)",
    slots: 60,
    equipment: "DISPLAY_C_DG",
  },
  {
    code: "MW25_L",
    group: "Metawerk (2025)",
    size: "L",
    label: "MW-25 L (10*10)",
    slots: 100,
    equipment: "DISPLAY_L_MWDG",
  },
  {
    code: "MW25_M",
    group: "Metawerk (2025)",
    size: "M",
    label: "MW-25 M (6*10)",
    slots: 60,
    equipment: "DISPLAY_M_MWDG",
  },
  {
    code: "MW24_L",
    group: "Metawerk (2024)",
    size: "L",
    label: "MW-24 L (10*9)",
    slots: 90,
    equipment: "DISPLAY_L_MWDG",
  },
  {
    code: "MW24_M",
    group: "Metawerk (2024)",
    size: "M",
    label: "MW-24 M (6*9)",
    slots: 54,
    equipment: "DISPLAY_M_MWDG",
  },
  {
    code: "MW24_S",
    group: "Metawerk (2024)",
    size: "S",
    label: "MW-24 S (10*2)",
    slots: 20,
    equipment: "DISPLAY_S_MW",
  },
  // Display MOD is counted in 18-slot units (as in the equipment file); no planogram yet.
  {
    code: "POSI_MOD",
    group: "POSI",
    size: "MOD",
    label: "Display MOD",
    slots: 18,
    equipment: null,
  },
  { code: "LIGHTBOX", group: "POSI", size: "", label: "Lightbox", slots: 0, equipment: null },
  { code: "SUPPORT", group: "Z-Movers", size: "", label: "Support", slots: 0, equipment: null },
] as const;

export type DistType = (typeof DIST_TYPES)[number]["code"];
export const TYPE_CODES: DistType[] = DIST_TYPES.map((t) => t.code);
export const typeInfo = (code: string) => DIST_TYPES.find((t) => t.code === code);

// The equipment's names: "Display XL (12*10) POSI" in the equipment file, "L (10*9) MW" in the
// TSM pivot, "Display-M (9*6) POSI" in the outlet base, "Display MOD", "LIGHTBOX", "SUPPORT".
export function typeFromPivotHeader(header: string): DistType | null {
  const name = header.replace(/^\s*display[\s-]*/i, "").trim();
  if (/^mod\b/i.test(name)) return "POSI_MOD";
  if (/^lightbox$/i.test(name)) return "LIGHTBOX";
  if (/^support$/i.test(name)) return "SUPPORT";
  const m = /^(XL|L|M|C|S)\s*\((\d+)\s*\*\s*(\d+)\)\s*(POSI|DG|MW)$/i.exec(name);
  if (!m) return null;
  const [, size, a, b, family] = m;
  // The base sometimes writes the shelf the other way round ("M (9*6)", "S (2*10)").
  const dims = [Number(a), Number(b)].sort((p, q) => p - q).join("*");
  const f = family!.toUpperCase();
  const s = size!.toUpperCase();
  const known = (code: string) =>
    (TYPE_CODES as string[]).includes(code) ? (code as DistType) : null;
  if (f === "POSI") return known(`POSI_${s}`);
  if (f === "DG") return known(`DG_${s}`);
  // Metawerk: 10*10 and 6*10 are the 2025 series, 10*9, 6*9 and 10*2 the 2024 one.
  if (dims === "10*10" && s === "L") return "MW25_L";
  if (dims === "6*10" && s === "M") return "MW25_M";
  if (s === "L") return "MW24_L";
  if (s === "M") return "MW24_M";
  if (s === "S") return "MW24_S";
  return null;
}

// Regions in the order of the equipment file (the rest follow alphabetically).
export const REGION_ORDER = [
  "Tashkent",
  "Syrdarya",
  "Fergana",
  "Kokand",
  "Andijan",
  "Namangan",
  "Samarkand",
  "Bukhara",
  "Navai",
  "Khorezm",
  "Karakalpakistan",
  "Kashkadarya",
  "Jizzax",
  "Surkhandarya",
];

// The same region spelled differently in different files.
const REGION_ALIASES: Record<string, string> = {
  sirdarya: "Syrdarya",
  navoi: "Navai",
  urgench: "Khorezm",
  nukus: "Karakalpakistan",
  djizzak: "Jizzax",
  jizzakh: "Jizzax",
};

export function canonicalRegion(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  return (
    REGION_ALIASES[clean.toLowerCase()] ??
    REGION_ORDER.find((r) => r.toLowerCase() === clean.toLowerCase()) ??
    clean
  );
}

export const sortRegions = (regions: Iterable<string>) =>
  [...new Set(regions)].sort((a, b) => {
    const ia = REGION_ORDER.indexOf(a);
    const ib = REGION_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

// Shipment destinations: a region, or "Region · TSM".
const SEP = " · ";
export const tsmDestination = (region: string, tsm: string) => `${region}${SEP}${tsm}`;
// Installed equipment whose outlet has no TSM in the outlet base (or is not in it, or has no
// Smartup ID): a row of its own inside the region. It is counted as installed and gets its POSM;
// it never goes to the region's warehouse.
export const NO_TSM = "TSM не назначен";

// TSM names in order, «TSM не назначен» last.
export const byTsmName = (a: string, b: string) =>
  a === NO_TSM ? 1 : b === NO_TSM ? -1 : a.localeCompare(b, "ru", { numeric: true });

export function parseDestination(destination: string): { region: string; tsm: string | null } {
  const at = destination.indexOf(SEP);
  return at === -1
    ? { region: destination, tsm: null }
    : { region: destination.slice(0, at), tsm: destination.slice(at + SEP.length) };
}

// The price on a price tag: "Ценник 28000" → 28000, "Ценник 19,000 blue" → 19000; null otherwise.
export function tagPrice(name: string): number | null {
  const m = /(\d{1,3}(?:[ ,. ]\d{3})+|\d{4,6})/.exec(name);
  if (!m || !/ценник|price/i.test(name)) return null;
  return Number(m[1]!.replace(/\D/g, ""));
}
