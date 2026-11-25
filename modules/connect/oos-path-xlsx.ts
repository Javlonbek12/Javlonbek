import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { ru } from "@/lib/i18n/ru";

import type { OosPath, PathRow } from "./oos-path";
import { NO_VISITS_REGION } from "./visits";

type Value = string | number | null;
// The workbook's way to add a sheet (see connectXlsx).
type AddSheet = (
  name: string,
  columns: { header: string; width: number }[],
  rows: Value[][],
) => unknown;

type ColKey = keyof typeof ru.connect.oosPath.col;

// «Путь OOS» in the Connect download: the block in full (the page shows the first rows of each
// list). `own`: the executors' level — one person's numbers and chains, without the tables by
// employee.
export function oosPathSheets(sheet: AddSheet, path: OosPath | null | undefined, own: boolean) {
  if (!path || !path.totals.checks) return;
  const column = (header: string, width = 14) => ({ header, width });
  const col = (key: ColKey, width = 14) => column(t(`connect.oosPath.col.${key}`), width);
  const percent = (key: ColKey) => column(`${t(`connect.oosPath.col.${key}`)}, %`, 12);
  // Whose data a column is: the steps are the bot's, the sales Smart Up's.
  const bot = (key: ColKey, width = 12) =>
    column(`${t(`connect.oosPath.col.${key}`)} (${t("connect.source.bot")})`, width);
  const smartUp = (key: ColKey, width = 12) =>
    column(`${t(`connect.oosPath.col.${key}`)} (${t("connect.source.smartup")})`, width);
  const r = path.totals;

  // Step × sold, the total under it, then the funnel and the two mismatches.
  const cross = (c: {
    checks: number;
    anySold: number;
    anyRate: number | null;
    all: number;
    some: number;
    noneOther: number;
    noneNothing: number;
    open: number;
  }): Value[] => [
    c.checks,
    c.anySold,
    c.anyRate,
    c.all,
    c.some,
    c.noneOther,
    c.noneNothing,
    c.open,
  ];
  sheet(
    t("connect.oosPath.sheet.summary"),
    [
      bot("step", 44),
      bot("checks", 16),
      smartUp("anySold", 18),
      smartUp("soldRate", 18),
      smartUp("soldAll", 16),
      smartUp("soldSome", 16),
      smartUp("noneOther", 22),
      smartUp("noneNothing", 22),
      smartUp("open", 16),
    ],
    [
      ...path.cross.map((c): Value[] => [t(`connect.oosPath.step.${c.step}`), ...cross(c)]),
      [
        t("connect.oosPath.total"),
        ...cross({
          checks: r.checks,
          anySold: r.anySold,
          anyRate: r.soldRate,
          all: r.soldAll,
          some: r.soldSome,
          noneOther: r.noneOther,
          noneNothing: r.noneNothing,
          open: r.open,
        }),
      ],
      [],
      ...path.funnel.map((stage): Value[] => [
        t(`connect.oosPath.stage.${stage.key}`),
        stage.count,
        stage.rate === null ? null : t("connect.oosPath.ofPrevious", { rate: stage.rate }),
      ]),
      [],
      [t("connect.oosPath.col.confirmed"), r.confirmed],
      [t("connect.oosPath.col.deliveredNoSale"), r.deliveredNoSale],
      [t("connect.oosPath.col.soldAnyway"), r.soldAnyway],
      [t("connect.oosPath.noZone"), r.noZone],
      [
        path.sales
          ? t("connect.oosPath.salesDate", { date: formatDay(path.sales.to) })
          : t("connect.oosPath.noSales"),
        null,
      ],
    ],
  );

  // The same numbers for every row of a table.
  const counts = [
    bot("checks", 12),
    bot("orders", 10),
    bot("noOrder", 12),
    percent("noOrder"),
    bot("storeWaiting", 12),
    bot("storeSilent", 12),
    bot("storeRefused", 12),
    bot("agentWaiting", 12),
    bot("agentAccepted", 12),
    bot("delivered", 12),
    bot("confirmed", 14),
    bot("other", 12),
    smartUp("closed", 12),
    smartUp("anySold", 14),
    percent("soldRate"),
    smartUp("soldAll", 12),
    smartUp("noneOther", 16),
    smartUp("noneNothing", 16),
    smartUp("open", 12),
    col("deliveredNoSale", 16),
    col("soldAnyway", 18),
  ];
  const numbers = (x: PathRow): Value[] => [
    x.checks,
    x.orders,
    x.noOrder,
    x.noOrderRate,
    x.storeWaiting,
    x.storeSilent,
    x.storeRefused,
    x.agentWaiting,
    x.agentAccepted,
    x.delivered,
    x.confirmed,
    x.other,
    x.closed,
    x.anySold,
    x.soldRate,
    x.soldAll,
    x.noneOther,
    x.noneNothing,
    x.open,
    x.deliveredNoSale,
    x.soldAnyway,
  ];

  if (!own && path.byRegion.length + path.byManager.length > 0)
    sheet(
      t("connect.oosPath.sheet.groups"),
      [
        col("who", 14),
        col("name", 30),
        column(t("connect.col.person"), 30),
        col("people", 8),
        ...counts,
      ],
      [
        ...path.byRegion.map((x): Value[] => [
          t("connect.oosPath.who.region"),
          regionName(x.region),
          null,
          x.people,
          ...numbers(x),
        ]),
        ...path.byManager.map((x): Value[] => [
          t("connect.oosPath.who.manager"),
          x.title ?? t("connect.oosPath.noManager"),
          x.name,
          x.people,
          ...numbers(x),
        ]),
      ],
    );

  if (!own && path.byTsm.length)
    sheet(
      t("connect.oosPath.sheet.people"),
      [column(t("connect.col.tsm"), 26), column(t("connect.col.person"), 30), ...counts],
      path.byTsm.map((x) => [x.code || null, x.name, ...numbers(x)]),
    );

  if (!own && path.byDr.length)
    sheet(
      t("connect.oosPath.sheet.reps"),
      [smartUp("zone", 30), ...counts],
      path.byDr.map((x) => [x.zone ?? t("connect.oosPath.noZone"), ...numbers(x)]),
    );

  if (path.stores.length)
    sheet(
      t("connect.oosPath.sheet.stores"),
      [
        col("reason", 28),
        column(t("connect.col.store"), 40),
        column("ID", 12),
        bot("check", 14),
        column(t("connect.col.tsm"), 26),
        column(t("connect.col.person"), 30),
        smartUp("zone", 24),
        bot("out", 10),
        column(`${t("connect.oosPath.col.out")}: ${t("connect.col.skus")}`, 70),
        bot("step", 34),
        bot("order", 14),
        smartUp("sale", 36),
      ],
      path.stores.map((x) => [
        t(`connect.oosPath.reason.${x.reason}`),
        x.store,
        x.storeCode,
        x.day,
        x.code,
        x.name,
        x.zones.join(", ") || t("connect.oosPath.noZone"),
        x.out.length,
        x.out.join(", "),
        t(`connect.oosPath.step.${x.step}`),
        x.orderNo,
        t(`connect.oosPath.sold.${x.sold}`),
      ]),
    );
}

// The row of those without a Smart Up visit has no region of its own (see regionRows).
const regionName = (region: string) =>
  region === NO_VISITS_REGION ? t("connect.section.noVisitsRegion") : region;
