"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

// A small dropdown that changes one query parameter of the current page (filters on "Today").
export function QuerySelect({
  name,
  value,
  options,
  label,
  className,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => {
        const next = new URLSearchParams(params.toString());
        next.set(name, event.target.value);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }}
      className={cn(
        "bg-card text-foreground h-9 rounded-lg border px-3 pr-8 text-sm shadow-[0_1px_2px_oklch(0_0_0/0.03)] outline-none",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
