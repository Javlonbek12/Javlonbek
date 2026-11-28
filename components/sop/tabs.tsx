"use client";

import {
  BookOpen,
  Boxes,
  ChartLine,
  Factory,
  GitCompare,
  Layers,
  ShieldAlert,
  SlidersHorizontal,
  TriangleAlert,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

// In the order of the work: what the file says, what is wrong in it, the stocks, the order, the
// caps for sales, the materials, the comparison; then the uploads, the norms and the memo.
const TABS = [
  { href: "/sop", key: "sop.tabs.overview", icon: ChartLine },
  { href: "/sop/findings", key: "sop.tabs.findings", icon: TriangleAlert },
  { href: "/sop/stock", key: "sop.tabs.stock", icon: Boxes, also: "/sop/sku" },
  { href: "/sop/order", key: "sop.tabs.order", icon: Factory },
  { href: "/sop/caps", key: "sop.tabs.caps", icon: ShieldAlert },
  { href: "/sop/materials", key: "sop.tabs.materials", icon: Layers },
  { href: "/sop/compare", key: "sop.tabs.compare", icon: GitCompare },
  { href: "/sop/uploads", key: "sop.tabs.uploads", icon: Upload },
  { href: "/sop/settings", key: "sop.tabs.settings", icon: SlidersHorizontal },
  { href: "/sop/guide", key: "sop.tabs.guide", icon: BookOpen },
] as const;

// The section's tabs, in the look of the other sections' tab bars. There are ten of them: on a
// phone the bar scrolls sideways, on a wide screen it wraps onto a second row so that none is
// hidden. `errors` — the errors nobody marked yet, on «Ошибки и риски».
export function SopTabs({ errors }: { errors: number }) {
  const t = useT();
  const pathname = usePathname();
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav
      aria-label={t("sop.title")}
      className="-mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0 print:hidden"
    >
      <ul className="bg-card shadow-card inline-flex w-max items-center gap-1 rounded-2xl border p-1 md:w-auto md:flex-wrap">
        {TABS.map((tab) => {
          const active =
            tab.href === "/sop"
              ? pathname === "/sop"
              : under(tab.href) || ("also" in tab && under(tab.also));
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  active
                    ? "bg-secondary text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
                )}
              >
                <Icon className="size-4" />
                {t(tab.key)}
                {tab.href === "/sop/findings" && errors > 0 && (
                  <span className="rounded-full bg-red-100 px-1.5 text-xs font-semibold text-red-900 tabular-nums dark:bg-red-950 dark:text-red-300">
                    {errors}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
