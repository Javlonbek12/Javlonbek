import { t } from "@/lib/i18n";
import type { ru } from "@/lib/i18n/ru";

import { localizeData } from "./localize";
import type { RoutesBlock } from "./routes-report";
import { changeTone, classTone, deltaTone, idleTone, targetTone, zoneTone } from "./tone";
import type { AddSheet, CellFormat, SheetColumn } from "./xlsx-style";

// «Маршруты и дисциплина» in the Excel download: the zones on the screen and the full lists of
// stores to act on (the page shows the first of them). All of it is Smart Up's data; the shares
// are coloured against the owner's targets, as on the page.
export function routeSheets(sheet: AddSheet, block: RoutesBlock) {
  const a = block.analysis;
  const { targets } = a;
  const col = (
    key: keyof typeof ru.connect.routes.col,
    width = 12,
    format: CellFormat = "text",
    more: Partial<SheetColumn> = {},
  ): SheetColumn => ({ header: t(`connect.routes.col.${key}`), width, format, ...more });
  const count = (key: keyof typeof ru.connect.routes.col, width = 12) => col(key, width, "count");
  const percent = (
    key: keyof typeof ru.connect.routes.col,
    tone?: SheetColumn["tone"],
  ): SheetColumn => ({
    header: `${t(`connect.routes.col.${key}`)}, %`,
    width: 12,
    format: "percent",
    tone,
  });
  // «▲ 1.4 п.п.» against the period before: up in green, down in red, as under a share on the page.
  const delta = (key: "attendanceDelta" | "hitRateDelta") =>
    col(key, 14, "change", {
      unit: t("connect.routes.pp"),
      tone: (value) => deltaTone(typeof value === "number" ? value : null),
      paint: "text",
    });
  const about = (key: keyof typeof ru.connect.cover.about) => t(`connect.cover.about.${key}`);

  sheet(
    t("connect.routes.sheets.zones"),
    [
      col("zone", 26),
      col("kind", 8),
      col("person", 30),
      col("manager", 40),
      col("organization", 18),
      count("clients", 8),
      count("planned", 8),
      count("visited", 10),
      percent("attendance", (_, __, i) => targetTone(a.zones[i]!.attendance, targets.attendance)),
      delta("attendanceDelta"),
      count("missed", 10),
      count("neverVisited", 12),
      count("unplanned", 10),
      count("upcoming", 10),
      count("visits", 10),
      count("orders", 10),
      // Only the distributor's reps have a hit rate (and a class of the matrix).
      percent("hitRate", (_, __, i) =>
        a.zones[i]!.kind === "DR" ? targetTone(a.zones[i]!.hitRate, targets.hitRate) : null,
      ),
      delta("hitRateDelta"),
      count("noOrder", 12),
      col("class", 24, "text", {
        tone: (_, __, i) => (a.zones[i]!.class ? classTone(a.zones[i]!.class!) : null),
        paint: "text",
      }),
    ],
    a.zones.map((z) => [
      z.zone,
      z.kind,
      z.person,
      [z.manager, z.managerPerson].filter(Boolean).join(" · ") || null,
      z.organization,
      z.clients,
      z.planned,
      z.visited,
      z.attendance,
      z.attendanceDelta,
      z.missed,
      z.neverVisited,
      z.unplanned,
      z.upcoming,
      z.visits,
      // Only the distributor's reps take orders.
      ...(z.kind === "DR"
        ? [z.orders, z.hitRate, z.hitRateDelta, z.noOrder]
        : [null, null, null, null]),
      z.class ? t(`connect.routes.class.${z.class}`) : null,
    ]),
    {
      source: "smartup",
      about: about("routes"),
      rowTone: (_, i) => zoneTone(a.zones[i]!, targets),
    },
  );
  sheet(
    t("connect.routes.sheets.missed"),
    [
      col("zone", 26),
      col("kind", 8),
      col("person", 30),
      col("organization", 18),
      col("storeCode", 12),
      col("store", 40),
      count("misses", 10),
      col("missedDays", 40),
      col("lastVisit", 14, "date"),
      col("grade", 8),
      col("equipment", 30),
    ],
    a.missed.map((s) => [
      s.zone,
      s.kind,
      s.person,
      s.organization,
      s.storeCode,
      s.store,
      s.misses,
      s.days.join(", "),
      s.lastVisit,
      s.grade,
      localizeData(s.equipment),
    ]),
    { source: "smartup", about: about("missed") },
  );
  if (block.staff !== "TSM" && (block.zone ? block.zone.kind === "DR" : a.totals.DR.zones > 0))
    sheet(
      t("connect.routes.sheets.noOrder"),
      [
        col("zone", 26),
        col("person", 30),
        col("organization", 18),
        col("storeCode", 12),
        col("store", 40),
        count("visits", 10),
        col("lastVisit", 14, "date"),
        col("grade", 8),
        col("equipment", 30),
      ],
      a.noOrder.map((s) => [
        s.zone,
        s.person,
        s.organization,
        s.storeCode,
        s.store,
        s.visits,
        s.lastVisit,
        s.grade,
        localizeData(s.equipment),
      ]),
      { source: "smartup", about: about("noOrder") },
    );
  // «Продажи по зонам»: every shown zone (the page shows the first of them).
  const sales = block.sales;
  if (sales)
    sheet(
      t("connect.zoneSales.sheet"),
      [
        col("zone", 26),
        { header: t("connect.zoneSales.kind"), width: 8, format: "text" },
        col("person", 30),
        col("organization", 18),
        { header: t("connect.zoneSales.col.sum"), width: 16, format: "money" },
        // «▼ 16.7%»: a fall is amber, a tenth and more red, growth green.
        {
          header: `${t("connect.zoneSales.col.change")}, %`,
          width: 14,
          format: "change",
          tone: (_, __, i) => changeTone(sales.rows[i]!.change),
        },
        { header: t("connect.zoneSales.col.blocks"), width: 10, format: "count" },
        { header: t("connect.zoneSales.col.days"), width: 10, format: "count" },
        count("clients", 8),
        { header: t("connect.zoneSales.col.coverage"), width: 16, format: "count" },
        { header: `${t("connect.zoneSales.col.coverage")}, %`, width: 16, format: "percent" },
        percent("hitRate", (_, __, i) => targetTone(sales.rows[i]!.hitRate, targets.hitRate)),
        percent("attendance", (_, __, i) =>
          targetTone(sales.rows[i]!.attendance, targets.attendance),
        ),
      ],
      sales.rows.map((r) => [
        r.zone,
        r.kind,
        r.person,
        r.organization,
        Math.round(r.sum),
        r.change,
        r.blocks,
        r.days,
        r.clients,
        r.buying,
        r.coverage,
        r.hitRate,
        r.attendance,
      ]),
      {
        source: "smartup",
        about: about("zoneSales"),
        rowTone: (_, i) => changeTone(sales.rows[i]!.change),
      },
    );
  if (sales?.idle.length)
    sheet(
      t("connect.zoneSales.idle.sheet"),
      [
        col("zone", 26),
        col("person", 30),
        col("organization", 18),
        col("storeCode", 12),
        col("store", 40),
        col("grade", 8),
        col("equipment", 30),
        { header: t("connect.zoneSales.idle.visits"), width: 10, format: "count" },
        // An order marked on the route and nothing sold: what to look into.
        {
          header: t("connect.zoneSales.idle.orders"),
          width: 12,
          format: "count",
          tone: (_, __, i) => idleTone(sales.idle[i]!),
        },
        { header: t("connect.zoneSales.idle.lastSale"), width: 18, format: "date" },
      ],
      sales.idle.map((s) => [
        s.zone,
        s.person,
        s.organization,
        s.storeCode,
        s.store,
        s.grade,
        localizeData(s.equipment),
        s.visits,
        s.orders,
        s.lastSale,
      ]),
      {
        source: "smartup",
        about: about("idle"),
        rowTone: (_, i) => idleTone(sales.idle[i]!),
      },
    );
}
