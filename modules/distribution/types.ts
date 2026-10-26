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
] as const;

export type DistType = (typeof DIST_TYPES)[number]["code"];
export const TYPE_CODES: DistType[] = DIST_TYPES.map((t) => t.code);
export const typeInfo = (code: string) => DIST_TYPES.find((t) => t.code === code);

// The TSM pivot names types like "L (10*9) MW" or "C (10*6) DG".
export function typeFromPivotHeader(header: string): DistType | null {
  const m = /^\s*(XL|L|M|C|S)\s*\((\d+)\s*\*\s*(\d+)\)\s*(POSI|DG|MW)\s*$/i.exec(header);
  if (!m) return null;
  const [, size, a, b, family] = m;
  const dims = `${a}*${b}`;
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

// Regions in the order of the file (the rest follow alphabetically).
export const REGION_ORDER = [
  "Tashkent",
  "Sirdarya",
  "Samarkand",
  "Fergana",
  "Kokand",
  "Andijan",
  "Namangan",
  "Bukhara",
  "Navoi",
  "Urgench",
  "Nukus",
  "Kashkadarya",
  "Djizzak",
  "Surkhandarya",
];

export const sortRegions = (regions: Iterable<string>) =>
  [...new Set(regions)].sort((a, b) => {
    const ia = REGION_ORDER.indexOf(a);
    const ib = REGION_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

// The region that is split by TSM.
export const TSM_REGION = "Tashkent";
// Shipment destinations: a region, or "Tashkent · TSM".
export const tsmDestination = (tsm: string) => `${TSM_REGION} · ${tsm}`;

// The price on a price tag: "Ценник 28000" → 28000, "Ценник 19,000 blue" → 19000; null otherwise.
export function tagPrice(name: string): number | null {
  const m = /(\d{1,3}(?:[ ,. ]\d{3})+|\d{4,6})/.exec(name);
  if (!m || !/ценник|price/i.test(name)) return null;
  return Number(m[1]!.replace(/\D/g, ""));
}
