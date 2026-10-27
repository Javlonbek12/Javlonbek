"use client";

import { Boxes, LayoutGrid, Map, Ruler, Scale, Store, Table, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/equipment", key: "equip.tabs.map", icon: Map },
  { href: "/equipment/types", key: "equip.tabs.types", icon: LayoutGrid },
  { href: "/equipment/models", key: "equip.tabs.models", icon: Boxes },
  { href: "/equipment/sizes", key: "equip.tabs.sizes", icon: Ruler },
  { href: "/equipment/control", key: "equip.tabs.control", icon: Scale },
  { href: "/equipment/outlets", key: "equip.tabs.outlets", icon: Store },
  { href: "/equipment/uploads", key: "equip.tabs.uploads", icon: Upload, manage: true },
  { href: "/equipment/tables", key: "equip.tabs.tables", icon: Table },
] as const;

// `manage`: the owner and managers also get the uploads.
export function EquipmentTabs({ manage }: { manage: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/equipment"
      ? pathname === href || pathname.startsWith("/equipment/region")
      : pathname.startsWith(href);
  return (
    <nav className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="bg-card shadow-card inline-flex gap-1 rounded-2xl border p-1">
        {TABS.filter((tab) => manage || !("manage" in tab)).map(({ href, key, icon: Icon }) => (
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
