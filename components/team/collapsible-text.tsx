"use client";

import { useEffect, useRef, useState } from "react";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

// A long text cut after three lines, with «Показать полностью» when there is more. Line breaks
// are kept. Without JavaScript the first three lines show.
export function CollapsibleText({ text, className }: { text: string; className?: string }) {
  const t = useT();
  const box = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const check = () => setCut(element.scrollHeight > element.clientHeight + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div className={cn("flex flex-col items-start gap-0.5", className)}>
      <p
        ref={box}
        className={cn("text-sm break-words whitespace-pre-wrap", !open && "line-clamp-3")}
      >
        {text}
      </p>
      {(cut || open) && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="text-primary text-xs hover:underline"
        >
          {open ? t("team.duties.less") : t("team.duties.more")}
        </button>
      )}
    </div>
  );
}
