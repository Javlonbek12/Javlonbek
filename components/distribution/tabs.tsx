"use client";

import {
  BookOpen,
  ChartPie,
  ClipboardList,
  PackageCheck,
  Truck,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

// In the order of the work: the campaign (concept → prices → order), its split by region and TSM,
// stock and shipments, the analysis; then the reference data.
const TABS = [
  { href: "/distribution/campaigns", key: "dist.tabs.orders", icon: ClipboardList },
  { href: "/distribution/plan", key: "dist.tabs.plan", icon: Truck },
  { href: "/distribution/stock", key: "dist.tabs.stock", icon: PackageCheck },
  { href: "/distribution", key: "dist.tabs.overview", icon: ChartPie },
  { href: "/distribution/import", key: "dist.tabs.import", icon: Upload, manage: true },
  { href: "/distribution/help", key: "dist.tabs.help", icon: BookOpen },
] as const;

export function DistributionTabs({ manage }: { manage: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/distribution" ? pathname === href : pathname.startsWith(href);
  return (
    <nav className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0 print:hidden">
      <ul className="bg-card shadow-card inline-flex gap-1 rounded-2xl border p-1">
        {TABS.filter((tab) => !("manage" in tab) || manage).map(({ href, key, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm whitespace-nowrap transition-colors",
                active(href)
                  ? "bg-secondary text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
              )}
            >
              <Icon className="size-4" />
              {t(key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
