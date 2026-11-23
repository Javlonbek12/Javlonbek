import type ExcelJS from "exceljs";

import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";

import type { AttentionReason } from "./attention";
import type { ConnectInsights } from "./insights";

type Value = string | number | null;
type AddSheet = (
  name: string,
  columns: { header: string; width: number }[],
  rows: Value[][],
) => ExcelJS.Worksheet;

const reasonText = (reason: AttentionReason) =>
  t(`connect.attention.reason.${reason.kind}`, { value: reason.value, of: reason.of ?? "" });

// The sheets of «Восстановление наличия», «Заказ дистрибьютора после OOS» and «Требует внимания»
// in the Connect download: the page's blocks in full (the page shows the first rows of each list).
// `own`: the executors' level — one TSM's numbers and stores, without the tables by employee.
export function insightSheets(sheet: AddSheet, insights: ConnectInsights | null, own: boolean) {
  if (!insights) return;
  const column = (header: string, width = 14) => ({ header, width });
  const col = (key: Parameters<typeof colKey>[0], width = 14) => column(colKey(key), width);
  const { recovery, followUp, attention } = insights;
  const r = recovery.totals;

  if (r.stores > 0 || followUp) {
    const rows: Value[][] = [
      [t("connect.recovery.baseLabel"), t(`connect.recovery.base.${recovery.baseline}`)],
      [t("connect.recovery.compared"), r.stores],
      [`${t("connect.recovery.rate")}, %`, r.rate],
      [t("connect.recovery.col.wasOut"), r.wasOut],
      [t("connect.recovery.col.restored"), r.restored],
      [t("connect.recovery.stillOut"), r.stillOut],
      [t("connect.recovery.newlyOut"), r.newlyOut],
      [t("connect.recovery.worse"), r.worse],
    ];
    if (followUp)
      rows.push(
        [],
        [t("connect.recovery.followTitle"), null],
        [t("connect.recovery.followChecks"), followUp.totals.checks],
        [t("connect.recovery.followRate"), followUp.totals.followed],
        [`${t("connect.recovery.followRate")}, %`, followUp.totals.rate],
        [t("connect.recovery.followMissed"), followUp.totals.checks - followUp.totals.followed],
        [t("connect.col.notClosed"), followUp.totals.open],
        ...(followUp.routesTo
          ? [[t("connect.recovery.routesDate", { date: formatDay(followUp.routesTo) }), null]]
          : []),
      );
    sheet(
      t("connect.recovery.sheet.summary"),
      [column(t("connect.col.metric"), 50), column(t("connect.col.value"), 24)],
      rows,
    );
  }

  if (!own && recovery.byTsm.length)
    sheet(
      t("connect.recovery.sheet.people"),
      [
        column(t("connect.col.tsm"), 26),
        column(t("connect.col.person"), 30),
        col("stores", 10),
        col("wasOut", 10),
        col("restored", 10),
        column(`${colKey("rate")}, %`, 16),
        col("stillOut", 12),
        col("newlyOut", 12),
        col("worse", 12),
      ],
      recovery.byTsm.map((x) => [
        x.code || null,
        x.name,
        x.stores,
        x.wasOut,
        x.restored,
        x.rate,
        x.stillOut,
        x.newlyOut,
        x.worse,
      ]),
    );

  if (!own && recovery.bySku.length)
    sheet(
      t("connect.recovery.sheet.skus"),
      [
        column(t("connect.col.sku"), 34),
        col("wasOut", 10),
        col("restored", 10),
        col("stillOut", 12),
        column(`${colKey("rate")}, %`, 16),
      ],
      recovery.bySku.map((x) => [x.sku, x.wasOut, x.restored, x.stillOut, x.rate]),
    );

  if (recovery.stores.length)
    sheet(
      t("connect.recovery.sheet.stores"),
      [
        column(t("connect.col.store"), 40),
        column("ID", 12),
        column(t("connect.col.tsm"), 26),
        col("baseDay", 16),
        col("lastDay", 16),
        col("days", 10),
        col("stillOut", 10),
        column(`${colKey("stillOut")}: ${t("connect.col.skus")}`, 70),
        col("newlyOut", 10),
        column(`${colKey("newlyOut")}: ${t("connect.col.skus")}`, 50),
      ],
      recovery.stores.map((x) => [
        x.store,
        x.storeCode,
        x.code,
        x.baseDay,
        x.lastDay,
        x.days,
        x.stillOut.length,
        x.stillOut.join(", ") || null,
        x.newlyOut.length,
        x.newlyOut.join(", ") || null,
      ]),
    );

  if (followUp && followUp.byDr.length + followUp.byTsm.length > 0)
    sheet(
      t("connect.recovery.sheet.follow"),
      [
        col("who", 8),
        column(`${colKey("zone")} / ${t("connect.col.tsm")}`, 28),
        column(t("connect.col.person"), 30),
        col("counted", 16),
        col("followed", 16),
        column(`${colKey("followRate")}, %`, 10),
      ],
      [
        ...followUp.byDr.map((x): Value[] => [
          t("connect.recovery.whoDr"),
          x.zone,
          null,
          x.checks,
          x.followed,
          x.rate,
        ]),
        ...followUp.byTsm.map((x): Value[] => [
          t("connect.recovery.whoTsm"),
          x.code,
          x.name,
          x.checks,
          x.followed,
          x.rate,
        ]),
      ],
    );

  if (attention)
    sheet(
      t("connect.attention.sheet"),
      [
        column(t("connect.col.tsm"), 26),
        column(t("connect.col.person"), 30),
        column(t("connect.attention.manager"), 30),
        column(t("connect.col.position"), 30),
        column(t("connect.attention.count"), 10),
        column(t("connect.attention.reasons"), 100),
      ],
      attention.length
        ? attention.map((x) => [
            x.code,
            x.name,
            x.manager?.name ?? null,
            x.manager?.title ?? null,
            x.reasons.length,
            x.reasons.map(reasonText).join("; "),
          ])
        : [[t("connect.attention.none"), null, null, null, null, null]],
    );
}

// A column heading of the recovery tables.
function colKey(
  key:
    | "stores"
    | "wasOut"
    | "restored"
    | "rate"
    | "stillOut"
    | "newlyOut"
    | "worse"
    | "baseDay"
    | "lastDay"
    | "days"
    | "zone"
    | "counted"
    | "followed"
    | "followRate"
    | "who",
) {
  return t(`connect.recovery.col.${key}`);
}
