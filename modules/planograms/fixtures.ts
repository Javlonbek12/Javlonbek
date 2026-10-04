import type { Geometry } from "./geometry";
import type { SkuInfo } from "./layout";

// Equipment shapes from docs/PLANOGRAM-INPUT.md (used by the seed and the tests).
export const EQUIPMENT_FIXTURES: {
  code: string;
  name: string;
  channel: string;
  geometry: Geometry;
}[] = [
  {
    code: "DISPLAY_L",
    name: "Display L",
    channel: "POSI",
    geometry: {
      header: "horizontal",
      shelves: Array.from({ length: 7 }, () => ({ slots: 10, offset: 0, group: 0 })),
    },
  },
  {
    code: "DISPLAY_M",
    name: "Display M",
    channel: "POSI",
    geometry: {
      header: "horizontal",
      shelves: Array.from({ length: 7 }, () => ({ slots: 6, offset: 0, group: 0 })),
    },
  },
  {
    code: "MODULE_9x2",
    name: "Модуль 9×2",
    channel: "MW",
    geometry: {
      header: null,
      shelves: [
        { slots: 9, offset: 0, group: 3 },
        { slots: 9, offset: 0, group: 3 },
      ],
    },
  },
  {
    code: "LEGO_21",
    name: "LEGO 21",
    channel: "DG",
    geometry: {
      header: null,
      shelves: [
        { slots: 3, offset: 3, group: 0 },
        { slots: 9, offset: 0, group: 3 },
        { slots: 9, offset: 0, group: 3 },
      ],
    },
  },
  {
    code: "POG_MINI",
    name: "POG MINI",
    channel: "POSI",
    geometry: { header: null, shelves: [{ slots: 18, offset: 0, group: 0 }] },
  },
];

type FixtureSku = SkuInfo & { price: number; priceStyle: "NUMBER" | "MING"; color: string };

const sku = (
  n: number,
  brand: string,
  name: string,
  price: number,
  extra: Partial<FixtureSku> = {},
): FixtureSku => ({
  id: `sku-${n}`,
  code: `SKU-TEST-${String(n).padStart(3, "0")}`,
  brand,
  name,
  isNew: false,
  isMandatory: false,
  defaultBadges: [],
  price,
  priceStyle: "NUMBER",
  color: "#64748b",
  ...extra,
});

const ESSE = "#1d4ed8";
const BOHEM = "#7c2d12";
const PINE = "#15803d";
const BLOOMING = "#7e22ce";
const SIMPLE = "#334155";

// 18 test SKUs: brands and prices as seen on the customer's examples, names marked "(тест)".
// 9 of them are mandatory ("9 обязательных SKU из 18").
export const SKU_FIXTURES: FixtureSku[] = [
  sku(1, "ESSE", "ESSE Special Gold (тест)", 31000, { isMandatory: true, color: ESSE }),
  sku(2, "ESSE", "ESSE Change 1 (тест)", 28000, {
    isNew: true,
    isMandatory: true,
    defaultBadges: ["1mg"],
    color: ESSE,
  }),
  sku(3, "ESSE", "ESSE Change W (тест)", 26000, { color: ESSE }),
  sku(4, "ESSE", "ESSE Change (тест)", 24000, { isMandatory: true, color: ESSE }),
  sku(5, "ESSE", "ESSE DEM (тест)", 22000, { color: ESSE }),
  sku(6, "ESSE", "ESSE GS (тест)", 21000, { isMandatory: true, color: ESSE }),
  sku(7, "ESSE", "ESSE Silver (тест)", 21000, { color: ESSE }),
  sku(8, "ESSE", "ESSE Shine (тест)", 21000, { color: ESSE }),
  sku(9, "BOHEM", "BOHEM Cigar L (тест)", 24000, { isMandatory: true, color: BOHEM }),
  sku(10, "BOHEM", "BOHEM Cigar C (тест)", 21000, { defaultBadges: ["1mg"], color: BOHEM }),
  sku(11, "BOHEM", "BOHEM Cigar F (тест)", 20000, { color: BOHEM }),
  sku(12, "PINE", "PINE Blue (тест)", 18000, {
    isMandatory: true,
    priceStyle: "MING",
    color: PINE,
  }),
  sku(13, "PINE", "PINE Green (тест)", 18000, {
    isMandatory: true,
    priceStyle: "MING",
    color: PINE,
  }),
  sku(14, "PINE", "PINE KS (тест)", 18000, { priceStyle: "MING", color: PINE }),
  sku(15, "Blooming", "Blooming Violet ON (тест)", 18000, {
    isMandatory: true,
    priceStyle: "MING",
    color: BLOOMING,
  }),
  sku(16, "Blooming", "Blooming Blue (тест)", 18000, { priceStyle: "MING", color: BLOOMING }),
  sku(17, "Simple", "Simple 2mg (тест)", 20000, {
    isMandatory: true,
    defaultBadges: ["2mg"],
    color: SIMPLE,
  }),
  sku(18, "Simple", "Simple (тест)", 20000, { color: SIMPLE }),
];
