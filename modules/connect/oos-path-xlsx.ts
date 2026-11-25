import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { ru } from "@/lib/i18n/ru";

import type { OosPath, PathRow, PathStage } from "./oos-path";
import { formatNumber as n } from "./report";
import { SHOWN } from "./shown";
import { pathRepTone, pathRowTone, REASON_TONE, type Tone } from "./tone";
import { NO_VISITS_REGION } from "./visits";
import type { Page, Source, TableColumn, TableDef } from "./xlsx-page";
import type { CellFormat } from "./xlsx-style";

type ColKey = keyof typeof ru.connect.oosPath.col;
type Level = "exec" | "manager" | "executor";

const about = (key: keyof typeof ru.connect.cover.about) => t(`connect.cover.about.${key}`);
const head = (key: ColKey) => t(`connect.oosPath.col.${key}`);
const pct = (value: number | null) => (value === null ? "—" : `${value}%`);
const column = (header: string, width = 14, format: CellFormat = "text") => ({
  header,
  width,
  format,
});
// Whose data a column is: the steps are the bot's, the sales Smart Up's. On a sheet the header
// says so; on the page the line under the header does.
const of = (source: Source, key: ColKey, width = 12, format: CellFormat = "count") => ({
  ...column(`${head(key)} (${t(`connect.source.${source}`)})`, width, format),
  source,
});

// What the chains stopped at on the way to a stage: the line under its number.
const STOPPED_TONE: Record<PathStage, Tone | null> = {
  found: null,
  order: "warn",
  store: "warn",
  agent: "warn",
  delivered: "warn",
  // Delivered in the bot and not sold in Smart Up: the two sources disagree.
  sold: "bad",
};

// «Путь OOS: от проверки до продажи» in the Connect download, as the page shows it on the level:
// what happened after each stock check that found a product out — the order, the store's and the
// rep's answers, the delivery (Connect bot) — and whether Smart Up shows a sale of those products
// within three days. The leadership sees the funnel, the regions, the managers and the worst TSMs
// and reps; a manager their own TSMs and reps and the chains to act on; an executor their own
// funnel and chains. The tables the page cuts are sheets of their own, every column of which says
// whose data it is.
export function oosPathBlock(page: Page, path: OosPath | null | undefined, level: Level) {
  if (!path) return;
  const r = path.totals;
  const lead = level !== "executor";
  const sales = Boolean(path.sales);
  page.section(t("connect.oosPath.title"), {
    hint: t("connect.oosPath.hint"),
    nav: t("connect.oosPath.sheet.summary"),
    sources: ["bot", "smartup"],
  });
  if (r.checks === 0) return void page.text(t("connect.oosPath.none"), "muted");

  // The funnel: found → order → store → rep → delivered → sold.
  const detail = (key: PathStage) => {
    if (key === "found")
      return t("connect.oosPath.foundNote", { stores: n(r.stores), tsms: n(r.tsms) });
    if (key === "store")
      return [
        t("connect.oosPath.storeStopped", {
          silent: n(r.storeSilent),
          waiting: n(r.storeWaiting),
          refused: n(r.storeRefused),
        }),
        r.other > 0 && t("connect.oosPath.otherStopped", { count: n(r.other) }),
      ]
        .filter(Boolean)
        .join(" · ");
    if (key === "delivered" && r.delivered > 0)
      return t("connect.oosPath.confirmedNote", { count: n(r.confirmed) });
    const open = r.delivered - (path.funnel.find((s) => s.key === "sold")?.of ?? r.delivered);
    if (key === "sold" && open > 0) return t("connect.oosPath.soldOpen", { count: n(open) });
    return null;
  };
  page.steps(
    path.funnel
      .filter((stage) => stage.key !== "sold" || sales)
      .map((stage, i) => ({
        label: `${i + 1}. ${t(`connect.oosPath.stage.${stage.key}`)}`,
        value: stage.count,
        rate: stage.rate === null ? null : t("connect.oosPath.ofPrevious", { rate: stage.rate }),
        stopped:
          stage.stopped > 0
            ? {
                text: t(`connect.oosPath.stopped.${stage.key as Exclude<PathStage, "found">}`, {
                  count: n(stage.stopped),
                }),
                tone: STOPPED_TONE[stage.key],
              }
            : null,
        note: detail(stage.key),
        source: stage.key === "sold" ? ("smartup" as const) : ("bot" as const),
      })),
  );

  // What Smart Up shows for the checks' products, and the two places where it disagrees with
  // the bot.
  if (path.sales) {
    page.sub(t("connect.oosPath.soldTitle"), { rule: true, sources: ["smartup"] });
    page.text(t("connect.oosPath.salesDate", { date: formatDay(path.sales.to) }), "small");
    page.stats([
      {
        label: t("connect.oosPath.soldRate"),
        value: r.soldRate,
        format: "percent",
        note: t("connect.oosPath.soldRateNote", { sold: n(r.anySold), closed: n(r.closed) }),
      },
      { label: t("connect.oosPath.soldAll"), value: r.soldAll },
      {
        label: t("connect.oosPath.notSold"),
        value: r.notSold,
        note: t("connect.oosPath.notSoldNote", {
          nothing: n(r.noneNothing),
          other: n(r.noneOther),
        }),
        tone: r.notSold ? "warn" : null,
      },
      { label: t("connect.oosPath.open"), value: r.open, note: t("connect.oosPath.openNote") },
    ]);
    if (r.deliveredNoSale > 0)
      page.callout(
        t("connect.oosPath.mismatchDelivered", {
          count: n(r.deliveredNoSale),
          total: n(r.delivered),
        }),
        "bad",
      );
    if (r.soldAnyway > 0)
      page.callout(t("connect.oosPath.mismatchAnyway", { count: n(r.soldAnyway) }), "warn");
  } else page.text(t("connect.oosPath.noSales"), "muted");

  // Whose data the columns of a table are.
  const legend = (zone = false) =>
    page.sources([
      { label: head("step"), source: "bot" },
      ...(sales ? [{ label: head("soldRate"), source: "smartup" as const }] : []),
      ...(zone ? [{ label: head("zone"), source: "smartup" as const }] : []),
    ]);

  // Step × sold: where the chains stopped, and what Smart Up shows for each step.
  if (lead) {
    type Cross = OosPath["cross"][number];
    page.sub(t("connect.oosPath.crossTitle"), {
      rule: true,
      hint: sales ? t("connect.oosPath.crossHint") : null,
    });
    legend();
    // A delivery without a sale is red; a sale without an order or an answer is marked too.
    const unsold = (key: "noneOther" | "noneNothing"): TableColumn<Cross> => ({
      header: head(key),
      format: "count",
      source: "smartup",
      value: (x) => x[key],
      tone: (x) => (x.step === "delivered" && x[key] > 0 ? "bad" : null),
      page: { w: 6 },
    });
    page.table<Cross>({
      rows: path.cross,
      columns: [
        {
          header: head("step"),
          source: "bot",
          value: (x) => t(`connect.oosPath.step.${x.step}`),
          page: { w: 12, flex: true },
        },
        {
          header: head("checks"),
          format: "count",
          source: "bot",
          value: (x) => x.checks,
          page: { w: 5 },
        },
        ...(sales
          ? [
              {
                header: head("anySold"),
                source: "smartup" as const,
                value: (x: Cross) =>
                  x.anyRate === null ? null : `${n(x.anySold)} · ${pct(x.anyRate)}`,
                tone: (x: Cross) =>
                  (x.step === "noOrder" || x.step === "storeSilent") && x.anySold > 0
                    ? ("warn" as const)
                    : null,
                page: { w: 6, right: true },
              },
              {
                header: head("soldAll"),
                format: "count" as const,
                source: "smartup" as const,
                value: (x: Cross) => x.all,
                page: { w: 5 },
              },
              unsold("noneOther"),
              unsold("noneNothing"),
              {
                header: head("open"),
                format: "count" as const,
                source: "smartup" as const,
                value: (x: Cross) => x.open,
                page: { w: 5 },
              },
            ]
          : []),
      ],
    });
  }

  // The same numbers for every row of a table: all of them on the sheet, the chain's steps on
  // the page. A rep's unanswered orders are marked on their own table only, as on the page.
  const counts = <T extends PathRow>(reps = false): TableColumn<T>[] => {
    const shown = (w: number, at?: number) => ({ w, ...(at === undefined ? {} : { at }) });
    return [
      {
        ...of("bot", "checks"),
        value: (x) => x.checks,
        page: { ...shown(4), header: head("checks") },
      },
      {
        ...of("bot", "orders", 10),
        value: (x) => x.orders,
        page: reps ? { ...shown(4), header: head("orders") } : undefined,
      },
      {
        ...of("bot", "noOrder"),
        value: (x) => x.noOrder,
        page: reps
          ? undefined
          : {
              ...shown(5),
              header: head("noOrder"),
              format: "text",
              right: true,
              value: (x) => `${n(x.noOrder)} · ${pct(x.noOrderRate)}`,
            },
      },
      {
        ...column(`${head("noOrder")}, %`, 12, "percent"),
        source: "bot",
        value: (x) => x.noOrderRate,
      },
      { ...of("bot", "storeWaiting"), value: (x) => x.storeWaiting },
      {
        ...of("bot", "storeSilent"),
        value: (x) => x.storeSilent,
        page: reps ? undefined : { ...shown(4), header: head("storeSilent") },
      },
      { ...of("bot", "storeRefused"), value: (x) => x.storeRefused },
      {
        ...of("bot", "agentWaiting"),
        value: (x) => x.agentWaiting,
        tone: reps ? (x) => (x.agentWaiting > 0 ? "warn" : null) : undefined,
        page: { ...shown(4), header: head("agentWaiting") },
      },
      {
        ...of("bot", "agentAccepted"),
        value: (x) => x.agentAccepted,
        page: { ...shown(4), header: head("agentAccepted") },
      },
      {
        ...of("bot", "delivered"),
        value: (x) => x.delivered,
        page: { ...shown(4), header: head("delivered") },
      },
      { ...of("bot", "confirmed", 14), value: (x) => x.confirmed },
      { ...of("bot", "other"), value: (x) => x.other },
      { ...of("smartup", "closed"), value: (x) => x.closed },
      { ...of("smartup", "anySold", 14), value: (x) => x.anySold },
      {
        ...column(`${head("soldRate")}, %`, 12, "percent"),
        source: "smartup",
        value: (x) => x.soldRate,
        page: sales ? { ...shown(4, reps ? 21 : undefined), header: head("soldRate") } : undefined,
      },
      { ...of("smartup", "soldAll"), value: (x) => x.soldAll },
      { ...of("smartup", "noneOther", 16), value: (x) => x.noneOther },
      { ...of("smartup", "noneNothing", 16), value: (x) => x.noneNothing },
      { ...of("smartup", "open"), value: (x) => x.open },
      // Delivered in the bot and not sold in Smart Up: the two sources disagree.
      {
        ...column(head("deliveredNoSale"), 16, "count"),
        value: (x) => x.deliveredNoSale,
        tone: (x) => (x.deliveredNoSale > 0 ? "bad" : null),
        page: sales ? shown(5, reps ? 20 : undefined) : undefined,
      },
      { ...column(head("soldAnyway"), 18, "count"), value: (x) => x.soldAnyway },
      ...(reps && sales
        ? [
            {
              header: head("notSold"),
              sheet: false as const,
              format: "count" as const,
              value: (x: T) => x.notSold,
              page: shown(4, 22),
            },
          ]
        : []),
    ];
  };
  const first = <T>(columns: TableColumn<T>[], rest: TableColumn<T>[]) => [...columns, ...rest];

  if (lead) {
    type Group = (OosPath["byRegion"][number] | OosPath["byManager"][number]) & {
      who: "region" | "manager";
    };
    const regions: Group[] = path.byRegion.map((x) => ({ ...x, who: "region" }));
    const managers: Group[] = path.byManager.map((x) => ({ ...x, who: "manager" }));
    const label = (x: Group) =>
      "region" in x
        ? x.region === NO_VISITS_REGION
          ? t("connect.section.noVisitsRegion")
          : x.region
        : (x.title ?? t("connect.oosPath.noManager"));
    const groups = (who: "region" | "manager"): TableDef<Group> => ({
      rows: [...regions, ...managers],
      rowTone: pathRowTone,
      full: {
        name: t("connect.oosPath.sheet.groups"),
        source: "both",
        about: about("pathGroups"),
        always: true,
      },
      columns: first<Group>(
        [
          { ...column(head("who"), 14), value: (x) => t(`connect.oosPath.who.${x.who}`) },
          {
            ...column(head("name"), 30),
            value: label,
            page:
              who === "region"
                ? { w: 10, flex: true, header: t("connect.col.region") }
                : {
                    // The person first, the position under them.
                    w: 12,
                    flex: true,
                    header: t("connect.attention.manager"),
                    value: (x) => ("name" in x && x.name ? x.name : label(x)),
                    sub: (x) => ("name" in x && x.name ? label(x) : null),
                    muted: (x) => "title" in x && !x.title,
                  },
          },
          {
            ...column(t("connect.col.person"), 30),
            value: (x) => ("name" in x ? x.name : null),
          },
          { ...column(head("people"), 8, "count"), value: (x) => x.people, page: { w: 4 } },
        ],
        counts<Group>(),
      ),
    });
    // The leadership's page has the regions and the managers; a manager's page neither.
    if (level === "exec" && (regions.length > 1 || managers.length > 0)) {
      const table = (title: string, who: "region" | "manager", rows: Group[]) => {
        page.sub(title, { rule: who === "region" || regions.length <= 1 });
        legend();
        page.table(
          { ...groups(who), full: undefined },
          { rows, limit: SHOWN.pathGroups, more: "" },
        );
      };
      if (regions.length > 1) table(t("connect.oosPath.byRegion"), "region", regions);
      if (managers.length > 0) table(t("connect.oosPath.byManager"), "manager", managers);
      page.list(groups("region"));
    }

    if (path.byTsm.length > 0) {
      type Tsm = OosPath["byTsm"][number];
      page.sub(t("connect.oosPath.byTsm"), { rule: true, hint: t("connect.oosPath.byTsmHint") });
      legend();
      page.table<Tsm>(
        {
          rows: path.byTsm,
          rowTone: pathRowTone,
          full: {
            name: t("connect.oosPath.sheet.people"),
            source: "both",
            about: about("pathPeople"),
            always: true,
          },
          columns: first<Tsm>(
            [
              {
                ...column(t("connect.col.tsm"), 26),
                value: (x) => x.code || null,
                page: { w: 12, flex: true, sub: (x) => x.name },
              },
              { ...column(t("connect.col.person"), 30), value: (x) => x.name },
            ],
            counts<Tsm>(),
          ),
        },
        { limit: SHOWN.path[level] },
      );
    }
    if (path.byDr.length > 0) {
      type Rep = OosPath["byDr"][number];
      page.sub(t("connect.oosPath.byDr"), {
        rule: path.byTsm.length === 0,
        hint: t("connect.oosPath.byDrHint"),
      });
      legend(true);
      page.table<Rep>(
        {
          rows: path.byDr,
          rowTone: pathRepTone,
          full: {
            name: t("connect.oosPath.sheet.reps"),
            source: "both",
            about: about("pathReps"),
            always: true,
          },
          columns: first<Rep>(
            [
              {
                ...of("smartup", "zone", 30, "text"),
                value: (x) => x.zone ?? t("connect.oosPath.noZone"),
                page: { w: 12, flex: true, header: head("zone"), muted: (x) => !x.zone },
              },
            ],
            counts<Rep>(true),
          ),
        },
        { limit: SHOWN.path[level] },
      );
    }
  }

  // The chains to act on: the page shows them to the managers and the executors; the leadership
  // has them on the sheet.
  if (!path.stores.length) return;
  type Chain = OosPath["stores"][number];
  // A TSM's own page: every chain is theirs, so the column would repeat one code.
  const oneTsm = level === "executor" && path.byDr.length === 0 && path.byTsm.length <= 1;
  const more = (list: string[]) =>
    list.slice(0, SHOWN.pathSkus).join(", ") +
    (list.length > SHOWN.pathSkus
      ? ` ${t("connect.recovery.moreSkus", { count: list.length - SHOWN.pathSkus })}`
      : "");
  const stores: TableDef<Chain> = {
    rows: path.stores,
    rowTone: (x) => REASON_TONE[x.reason],
    full: {
      name: t("connect.oosPath.sheet.stores"),
      source: "both",
      about: about("pathStores"),
      always: true,
    },
    columns: [
      // Why the chain is in the list, in the colour of the reason.
      {
        ...column(head("reason"), 28),
        value: (x) => t(`connect.oosPath.reason.${x.reason}`),
        tone: (x) => REASON_TONE[x.reason],
        page: { w: 7, at: 1 },
      },
      {
        ...column(t("connect.col.store"), 40),
        value: (x) => x.store,
        page: { w: 9, flex: true, at: 0, sub: (x) => x.storeCode },
      },
      { ...column("ID", 12), value: (x) => x.storeCode },
      {
        ...of("bot", "check", 14, "date"),
        value: (x) => x.day,
        page: {
          w: 5,
          at: 2,
          header: head("check"),
          value: (x) => formatDay(x.day),
          sub: (x) => (oneTsm ? null : (x.code ?? "—")),
        },
      },
      { ...column(t("connect.col.tsm"), 26), value: (x) => x.code },
      { ...column(t("connect.col.person"), 30), value: (x) => x.name },
      {
        ...of("smartup", "zone", 24, "text"),
        value: (x) => x.zones.join(", ") || t("connect.oosPath.noZone"),
        page: { w: 6, at: 3, header: head("zone"), muted: (x) => !x.zones.length },
      },
      {
        ...of("bot", "out", 10),
        value: (x) => x.out.length,
        page: {
          w: 8,
          at: 4,
          header: head("out"),
          format: "text",
          bold: true,
          value: (x) => t("connect.oosPath.outCount", { count: x.out.length }),
          sub: (x) => more(x.out),
        },
      },
      {
        ...column(`${head("out")}: ${t("connect.col.skus")}`, 70),
        value: (x) => x.out.join(", "),
      },
      {
        ...of("bot", "step", 34, "text"),
        value: (x) => t(`connect.oosPath.step.${x.step}`),
        page: { w: 7, at: 5, header: head("step"), sub: (x) => x.orderNo },
      },
      { ...of("bot", "order", 14, "text"), value: (x) => x.orderNo },
      {
        ...of("smartup", "sale", 36, "text"),
        value: (x) => t(`connect.oosPath.sold.${x.sold}`),
        page: sales ? { w: 6, at: 6, header: head("sale") } : undefined,
      },
    ],
  };
  if (level === "exec") return void page.list(stores, t("connect.oosPath.storesTitle"));
  page.sub(`${t("connect.oosPath.storesTitle")} · ${n(path.stores.length)}`, {
    rule: true,
    hint: t("connect.oosPath.storesHint"),
  });
  legend(true);
  page.table(stores, { limit: SHOWN.pathStores });
}
