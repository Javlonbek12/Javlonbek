import type { ReactNode } from "react";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Building blocks of the Connect analytics pages: tiles, bars, tables and small column charts.
// Colors follow the validated chart palette (blue #2a78d6, orange #eb6834) and the status scale.

// Red is kept for errors and overdue items: a store that didn't answer or a rejected payment is
// a warning (amber / orange), not an error.
export const STAGE_COLOR: Record<string, string> = {
  delivered: "#1f9d55",
  paid: "#1f9d55",
  approved: "#2a78d6",
  inProgress: "#2a78d6",
  blocked: "#d69e2e",
  waitingBum: "#eb6834",
  waitingBdm: "#eb6834",
  noAnswer: "#d69e2e",
  refused: "#898781",
  rejected: "#898781",
  // Smart Up visits and Market Visit results.
  ok: "#1f9d55",
  noMv: "#eb6834",
  noOos: "#d69e2e",
  notInTime: "#b7791f",
  otherEmployee: "#8a6fd1",
  closed: "#b8b6ae",
  full: "#1f9d55",
  partial: "#d69e2e",
  noPhoto: "#eb6834",
  partialNoPhoto: "#b7791f",
  skipped: "#898781",
};

// A list of numbers with labels, without boxes inside the section's card.
export function StatGrid({
  items,
}: {
  items: {
    key: string;
    label: string;
    value: string | number;
    note?: string;
    tone?: "warn" | "good";
  }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.key} className="flex min-w-0 flex-col border-l-2 pl-3">
          <dt className="text-muted-foreground text-xs">{item.label}</dt>
          <dd
            className={cn(
              "font-display text-xl font-semibold tabular-nums",
              item.tone === "warn" && "text-amber-600 dark:text-amber-400",
              item.tone === "good" && "text-emerald-700 dark:text-emerald-400",
            )}
          >
            {item.value}
          </dd>
          {item.note && <dd className="text-muted-foreground text-xs">{item.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

// Grouped columns per day (plan, visited, with Connect), the legend under them.
export function DayBars({
  days,
  series,
}: {
  days: { key: string; label: string; values: number[] }[];
  series: { label: string; color: string }[];
}) {
  const max = Math.max(1, ...days.flatMap((d) => d.values));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex h-36 items-end gap-2 border-b">
        {days.map((d) => (
          <div
            key={d.key}
            className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5"
            title={`${d.label}: ${d.values.map((v, i) => `${series[i]?.label} ${v}`).join(" · ")}`}
          >
            {d.values.map((v, i) => (
              <span
                key={i}
                className="w-full max-w-4 rounded-t"
                style={{
                  height: `${v ? Math.max(2, (v / max) * 100) : 0}%`,
                  background: series[i]?.color,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {days.map((d) => (
          <span
            key={d.key}
            className="text-muted-foreground min-w-0 flex-1 truncate text-center text-[10px]"
          >
            {d.label}
          </span>
        ))}
      </div>
      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Answer values of a question in one bar: «Да» blue, «Нет» orange, the others in turn, not
// answered grey.
const YES_NO: Record<string, string> = { Да: "#2a78d6", Нет: "#eb6834" };
const OTHER_ANSWERS = ["#1f9d55", "#8a6fd1", "#d69e2e", "#0f9b8e"];
export const UNANSWERED_COLOR = "#d4d2ca";

export function AnswerBar({
  parts,
}: {
  parts: { key: string; label: string; value: number; color?: string }[];
}) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return null;
  let other = 0;
  const colored = parts.map((p) => ({
    ...p,
    color: p.color ?? YES_NO[p.key] ?? OTHER_ANSWERS[other++ % OTHER_ANSWERS.length]!,
  }));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-3 overflow-hidden rounded-full">
        {colored
          .filter((p) => p.value)
          .map((p) => (
            <span
              key={p.key}
              className="border-card h-full border-r last:border-r-0"
              style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
              title={`${p.label}: ${p.value}`}
            />
          ))}
      </div>
      <ul className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        {colored.map((p) => (
          <li key={p.key} className="flex items-center gap-1">
            <span className="size-2 rounded-sm" style={{ background: p.color }} />
            {p.label} <span className="text-foreground tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Section({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0 gap-3", className)}>
      <CardTitle>{title}</CardTitle>
      {hint && <CardDescription>{hint}</CardDescription>}
      {children}
    </Card>
  );
}

export function Kpi({
  label,
  value,
  note,
  meter,
  tone,
  compare,
  trend,
}: {
  label: string;
  value: string | number;
  note?: string;
  // Next to the number: the change against the previous period (see trend.tsx).
  trend?: ReactNode;
  // 0..100: a thin bar under the number.
  meter?: number;
  tone?: "good" | "warn" | "bad";
  // Against the previous period: «к прошлому месяцу: ▲ 2 п.п. (было 79%)».
  compare?: { text: string; trend: "better" | "worse" | "same" };
}) {
  return (
    <Card className="gap-1 p-4 md:p-5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span
        className={cn(
          "font-display font-semibold tabular-nums",
          // Money ("427,9 млн сум") is long: a smaller size keeps it on one line.
          String(value).length > 8 ? "text-lg md:text-xl" : "text-2xl md:text-3xl",
          tone === "bad" && "text-red-600 dark:text-red-400",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "good" && "text-emerald-700 dark:text-emerald-400",
          trend && "flex flex-wrap items-baseline gap-x-2",
        )}
      >
        {value}
        {trend}
      </span>
      {meter !== undefined && (
        <span className="bg-muted h-1.5 overflow-hidden rounded-full">
          <span
            className="block h-full rounded-full bg-[#2a78d6]"
            style={{ width: `${Math.max(0, Math.min(100, meter))}%` }}
          />
        </span>
      )}
      {note && <span className="text-muted-foreground text-xs">{note}</span>}
      {compare && (
        <span
          className={cn(
            "text-xs",
            compare.trend === "better" && "text-emerald-700 dark:text-emerald-400",
            // Worse is amber: red is kept for overdue items and errors.
            compare.trend === "worse" && "text-amber-700 dark:text-amber-400",
            compare.trend === "same" && "text-muted-foreground",
          )}
        >
          {compare.text}
        </span>
      )}
    </Card>
  );
}

// Horizontal bars with a label and a value; `color` per row or one for all.
export function BarList({
  rows,
  format = (n) => String(n),
  stacked = false,
}: {
  rows: { key: string; label: string; value: number; color?: string; note?: string }[];
  format?: (value: number) => string;
  // Long labels (questions): the label on its own line above the bar.
  stacked?: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (stacked)
    return (
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-col gap-1 text-sm">
            <span className="leading-snug">{r.label}</span>
            <span className="flex items-center gap-3">
              <span className="bg-muted/60 h-3 flex-1 rounded-full">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${r.value ? Math.max(2, (r.value / max) * 100) : 0}%`,
                    background: r.color ?? "#2a78d6",
                  }}
                />
              </span>
              <span className="text-right whitespace-nowrap tabular-nums">
                <span className="font-semibold">{format(r.value)}</span>
                {r.note && <span className="text-muted-foreground"> · {r.note}</span>}
              </span>
            </span>
          </li>
        ))}
      </ul>
    );
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto]"
          title={`${r.label}: ${format(r.value)}`}
        >
          <span className="truncate">{r.label}</span>
          <span className="bg-muted/60 h-3 rounded-full">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${r.value ? Math.max(2, (r.value / max) * 100) : 0}%`,
                background: r.color ?? "#2a78d6",
              }}
            />
          </span>
          <span className="text-right whitespace-nowrap tabular-nums">
            <span className="font-semibold">{format(r.value)}</span>
            {r.note && <span className="text-muted-foreground"> · {r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// One stacked bar of stages with a legend under it.
export function StageBar({
  rows,
}: {
  // `color` when the key is not a known stage (an order's delivery status as the bot writes it).
  rows: { key: string; label: string; value: number; note?: string; color?: string }[];
}) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (!total) return <p className="text-muted-foreground text-sm">{t("connect.manager.noRows")}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-5 overflow-hidden rounded-full">
        {rows
          .filter((r) => r.value)
          .map((r) => (
            <div
              key={r.key}
              className="border-card h-full border-r-2 last:border-r-0"
              style={{
                width: `${(r.value / total) * 100}%`,
                background: r.color ?? STAGE_COLOR[r.key],
              }}
              title={`${r.label}: ${r.value}`}
            />
          ))}
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: r.color ?? STAGE_COLOR[r.key] }}
              />
              <span className="truncate">{r.label}</span>
            </span>
            <span className="text-right whitespace-nowrap tabular-nums">
              <span className="font-semibold">{r.value}</span>
              {r.note && <span className="text-muted-foreground"> · {r.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  numeric?: boolean;
  className?: string;
};

// A table on wider screens and one card per row on phones (the first column is the card's
// heading, the rest are «label: value» lines), so nothing scrolls sideways; long lists are cut
// with "and N more".
export function DataTable<T>({
  rows,
  columns,
  limit = 50,
  rowKey,
}: {
  rows: T[];
  columns: Column<T>[];
  limit?: number;
  rowKey: (row: T) => string;
}) {
  if (!rows.length)
    return <p className="text-muted-foreground text-sm">{t("connect.manager.noRows")}</p>;
  const [head, ...rest] = columns;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.slice(0, limit).map((row) => (
          <li key={rowKey(row)} className="flex flex-col gap-1.5 rounded-xl border p-3 text-sm">
            {head && <div className="font-medium">{head.cell(row)}</div>}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
              {rest.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-muted-foreground">{c.header}</dt>
                  <dd className={cn("min-w-0 break-words", c.numeric && "tabular-nums")}>
                    {c.cell(row)}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <div className="-mx-1 hidden overflow-x-auto px-1 md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-xs">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    // Headers wrap («Другой / сотр.»): a wide table still fits its card.
                    "px-2 py-2 align-bottom font-medium",
                    c.numeric && "text-right",
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row) => (
              <tr key={rowKey(row)} className="border-b last:border-b-0">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-2 py-2 align-top",
                      c.numeric && "text-right whitespace-nowrap tabular-nums",
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <span className="text-muted-foreground text-xs">
          {t("connect.more", { count: rows.length - limit })}
        </span>
      )}
    </div>
  );
}

// The bot writes people as "TSM_TASH_12 - Name": the name first, the position under it.
const POSITION = /_|^(tsm|bdm|bum|dr|senior|junior|marketing|performance|express|trade)\b/i;

export function PersonName({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const [role = "", ...rest] = value.split(" - ");
  if (!rest.length || !POSITION.test(role)) return <span>{value}</span>;
  return (
    <span className="flex flex-col">
      <span>{rest.join(" - ")}</span>
      <span className="text-muted-foreground text-xs">{role}</span>
    </span>
  );
}
