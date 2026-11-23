import { t } from "@/lib/i18n";
import type { ru } from "@/lib/i18n/ru";

import { localizeData } from "./localize";
import type { RoutesBlock } from "./routes-report";

type Value = string | number | null;
// The workbook's way to add a sheet (see connectXlsx).
type AddSheet = (
  name: string,
  columns: { header: string; width: number }[],
  rows: Value[][],
) => unknown;

// «Маршруты и дисциплина» in the Excel download: the zones on the screen and the full lists of
// stores to act on (the page shows the first of them).
export function routeSheets(sheet: AddSheet, block: RoutesBlock) {
  const a = block.analysis;
  const col = (key: keyof typeof ru.connect.routes.col, width = 12) => ({
    header: t(`connect.routes.col.${key}`),
    width,
  });
  const percent = (key: keyof typeof ru.connect.routes.col) => ({
    header: `${t(`connect.routes.col.${key}`)}, %`,
    width: 12,
  });
  sheet(
    t("connect.routes.sheets.zones"),
    [
      col("zone", 26),
      col("kind", 8),
      col("person", 30),
      col("manager", 40),
      col("organization", 18),
      col("clients", 8),
      col("planned", 8),
      col("visited", 10),
      percent("attendance"),
      col("attendanceDelta", 14),
      col("missed", 10),
      col("neverVisited", 12),
      col("unplanned", 10),
      col("upcoming", 10),
      col("visits", 10),
      col("orders", 10),
      percent("hitRate"),
      col("hitRateDelta", 14),
      col("noOrder", 12),
      col("class", 24),
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
      col("misses", 10),
      col("missedDays", 40),
      col("lastVisit", 14),
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
        col("visits", 10),
        col("lastVisit", 14),
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
    );
}
