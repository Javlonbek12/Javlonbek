"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/planograms", key: "planograms.tabs.list" },
  { href: "/planograms/templates", key: "planograms.tabs.templates" },
  { href: "/planograms/equipment", key: "planograms.tabs.equipment" },
  { href: "/planograms/skus", key: "planograms.tabs.skus" },
  { href: "/planograms/posm", key: "planograms.tabs.posm" },
  { href: "/planograms/prices", key: "planograms.tabs.prices" },
  { href: "/planograms/mass", key: "planograms.tabs.mass" },
] as const;

export function PlanogramTabs() {
  const t = useT();
  const pathname = usePathname();
  const library = TABS.slice(1).some((tab) => pathname.startsWith(tab.href));
  const active = (href: string) => (href === "/planograms" ? !library : pathname.startsWith(href));
  return (
    <nav className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={active(tab.href) ? "page" : undefined}
              className={cn(
                "-mb-px block border-b-2 px-3 py-2 text-sm whitespace-nowrap",
                active(tab.href)
                  ? "border-primary font-medium"
                  : "text-muted-foreground border-transparent",
              )}
            >
              {t(tab.key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
