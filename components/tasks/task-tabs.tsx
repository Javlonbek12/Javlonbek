"use client";

import {
  CalendarDays,
  ChartNoAxesGantt,
  Columns3,
  ListChecks,
  NotebookTabs,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/tasks", key: "tasks.views.list", icon: ListChecks },
  { href: "/tasks/board", key: "tasks.views.kanban", icon: Columns3 },
  { href: "/tasks/calendar", key: "tasks.views.calendar", icon: CalendarDays },
  { href: "/tasks/timeline", key: "tasks.views.timeline", icon: ChartNoAxesGantt },
  { href: "/tasks/plans", key: "tasks.views.plans", icon: NotebookTabs },
] as const;

export function TaskTabs() {
  const t = useT();
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/tasks" ? pathname === "/tasks" : pathname.startsWith(href);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] md:text-[34px]">{t("tasks.title")}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{t("tasks.subtitle")}</p>
        </div>
        <Button
          asChild
          className="h-10 shrink-0 rounded-xl px-4 shadow-[0_8px_18px_-8px_var(--primary)] md:h-11 md:px-5"
        >
          <Link href="/tasks/new">
            <Plus />
            {t("tasks.newTask")}
          </Link>
        </Button>
      </div>
      <nav className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="bg-card shadow-card inline-flex gap-1 rounded-2xl border p-1">
          {TABS.map(({ href, key, icon: Icon }) => (
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
    </div>
  );
}
