"use client";

import {
  ArrowLeft,
  CalendarDays,
  ChartNoAxesGantt,
  ChevronDown,
  ClipboardCheck,
  Columns3,
  ListChecks,
  NotebookTabs,
  Plus,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/components/locale-provider";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Two kinds of tabs: the work («Задачи», «Ждут решения», «Планы», «Время») and, inside «Задачи»,
// the way to look at the same tasks («Вид: Список / Доска / Календарь / Таймлайн»). Every view
// opens with the «Чьи задачи» chosen last (remembered per person).
const WORK = [
  { href: "/tasks", key: "tasks.views.tasks", short: "tasks.views.tasks", icon: ListChecks },
  {
    href: "/tasks/decide",
    key: "tasks.views.decide",
    short: "tasks.views.decideShort",
    icon: ClipboardCheck,
  },
  {
    href: "/tasks/plans",
    key: "tasks.views.plans",
    short: "tasks.views.plans",
    icon: NotebookTabs,
  },
  { href: "/tasks/time", key: "tasks.views.time", short: "tasks.views.time", icon: Timer },
] as const;

const VIEWS = [
  { href: "/tasks", key: "tasks.views.list", icon: ListChecks },
  { href: "/tasks/board", key: "tasks.views.kanban", icon: Columns3 },
  { href: "/tasks/calendar", key: "tasks.views.calendar", icon: CalendarDays },
  { href: "/tasks/timeline", key: "tasks.views.timeline", icon: ChartNoAxesGantt },
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
  const [viewsOpen, setViewsOpen] = useState(false);
  const view = VIEWS.find((v) => v.href === pathname);
  const workActive = (href: string) =>
    href === "/tasks"
      ? Boolean(view) || pathname === "/tasks/trash"
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
          <h1 className="min-w-0 truncate text-[22px] font-semibold">{t(single)}</h1>
        </div>
      )}
      <div className={cn("flex items-start justify-between gap-3", single && "hidden md:flex")}>
        <h1 className="min-w-0 text-[22px] font-medium md:text-2xl">{t("tasks.title")}</h1>
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
      <div
        className={cn(
          "flex flex-col gap-2 md:flex-row md:items-center md:justify-between",
          single && "hidden md:flex",
        )}
      >
        <nav aria-label={t("tasks.title")}>
          {/* Four short tabs: all in sight on a phone. */}
          <ul className="bg-card shadow-card grid grid-cols-4 gap-1 rounded-2xl border p-1 md:inline-flex">
            {WORK.map(({ href, key, short, icon: Icon }) => (
              <li key={href} className="min-w-0">
                <Link
                  href={href}
                  aria-current={workActive(href) ? "page" : undefined}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-sm whitespace-nowrap transition-colors md:px-3.5",
                    workActive(href)
                      ? "bg-secondary text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
                  )}
                >
                  <Icon className="hidden size-4 sm:block" />
                  <span className="truncate md:hidden">{t(short)}</span>
                  <span className="hidden md:inline">{t(key)}</span>
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
        {view && (
          <>
            {/* A phone: «Вид: Список ▾» opens the four ways to look. */}
            <div className="relative md:hidden">
              <button
                type="button"
                onClick={() => setViewsOpen((open) => !open)}
                aria-expanded={viewsOpen}
                className="bg-card shadow-card flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm"
              >
                <span className="text-muted-foreground">{t("tasks.views.view")}:</span>
                <span className="font-medium">{t(view.key)}</span>
                <ChevronDown className="size-4" />
              </button>
              {viewsOpen && (
                <ul className="bg-card absolute z-30 mt-1 flex w-48 flex-col rounded-xl border p-1 shadow-lg">
                  {VIEWS.map(({ href, key, icon: Icon }) => (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={() => setViewsOpen(false)}
                        aria-current={href === view.href ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                          href === view.href ? "bg-secondary text-primary font-semibold" : "",
                        )}
                      >
                        <Icon className="size-4" />
                        {t(key)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <span className="text-muted-foreground text-sm">{t("tasks.views.view")}:</span>
              <ul className="bg-card shadow-card inline-flex gap-1 rounded-2xl border p-1">
                {VIEWS.map(({ href, key, icon: Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={href === view.href ? "page" : undefined}
                      title={t(key)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm whitespace-nowrap",
                        href === view.href
                          ? "bg-secondary text-primary font-semibold"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
                      )}
                    >
                      <Icon className="size-4" />
                      <span className="hidden lg:inline">{t(key)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
