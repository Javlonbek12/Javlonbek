"use client";

import { Boxes, LayoutGrid, Map, Ruler, Scale, Store, Table, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

// Two groups, so the bar reads simply on a phone: what is installed (where it stands, checks,
// files) and the reference (types, models, sizes, tables).
const GROUPS = [
  {
    key: "equip.groups.installed",
    tabs: [
      { href: "/equipment", key: "equip.tabs.map", icon: Map },
      { href: "/equipment/outlets", key: "equip.tabs.outlets", icon: Store },
      { href: "/equipment/control", key: "equip.tabs.control", icon: Scale },
      { href: "/equipment/uploads", key: "equip.tabs.uploads", icon: Upload, manage: true },
    ],
  },
  {
    key: "equip.groups.reference",
    tabs: [
      { href: "/equipment/types", key: "equip.tabs.types", icon: LayoutGrid },
      { href: "/equipment/models", key: "equip.tabs.models", icon: Boxes },
      { href: "/equipment/sizes", key: "equip.tabs.sizes", icon: Ruler },
      { href: "/equipment/tables", key: "equip.tabs.tables", icon: Table },
    ],
  },
] as const;

// `manage`: the owner and managers also get the uploads.
export function EquipmentTabs({ manage }: { manage: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/equipment"
      ? pathname === href || pathname.startsWith("/equipment/region")
      : pathname.startsWith(href);
  const groups = GROUPS.map((g) => ({
    ...g,
    tabs: g.tabs.filter((tab) => manage || !("manage" in tab)),
  }));
  const current = groups.find((g) => g.tabs.some((tab) => active(tab.href))) ?? groups[0]!;
  return (
    <nav className="flex flex-col gap-2">
      <ul className="bg-card shadow-card inline-flex w-fit gap-1 rounded-2xl border p-1">
        {groups.map((g) => (
          <li key={g.key}>
            <Link
              href={g.tabs[0]!.href}
              aria-current={g === current ? "true" : undefined}
              className={cn(
                "block rounded-xl px-4 py-2 text-sm whitespace-nowrap transition-colors",
                g === current
                  ? "bg-secondary text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
              )}
            >
              {t(g.key)}
            </Link>
          </li>
        ))}
      </ul>
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex w-fit gap-1 border-b">
          {current.tabs.map(({ href, key, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={active(href) ? "page" : undefined}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap",
                  active(href)
                    ? "border-primary text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                <Icon className="size-4" />
                {t(key)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
