"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/tasks", key: "tasks.views.list" },
  { href: "/tasks/board", key: "tasks.views.kanban" },
  { href: "/tasks/calendar", key: "tasks.views.calendar" },
  { href: "/tasks/timeline", key: "tasks.views.timeline" },
  { href: "/tasks/plans", key: "tasks.views.plans" },
] as const;

export function TaskTabs() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/tasks" ? pathname === "/tasks" : pathname.startsWith(href);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[22px] font-medium md:text-2xl">{t("tasks.title")}</h1>
        <Button asChild size="sm">
          <Link href="/tasks/new">
            <Plus />
            {t("tasks.newTask")}
          </Link>
        </Button>
      </div>
      <nav className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="bg-secondary/70 inline-flex gap-0.5 rounded-full p-1">
          {TABS.map((tab) => (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active(tab.href) ? "page" : undefined}
                className={cn(
                  "block rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors",
                  active(tab.href)
                    ? "bg-card text-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(tab.key)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
