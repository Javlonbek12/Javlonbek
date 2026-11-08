"use client";

import {
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  ChartNoAxesGantt,
  Columns3,
  ListChecks,
  NotebookTabs,
  Plus,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useT } from "@/components/locale-provider";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/tasks", key: "tasks.views.list", icon: ListChecks },
  { href: "/tasks/board", key: "tasks.views.kanban", icon: Columns3 },
  { href: "/tasks/calendar", key: "tasks.views.calendar", icon: CalendarDays },
  { href: "/tasks/timeline", key: "tasks.views.timeline", icon: ChartNoAxesGantt },
  { href: "/tasks/plans", key: "tasks.views.plans", icon: NotebookTabs },
  { href: "/tasks/decide", key: "tasks.views.decide", icon: ClipboardCheck },
  { href: "/tasks/time", key: "tasks.views.time", icon: Timer },
] as const;

// Sections of /tasks that are not one task.
const SECTIONS = new Set(["board", "calendar", "timeline", "plans", "decide", "time", "trash"]);

// A page about one task (its card, the new-task form, the edit form): on a phone it gets only
// «← Назад» and its title, not the big header and the tab bar.
function singleTaskTitle(pathname: string): TranslationKey | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "tasks" || parts.length < 2 || SECTIONS.has(parts[1]!)) return null;
  if (parts[1] === "new") return "tasks.newTask";
  return parts[2] === "edit" ? "tasks.edit" : "tasks.panel.title";
}

// `decisions`: how many tasks wait for the user's decision (shown on «Ждут решения»).
export function TaskTabs({ decisions }: { decisions: number }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const active = (href: string) =>
    // "/tasks/time" must not light up on "/tasks/timeline".
    href === "/tasks"
      ? pathname === "/tasks"
      : pathname === href || pathname.startsWith(`${href}/`);
  const single = singleTaskTitle(pathname);
  // Back where the user came from (a list, a notification…); straight in — to the list.
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/tasks");
  };

  return (
    <div className="flex flex-col gap-4">
      {single && (
        <div className="flex items-center gap-2 md:hidden">
          <Button variant="ghost" size="sm" onClick={goBack} className="-ml-2 gap-1">
            <ArrowLeft className="size-4" aria-hidden />
            {t("tasks.back")}
          </Button>
          <h1 className="min-w-0 truncate text-lg font-semibold">{t(single)}</h1>
        </div>
      )}
      <div className={cn("flex items-start justify-between gap-3", single && "hidden md:flex")}>
        <h1 className="min-w-0 text-[26px] md:text-[34px]">{t("tasks.title")}</h1>
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
      <nav
        className={cn("-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0", single && "hidden md:block")}
      >
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
                {href === "/tasks/decide" && decisions > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
                    {decisions}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
