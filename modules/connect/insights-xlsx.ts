import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { ru } from "@/lib/i18n/ru";

import { attentionRules, type AttentionReason, type AttentionRow } from "./attention";
import type { ConnectInsights } from "./insights";
import type { FollowUps, Recovery } from "./recovery";
import { formatNumber } from "./report";
import { SHOWN } from "./shown";
import type { WorstList } from "./worst";
import type { Page, TableColumn, TableDef } from "./xlsx-page";
import type { CellFormat } from "./xlsx-style";

const reasonText = (reason: AttentionReason) =>
  t(`connect.attention.reason.${reason.kind}`, { value: reason.value, of: reason.of ?? "" });
const about = (key: keyof typeof ru.connect.cover.about) => t(`connect.cover.about.${key}`);
const column = (header: string, width = 14, format: CellFormat = "text") => ({
  header,
  width,
  format,
});

// «Требует внимания» at the top of the leadership's and the managers' levels: who to talk to and
// about what, the most reasons first. The page's first ten; the whole list is a sheet.
export function attentionBlock(page: Page, insights: ConnectInsights | null | undefined) {
  const rows = insights?.attention;
  if (!insights || !rows) return;
  const R = attentionRules(insights.rules);
  const hint = t("connect.attention.hint", {
    connect: R.connect.below,
    recovery: R.recovery.below,
    followUp: R.followUp.below,
    unsold: R.unsold.from,
  });
  const title = t("connect.attention.title");
  page.section(rows.length ? `${title} · ${rows.length}` : title, {
    sources: ["smartup", "bot"],
    nav: title,
    hint: insights.attendance
      ? `${hint} ${t("connect.attention.hintAttendance", { attendance: R.attendance.below })}`
      : hint,
  });
  // Nobody on the list is good news: the page writes it in green.
  if (!rows.length) return void page.text(t("connect.attention.none"), "good");
  const table: TableDef<AttentionRow> = {
    rows,
    full: {
      name: t("connect.attention.sheet"),
      source: "both",
      about: about("attentionList"),
      always: true,
    },
    columns: [
      {
        ...column(t("connect.col.tsm"), 26),
        value: (x) => x.code,
        page: { w: 12, sub: (x) => x.name },
      },
      { ...column(t("connect.col.person"), 30), value: (x) => x.name },
      {
        ...column(t("connect.attention.manager"), 30),
        value: (x) => x.manager?.name ?? null,
        // The person first, the position under them.
        page: {
          w: 12,
          value: (x) => (x.manager ? (x.manager.name ?? x.manager.title) : null),
          sub: (x) => (x.manager?.name ? x.manager.title : null),
        },
      },
      { ...column(t("connect.col.position"), 30), value: (x) => x.manager?.title ?? null },
      {
        ...column(t("connect.attention.count"), 10, "count"),
        value: (x) => x.reasons.length,
      },
      // What to talk about, in amber as on the page (a reason a line).
      {
        ...column(t("connect.attention.reasons"), 100),
        value: (x) => x.reasons.map(reasonText).join("; "),
        tone: () => "warn",
        paint: "text",
        page: { w: 24, flex: true, value: (x) => x.reasons.map(reasonText).join("\n") },
      },
    ],
  };
  page.table(table, { limit: SHOWN.attention });
}

// «Худшие результаты»: the five lowest numbers of each kind next to each other, each list a card
// outlined by its worst row.
export function worstBlock(page: Page, lists: WorstList[]) {
  const shown = lists.filter((list) => list.rows.length > 0);
  if (!shown.length) return;
  page.section(t("connect.worst.title"), {
    sources: ["smartup", "bot"],
    hint: t("connect.worst.hint"),
  });
  page.cards(
    shown.map((list) => ({
      title: list.title,
      norm: list.norm,
      rows: list.rows.slice(0, SHOWN.worst),
    })),
  );
}

type RecoveryCol = keyof typeof ru.connect.recovery.col;
const head = (key: RecoveryCol) => t(`connect.recovery.col.${key}`);

// The product names shown next to their number; the whole list is on the sheet.
const skus = (list: string[], shown: number) =>
  list.length
    ? list.slice(0, shown).join(", ") +
      (list.length > shown
        ? ` ${t("connect.recovery.moreSkus", { count: list.length - shown })}`
        : "")
    : null;

// «Восстановление наличия» inside «Автосток (OOS) и заказы»: did the products that were out come
// back by the store's last check of the period. `own`: the executors' level — one TSM's numbers
// and stores, without the tables by employee and product.
export function recoveryBlock(page: Page, data: Recovery, own: boolean) {
  const r = data.totals;
  const title = t("connect.recovery.title");
  page.sub(title, { rule: true, sources: ["bot"], hint: t("connect.recovery.hint"), nav: title });
  page.text(t(`connect.recovery.baseNote.${data.baseline}`), "small");
  // The page's switch, as what is chosen.
  page.text(
    `${t("connect.recovery.baseLabel")}: ${t(`connect.recovery.base.${data.baseline}`)}`,
    "small",
  );
  if (r.stores === 0) return void page.text(t("connect.recovery.none"), "muted");
  page.stats([
    {
      label: t("connect.recovery.compared"),
      value: r.stores,
      note: t("connect.recovery.comparedNote"),
    },
    {
      label: t("connect.recovery.rate"),
      value: r.rate,
      format: "percent",
      note: t("connect.recovery.rateNote", {
        restored: formatNumber(r.restored),
        total: formatNumber(r.wasOut),
      }),
    },
    {
      label: t("connect.recovery.stillOut"),
      value: r.stillOut,
      note: t("connect.recovery.stillOutNote"),
      tone: r.stillOut ? "warn" : null,
    },
    {
      label: t("connect.recovery.newlyOut"),
      value: r.newlyOut,
      note: t("connect.recovery.newlyOutNote"),
    },
    { label: t("connect.recovery.worse"), value: r.worse, note: t("connect.recovery.worseNote") },
  ]);
  if (!own) {
    type Tsm = Recovery["byTsm"][number];
    type Sku = Recovery["bySku"][number];
    const count = <T>(key: RecoveryCol, value: (x: T) => number, w?: number): TableColumn<T> => ({
      ...column(
        head(key),
        key === "stillOut" || key === "newlyOut" || key === "worse" ? 12 : 10,
        "count",
      ),
      value,
      page: w ? { w } : undefined,
    });
    const byTsm: TableDef<Tsm> = {
      rows: data.byTsm,
      full: {
        name: t("connect.recovery.sheet.people"),
        source: "bot",
        about: about("recoveryPeople"),
        always: true,
      },
      columns: [
        {
          ...column(t("connect.col.tsm"), 26),
          value: (x) => x.code || null,
          page: { w: 8, flex: true, sub: (x) => x.name },
        },
        { ...column(t("connect.col.person"), 30), value: (x) => x.name },
        count("stores", (x) => x.stores, 3),
        count("wasOut", (x) => x.wasOut),
        count("restored", (x) => x.restored),
        {
          ...column(`${head("rate")}, %`, 16, "percent"),
          value: (x) => x.rate,
          page: { w: 4, header: head("rate") },
        },
        count("stillOut", (x) => x.stillOut, 4),
        count("newlyOut", (x) => x.newlyOut, 4),
        count("worse", (x) => x.worse),
      ],
    };
    const bySku: TableDef<Sku> = {
      rows: data.bySku,
      full: {
        name: t("connect.recovery.sheet.skus"),
        source: "bot",
        about: about("recoverySkus"),
        always: true,
      },
      columns: [
        {
          ...column(t("connect.col.sku"), 34),
          value: (x) => x.sku,
          page: { w: 10, flex: true },
        },
        count("wasOut", (x) => x.wasOut, 4),
        count("restored", (x) => x.restored, 4),
        count("stillOut", (x) => x.stillOut),
        {
          ...column(`${head("rate")}, %`, 16, "percent"),
          value: (x) => x.rate,
          page: { w: 4, header: head("rate") },
        },
      ],
    };
    page.split(
      () => {
        page.sub(t("connect.recovery.byTsm"), { level: 4 });
        // The line the hint of the table next to it takes: the two tables start level.
        page.text("", "small");
        page.table(byTsm, { limit: SHOWN.recovery });
      },
      () => {
        page.sub(t("connect.recovery.bySku"), {
          level: 4,
          hint: t("connect.recovery.bySkuHint"),
        });
        page.table(bySku, { limit: SHOWN.recovery });
      },
    );
  }
  if (!data.stores.length) return;
  type Store = Recovery["stores"][number];
  // How many products and which: «8» and under it «A, B, C… и ещё 5».
  const out = (key: "stillOut" | "newlyOut", w: number): TableColumn<Store>[] => [
    {
      ...column(head(key), 10, "count"),
      value: (x) => x[key].length,
      page: {
        w,
        format: "text",
        bold: true,
        value: (x) => (x[key].length ? String(x[key].length) : null),
        sub: (x) => skus(x[key], SHOWN.recoverySkus),
      },
    },
    {
      ...column(`${head(key)}: ${t("connect.col.skus")}`, key === "stillOut" ? 70 : 50),
      value: (x) => x[key].join(", ") || null,
    },
  ];
  const stores: TableDef<Store> = {
    rows: data.stores,
    full: {
      name: t("connect.recovery.sheet.stores"),
      source: "bot",
      about: about("recoveryStores"),
      always: true,
    },
    columns: [
      {
        ...column(t("connect.col.store"), 40),
        value: (x) => x.store,
        page: { w: 11, flex: true, sub: (x) => x.storeCode },
      },
      { ...column("ID", 12), value: (x) => x.storeCode },
      {
        ...column(t("connect.col.tsm"), 26),
        value: (x) => x.code,
        page: own ? undefined : { w: 7 },
      },
      {
        ...column(head("baseDay"), 16, "date"),
        value: (x) => x.baseDay,
        page: {
          w: 7,
          header: head("checks"),
          value: (x) => `${formatDay(x.baseDay)} → ${formatDay(x.lastDay)}`,
          sub: (x) => t("connect.recovery.daysShort", { count: x.days }),
        },
      },
      { ...column(head("lastDay"), 16, "date"), value: (x) => x.lastDay },
      { ...column(head("days"), 10, "count"), value: (x) => x.days },
      ...out("stillOut", 13),
      ...out("newlyOut", 10),
    ],
  };
  page.sub(`${t("connect.recovery.storesTitle")} · ${formatNumber(data.stores.length)}`, {
    level: 4,
    hint: t("connect.recovery.storesHint"),
  });
  page.table(stores, { limit: SHOWN.recoveryStores });
}

// «Заказ дистрибьютора после OOS (3 дня)»: after a check found a product out, did a distributor's
// rep visit the store with an order on that day or within the next three.
export function followUpBlock(page: Page, data: FollowUps) {
  const f = data.totals;
  page.sub(t("connect.recovery.followTitle"), { rule: true, sources: ["bot", "smartup"] });
  if (data.routesTo)
    page.text(t("connect.recovery.routesDate", { date: formatDay(data.routesTo) }), "small");
  page.text(t("connect.recovery.followHint"), "small");
  if (f.checks + f.open === 0) return void page.text(t("connect.recovery.followEmpty"), "muted");
  const missed = f.checks - f.followed;
  page.stats([
    {
      label: t("connect.recovery.followChecks"),
      value: f.checks,
      note: f.open ? t("connect.recovery.followOpen", { count: formatNumber(f.open) }) : null,
    },
    {
      label: t("connect.recovery.followRate"),
      value: f.rate,
      format: "percent",
      note: t("connect.recovery.followRateNote", {
        followed: formatNumber(f.followed),
        checks: formatNumber(f.checks),
      }),
    },
    {
      label: t("connect.recovery.followMissed"),
      value: missed,
      tone: missed ? "warn" : null,
    },
  ]);
  // One list for the sheet — the reps' zones, then the TSMs; the page shows them as two tables.
  type Row = { who: "dr" | "tsm"; code: string; name: string | null } & Pick<
    FollowUps["byTsm"][number],
    "checks" | "followed" | "rate"
  >;
  const reps: Row[] = data.byDr.map((x) => ({ ...x, who: "dr", code: x.zone, name: null }));
  const tsms: Row[] = data.byTsm.map((x) => ({ ...x, who: "tsm" }));
  const table = (first: string): TableDef<Row> => ({
    rows: [...reps, ...tsms],
    full: {
      name: t("connect.recovery.sheet.follow"),
      source: "both",
      about: about("follow"),
      always: true,
    },
    columns: [
      {
        ...column(head("who"), 8),
        value: (x) => t(x.who === "dr" ? "connect.recovery.whoDr" : "connect.recovery.whoTsm"),
      },
      {
        ...column(`${head("zone")} / ${t("connect.col.tsm")}`, 28),
        value: (x) => x.code,
        page: { w: 9, flex: true, header: first, sub: (x) => x.name },
      },
      { ...column(t("connect.col.person"), 30), value: (x) => x.name },
      { ...column(head("counted"), 16, "count"), value: (x) => x.checks, page: { w: 4 } },
      { ...column(head("followed"), 16, "count"), value: (x) => x.followed, page: { w: 5 } },
      {
        ...column(`${head("followRate")}, %`, 10, "percent"),
        value: (x) => x.rate,
        page: { w: 3, header: head("followRate") },
      },
    ],
  });
  if (!reps.length && !tsms.length) return;
  const block = (title: string, first: string, rows: Row[]) => () => {
    if (!rows.length) return;
    page.sub(title, { level: 4 });
    page.table({ ...table(first), full: undefined }, { rows, limit: SHOWN.followUp, more: "" });
  };
  const blocks = [
    block(t("connect.recovery.byDr"), head("zone"), reps),
    block(t("connect.recovery.byTsmFollow"), t("connect.col.tsm"), tsms),
  ];
  page.split(reps.length ? blocks[0]! : blocks[1]!, reps.length ? blocks[1]! : () => {});
  page.list(table(""));
}
