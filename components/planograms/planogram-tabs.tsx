"use client";

import { Boxes, Copy, LayoutList, Layers, Package, Sticker, Tag } from "lucide-react";
import { usePathname } from "next/navigation";

import { TradeTabs } from "@/components/equipment/trade-tabs";
import { useT } from "@/components/locale-provider";

// «Оборудование» lives in its own section (shared with POSM distribution): the tab says so.
const TABS = [
  { href: "/planograms", key: "planograms.tabs.list", icon: LayoutList },
  { href: "/planograms/templates", key: "planograms.tabs.templates", icon: Copy },
  { href: "/equipment/models", key: "planograms.tabs.equipment", icon: Boxes, away: true },
  { href: "/planograms/skus", key: "planograms.tabs.skus", icon: Package },
  { href: "/planograms/posm", key: "planograms.tabs.posm", icon: Sticker },
  { href: "/planograms/prices", key: "planograms.tabs.prices", icon: Tag },
  { href: "/planograms/mass", key: "planograms.tabs.mass", icon: Layers },
] as const;

export function PlanogramTabs() {
  const t = useT();
  const pathname = usePathname();
  const library = TABS.slice(1).some((tab) => pathname.startsWith(tab.href));
  const active = (href: string) => (href === "/planograms" ? !library : pathname.startsWith(href));
  return (
    <TradeTabs
      label={t("planograms.title")}
      tabs={TABS.map((tab) => ({
        href: tab.href,
        label: t(tab.key),
        icon: tab.icon,
        active: active(tab.href),
        away: "away" in tab ? t("planograms.tabs.equipmentHint") : undefined,
      }))}
    />
  );
}
