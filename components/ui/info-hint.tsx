"use client";

import { CircleHelp } from "lucide-react";
import { useId, useState } from "react";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

// A section's long description, hidden behind a small «?» next to its title: the page starts
// with its data, and the explanation is one press away. Put the button where the title is and
// pass the text as children; it opens below the title row.
export function InfoHint({
  children,
  className,
  defaultOpen = false,
}: {
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? t("common.hide") : t("common.whatIsThis")}
        title={open ? t("common.hide") : t("common.whatIsThis")}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "text-muted-foreground hover:text-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-full align-middle",
          open && "text-foreground bg-muted",
        )}
      >
        <CircleHelp className="size-4" />
      </button>
      <div
        id={id}
        hidden={!open}
        className={cn("text-muted-foreground basis-full text-sm", className)}
      >
        {children}
      </div>
    </>
  );
}
