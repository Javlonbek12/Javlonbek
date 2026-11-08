"use client";

import { Search } from "lucide-react";
import Form from "next/form";
import { useEffect, useRef } from "react";

import { useT } from "@/components/locale-provider";

const SEARCH_DELAY_MS = 400;

// The team search works as you type (after a short pause), like the task list: no «Показать».
export function TeamSearch({ q, hidden }: { q: string; hidden: Record<string, string> }) {
  const t = useT();
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <Form
      ref={form}
      action="/team"
      replace
      scroll={false}
      onChange={() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => form.current?.requestSubmit(), SEARCH_DELAY_MS);
      }}
      // At least 16rem wide: on a phone the list/cards switch goes to the next line instead.
      className="min-w-0 flex-1 basis-64"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="bg-card shadow-card flex min-w-0 items-center gap-2 rounded-2xl border px-4">
        <Search className="text-muted-foreground size-[18px] shrink-0" aria-hidden />
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder={t("team.search")}
          aria-label={t("team.search")}
          enterKeyHint="search"
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
    </Form>
  );
}
