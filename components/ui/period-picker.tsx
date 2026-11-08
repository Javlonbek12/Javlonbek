import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { Button } from "./button";
import { Input } from "./input";

export type PeriodChip = {
  key: string;
  label: string;
  // The page with this period chosen: a chip applies at once, there is no «Показать».
  href: string;
  // Its dates in words («1–7 нояб.»), shown on hover.
  dates?: string;
};

export type PeriodCustom = {
  // «Свои даты…»
  label: string;
  // «Применить»
  apply: string;
  fromLabel: string;
  toLabel: string;
  // Calendar dates or whole months.
  type: "date" | "month";
  from?: string;
  to?: string;
  min?: string;
  max?: string;
  // Where the form goes and what else it keeps (view, filters…).
  action: string;
  params?: Record<string, string>;
  fromParam?: string;
  toParam?: string;
};

// One way to choose a period on every page: chips that apply at once, and the chosen dates written
// next to them, so «3 мес.» never has to be guessed. Optional: a label saying the direction
// («Прошедшие:», «Следующие:»), arrows that step to the previous / next period, and own dates.
// No client code: the chips are links and own dates a small form, so it fits server pages.
export function PeriodPicker({
  label,
  chips,
  active,
  dates,
  step,
  custom,
  className,
}: {
  label?: string;
  chips: PeriodChip[];
  // The chosen chip; null when the period is own dates or was stepped to.
  active: string | null;
  // The period on screen, written out («1 авг. – 8 нояб. 2026»).
  dates?: string;
  step?: { prev: string; next: string; prevLabel: string; nextLabel: string };
  custom?: PeriodCustom;
  className?: string;
}) {
  const chip = (on: boolean) =>
    cn(
      "rounded-full px-3 py-1 whitespace-nowrap",
      on ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
    );
  const customActive = Boolean(custom) && active === null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm", className)}>
      {label && <span className="text-muted-foreground text-xs">{label}</span>}
      {step && (
        <Button asChild variant="outline" size="icon" className="size-8">
          <Link href={step.prev} aria-label={step.prevLabel}>
            <ChevronLeft />
          </Link>
        </Button>
      )}
      <div className="bg-secondary/70 inline-flex max-w-full flex-wrap gap-0.5 rounded-2xl p-1 sm:rounded-full">
        {chips.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            title={c.dates}
            aria-current={c.key === active ? "true" : undefined}
            className={chip(c.key === active)}
          >
            {c.label}
          </Link>
        ))}
      </div>
      {step && (
        <Button asChild variant="outline" size="icon" className="size-8">
          <Link href={step.next} aria-label={step.nextLabel}>
            <ChevronRight />
          </Link>
        </Button>
      )}
      {dates && (
        <span className="text-muted-foreground text-xs whitespace-nowrap" data-period-dates>
          {dates}
        </span>
      )}
      {custom && (
        <details className="basis-full sm:basis-auto" open={customActive}>
          <summary
            className={cn(
              "w-fit cursor-pointer list-none text-xs underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden",
              customActive ? "text-foreground font-medium" : "text-primary",
            )}
          >
            {custom.label}
          </summary>
          <form action={custom.action} className="mt-1.5 flex flex-wrap items-end gap-2">
            {Object.entries(custom.params ?? {}).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <label className="text-muted-foreground flex flex-col gap-0.5 text-xs">
              {custom.fromLabel}
              <Input
                type={custom.type}
                name={custom.fromParam ?? "from"}
                defaultValue={custom.from}
                min={custom.min}
                max={custom.max}
                required
                className="h-8 w-40"
              />
            </label>
            <label className="text-muted-foreground flex flex-col gap-0.5 text-xs">
              {custom.toLabel}
              <Input
                type={custom.type}
                name={custom.toParam ?? "to"}
                defaultValue={custom.to}
                min={custom.min}
                max={custom.max}
                required
                className="h-8 w-40"
              />
            </label>
            <Button type="submit" size="sm" variant="outline">
              {custom.apply}
            </Button>
          </form>
        </details>
      )}
    </div>
  );
}
