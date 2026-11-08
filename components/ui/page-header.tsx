import { cn } from "@/lib/utils";

import { InfoHint } from "./info-hint";

// The top of every section page: the title, its «?» with the long description, a line under the
// title (optional) and the page's buttons. On a phone the buttons go under the title instead of
// squeezing it into three lines.
export function PageHeader({
  title,
  hint,
  hintClassName,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  // The section's description, behind the «?» next to the title.
  hint?: React.ReactNode;
  hintClassName?: string;
  // Buttons and menus on the right.
  actions?: React.ReactNode;
  // A line under the title (dates, a status, a short note).
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-3", className)}>
      <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-1">
        <h1 className="min-w-0 text-[22px] font-medium break-words md:text-2xl">{title}</h1>
        {hint && <InfoHint className={hintClassName}>{hint}</InfoHint>}
        {children && <div className="text-muted-foreground basis-full text-sm">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
