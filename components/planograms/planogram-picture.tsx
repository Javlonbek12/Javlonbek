"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

// The planogram picture. A wide planogram scrolls sideways so the price tags stay readable;
// «Fit to screen» shrinks it to the screen width to see the whole display at once.
export function PlanogramPicture({ svg, className }: { svg: string; className?: string }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(false);
  const [wide, setWide] = useState(false);

  // Is the picture wider than the box (padding aside)? The observer reports once at the start.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const width = Number(el.querySelector("svg")?.getAttribute("width") ?? 0);
      setWide(width > el.clientWidth - 16);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [svg]);

  return (
    <div className="flex flex-col gap-1">
      {(wide || fit) && (
        <button
          type="button"
          onClick={() => setFit(!fit)}
          aria-pressed={fit}
          className="text-muted-foreground hover:bg-accent flex items-center gap-1.5 self-end rounded-full px-3 py-1 text-sm print:hidden"
        >
          {fit ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          {fit ? t("planograms.picture.actual") : t("planograms.picture.fit")}
        </button>
      )}
      <div
        ref={box}
        className={cn(
          "rounded-lg border bg-white p-2",
          fit ? "[&_svg]:h-auto [&_svg]:w-full" : "overflow-x-auto [&_svg]:max-w-none",
          className,
        )}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
