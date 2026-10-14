import Link from "next/link";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Two pages of content analytics: the detailed analytics and the big picture for directors.
export function AnalyticsTabs({ active }: { active: "analytics" | "overview" }) {
  const tabs = [
    { key: "analytics", href: "/content-analytics", label: t("content.overview.tabAnalytics") },
    { key: "overview", href: "/content-analytics/overview", label: t("content.overview.tab") },
  ] as const;
  return (
    <nav className="flex gap-1 border-b text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            "-mb-px border-b-2 px-3 py-2",
            tab.key === active
              ? "border-primary text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
