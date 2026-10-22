import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Ring } from "./ring";

// Building blocks of the "Today" screen: tinted stat cards and section headers with an icon tile.

const TONES = {
  green: {
    color: "var(--series-3)",
    tint: "from-[color-mix(in_oklch,var(--series-3)_9%,var(--card))]",
  },
  blue: {
    color: "var(--series-1)",
    tint: "from-[color-mix(in_oklch,var(--series-1)_9%,var(--card))]",
  },
  red: {
    color: "var(--series-2)",
    tint: "from-[color-mix(in_oklch,var(--series-2)_10%,var(--card))]",
  },
} as const;
export type Tone = keyof typeof TONES;

// "Done this week 1/1" with a ring, an icon in the corner and a small note under the number.
export function StatCard({
  tone,
  icon: Icon,
  label,
  value,
  total,
  note,
  noteTone,
}: {
  tone: Tone;
  icon: LucideIcon;
  label: string;
  value: number;
  total: number;
  note: string;
  noteTone?: "up" | "down";
}) {
  const { color, tint } = TONES[tone];
  return (
    <div
      className={cn(
        "bg-card shadow-card relative flex items-center gap-4 overflow-hidden rounded-2xl border bg-gradient-to-br to-[var(--card)] p-3 sm:p-4 md:p-5",
        tint,
      )}
    >
      <Ring
        percent={total ? Math.round((value / total) * 100) : 0}
        color={color}
        size={64}
        filled={false}
        label=""
        className="hidden sm:block"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-muted-foreground text-[11px] leading-tight font-medium sm:truncate sm:text-xs md:text-sm">
          {label}
        </span>
        <span className="text-xl font-bold tabular-nums sm:text-2xl md:text-3xl">
          {value}
          <span className="text-muted-foreground text-sm font-medium sm:text-base md:text-lg">
            /{total}
          </span>
        </span>
        <span
          className={cn(
            "hidden truncate text-[11px] font-medium tracking-wide uppercase sm:block",
            noteTone === "up"
              ? "text-emerald-600 dark:text-emerald-400"
              : noteTone === "down"
                ? "text-destructive"
                : "text-muted-foreground",
          )}
        >
          {note}
        </span>
      </div>
      <span
        className="absolute top-3 right-3 hidden size-9 items-center justify-center rounded-full sm:flex"
        style={{ background: `color-mix(in oklch, ${color} 14%, transparent)`, color }}
      >
        <Icon className="size-[18px]" />
      </span>
    </div>
  );
}

// A card title with a coloured icon tile, an optional counter and something on the right.
export function SectionTitle({
  icon: Icon,
  color = "var(--primary)",
  title,
  count,
  countTone,
  right,
}: {
  icon: LucideIcon;
  color?: string;
  title: string;
  count?: number;
  countTone?: "danger";
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2.5 text-base font-semibold md:text-[17px]">
        <span
          className="flex size-8 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in oklch, ${color} 14%, transparent)`, color }}
        >
          <Icon className="size-[18px]" />
        </span>
        <span className={cn(countTone === "danger" && "text-destructive")}>
          {title}
          {count !== undefined && (
            <span className={cn("ml-1.5 font-bold", countTone !== "danger" && "text-primary")}>
              · {count}
            </span>
          )}
        </span>
      </h2>
      {right}
    </div>
  );
}
