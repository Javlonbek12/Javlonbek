import ExcelJS from "exceljs";

import { t, type TranslationKey } from "@/lib/i18n";

import { plannedFor } from "./compute";
import type { Distribution } from "./service";
import { DIST_TYPES } from "./types";

type Value = string | number | null;

// The distribution as Excel: findings, the plan by region, Tashkent by TSM, the stock, where it
// went, and a waybill sheet per region — the same numbers as on the screen.
export async function distributionXlsx(d: Distribution): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = t("app.name");
  const sheet = (name: string, header: Value[], rows: Value[][], widths: number[] = []) => {
    const ws = book.addWorksheet(
      name
        .replace(/[*?:\\/[\]]/g, " ")
        .trim()
        .slice(0, 31),
    );
    ws.addRow(header);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
    ws.addRows(rows);
    ws.columns.forEach((c, i) => (c.width = widths[i] ?? (i === 0 ? 36 : 12)));
    return ws;
  };
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const regions = [...d.regions.keys()];
  const tsms = [...d.tsms.keys()];

  sheet(
    t("dist.findings.title"),
    [t("dist.findings.title")],
    d.findings.map((f) => [t(`dist.findings.${f.key}` as TranslationKey, f.params)]),
    [140],
  );

  sheet(
    t("dist.tabs.plan"),
    [
      t("dist.plan.posm"),
      t("dist.plan.base"),
      t("dist.plan.toShip"),
      ...regions,
      t("dist.plan.distributed"),
      t("dist.plan.central"),
    ],
    [
      ...d.plans.map((p) => [
        p.item.name,
        t(`dist.base.${p.item.base}`),
        p.toShip,
        ...regions.map((r) => p.byRegion.get(r) ?? 0),
        p.distributed,
        p.central,
      ]),
      [
        t("dist.total"),
        null,
        sum(d.plans.map((p) => p.toShip)),
        ...regions.map((r) => sum(d.plans.map((p) => p.byRegion.get(r) ?? 0))),
        sum(d.plans.map((p) => p.distributed)),
        sum(d.plans.map((p) => p.central)),
      ],
    ],
  );

  if (tsms.length)
    sheet(
      t("dist.plan.tsmTitle"),
      [t("dist.equipment.tsm"), ...d.plans.map((p) => p.item.name), t("dist.total")],
      [
        ...tsms.map((tsm) => [
          tsm,
          ...d.plans.map((p) => p.byTsm.get(tsm) ?? 0),
          sum(d.plans.map((p) => p.byTsm.get(tsm) ?? 0)),
        ]),
        [
          t("dist.plan.tsmRest"),
          ...d.plans.map((p) => p.tsmRest),
          sum(d.plans.map((p) => p.tsmRest)),
        ],
      ],
    );

  sheet(
    t("dist.stock.title"),
    [
      t("dist.stock.posm"),
      t("dist.stock.available"),
      t("dist.stock.planned"),
      t("dist.stock.shipped"),
      t("dist.stock.onHand"),
      t("dist.stock.toSend"),
    ],
    d.stock.map((s) => [s.item.name, s.available, s.planned, s.shipped, s.onHand, s.toSend]),
  );

  sheet(
    t("dist.stock.history"),
    [
      t("dist.stock.date"),
      t("dist.stock.posm"),
      t("dist.stock.destination"),
      t("dist.stock.quantity"),
      t("dist.stock.note"),
    ],
    d.shipments.map((s) => [
      s.shippedOn.toISOString().slice(0, 10),
      s.posm.name,
      s.destination,
      s.quantity,
      s.note,
    ]),
    [12, 36, 28, 10, 40],
  );

  sheet(
    t("dist.equipment.base"),
    [t("dist.equipment.region"), ...DIST_TYPES.map((x) => x.label), t("dist.total")],
    [...d.regions].map(([region, units]) => [
      region,
      ...DIST_TYPES.map((x) => units[x.code] ?? 0),
      sum(Object.values(units)),
    ]),
  );

  // A waybill per region: what to send, what has gone, with a column for the signature.
  for (const region of regions) {
    const ws = sheet(
      `${t("dist.regions.waybill")} ${region}`,
      [
        t("dist.waybill.posm"),
        t("dist.waybill.category"),
        t("dist.waybill.planned"),
        t("dist.waybill.shipped"),
        t("dist.waybill.toSend"),
        t("dist.waybill.received"),
      ],
      d.plans
        .map((p) => {
          const planned = plannedFor(p, region);
          const shipped = sum(
            d.shipments
              .filter((s) => s.posmId === p.item.id && s.destination === region)
              .map((s) => s.quantity),
          );
          return [
            p.item.name,
            p.item.category,
            planned,
            shipped,
            Math.max(0, planned - shipped),
            null,
          ];
        })
        .filter((row) => (row[2] as number) > 0),
      [36, 16, 12, 12, 12, 24],
    );
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  return Buffer.from(await book.xlsx.writeBuffer());
}
