"use client";

import { BookOpen, ChartPie, ClipboardList, PackageCheck, Truck, Upload } from "lucide-react";
import { usePathname } from "next/navigation";

import { TradeTabs } from "@/components/equipment/trade-tabs";
import { useT } from "@/components/locale-provider";

// In the order of the work: the campaign (concept → prices → order), its split by region and TSM,
// the shipments, the analysis; then the reference data.
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
    <TradeTabs
      label={t("dist.title")}
      tabs={TABS.filter((tab) => !("manage" in tab) || manage).map((tab) => ({
        href: tab.href,
        label: t(tab.key),
        icon: tab.icon,
        active: active(tab.href),
      }))}
    />
  );
}
