import Link from "next/link";

import { cn } from "@/lib/utils";

export type SegmentedItem = {
  key: string;
  label: React.ReactNode;
  // The page with this choice made: a link, so it fits server pages and keeps the other filters.
  href: string;
  active: boolean;
};

// One switch for two or three views of the same list («Предстоящие / Прошедшие», «Списком /
// Карточками»), the same on every page: the chosen one is a white pill.
export function Segmented({
  items,
  label,
  className,
}: {
  items: SegmentedItem[];
  // What is being switched, for screen readers.
  label?: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "bg-secondary/70 inline-flex max-w-full shrink-0 gap-0.5 rounded-full p-1 text-sm",
        className,
      )}
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? "true" : undefined}
          className={cn(
            "rounded-full px-3.5 py-1 whitespace-nowrap",
            item.active
              ? "bg-card font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
