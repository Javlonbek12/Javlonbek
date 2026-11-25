import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { ru } from "@/lib/i18n/ru";

import type { OosPath, PathRow } from "./oos-path";
import { pathRepTone, pathRowTone, REASON_TONE, type Tone } from "./tone";
import { NO_VISITS_REGION } from "./visits";
import type { AddSheet, CellFormat, SheetColumn, SheetRow, Value } from "./xlsx-style";

type ColKey = keyof typeof ru.connect.oosPath.col;

// «Путь OOS» in the Connect download: the block in full (the page shows the first rows of each
// list). `own`: the executors' level — one person's numbers and chains, without the tables by
// employee. Every sheet compares the two sources, and every column says whose it is (in its
// header and by the line under it); what the page marks — a delivery without a sale red, a rep
// who has not answered amber — is marked here.
export function oosPathSheets(sheet: AddSheet, path: OosPath | null | undefined, own: boolean) {
  if (!path || !path.totals.checks) return;
  const column = (
    header: string,
    width = 14,
    format: CellFormat = "text",
    more: Partial<SheetColumn> = {},
  ): SheetColumn => ({ header, width, format, ...more });
  const col = (key: ColKey, width = 14, format: CellFormat = "count") =>
    column(t(`connect.oosPath.col.${key}`), width, format);
  const percent = (key: ColKey, source: "bot" | "smartup") =>
    column(`${t(`connect.oosPath.col.${key}`)}, %`, 12, "percent", { source });
  // Whose data a column is: the steps are the bot's, the sales Smart Up's.
  const bot = (
    key: ColKey,
    width = 12,
    format: CellFormat = "count",
    more: Partial<SheetColumn> = {},
  ) =>
    column(`${t(`connect.oosPath.col.${key}`)} (${t("connect.source.bot")})`, width, format, {
      source: "bot",
      ...more,
    });
  const smartUp = (
    key: ColKey,
    width = 12,
    format: CellFormat = "count",
    more: Partial<SheetColumn> = {},
  ) =>
    column(`${t(`connect.oosPath.col.${key}`)} (${t("connect.source.smartup")})`, width, format, {
      source: "smartup",
      ...more,
    });
  const about = (key: keyof typeof ru.connect.cover.about) => t(`connect.cover.about.${key}`);
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
  // The rows of the table are the steps; the total and what is under it have no step.
  const step = (index: number) => path.cross[index]?.step;
  // A sale without an order or an answer of the store is marked amber.
  const soldAnyway: SheetColumn["tone"] = (_, __, i) =>
    (step(i) === "noOrder" || step(i) === "storeSilent") && path.cross[i]!.anySold > 0
      ? "warn"
      : null;
  // A delivery without a sale is red.
  const unsold: SheetColumn["tone"] = (value, _, i) =>
    step(i) === "delivered" && typeof value === "number" && value > 0 ? "bad" : null;
  const mismatch = (label: string, value: number, tone: Tone): SheetRow => ({
    cells: [label, value],
    tone: value > 0 ? tone : null,
  });
  sheet(
    t("connect.oosPath.sheet.summary"),
    [
      bot("step", 44, "text"),
      bot("checks", 16),
      smartUp("anySold", 18, "count", { tone: soldAnyway }),
      smartUp("soldRate", 18, "percent", { tone: soldAnyway }),
      smartUp("soldAll", 16),
      smartUp("soldSome", 16),
      smartUp("noneOther", 22, "count", { tone: unsold }),
      smartUp("noneNothing", 22, "count", { tone: unsold }),
      smartUp("open", 16),
    ],
    [
      ...path.cross.map((c): Value[] => [t(`connect.oosPath.step.${c.step}`), ...cross(c)]),
      {
        cells: [
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
        bold: true,
      },
      [],
      // The funnel is a list of its own: a stage, how many reached it, its share in words.
      ...path.funnel.map((stage): SheetRow => ({
        cells: [
          t(`connect.oosPath.stage.${stage.key}`),
          stage.count,
          stage.rate === null ? null : t("connect.oosPath.ofPrevious", { rate: stage.rate }),
        ],
        formats: ["text", "count", "text"],
      })),
      [],
      [t("connect.oosPath.col.confirmed"), r.confirmed],
      mismatch(t("connect.oosPath.col.deliveredNoSale"), r.deliveredNoSale, "bad"),
      mismatch(t("connect.oosPath.col.soldAnyway"), r.soldAnyway, "warn"),
      [t("connect.oosPath.noZone"), r.noZone],
      [
        path.sales
          ? t("connect.oosPath.salesDate", { date: formatDay(path.sales.to) })
          : t("connect.oosPath.noSales"),
        null,
      ],
    ],
    { source: "both", about: about("path") },
  );

  // The same numbers for every row of a table. A rep's unanswered orders are marked on their
  // own table only, as on the page.
  const counts = (rows: PathRow[], reps = false): SheetColumn[] => [
    bot("checks", 12),
    bot("orders", 10),
    bot("noOrder", 12),
    percent("noOrder", "bot"),
    bot("storeWaiting", 12),
    bot("storeSilent", 12),
    bot("storeRefused", 12),
    bot("agentWaiting", 12, "count", {
      tone: reps ? (_, __, i) => (rows[i]!.agentWaiting > 0 ? "warn" : null) : undefined,
    }),
    bot("agentAccepted", 12),
    bot("delivered", 12),
    bot("confirmed", 14),
    bot("other", 12),
    smartUp("closed", 12),
    smartUp("anySold", 14),
    percent("soldRate", "smartup"),
    smartUp("soldAll", 12),
    smartUp("noneOther", 16),
    smartUp("noneNothing", 16),
    smartUp("open", 12),
    // Delivered in the bot and not sold in Smart Up: the two sources disagree.
    {
      ...col("deliveredNoSale", 16),
      tone: (_, __, i) => (rows[i]!.deliveredNoSale > 0 ? "bad" : null),
    },
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

  if (!own && path.byRegion.length + path.byManager.length > 0) {
    const groups: PathRow[] = [...path.byRegion, ...path.byManager];
    sheet(
      t("connect.oosPath.sheet.groups"),
      [
        col("who", 14, "text"),
        col("name", 30, "text"),
        column(t("connect.col.person"), 30),
        col("people", 8),
        ...counts(groups),
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
      {
        source: "both",
        about: about("pathGroups"),
        rowTone: (_, i) => pathRowTone(groups[i]!),
      },
    );
  }

  if (!own && path.byTsm.length)
    sheet(
      t("connect.oosPath.sheet.people"),
      [
        column(t("connect.col.tsm"), 26),
        column(t("connect.col.person"), 30),
        ...counts(path.byTsm),
      ],
      path.byTsm.map((x) => [x.code || null, x.name, ...numbers(x)]),
      {
        source: "both",
        about: about("pathPeople"),
        rowTone: (_, i) => pathRowTone(path.byTsm[i]!),
      },
    );

  if (!own && path.byDr.length)
    sheet(
      t("connect.oosPath.sheet.reps"),
      [smartUp("zone", 30, "text"), ...counts(path.byDr, true)],
      path.byDr.map((x) => [x.zone ?? t("connect.oosPath.noZone"), ...numbers(x)]),
      {
        source: "both",
        about: about("pathReps"),
        rowTone: (_, i) => pathRepTone(path.byDr[i]!),
      },
    );

  if (path.stores.length)
    sheet(
      t("connect.oosPath.sheet.stores"),
      [
        // Why the chain is in the list, in the colour of the reason.
        {
          ...col("reason", 28, "text"),
          tone: (_, __, i) => REASON_TONE[path.stores[i]!.reason],
        },
        column(t("connect.col.store"), 40),
        column("ID", 12),
        bot("check", 14, "date"),
        column(t("connect.col.tsm"), 26),
        column(t("connect.col.person"), 30),
        smartUp("zone", 24, "text"),
        bot("out", 10),
        column(`${t("connect.oosPath.col.out")}: ${t("connect.col.skus")}`, 70),
        bot("step", 34, "text"),
        bot("order", 14, "text"),
        smartUp("sale", 36, "text"),
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
      {
        source: "both",
        about: about("pathStores"),
        rowTone: (_, i) => REASON_TONE[path.stores[i]!.reason],
      },
    );
}

// The row of those without a Smart Up visit has no region of its own (see regionRows).
const regionName = (region: string) =>
  region === NO_VISITS_REGION ? t("connect.section.noVisitsRegion") : region;
