import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { ru } from "@/lib/i18n/ru";
import { plural } from "@/modules/reports/format";

import type { IsmBlock, paymentIssues } from "./analytics";
import type { ManagerTree, TreeNode } from "./hierarchy";
import { localizeData } from "./localize";
import { titleKey } from "./parse";
import { formatMoney, formatNumber, type ConnectReport } from "./report";
import type { ConnectRules } from "./rules";
import type { SalesSummary } from "./sales";
import { SHOWN } from "./shown";
import {
  answerColors,
  connectTone,
  deliveryColor,
  personName,
  regionTone,
  STAGE_COLOR,
  UNANSWERED_COLOR,
  visitedTone,
} from "./tone";
import {
  aggregateRows,
  MV_RESULTS,
  NO_VISITS_REGION,
  STORE_OPEN_QUESTION,
  topAnswers,
  VISIT_ISSUES,
  type RowTotals,
  type TsmRow,
  type VisitSections,
} from "./visits";
import type { Page, TableColumn, TableDef } from "./xlsx-page";
import type { CellFormat, SheetRow, Value } from "./xlsx-style";

// The blocks of «Аналитика Connect» that every level has — the visits, the stock checks and the
// orders, Market Visit, the ISM payments — and the tables by region, by employee and by position,
// as the page shows them; the lists the page cuts are sheets of their own. Known data values
// (answers, statuses, questions, equipment) are translated with localizeData.

type Col = keyof typeof ru.connect.col;
const about = (key: keyof typeof ru.connect.cover.about) => t(`connect.cover.about.${key}`);
const col = (key: Col, width = 14, format: CellFormat = "text") => ({
  header: t(`connect.col.${key}`),
  width,
  format,
});
const count = (key: Col, width = 14) => col(key, width, "count");
const share = (key: Col, width = 10) => col(key, width, "percent");
const status = (value: string | null) => localizeData(value ?? "") || t("connect.oos.noStatus");
// A share that has nothing to be a share of is a dash on the page.
const when = (has: number, value: number) => (has ? value : null);

type Region = NonNullable<ConnectReport["exec"]>["regions"][number];

// «По регионам» of the leadership's level: the two shares the page colours against the owner's
// lines, the row marked by the worse of them.
export function regionsBlock(page: Page, regions: Region[], rules: ConnectRules) {
  if (!regions.length) return;
  page.section(t("connect.section.regions"), {
    sources: ["smartup", "bot"],
    hint: t("connect.section.regionsHint"),
  });
  const number = (
    key: Col,
    value: (r: Region) => number | null,
    w: number,
    width = 10,
  ): TableColumn<Region> => ({ ...count(key, width), value, page: { w } });
  const rate = (
    key: Col,
    value: (r: Region) => number | null,
    tone?: (r: Region) => ReturnType<typeof visitedTone>,
  ): TableColumn<Region> => ({ ...share(key), value, tone, page: { w: 4 } });
  page.table<Region>(
    {
      rows: regions,
      rowTone: (r) => regionTone(r, rules),
      full: { name: t("connect.sheets.regions"), source: "both", about: about("regions") },
      columns: [
        {
          ...col("region", 20),
          value: (r) =>
            r.region === NO_VISITS_REGION ? t("connect.section.noVisitsRegion") : r.region,
          page: { w: 8, flex: true },
        },
        number("people", (r) => r.people, 3, 8),
        number("planned", (r) => r.planned, 3),
        rate(
          "visitedRate",
          (r) => r.visitedRate,
          (r) => visitedTone(r, rules),
        ),
        rate(
          "connectRate",
          (r) => r.connectRate,
          (r) => connectTone(r, rules),
        ),
        rate("withMvRate", (r) => r.withMvRate),
        rate("withOosRate", (r) => r.withOosRate),
        rate("inTimeRate", (r) => (r.timed ? r.inTimeRate : null)),
        number("otherEmployee", (r) => r.otherEmployee, 3),
        { ...count("closed", 10), value: (r) => r.closed },
        rate("mvFullRate", (r) => r.mvFullRate),
        number("oosFound", (r) => r.oosFound, 3),
        number("orders", (r) => r.orders, 3),
        { ...count("packs", 10), value: (r) => r.packs },
        { ...col("sum", 16, "money"), value: (r) => r.sum, page: { w: 5 } },
      ],
    },
    { limit: SHOWN.regions },
  );
}

// The sales cross-check per TSM or position (when sales are loaded).
const salesColumns = <T extends Pick<RowTotals, "sales" | "salesRate">>(
  sales: boolean,
  shown: boolean,
): TableColumn<T>[] =>
  sales
    ? [
        { ...count("checked", 10), value: (r) => r.sales.checked },
        { ...count("anySold", 10), value: (r) => r.sales.anySold },
        {
          ...share("salesRate", 12),
          value: (r) => when(r.sales.checked, r.salesRate),
          page: shown ? { w: 3 } : undefined,
        },
        { ...count("allSold", 10), value: (r) => r.sales.allSold },
        // «12 / 30»: two numbers in a text, on the numbers' side.
        {
          ...count("linesSold", 14),
          value: (r) => `${r.sales.linesSold} / ${r.sales.lines}`,
        },
        {
          ...count("packsSold", 14),
          value: (r) => `${r.sales.packsSold} / ${r.sales.packsOrdered}`,
        },
        { ...count("notClosed", 12), value: (r) => r.sales.notClosed },
      ]
    : [];

// One row per TSM with everything counted for them; on the page those with more visits needing
// attention come first.
export function peopleTable(rows: TsmRow[], sales: boolean): TableDef<TsmRow> {
  const rate = (
    key: Col,
    value: (r: TsmRow) => number | null,
    shown?: (r: TsmRow) => number | null,
  ): TableColumn<TsmRow> => ({
    ...share(key),
    value,
    page: shown ? { w: 3, value: shown } : undefined,
  });
  const number = (key: Col, value: (r: TsmRow) => number, w = 0): TableColumn<TsmRow> => ({
    ...count(key, 10),
    value,
    page: w ? { w } : undefined,
  });
  return {
    rows,
    full: {
      name: t("connect.sheets.people"),
      source: "both",
      about: about("people"),
      always: true,
    },
    columns: [
      {
        ...col("tsm", 26),
        value: (r) => r.code,
        page: { w: 6, flex: true, sub: (r) => r.name },
      },
      { ...col("person", 30), value: (r) => r.name },
      { ...col("zone", 18), value: (r) => r.zone, page: { w: 4 } },
      { ...col("region", 16), value: (r) => r.region },
      number("planned", (r) => r.planned, 2),
      rate(
        "visitedRate",
        (r) => r.visitedRate,
        (r) => when(r.planned, r.visitedRate),
      ),
      rate("connectRate", (r) => r.connectRate),
      rate(
        "withMvRate",
        (r) => r.withMvRate,
        (r) => when(r.visited, r.withMvRate),
      ),
      rate(
        "withOosRate",
        (r) => r.withOosRate,
        (r) => when(r.visited, r.withOosRate),
      ),
      rate(
        "inTimeRate",
        (r) => (r.timed ? r.inTimeRate : null),
        (r) => when(r.timed, r.inTimeRate),
      ),
      number("otherEmployee", (r) => r.otherEmployee, 2),
      number("closed", (r) => r.closed),
      { ...count("attention", 10), value: (r) => r.attention, page: { w: 2, bold: true } },
      rate(
        "mvFullRate",
        (r) => r.mvFullRate,
        (r) => when(r.mvOpen, r.mvFullRate),
      ),
      number("problems", (r) => r.problems, 2),
      number("oosFound", (r) => r.oosFound, 2),
      number("orders", (r) => r.orders, 2),
      number("packs", (r) => r.packs, 2),
      { ...col("sum", 16, "money"), value: (r) => r.sum, page: { w: 4 } },
      ...salesColumns<TsmRow>(sales, true),
      {
        ...col("statuses", 60),
        value: (r) => r.statuses.map((s) => `${status(s.status)}: ${s.count}`).join("; "),
        page: {
          w: 6,
          value: (r) => r.statuses.map((s) => `${status(s.status)}: ${s.count}`).join("\n"),
        },
      },
    ],
  };
}

// A table of TSMs as a block of a manager's page.
export function peopleBlock(
  page: Page,
  rows: TsmRow[],
  all: TableDef<TsmRow>,
  title: string,
  hint: string,
) {
  page.section(title, { sources: ["smartup", "bot"], hint });
  const sorted = [...rows].sort(
    (a, b) => b.attention - a.attention || b.planned - a.planned || a.code.localeCompare(b.code),
  );
  page.table({ ...all, full: undefined }, { rows: sorted, limit: SHOWN.people, more: "" });
  page.list(all);
}

// A position of the managers' tree as a row: its place, who holds it, the numbers under it.
type Line = {
  depth: number;
  title: string;
  person: Value;
  roles: Value;
  // On the page, under the title: who holds the position and how many TSMs are under it.
  sub: string | null;
  totals: RowTotals | null;
  tsms: number;
};

// The managers' tree: on the sheet each position indented under the one above it, with the
// numbers of the TSMs under it, and the positions without TSMs (the distributor's staff) after
// them; on the page the rows it shows before anything is opened — the top positions, what is
// directly under them, and a single position under another.
export function treeBlock(page: Page, tree: ManagerTree, sales: boolean, people: TableDef<TsmRow>) {
  page.section(t("connect.manager.tree"), {
    sources: ["smartup", "bot"],
    hint: t("connect.manager.treeHint"),
  });
  if (!tree.roots.length && !tree.idle.length)
    return void page.text(t("connect.manager.noRows"), "muted");
  const holders = (n: TreeNode) =>
    n.people.length
      ? n.people.map((p) => p.name ?? t("connect.manager.vacant")).join("; ")
      : t("connect.manager.noRow");
  const position = (n: TreeNode, counted: boolean): Line => ({
    depth: n.depth,
    title: n.title,
    person: holders(n),
    roles: n.people.flatMap((p) => p.roles).join(", ") || null,
    sub: [
      n.people.length
        ? n.people
            .map((p) =>
              [p.name ?? t("connect.manager.vacant"), p.roles.join(", ")]
                .filter(Boolean)
                .join(" · "),
            )
            .join("\n")
        : t("connect.manager.noRow"),
      counted && n.tsms > 0 ? t("connect.manager.tsmCount", { count: n.tsms }) : null,
    ]
      .filter(Boolean)
      .join("\n"),
    totals: n.totals,
    tsms: n.tsms,
  });
  // A TSM code of a position with positions under it: its own row.
  const own = (r: TsmRow, depth: number): Line => ({
    depth,
    title: r.code,
    person: r.name,
    roles: null,
    sub: r.name,
    totals: aggregateRows([r]),
    tsms: 1,
  });

  // Every position, for the sheet.
  const all: Line[] = [];
  const walk = (n: TreeNode) => {
    all.push(position(n, false));
    if (n.children.length || n.own.length > 1) for (const r of n.own) all.push(own(r, n.depth + 1));
    n.children.forEach(walk);
  };
  tree.roots.forEach(walk);
  const counted = all.length;
  tree.idle.forEach(walk);

  // What the page shows before a position is opened.
  const shown: Line[] = [];
  const show = (n: TreeNode, open: boolean) => {
    const [single] = n.own;
    const code = single && n.own.length === 1 && titleKey(single.code) === n.key;
    if (!n.children.length && (code || !n.own.length)) return void shown.push(position(n, false));
    shown.push(position(n, true));
    if (!open) return;
    for (const r of n.own) shown.push(own(r, n.depth + 1));
    n.children.forEach((child) => show(child, n.children.length === 1));
  };
  tree.roots.forEach((n) => show(n, true));

  const number = (
    key: Col,
    value: (r: RowTotals) => number | null,
    w: number,
    shownAs?: (r: RowTotals) => number | null,
  ): TableColumn<Line> => ({
    ...(key.endsWith("Rate") ? share(key) : count(key, 10)),
    value: (x) => (x.totals ? value(x.totals) : null),
    // A position without TSMs has no numbers; a share with nothing to be a share of is a dash.
    page: {
      w,
      blank: true,
      value: (x) => (x.totals ? ((shownAs ?? value)(x.totals) ?? "—") : null),
    },
  });
  const columns: TableColumn<Line>[] = [
    {
      ...col("position", 40),
      value: (x) => x.title,
      page: { w: 12, flex: true, bold: true, sub: (x) => x.sub },
    },
    { ...col("person", 30), value: (x) => x.person },
    { ...col("roles", 26), value: (x) => x.roles },
    { ...count("people", 8), value: (x) => x.tsms || null },
    number("planned", (r) => r.planned, 3),
    number(
      "visitedRate",
      (r) => r.visitedRate,
      3,
      (r) => when(r.planned, r.visitedRate),
    ),
    number(
      "connectRate",
      (r) => r.connectRate,
      3,
      (r) => when(r.visited, r.connectRate),
    ),
    number(
      "inTimeRate",
      (r) => (r.timed ? r.inTimeRate : null),
      3,
      (r) => when(r.timed, r.inTimeRate),
    ),
    number(
      "mvFullRate",
      (r) => r.mvFullRate,
      3,
      (r) => when(r.mvOpen, r.mvFullRate),
    ),
    number("oosFound", (r) => r.oosFound, 3),
    number("orders", (r) => r.orders, 3),
    number("packs", (r) => r.packs, 3),
    {
      ...col("sum", 16, "money"),
      value: (x) => x.totals?.sum ?? null,
      page: { w: 5, blank: true },
    },
    ...salesColumns<RowTotals>(sales, true).map((column): TableColumn<Line> => ({
      header: column.header,
      width: column.width,
      format: column.format,
      value: (x) => (x.totals ? column.value(x.totals) : null),
      page: column.page && {
        w: column.page.w,
        blank: true,
        value: (x: Line) => (x.totals ? (column.value(x.totals) ?? "—") : null),
      },
    })),
  ];
  const sheetRow = (x: Line): SheetRow => ({
    // A position without TSMs has its name, its people and nothing counted.
    cells: columns
      .filter((column) => column.sheet !== false)
      .slice(0, x.totals ? undefined : 4)
      .map((column) => column.value(x)),
    indent: Math.min(x.depth, 15),
    bold: x.tsms > 1 || (!x.totals && x.depth === 0),
  });
  const table: TableDef<Line> = {
    rows: all,
    indent: (x) => Math.min(x.depth, 8),
    columns,
    full: {
      name: t("connect.sheets.tree"),
      source: "both",
      about: about("tree"),
      always: true,
      rows: [
        ...all.slice(0, counted).map(sheetRow),
        ...(all.length > counted
          ? [[], { cells: [t("connect.manager.idle")], kind: "title" as const }]
          : []),
        ...all.slice(counted).map(sheetRow),
      ],
    },
  };
  if (shown.length) page.table({ ...table, full: undefined }, { rows: shown, limit: 1000 });
  else page.text(t("connect.manager.noRows"), "muted");
  if (all.length > counted) {
    // The page keeps them closed: how many, and what they are.
    page.sub(`${t("connect.manager.idle")} · ${all.length - counted}`, {
      level: 4,
      hint: t("connect.manager.idleHint"),
    });
  }
  page.list(table);
  page.list(people, t("connect.manager.people"));
}

// --- The three sections ----------------------------------------------------------------------

const pct = (value: number) => `${value}%`;

// «Визиты (Smart Up) и Connect Bot». `extra`: a level's own lists under the numbers.
export function visitsBlock(page: Page, v: VisitSections["visits"], extra?: () => void) {
  page.section(t("connect.section.visits"), {
    sources: ["smartup", "bot"],
    hint: t("connect.section.visitsHint"),
  });
  page.stats([
    { label: t("connect.visits.planned"), value: v.planned },
    {
      label: t("connect.visits.visited"),
      value: v.visited,
      note: t("connect.visits.visitedNote", { rate: v.visitedRate }),
    },
    {
      label: t("connect.visits.notVisited"),
      value: v.notVisited,
      tone: v.notVisited ? "warn" : null,
    },
    {
      label: t("connect.visits.unplanned"),
      value: v.unplanned,
      note: t("connect.visits.unplannedNote", { count: v.unplannedWithConnect }),
    },
  ]);
  page.sub(t("connect.visits.ofVisited"));
  // Visits read from the route analysis have no time to check against.
  const timed = v.timed > 0 || !v.withConnect;
  page.stats([
    {
      label: t("connect.visits.withMv"),
      value: v.withMvRate,
      format: "percent",
      note: formatNumber(v.withMv),
    },
    {
      label: t("connect.visits.withOos"),
      value: v.withOosRate,
      format: "percent",
      note: formatNumber(v.withOos),
    },
    { label: t("connect.visits.both"), value: v.both },
    {
      label: t("connect.visits.inTime"),
      value: timed ? v.inTimeRate : null,
      format: "percent",
      note: t(timed ? "connect.visits.inTimeNote" : "connect.routes.noTimes"),
    },
    {
      label: t("connect.visits.otherEmployee"),
      value: v.otherEmployee,
      note: pct(v.otherRate),
      tone: v.otherEmployee ? "warn" : null,
    },
    { label: t("connect.visits.closed"), value: v.closed },
    { label: t("connect.visits.mvWithoutVisit"), value: v.mvWithoutVisit },
    {
      label: t("connect.visits.duplicates"),
      value: v.mvCopiesRemoved + v.oosCopiesRemoved,
      note: [
        t("connect.visits.mvCopies", {
          copies: plural("connect.words.copies", v.mvCopiesRemoved),
          days: formatNumber(v.mvDuplicateDays),
        }),
        t("connect.visits.oosCopies", {
          copies: plural("connect.words.copies", v.oosCopiesRemoved),
          days: formatNumber(v.oosDuplicateDays),
        }),
      ].join("; "),
    },
  ]);
  page.split(
    () => {
      page.sub(t("connect.visits.statuses"));
      page.stages(
        (["ok", ...VISIT_ISSUES] as const).map((s) => ({
          label: t(`connect.status.${s}`),
          value: v.status[s],
          color: STAGE_COLOR[s]!,
          note: v.visited ? pct(Math.round((v.status[s] / v.visited) * 100)) : null,
        })),
      );
    },
    () => {
      if (!v.days.length) return;
      page.sub(t("connect.visits.byDay"));
      page.days(
        v.days.map((d) => ({
          label: formatDay(d.day),
          values: [d.planned, d.visited, d.withConnect],
        })),
        [
          { label: t("connect.visits.legend.planned"), color: "#c9c7bf" },
          { label: t("connect.visits.legend.visited"), color: "#2a78d6" },
          { label: t("connect.visits.legend.withConnect"), color: "#1f9d55" },
        ],
      );
    },
  );
  extra?.();
}

// «Автосток (OOS) и заказы». `extra`: the blocks a level adds to the section (the orders, the
// recovery of stock, the distributor's orders).
export function oosBlock(page: Page, o: VisitSections["oos"], extra?: () => void) {
  page.section(t("connect.section.oos"), {
    sources: ["bot"],
    hint: t("connect.section.oosHint"),
  });
  page.stats([
    { label: t("connect.oos.checked"), value: o.checked, note: t("connect.oos.checkedNote") },
    {
      label: t("connect.oos.withGap"),
      value: o.withGap,
      note: t("connect.oos.withGapNote", { rate: o.gapRate }),
    },
    {
      label: t("connect.oos.ledToOrder"),
      value: o.orderRate,
      format: "percent",
      note: t("connect.oos.ledToOrderNote", { count: formatNumber(o.withGap) }),
    },
    { label: t("connect.oos.orders"), value: o.orders },
    { label: t("connect.oos.packs"), value: o.packs },
    { label: t("connect.oos.sum"), value: o.sum, format: "money" },
  ]);
  page.split(
    () => {
      page.sub(t("connect.oos.byStatus"));
      page.stages(
        o.byStatus.map((s) => ({
          label: status(s.status),
          value: s.count,
          note: `${t("connect.packs", { count: formatNumber(s.packs) })} · ${formatMoney(s.sum)}`,
          color: deliveryColor(s.status)!,
        })),
      );
    },
    () => {
      if (!o.topSkus.length) return;
      page.sub(t("connect.oos.topSkus"));
      page.bars(
        o.topSkus.map((s) => ({
          label: s.sku,
          value: s.total,
          note: t("connect.oos.topSkusNote", { rate: s.rate }),
        })),
        { color: "#eb6834" },
      );
    },
  );
  if (o.sales) salesBlock(page, o.sales);
  extra?.();
}

// «Продажи после заказа (3 дня)»: were the products of each auto-stock order sold to that store
// from the order day to the third day after it.
function salesBlock(page: Page, s: SalesSummary) {
  page.sub(t("connect.oos.salesTitle"), { rule: true, sources: ["bot", "smartup"] });
  // How far the sales are loaded: an order's three days may not be over yet.
  page.text(t("connect.oos.salesDate", { date: formatDay(s.to) }), "small");
  page.text(t("connect.oos.salesHint"), "small");
  if (s.orders === 0) return void page.text(t("connect.oos.salesNone"), "muted");
  page.stats([
    {
      label: t("connect.oos.salesChecked"),
      value: s.checked,
      note: s.notClosed
        ? t("connect.oos.salesNotClosed", { count: formatNumber(s.notClosed) })
        : null,
    },
    {
      label: t("connect.oos.salesAny"),
      value: s.anyRate,
      format: "percent",
      note: formatNumber(s.anySold),
    },
    {
      label: t("connect.oos.salesAll"),
      value: s.allRate,
      format: "percent",
      note: `${formatNumber(s.allSold)} · ${t("connect.oos.salesAllNote")}`,
    },
    {
      label: t("connect.oos.salesLines"),
      value: s.linesRate,
      format: "percent",
      note: t("connect.oos.salesOf", {
        sold: formatNumber(s.linesSold),
        total: formatNumber(s.lines),
      }),
    },
    {
      label: t("connect.oos.salesPacks"),
      value: s.packsRate,
      format: "percent",
      note: t("connect.oos.salesPacksNote", {
        sold: formatNumber(s.packsSold),
        total: formatNumber(s.packsOrdered),
        raw: formatNumber(s.packsSoldRaw),
      }),
    },
  ]);
  type Row = SalesSummary["byStatus"][number];
  if (s.byStatus.length > 0) {
    page.sub(t("connect.oos.salesByStatus"), { level: 4 });
    // «12 · 34%» and «12 / 30»: two numbers in a text, on the numbers' side.
    const both = (key: "anySold" | "allSold", rate: "anyRate" | "allRate"): TableColumn<Row> => ({
      ...count(key, 16),
      value: (r) => (r.checked ? `${formatNumber(r[key])} · ${pct(r[rate])}` : null),
      page: { w: 6, right: true, format: "text" },
    });
    page.table<Row>({
      rows: s.byStatus,
      // The statuses are few: a sheet only if the page ever cuts them.
      full: {
        name: t("connect.oos.salesByStatus"),
        source: "both",
        about: about("salesStatuses"),
      },
      columns: [
        {
          ...col("status", 44),
          value: (r) => status(r.status),
          color: (r) => deliveryColor(r.status),
          page: { w: 14, flex: true },
        },
        { ...count("checked", 12), value: (r) => r.checked, page: { w: 5 } },
        both("anySold", "anyRate"),
        both("allSold", "allRate"),
        {
          ...count("linesSold", 16),
          value: (r) => `${formatNumber(r.linesSold)} / ${formatNumber(r.lines)}`,
          page: { w: 6, right: true, format: "text" },
        },
        {
          ...count("packsSold", 16),
          value: (r) => `${formatNumber(r.packsSold)} / ${formatNumber(r.packsOrdered)}`,
          page: { w: 6, right: true, format: "text" },
        },
        { ...count("notClosed", 12), value: (r) => r.notClosed, page: { w: 5 } },
      ],
    });
  }
  if (s.topUnsold.length > 0)
    // Half the block's width, as on the page.
    page.split(
      () => {
        page.sub(t("connect.oos.salesTopUnsold"), { level: 4 });
        page.bars(
          s.topUnsold.map((x) => ({
            label: x.sku,
            value: x.unsold,
            note: t("connect.oos.salesTopUnsoldNote", { count: formatNumber(x.ordered) }),
          })),
          { color: "#d69e2e" },
        );
      },
      () => {},
    );
}

// «Market Visit». `extra`: a level's own list under the questions.
export function mvBlock(page: Page, m: VisitSections["mv"], extra?: () => void) {
  page.section(t("connect.section.mv"), { sources: ["bot"], hint: t("connect.section.mvHint") });
  page.stats([
    { label: t("connect.mv.unique"), value: m.unique },
    {
      label: t("connect.mv.fullRate"),
      value: m.fullRate,
      format: "percent",
      note: t("connect.mv.fullRateNote"),
    },
    { label: t("connect.mv.problems"), value: m.problems },
  ]);
  type Equipment = VisitSections["mv"]["equipment"][number];
  const equipment: TableDef<Equipment> = {
    rows: m.equipment,
    full: { name: t("connect.sheets.equipment"), source: "bot", about: about("equipment") },
    columns: [
      { ...col("value", 50), value: (e) => localizeData(e.type) },
      { ...count("count"), value: (e) => e.count },
    ],
  };
  page.split(
    () => {
      page.sub(t("connect.mv.results"));
      page.stages(
        MV_RESULTS.map((r) => ({
          label: t(`connect.result.${r}`),
          value: m.results[r],
          color: STAGE_COLOR[r]!,
        })),
      );
    },
    () => {
      if (!m.equipment.length) return;
      page.sub(t("connect.mv.equipment"));
      page.bars(
        m.equipment
          .slice(0, SHOWN.equipment)
          .map((e) => ({ label: localizeData(e.type), value: e.count })),
      );
      // The page shows the most frequent types; every type is on the sheet.
      if (m.equipment.length > SHOWN.equipment) page.list(equipment);
    },
  );
  if (m.questions.length > 0) {
    page.sub(t("connect.mv.questions"), { hint: t("connect.mv.questionsHint") });
    let cut = false;
    for (const q of m.questions) {
      const top = topAnswers(q.answers);
      if (top.other) cut = true;
      page.gap(4);
      // A question's share of problem answers, in amber as on the page.
      page.rich([
        { text: localizeData(q.q) },
        ...(q.q !== STORE_OPEN_QUESTION && q.problems > 0
          ? [
              {
                text: ` · ${t("connect.mv.problemShare", { rate: q.problemRate })}`,
                tone: "warn" as const,
              },
            ]
          : []),
      ]);
      page.answers(
        answerColors([
          ...top.shown.map((a) => ({
            key: a.value,
            label: localizeData(a.value),
            value: a.count,
          })),
          ...(top.other
            ? [
                {
                  key: "+",
                  label: t("connect.mv.otherAnswers", { count: top.otherKinds }),
                  value: top.other,
                  color: UNANSWERED_COLOR,
                },
              ]
            : []),
          ...(q.unanswered
            ? [
                {
                  key: "-",
                  label: t("connect.mv.unanswered"),
                  value: q.unanswered,
                  color: UNANSWERED_COLOR,
                },
              ]
            : []),
        ]),
      );
    }
    // The page sums up the rare answers of a question; every answer is on the sheet.
    if (cut) {
      type Answer = {
        q: string;
        answer: string;
        count: number;
        rate: number | null;
        problem: boolean;
      };
      const answers: Answer[] = m.questions.flatMap((q) => [
        ...q.answers.map((a, i) => ({
          q: localizeData(q.q),
          answer: localizeData(a.value),
          count: a.count,
          // A question's share of problem answers is on its first row.
          rate: i === 0 ? q.problemRate : null,
          problem: i === 0 && q.q !== STORE_OPEN_QUESTION && q.problems > 0,
        })),
        ...(q.unanswered
          ? [
              {
                q: localizeData(q.q),
                answer: t("connect.mv.unanswered"),
                count: q.unanswered,
                rate: null,
                problem: false,
              },
            ]
          : []),
      ]);
      page.gap(4);
      page.list<Answer>({
        rows: answers,
        full: { name: t("connect.sheets.questions"), source: "bot", about: about("questions") },
        columns: [
          { ...col("question", 70), value: (x) => x.q },
          { ...col("answer", 28), value: (x) => x.answer },
          { ...count("count"), value: (x) => x.count },
          {
            ...col("problemRate", 14, "percent"),
            value: (x) => x.rate,
            tone: (x) => (x.problem ? "warn" : null),
            paint: "text",
          },
        ],
      });
    }
  }
  extra?.();
}

// --- «Оплаты ISM» ----------------------------------------------------------------------------

// Built from the bot's payment requests, by months. The leadership sees the money by stage,
// managers what waits for a decision, a TSM what to see through.
export function ismBlock(
  page: Page,
  input: {
    level: "exec" | "manager" | "executor";
    months: string;
    block?: IsmBlock;
    issues?: ReturnType<typeof paymentIssues>;
  },
) {
  const { level, months, block, issues } = input;
  const hint = t("connect.section.ismHint", { months });
  if (level === "executor" ? !issues?.length : !block?.requests) {
    page.section(t("connect.section.ism"), { sources: ["bot"], hint });
    page.text(level === "executor" ? t("connect.manager.noRows") : t("connect.ism.none"), "muted");
    return;
  }
  if (level === "executor") {
    type Issue = ReturnType<typeof paymentIssues>[number];
    page.section(t("connect.ism.issues"), {
      sources: ["bot"],
      nav: false,
      hint: `${hint} ${t("connect.ism.issuesHint")}`,
    });
    page.table<Issue>({
      rows: issues!,
      full: {
        name: `${t("connect.sheets.ism")} ${months}`,
        source: "bot",
        about: about("ismIssues"),
        always: true,
      },
      columns: [
        {
          ...col("store", 40),
          value: (p) => p.store,
          page: {
            w: 16,
            flex: true,
            sub: (p) => [formatDay(p.day), p.city].filter(Boolean).join(" · "),
          },
        },
        { ...col("city", 16), value: (p) => p.city },
        { ...col("date", 12, "date"), value: (p) => p.day },
        {
          ...col("stage", 24),
          value: (p) => t(`connect.paymentStage.${p.stage}`),
          color: (p) => STAGE_COLOR[p.stage],
          page: {
            w: 18,
            sub: (p) =>
              [
                localizeData(p.note),
                p.failed.length
                  ? t("connect.ism.failed", {
                      list: p.failed.map((x) => localizeData(x)).join("; "),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join("\n") || null,
          },
        },
        {
          ...col("status", 40),
          value: (p) =>
            [p.note, ...p.failed]
              .map((x) => localizeData(x))
              .filter(Boolean)
              .join("; ") || null,
        },
        { ...col("sum", 14, "money"), value: (p) => p.sum, page: { w: 6 } },
      ],
    });
    return;
  }
  const b = block!;
  type Waiting = IsmBlock["waitingList"][number];
  // What waits for a decision, the oldest first.
  const waiting: TableDef<Waiting> = {
    rows: b.waitingList,
    full: {
      name: t("connect.sheets.ismWaiting"),
      source: "bot",
      about: about("ism"),
      always: true,
    },
    columns: [
      {
        ...col("store", 40),
        value: (p) => p.store,
        page: { w: 12, flex: true, sub: (p) => p.city },
      },
      {
        ...col("person", 28),
        value: (p) => p.person,
        page: {
          w: 10,
          value: (p) => personName(p.person).name,
          sub: (p) => personName(p.person).role,
        },
      },
      {
        ...col("stage", 24),
        value: (p) => t(`connect.paymentStage.${p.stage}`),
        color: (p) => STAGE_COLOR[p.stage],
        page: { w: 8 },
      },
      {
        ...col("decider", 30),
        value: (p) => p.decider,
        page: {
          w: 10,
          value: (p) => personName(p.decider).name,
          sub: (p) => personName(p.decider).role,
        },
      },
      { ...col("sum", 16, "money"), value: (p) => p.sum, page: { w: 5 } },
      { ...count("days", 10), value: (p) => p.days, page: { w: 3 } },
    ],
  };
  // The checklist's points answered «no» most often, the share of them as a bar.
  const fails = () => {
    if (!b.checklistFails.length) return;
    page.sub(t("connect.ism.checklist"));
    page.bars(
      b.checklistFails.map((f) => ({
        label: localizeData(f.q),
        value: f.rate,
        note: `${f.no}/${f.total}`,
      })),
      { format: "percent", stacked: true, color: "#d69e2e" },
    );
  };
  page.section(t("connect.section.ism"), { sources: ["bot"], hint });
  if (level === "manager") {
    page.sub(t("connect.ism.waiting"), { hint: t("connect.ism.waitingHint") });
    page.table(waiting, { limit: SHOWN.ismWaiting });
    fails();
    return;
  }
  page.stats([
    {
      label: t("connect.kpi.contractSum"),
      value: b.contractSum,
      format: "money",
      note: `${t("connect.kpi.requests")}: ${formatNumber(b.requests)}`,
    },
    {
      label: t("connect.kpi.paidSum"),
      value: b.paidSum,
      format: "money",
      note: t("connect.kpi.paidRate", { rate: b.paidRate }),
    },
    {
      label: t("connect.kpi.waitingSum"),
      value: b.waitingSum,
      format: "money",
      note: plural("connect.words.requests", b.waiting),
      tone: b.waiting ? "warn" : null,
    },
    {
      label: t("connect.kpi.checklist"),
      value: b.checklist,
      format: "percent",
      note: t("connect.kpi.roiPositive", { rate: b.roiPositive }),
    },
  ]);
  // The leadership's page has the money by stage; the requests behind «ждут решения» are a list.
  page.list(waiting, t("connect.ism.waiting"));
  page.split(() => {
    page.sub(t("connect.ism.stages"));
    page.stages(
      b.stages.map((s) => ({
        label: t(`connect.paymentStage.${s.id}`),
        value: s.value,
        color: STAGE_COLOR[s.id]!,
        note: s.sum ? formatMoney(s.sum) : null,
      })),
    );
  }, fails);
}

// --- One TSM's own lists ---------------------------------------------------------------------

type Detail = NonNullable<ConnectReport["executor"]>["detail"];

// A list the page keeps closed until it is asked for: its name with the count, and the sheet.
function closed<T>(page: Page, title: string, table: TableDef<T>, hint?: string) {
  if (!table.rows.length) return;
  page.sub(`${title} · ${table.rows.length}`, { level: 4, hint });
  page.list(table);
}

// Under the visits' numbers: the visits where not everything was done in Connect, then the
// stores not visited, the questionnaires without a visit and the duplicates.
export function visitLists(page: Page, d: Detail) {
  type Visit = Detail["attention"][number];
  const issues = (a: Visit) => [
    ...a.issues.map((i) => ({ text: t(`connect.status.${i}`), color: STAGE_COLOR[i] })),
    ...(a.result && a.result !== "full" && a.result !== "closed"
      ? [
          {
            text: `${t("connect.section.mv")}: ${t(`connect.result.${a.result}`)}`,
            color: STAGE_COLOR[a.result],
          },
        ]
      : []),
    ...(a.closed ? [{ text: t("connect.status.closed"), color: "#616978" }] : []),
    ...(a.by ? [{ text: t("connect.executor.byOther", { person: a.by }), color: "#616978" }] : []),
  ];
  page.sub(`${t("connect.executor.attention")} · ${d.attention.length}`, {
    hint: t("connect.executor.attentionHint"),
  });
  if (!d.attention.length) page.text(t("connect.executor.allDone"));
  else
    page.table<Visit>(
      {
        rows: d.attention,
        full: {
          name: t("connect.sheets.attention"),
          source: "both",
          about: about("attention"),
          always: true,
        },
        columns: [
          {
            ...col("store", 40),
            value: (a) => a.store,
            page: { w: 16, flex: true, sub: (a) => `${formatDay(a.day)} · ${a.storeCode}` },
          },
          { ...col("date", 12, "date"), value: (a) => a.day },
          { ...col("smartUp", 14), value: (a) => a.smartUp, page: { w: 6 } },
          {
            ...col("mv", 8),
            value: (a) => a.mvAt,
            page: {
              w: 7,
              header: t("connect.col.connect"),
              lines: (a) => [
                { text: `${t("connect.col.mv")}: ${a.mvAt ?? "—"}` },
                { text: `${t("connect.col.oos")}: ${a.oosAt ?? "—"}` },
              ],
            },
          },
          { ...col("oos", 8), value: (a) => a.oosAt },
          {
            ...col("issue", 60),
            value: (a) =>
              issues(a)
                .map((issue) => issue.text)
                .join("; "),
            page: { w: 18, lines: issues },
          },
        ],
      },
      { limit: SHOWN.own },
    );
  closed<Detail["notVisited"][number]>(page, t("connect.executor.notVisited"), {
    rows: d.notVisited,
    full: {
      name: t("connect.sheets.notVisited"),
      source: "both",
      about: about("notVisited"),
      always: true,
    },
    columns: [
      { ...col("store", 40), value: (n) => n.store },
      { ...col("date", 12, "date"), value: (n) => n.day },
    ],
  });
  closed<Detail["withoutVisit"][number]>(page, t("connect.executor.withoutVisit"), {
    rows: d.withoutVisit,
    full: {
      name: t("connect.sheets.withoutVisit"),
      source: "both",
      about: about("withoutVisit"),
      always: true,
    },
    columns: [
      { ...col("store", 40), value: (w) => w.store },
      { ...col("date", 12, "date"), value: (w) => w.day },
      { ...col("time", 8), value: (w) => w.at },
    ],
  });
  closed<Detail["duplicates"][number]>(
    page,
    t("connect.executor.duplicates"),
    {
      rows: d.duplicates,
      full: {
        name: t("connect.sheets.duplicates"),
        source: "both",
        about: about("duplicates"),
        always: true,
      },
      columns: [
        { ...col("store", 40), value: (w) => w.store },
        { ...col("date", 12, "date"), value: (w) => w.day },
        { ...count("mv", 8), value: (w) => w.mv || null },
        { ...count("oos", 8), value: (w) => w.oos || null },
      ],
    },
    t("connect.executor.duplicatesHint"),
  );
}

// Under the stock checks' numbers: the TSM's orders, and those with nothing sold after them.
export function orderLists(page: Page, d: Detail, sales: boolean) {
  type Order = Detail["orders"][number];
  if (d.orders.length > 0) {
    page.sub(`${t("connect.executor.orders")} · ${d.orders.length}`);
    page.table<Order>(
      {
        rows: d.orders,
        full: {
          name: t("connect.sheets.orders"),
          source: "bot",
          about: about("orders"),
          always: true,
        },
        columns: [
          { ...col("order", 14), value: (o) => o.id },
          {
            ...col("store", 40),
            value: (o) => o.store,
            page: { w: 18, flex: true, sub: (o) => `${formatDay(o.day)} · ${o.id}` },
          },
          { ...col("date", 12, "date"), value: (o) => o.day },
          // A delivery status as the bot writes it, in the colour of its stage.
          {
            ...col("status", 40),
            value: (o) => localizeData(o.status),
            color: (o) => deliveryColor(o.status ?? ""),
            page: { w: 16, value: (o) => status(o.status) },
          },
          { ...count("packs"), value: (o) => o.packs, page: { w: 5 } },
          { ...col("sum", 14, "money"), value: (o) => o.sum, page: { w: 6, format: "count" } },
        ],
      },
      { limit: SHOWN.own },
    );
  }
  if (!sales) return;
  closed<Detail["unsold"][number]>(
    page,
    t("connect.executor.unsold"),
    {
      rows: d.unsold,
      full: {
        name: t("connect.sheets.unsold"),
        source: "both",
        about: about("unsold"),
        always: true,
      },
      columns: [
        { ...col("order", 14), value: (o) => o.id },
        { ...col("store", 40), value: (o) => o.store },
        { ...col("date", 12, "date"), value: (o) => o.day },
        {
          ...col("status", 40),
          value: (o) => localizeData(o.status),
          color: (o) => deliveryColor(o.status ?? ""),
        },
        { ...col("skus", 80), value: (o) => o.skus.join(", ") },
      ],
    },
    t("connect.executor.unsoldHint"),
  );
}

// Under the questionnaires' numbers: the stores with problem answers.
export function problemList(page: Page, d: Detail) {
  type Problem = Detail["problems"][number];
  if (!d.problems.length) return;
  page.sub(`${t("connect.executor.problems")} · ${d.problems.length}`);
  page.table<Problem>(
    {
      rows: d.problems,
      full: {
        name: t("connect.sheets.problems"),
        source: "bot",
        about: about("problems"),
        always: true,
      },
      columns: [
        {
          ...col("store", 40),
          value: (p) => p.store,
          page: { w: 16, flex: true, sub: (p) => formatDay(p.day) },
        },
        { ...col("date", 12, "date"), value: (p) => p.day },
        {
          ...col("problems", 90),
          value: (p) => p.problems.map((x) => localizeData(x)).join("; "),
          page: { w: 30, value: (p) => p.problems.map((x) => localizeData(x)).join("\n") },
        },
      ],
    },
    { limit: SHOWN.own },
  );
}
