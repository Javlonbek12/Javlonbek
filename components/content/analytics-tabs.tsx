import { Settings2 } from "lucide-react";
import Link from "next/link";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Content analytics: the results of the plan, the big picture ahead for directors, and the
// sections posts are sorted into (a setting, kept apart from the numbers).
export function AnalyticsTabs({ active }: { active: "analytics" | "overview" | "sections" }) {
  const tabs = [
    { key: "analytics", href: "/content-analytics", label: t("content.overview.tabAnalytics") },
    { key: "overview", href: "/content-analytics/overview", label: t("content.overview.tab") },
    {
      key: "sections",
      href: "/content-analytics/sections",
      label: t("content.analytics.sections.title"),
    },
  ] as const;
  return (
    <nav className="flex gap-1 overflow-x-auto border-b text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 whitespace-nowrap",
            tab.key === active
              ? "border-primary text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          {tab.label}
          {tab.key === "sections" && <Settings2 className="size-3.5" aria-hidden />}
        </Link>
      ))}
    </nav>
  );
}
