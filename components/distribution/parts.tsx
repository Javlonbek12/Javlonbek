import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import type { ReactNode } from "react";

import { intlLocale, t, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Finding } from "@/modules/distribution/compute";

// Building blocks of the POSM distribution pages.

export const fmt = (value: number) =>
  new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1 }).format(value);
export const pct = (value: number) =>
  new Intl.NumberFormat(intlLocale(), { style: "percent", maximumFractionDigits: 0 }).format(value);

// A wide table: scrolls sideways, the first column stays in place.
export function Matrix({
  head,
  rows,
  foot,
  dense = false,
  text = [],
}: {
  head: ReactNode[];
  rows: { key: string; cells: ReactNode[]; muted?: boolean }[];
  foot?: ReactNode[];
  dense?: boolean;
  // Columns (besides the first) that hold text: aligned left.
  text?: number[];
}) {
  const cell = (i: number) =>
    cn(
      dense ? "px-2 py-1.5" : "px-2.5 py-2",
      i === 0
        ? "bg-card sticky left-0 z-[1] max-w-[16rem] min-w-[10rem] text-left"
        : text.includes(i)
          ? "text-left"
          : "text-right whitespace-nowrap tabular-nums",
    );
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
            {head.map((h, i) => (
              <th key={i} className={cn(cell(i), "align-bottom font-medium")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={cn("border-b last:border-b-0", row.muted && "text-muted-foreground")}
            >
              {row.cells.map((c, i) => (
                <td key={i} className={cell(i)}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="border-t-2 font-semibold">
              {foot.map((c, i) => (
                <td key={i} className={cell(i)}>
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// A number that is 0 is shown quietly.
export function N({ value, tone }: { value: number; tone?: "good" | "bad" }) {
  if (value === 0) return <span className="text-muted-foreground/60">0</span>;
  return (
    <span
      className={cn(
        tone === "bad" && "text-red-600 dark:text-red-400",
        tone === "good" && "text-emerald-700 dark:text-emerald-400",
      )}
    >
      {fmt(value)}
    </span>
  );
}

// + surplus / − deficit.
export function Balance({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "font-medium",
        value < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400",
      )}
    >
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {fmt(Math.abs(value))}
    </span>
  );
}

const ICON = { bad: OctagonAlert, warn: AlertTriangle, info: Info };
const ICON_COLOR = {
  bad: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-[#2a78d6]",
};

export function Findings({ items }: { items: Finding[] }) {
  return (
    <ul className="flex flex-col gap-2.5 text-sm">
      {items.map((f, i) => {
        const Icon = ICON[f.tone];
        return (
          <li key={i} className="flex gap-2.5">
            <Icon className={cn("mt-0.5 size-4 shrink-0", ICON_COLOR[f.tone])} />
            <span className="leading-snug">
              {t(`dist.findings.${f.key}` as TranslationKey, f.params)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
