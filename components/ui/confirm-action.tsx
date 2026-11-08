import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Button } from "./button";

type FormAction = (formData: FormData) => void | Promise<void>;

// An action that can't be undone (delete, cancel, archive, apply…) behind a second click: the
// button opens a small card saying what will happen, with the real submit button inside.
// Works without JavaScript (a <details> popover), so it fits server and client components.
export function ConfirmAction({
  label,
  title,
  hint,
  confirm,
  action,
  hidden = {},
  children,
  icon,
  tone = "destructive",
  size = "sm",
  align = "left",
  className,
}: {
  // The visible button.
  label: ReactNode;
  // The question in the card: «Удалить встречу?»
  title: ReactNode;
  // What happens, in a sentence: «Протокол встречи тоже удалится».
  hint?: ReactNode;
  // The submit button in the card: «Да, удалить».
  confirm: ReactNode;
  action: FormAction;
  // Hidden form fields (ids and the like).
  hidden?: Record<string, string>;
  // Extra fields inside the card, e.g. a reason.
  children?: ReactNode;
  icon?: ReactNode;
  // destructive: red summary on hover and a red submit; default: a neutral one (apply, approve).
  tone?: "destructive" | "default";
  size?: "sm" | "default";
  // Which edge of the button the card lines up with (right: buttons at the right of a row).
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <details className={cn("relative w-fit", className)}>
      <summary
        className={cn(
          "flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-full border text-sm font-medium [&::-webkit-details-marker]:hidden",
          size === "sm" ? "h-8 px-3.5" : "h-9 px-4",
          tone === "destructive"
            ? "text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30"
            : "bg-card hover:bg-accent",
        )}
      >
        {icon}
        {label}
      </summary>
      <div
        className={cn(
          "bg-card shadow-card absolute z-30 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-xl border p-3 text-sm",
          align === "right" ? "right-0" : "left-0",
        )}
      >
        <span className="font-medium">{title}</span>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
        <form action={action} className="flex flex-col gap-2">
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {children}
          <div>
            <Button
              type="submit"
              size="sm"
              variant={tone === "destructive" ? "destructive" : "default"}
            >
              {confirm}
            </Button>
          </div>
        </form>
      </div>
    </details>
  );
}
