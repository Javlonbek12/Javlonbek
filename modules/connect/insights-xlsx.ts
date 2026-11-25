import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { ru } from "@/lib/i18n/ru";

import type { AttentionReason } from "./attention";
import type { ConnectInsights } from "./insights";
import type { Tone } from "./tone";
import type { AddSheet, CellFormat, SheetColumn, SheetRow, Value } from "./xlsx-style";

const reasonText = (reason: AttentionReason) =>
  t(`connect.attention.reason.${reason.kind}`, { value: reason.value, of: reason.of ?? "" });

// The sheets of «Восстановление наличия», «Заказ дистрибьютора после OOS» and «Требует внимания»
// in the Connect download: the page's blocks in full (the page shows the first rows of each list).
// `own`: the executors' level — one TSM's numbers and stores, without the tables by employee.
export function insightSheets(sheet: AddSheet, insights: ConnectInsights | null, own: boolean) {
  if (!insights) return;
  const column = (header: string, width = 14, format: CellFormat = "text"): SheetColumn => ({
    header,
    width,
    format,
  });
  const col = (key: Parameters<typeof colKey>[0], width = 14, format: CellFormat = "count") =>
    column(colKey(key), width, format);
  const share = (key: Parameters<typeof colKey>[0], width = 16) =>
    column(`${colKey(key)}, %`, width, "percent");
  const about = (key: keyof typeof ru.connect.cover.about) => t(`connect.cover.about.${key}`);
  const number = (
    label: string,
    value: Value,
    format: CellFormat = "count",
    tone: Tone | null = null,
  ): SheetRow => ({ cells: [label, value], format, tone });
  // The page marks what is still to be done (a number that should be zero and is not).
  const some = (value: number): Tone | null => (value ? "warn" : null);
  const { recovery, followUp, attention } = insights;
  const r = recovery.totals;

  if (r.stores > 0 || followUp) {
    const rows: SheetRow[] = [
      [t("connect.recovery.baseLabel"), t(`connect.recovery.base.${recovery.baseline}`)],
      number(t("connect.recovery.compared"), r.stores),
      number(`${t("connect.recovery.rate")}, %`, r.rate, "percent"),
      number(t("connect.recovery.col.wasOut"), r.wasOut),
      number(t("connect.recovery.col.restored"), r.restored),
      number(t("connect.recovery.stillOut"), r.stillOut, "count", some(r.stillOut)),
      number(t("connect.recovery.newlyOut"), r.newlyOut),
      number(t("connect.recovery.worse"), r.worse),
    ];
    if (followUp) {
      const missed = followUp.totals.checks - followUp.totals.followed;
      rows.push(
        [],
        { cells: [t("connect.recovery.followTitle"), null], kind: "title" },
        number(t("connect.recovery.followChecks"), followUp.totals.checks),
        number(t("connect.recovery.followRate"), followUp.totals.followed),
        number(`${t("connect.recovery.followRate")}, %`, followUp.totals.rate, "percent"),
        number(t("connect.recovery.followMissed"), missed, "count", some(missed)),
        number(t("connect.col.notClosed"), followUp.totals.open),
        ...(followUp.routesTo
          ? [[t("connect.recovery.routesDate", { date: formatDay(followUp.routesTo) }), null]]
          : []),
      );
    }
    sheet(
      t("connect.recovery.sheet.summary"),
      [column(t("connect.col.metric"), 50), column(t("connect.col.value"), 24, "count")],
      rows,
      // The recovery is the bot's checks; the rep's order after them is Smart Up's route.
      { source: followUp ? "both" : "bot", about: about("recovery"), list: true },
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
        share("rate"),
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
      { source: "bot", about: about("recoveryPeople") },
    );

  if (!own && recovery.bySku.length)
    sheet(
      t("connect.recovery.sheet.skus"),
      [
        column(t("connect.col.sku"), 34),
        col("wasOut", 10),
        col("restored", 10),
        col("stillOut", 12),
        share("rate"),
      ],
      recovery.bySku.map((x) => [x.sku, x.wasOut, x.restored, x.stillOut, x.rate]),
      { source: "bot", about: about("recoverySkus") },
    );

  if (recovery.stores.length)
    sheet(
      t("connect.recovery.sheet.stores"),
      [
        column(t("connect.col.store"), 40),
        column("ID", 12),
        column(t("connect.col.tsm"), 26),
        col("baseDay", 16, "date"),
        col("lastDay", 16, "date"),
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
      { source: "bot", about: about("recoveryStores") },
    );

  if (followUp && followUp.byDr.length + followUp.byTsm.length > 0)
    sheet(
      t("connect.recovery.sheet.follow"),
      [
        col("who", 8, "text"),
        column(`${colKey("zone")} / ${t("connect.col.tsm")}`, 28),
        column(t("connect.col.person"), 30),
        col("counted", 16),
        col("followed", 16),
        share("followRate", 10),
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
      { source: "both", about: about("follow") },
    );

  if (attention)
    sheet(
      t("connect.attention.sheet"),
      [
        // Nobody on the list is good news: the page writes it in green.
        {
          ...column(t("connect.col.tsm"), 26),
          tone: () => (attention.length ? null : "good"),
          paint: "text",
        },
        column(t("connect.col.person"), 30),
        column(t("connect.attention.manager"), 30),
        column(t("connect.col.position"), 30),
        column(t("connect.attention.count"), 10, "count"),
        // What to talk about, in amber as on the page.
        {
          ...column(t("connect.attention.reasons"), 100),
          tone: () => (attention.length ? "warn" : null),
          paint: "text",
        },
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
      { source: "both", about: about("attentionList") },
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
