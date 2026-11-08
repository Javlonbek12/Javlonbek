"use client";

import { Boxes, LayoutGrid, Map, Ruler, Scale, Store, Table, Upload } from "lucide-react";
import { usePathname } from "next/navigation";

import { useT } from "@/components/locale-provider";

import { TradeTabs } from "./trade-tabs";

// Two groups in one row: what is installed (where it stands, checks, files), then the reference
// (types, models, sizes, tables).
const GROUPS = [
  [
    { href: "/equipment", key: "equip.tabs.map", icon: Map },
    { href: "/equipment/outlets", key: "equip.tabs.outlets", icon: Store },
    { href: "/equipment/control", key: "equip.tabs.control", icon: Scale },
    { href: "/equipment/uploads", key: "equip.tabs.uploads", icon: Upload, manage: true },
  ],
  [
    { href: "/equipment/types", key: "equip.tabs.types", icon: LayoutGrid },
    { href: "/equipment/models", key: "equip.tabs.models", icon: Boxes },
    { href: "/equipment/sizes", key: "equip.tabs.sizes", icon: Ruler },
    { href: "/equipment/tables", key: "equip.tabs.tables", icon: Table },
  ],
] as const;

// `manage`: the owner and managers also get the uploads. `toCheck`: outlets the check lists.
export function EquipmentTabs({ manage, toCheck }: { manage: boolean; toCheck: number }) {
  const t = useT();
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/equipment"
      ? pathname === href || pathname.startsWith("/equipment/region")
      : pathname.startsWith(href);
  return (
    <TradeTabs
      label={t("equip.title")}
      tabs={GROUPS.flatMap((group, g) =>
        group
          .filter((tab) => manage || !("manage" in tab))
          .map((tab, i) => ({
            href: tab.href,
            label: t(tab.key),
            icon: tab.icon,
            active: active(tab.href),
            count: tab.href === "/equipment/outlets" ? toCheck : undefined,
            group: g > 0 && i === 0,
          })),
      )}
    />
  );
}
