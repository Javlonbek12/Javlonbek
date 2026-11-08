"use client";

import { ArrowUpRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";

import { cn } from "@/lib/utils";

export type TradeTab = {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  // A number to look at (e.g. outlets to check).
  count?: number;
  // Leads to another section: marked, so the change of menu is no surprise.
  away?: string;
  // Starts a new group (a thin line before it).
  group?: boolean;
};

// The one tab bar of the trade-marketing sections (planograms, equipment, POSM distribution):
// pills with icons in a row that scrolls sideways on a phone.
export function TradeTabs({ tabs, label }: { tabs: TradeTab[]; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0 print:hidden">
      <ul className="bg-card shadow-card inline-flex w-max items-center gap-1 rounded-2xl border p-1">
        {tabs.map(({ href, label: text, icon: Icon, active, count, away, group }) => (
          <Fragment key={href}>
            {group && <li aria-hidden className="bg-border mx-1 h-5 w-px" />}
            <li>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                title={away}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm whitespace-nowrap transition-colors",
                  active
                    ? "bg-secondary text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
                )}
              >
                <Icon className="size-4" />
                {text}
                {count !== undefined && count > 0 && (
                  <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-900 tabular-nums dark:bg-amber-950 dark:text-amber-300">
                    {count}
                  </span>
                )}
                {away && <ArrowUpRight className="size-3.5" aria-label={away} />}
              </Link>
            </li>
          </Fragment>
        ))}
      </ul>
    </nav>
  );
}
