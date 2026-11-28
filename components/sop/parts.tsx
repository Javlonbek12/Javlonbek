import Link from "next/link";
import type { ReactNode } from "react";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Severity } from "@/modules/sop/findings";

// Building blocks of the «S&OP» pages: tiles, marks, the scrolling table. Colour never stands
// alone: a red cell always has its number, a mark always its word.

export type Tone = "good" | "warn" | "bad";

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
};

export const TONE_CELL: Record<Tone, string> = {
  good: "bg-emerald-500/15 text-emerald-900 dark:text-emerald-200",
  warn: "bg-amber-400/25 text-amber-900 dark:text-amber-200",
  bad: "bg-red-500/20 text-red-900 dark:text-red-200",
};

const SEVERITY_TONE: Record<Severity, string> = {
  error: "bg-red-500/15 text-red-800 dark:text-red-200",
  risk: "bg-amber-400/25 text-amber-900 dark:text-amber-200",
  note: "bg-muted text-muted-foreground",
};

export function SeverityMark({ severity, count }: { severity: Severity; count?: number }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        SEVERITY_TONE[severity],
      )}
    >
      {t(count === undefined ? `sop.severityOne.${severity}` : `sop.severity.${severity}`)}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </span>
  );
}

// A small grey word next to a name: a status of the sheet, «заморожен», «неликвид».
export function Chip({
  children,
  tone,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tone ? TONE_CELL[tone] : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export type TileItem = {
  key: string;
  label: string;
  value: string;
  note?: ReactNode;
  tone?: Tone;
  href?: string;
};

// The headline numbers of a page.
export function Tiles({ items }: { items: TileItem[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-7">
      {items.map((item) => {
        const body = (
          <>
            <dt className="text-muted-foreground text-xs">{item.label}</dt>
            <dd
              className={cn(
                "font-display text-2xl font-semibold tabular-nums",
                item.tone && TONE_TEXT[item.tone],
              )}
            >
              {item.value}
            </dd>
            {item.note && <dd className="text-muted-foreground text-xs">{item.note}</dd>}
          </>
        );
        const box = cn(
          "bg-card shadow-card border-border/80 flex min-w-0 flex-col gap-0.5 rounded-2xl border p-4",
          item.tone === "bad" && "border-l-4 border-l-red-500",
          item.tone === "warn" && "border-l-4 border-l-amber-400",
        );
        return item.href ? (
          <Link key={item.key} href={item.href} className={cn(box, "hover:bg-accent/40")}>
            {body}
          </Link>
        ) : (
          <div key={item.key} className={box}>
            {body}
          </div>
        );
      })}
    </dl>
  );
}

// A wide table: scrolls sideways inside its card on a phone, the first column stays in place.
export function ScrollTable({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="-mx-4 overflow-x-auto px-4 md:-mx-6 md:px-6"
    >
      <table className={cn("w-full border-separate border-spacing-0 text-sm", className)}>
        {children}
      </table>
    </div>
  );
}

export const TH = "text-muted-foreground border-b px-2 py-2 text-xs font-normal whitespace-nowrap";
export const TD = "border-b px-2 py-2 align-top";
export const STICKY = "bg-card sticky left-0 z-10";
export const NUM = "text-right tabular-nums whitespace-nowrap";

export function Section({
  title,
  hint,
  children,
  id,
  actions,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  id?: string;
  actions?: ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-20 gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          {hint && <CardDescription>{hint}</CardDescription>}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}

// A row of link-pills: the quick filters of a list.
export function Pills({
  items,
  label,
}: {
  items: { key: string; label: string; href: string; active: boolean; count?: number }[];
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? "true" : undefined}
          className={cn(
            "rounded-full border px-3 py-1 text-sm whitespace-nowrap",
            item.active
              ? "bg-secondary text-primary border-transparent font-semibold"
              : "text-muted-foreground hover:text-foreground bg-card",
          )}
        >
          {item.label}
          {item.count !== undefined && (
            <span className="ml-1.5 text-xs tabular-nums opacity-70">{item.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
