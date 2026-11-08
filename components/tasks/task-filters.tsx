"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import Form from "next/form";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import { SCOPE_COOKIE } from "@/modules/tasks/scope-cookie";

const SEARCH_DELAY_MS = 400;

// The search and filters above the task list. Search works as you type (after a short pause), a
// filter applies as soon as it is chosen — no «Показать» button. On a phone the dropdowns hide
// behind «Фильтры · N» (N: how many are set). The chosen «Чьи» is remembered for next time
// (a cookie per user, read by the page).
export function TaskFilterForm({
  q,
  activeCount,
  userId,
  hidden,
  children,
}: {
  q: string;
  activeCount: number;
  userId: string;
  // Values kept from outside the form (the quick filter chips).
  hidden: Record<string, string>;
  // The dropdowns.
  children: ReactNode;
}) {
  const t = useT();
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const submit = () => form.current?.requestSubmit();
  const onChange = (event: React.FormEvent<HTMLFormElement>) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (timer.current) clearTimeout(timer.current);
    if (target.name === "scope")
      document.cookie = `${SCOPE_COOKIE}=${encodeURIComponent(`${userId}:${target.value}`)}; path=/; max-age=31536000; samesite=lax`;
    if (target.name === "q") timer.current = setTimeout(submit, SEARCH_DELAY_MS);
    else submit();
  };

  return (
    <Form
      ref={form}
      action="/tasks"
      replace
      scroll={false}
      onChange={onChange}
      className="flex flex-col gap-3"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex items-center gap-2">
        <label className="bg-card shadow-card flex min-w-0 flex-1 items-center gap-2 rounded-2xl border px-4">
          <Search className="text-muted-foreground size-[18px] shrink-0" aria-hidden />
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder={t("tasks.filters.search")}
            aria-label={t("tasks.filters.search")}
            enterKeyHint="search"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={cn(
            "bg-card shadow-card flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border px-3.5 text-sm font-medium md:hidden",
            open && "border-primary text-primary",
          )}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          {t("tasks.filters.button")}
          {activeCount > 0 && (
            <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs tabular-nums">
              {activeCount}
            </span>
          )}
        </button>
      </div>
      <div
        className={cn(
          "grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:flex-wrap md:items-center",
          open ? "grid" : "hidden md:flex",
        )}
      >
        {children}
      </div>
    </Form>
  );
}
