"use client";

import { Search } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { AutoSubmitForm } from "@/components/ui/auto-submit-form";

// The team search works as you type (after a short pause), like the task list: no «Показать».
// `children`: more filters of the same form (a select applies at once).
export function TeamSearch({
  q,
  hidden,
  placeholder,
  children,
}: {
  q: string;
  hidden: Record<string, string>;
  placeholder?: string;
  children?: React.ReactNode;
}) {
  const t = useT();
  const label = placeholder ?? t("team.search");
  return (
    // At least 16rem wide: on a phone the list/cards switch goes to the next line instead.
    <AutoSubmitForm
      action="/team"
      className="flex min-w-0 flex-1 basis-64 flex-wrap items-center gap-2"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="bg-card shadow-card flex min-w-0 flex-1 basis-56 items-center gap-2 rounded-2xl border px-4">
        <Search className="text-muted-foreground size-[18px] shrink-0" aria-hidden />
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder={label}
          aria-label={label}
          enterKeyHint="search"
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      {children}
    </AutoSubmitForm>
  );
}
