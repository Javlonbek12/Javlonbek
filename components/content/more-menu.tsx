import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Rare actions (Excel, uploads, sending to Telegram) behind one «⋯» button, so a phone screen
// starts with the data. A <details> popover: no client code, fits server pages.
export function MoreMenu({
  label,
  children,
  className,
}: {
  // The button's name for screen readers and on hover: «Ещё».
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("relative", className)}>
      <summary
        aria-label={label}
        title={label}
        className="border-input bg-card hover:bg-accent flex size-9 cursor-pointer list-none items-center justify-center rounded-full border shadow-xs [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal className="size-4" />
      </summary>
      <div className="bg-card shadow-card absolute right-0 z-30 mt-2 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-2xl border p-2 text-sm">
        {children}
      </div>
    </details>
  );
}

// One line of the menu: a link or a form's submit button looks the same.
export const menuItem =
  "hover:bg-accent flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm [&_svg]:size-4 [&_svg]:shrink-0";
