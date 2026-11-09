import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { t } from "@/lib/i18n";
import { flattenTree, type ManagerTree, type TreeNode } from "@/modules/connect/hierarchy";
import { titleKey } from "@/modules/connect/parse";
import { formatMoney, formatNumber } from "@/modules/connect/report";
import { aggregateRows, type RowTotals, type TsmRow } from "@/modules/connect/visits";

import { FilterSelect } from "./filter-select";

const pct = (value: number) => `${value}%`;

// `width`: the column on wider screens, rem (money needs more).
type Metric = { key: string; header: string; cell: (r: RowTotals) => string; width?: number };

const metrics = (sales: boolean): Metric[] => [
  { key: "planned", header: t("connect.col.planned"), cell: (r) => formatNumber(r.planned) },
  {
    key: "visited",
    header: t("connect.col.visitedRate"),
    cell: (r) => (r.planned ? pct(r.visitedRate) : "—"),
  },
  {
    key: "connect",
    header: t("connect.col.connectRate"),
    cell: (r) => (r.visited ? pct(r.connectRate) : "—"),
  },
  {
    key: "inTime",
    header: t("connect.col.inTimeRate"),
    cell: (r) => (r.withConnect ? pct(r.inTimeRate) : "—"),
  },
  {
    key: "full",
    header: t("connect.col.mvFullRate"),
    cell: (r) => (r.mvOpen ? pct(r.mvFullRate) : "—"),
  },
  { key: "oosFound", header: t("connect.col.oosFound"), cell: (r) => formatNumber(r.oosFound) },
  { key: "orders", header: t("connect.col.orders"), cell: (r) => formatNumber(r.orders) },
  { key: "packs", header: t("connect.col.packs"), cell: (r) => formatNumber(r.packs) },
  { key: "sum", header: t("connect.col.sum"), cell: (r) => formatMoney(r.sum), width: 7 },
  ...(sales
    ? [
        {
          key: "sales",
          header: t("connect.col.salesRate"),
          width: 5.5,
          cell: (r: RowTotals) => (r.sales.checked ? pct(r.salesRate) : "—"),
        },
      ]
    : []),
];

type PositionLink = {
  action: (form: FormData) => Promise<void>;
  users: { id: string; name: string }[];
  links: Record<string, string>;
  back: string;
};

type Props = {
  personHref: (code: string) => string;
  columns: Metric[];
  link?: PositionLink;
};

// The managers' level by the employee info: each position with its person and the numbers of the
// TSMs under it, as rows that open (top positions open, a single position under another opens
// too). On wider screens the numbers stand in columns under one header; on phones under the name.
// The owner and managers link a position to a person in the app («Сотрудник в приложении»): that
// person then sees every TSM under it. Positions without TSMs (the distributor's staff) are at the
// end, closed.
export function ManagerTreeView({
  tree,
  sales,
  personHref,
  link,
}: {
  tree: ManagerTree;
  sales: boolean;
  personHref: (code: string) => string;
  link?: PositionLink;
}) {
  const columns = metrics(sales);
  const props: Props = { personHref, columns, link };
  const idle = flattenTree(tree.idle).length;
  // One column template for the header and every row: the name, then each number.
  const widths = columns.map((c) => c.width ?? 4.5);
  const layout = {
    "--tree-cols": `minmax(14rem, 1fr) ${widths.map((w) => `${w}rem`).join(" ")}`,
    "--tree-min": `${14 + widths.reduce((a, b) => a + b, 0)}rem`,
  } as CSSProperties;
  return (
    // `relative`: the column names kept for screen readers (absolutely placed) stay inside the
    // scrolling box instead of widening the page.
    <div className="relative -mx-1 overflow-x-auto px-1">
      <div
        className="flex min-w-0 flex-col text-sm [--indent:0.75rem] md:min-w-(--tree-min) md:[--indent:1.25rem]"
        style={layout}
      >
        <div className={`${GRID} text-muted-foreground hidden border-b pb-2 text-xs md:grid`}>
          <span>{t("connect.col.position")}</span>
          {columns.map((c) => (
            <span key={c.key} className="px-2 text-right">
              {c.header}
            </span>
          ))}
        </div>
        {tree.roots.map((node) => (
          <Node key={node.key} node={node} open {...props} />
        ))}
        {idle > 0 && (
          <details className="mt-3 rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t("connect.manager.idle")} · {idle}
            </summary>
            <p className="text-muted-foreground mt-1 mb-2 text-xs">
              {t("connect.manager.idleHint")}
            </p>
            {tree.idle.map((node) => (
              <Node key={node.key} node={node} open={false} {...props} />
            ))}
          </details>
        )}
      </div>
    </div>
  );
}

const GRID = "gap-x-0 md:grid-cols-(--tree-cols) md:items-start";

const indent = (depth: number) => ({ paddingLeft: `calc(${depth} * var(--indent))` });

function Node({ node, open, ...props }: Props & { node: TreeNode; open: boolean }) {
  const [single] = node.own;
  const code =
    single && node.own.length === 1 && titleKey(single.code) === node.key ? single.code : null;
  // A TSM's own position (or a position without TSMs): one row, the code opens the TSM's list.
  if (!node.children.length && (code || !node.own.length)) {
    return (
      <Row
        depth={node.depth}
        title={
          code ? (
            <Link
              href={props.personHref(code)}
              className="text-primary underline underline-offset-2"
            >
              {node.title}
            </Link>
          ) : (
            node.title
          )
        }
        sub={<People node={node} />}
        totals={node.totals}
        columns={props.columns}
      />
    );
  }
  return (
    <details open={open} className="border-b last:border-b-0">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <RowCells
          depth={node.depth}
          chevron
          title={node.title}
          sub={
            <>
              <People node={node} />
              {node.tsms > 0 && <span>{t("connect.manager.tsmCount", { count: node.tsms })}</span>}
            </>
          }
          totals={node.totals}
          columns={props.columns}
        />
      </summary>
      {props.link && <LinkForm node={node} link={props.link} />}
      {node.own.map((row) => (
        <OwnRow key={row.code} row={row} depth={node.depth + 1} {...props} />
      ))}
      {node.children.map((child) => (
        <Node key={child.key} node={child} open={node.children.length === 1} {...props} />
      ))}
    </details>
  );
}

// A TSM code that belongs to a position with positions under it (its own visits).
function OwnRow({ row, depth, ...props }: Props & { row: TsmRow; depth: number }) {
  return (
    <Row
      depth={depth}
      title={
        <Link
          href={props.personHref(row.code)}
          className="text-primary underline underline-offset-2"
        >
          {row.code}
        </Link>
      }
      sub={row.name}
      totals={aggregateRows([row])}
      columns={props.columns}
    />
  );
}

function Row(props: {
  depth: number;
  title: ReactNode;
  sub: ReactNode;
  totals: RowTotals | null;
  columns: Metric[];
}) {
  return (
    <div className="border-b last:border-b-0">
      <RowCells {...props} chevron={false} />
    </div>
  );
}

function RowCells({
  depth,
  chevron,
  title,
  sub,
  totals,
  columns,
}: {
  depth: number;
  chevron: boolean;
  title: ReactNode;
  sub: ReactNode;
  totals: RowTotals | null;
  columns: Metric[];
}) {
  return (
    <div className={`${GRID} grid gap-y-1.5 py-2`}>
      <div className="flex min-w-0 items-start gap-1" style={indent(depth)}>
        {chevron ? (
          <ChevronRight className="text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform [[open]>summary_&]:rotate-90" />
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="font-medium break-words">{title}</span>
          {sub && (
            <span className="text-muted-foreground flex flex-col text-xs break-words">{sub}</span>
          )}
        </span>
      </div>
      {totals && (
        <dl
          className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3 md:contents md:text-sm"
          style={indent(depth + 1)}
        >
          {columns.map((c) => (
            <div key={c.key} className="flex min-w-0 justify-between gap-2 md:block md:px-2">
              <dt className="text-muted-foreground md:sr-only">{c.header}</dt>
              <dd className="text-right whitespace-nowrap tabular-nums">{c.cell(totals)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// Who holds the position and their roles; a manager title without a row of its own says so.
function People({ node }: { node: TreeNode }) {
  if (!node.people.length) return <span>{t("connect.manager.noRow")}</span>;
  return (
    <>
      {node.people.map((p, i) => (
        <span key={i}>
          {[p.name ?? t("connect.manager.vacant"), p.roles.join(", ")].filter(Boolean).join(" · ")}
        </span>
      ))}
    </>
  );
}

function LinkForm({ node, link }: { node: TreeNode; link: PositionLink }) {
  const current = Object.entries(link.links).find(([title]) => titleKey(title) === node.key)?.[1];
  return (
    <form
      action={link.action}
      className="flex flex-wrap items-center gap-2 pb-2 text-xs"
      style={indent(node.depth + 1)}
    >
      <input type="hidden" name="title" value={node.title} />
      <input type="hidden" name="back" value={link.back} />
      <label className="text-muted-foreground flex flex-wrap items-center gap-2">
        {t("connect.executor.linkLabel")}
        <FilterSelect
          name="userId"
          defaultValue={current ?? ""}
          className="h-8 w-auto max-w-60 text-xs"
        >
          <option value="">{t("connect.executor.notLinked")}</option>
          {link.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </FilterSelect>
      </label>
    </form>
  );
}
