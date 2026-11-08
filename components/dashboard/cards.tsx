import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Building blocks of the "Today" screen: section headers with an icon tile.

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
