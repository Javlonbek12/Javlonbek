import type { ReactNode } from "react";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Building blocks of the Connect analytics pages: tiles, bars, tables and small column charts.
// Colors follow the validated chart palette (blue #2a78d6, orange #eb6834) and the status scale.

export const STAGE_COLOR: Record<string, string> = {
  delivered: "#1f9d55",
  paid: "#1f9d55",
  approved: "#2a78d6",
  inProgress: "#2a78d6",
  blocked: "#d69e2e",
  waitingBum: "#eb6834",
  waitingBdm: "#eb6834",
  noAnswer: "#d64545",
  refused: "#898781",
  rejected: "#d64545",
};

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
}: {
  label: string;
  value: string | number;
  note?: string;
  // 0..100: a thin bar under the number.
  meter?: number;
  tone?: "good" | "warn" | "bad";
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
        )}
      >
        {value}
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
  rows: { key: string; label: string; value: number; note?: string }[];
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
              style={{ width: `${(r.value / total) * 100}%`, background: STAGE_COLOR[r.key] }}
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
                style={{ background: STAGE_COLOR[r.key] }}
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

// A small column chart: one value per month, the value printed above each column.
export function MiniColumns({
  title,
  points,
  format = (n) => String(n),
  color = "#2a78d6",
}: {
  title: string;
  points: { label: string; value: number }[];
  format?: (value: number) => string;
  color?: string;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-sm font-medium">{title}</span>
      <div className="flex h-36 items-end gap-1.5 border-b">
        {points.map((p, i) => (
          <div
            key={p.label}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            title={`${p.label}: ${format(p.value)}`}
          >
            {/* With many months only the peak and the last value are printed. */}
            {(points.length <= 6 || p.value === max || i === points.length - 1) && (
              <span className="text-muted-foreground text-[10px] whitespace-nowrap tabular-nums">
                {format(p.value)}
              </span>
            )}
            <span
              className="w-full max-w-10 rounded-t"
              style={{
                height: `${p.value ? Math.max(3, (p.value / max) * 75) : 0}%`,
                background: color,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        {points.map((p) => (
          <span
            key={p.label}
            className="text-muted-foreground min-w-0 flex-1 text-center text-[10px] whitespace-nowrap"
          >
            {p.label}
          </span>
        ))}
      </div>
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

// A table that scrolls sideways on phones; long lists are cut with "and N more".
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
  return (
    <div className="flex flex-col gap-2">
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-xs">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-2 py-2 font-medium whitespace-nowrap",
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
