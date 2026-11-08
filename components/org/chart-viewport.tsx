"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";

// The chart opens fitted to the screen (scaled down when it is wider), so nobody is cut off at the
// edges; «100%» shows it full size, scrolling sideways from the middle (the top person).
export function ChartViewport({
  children,
  tools,
}: {
  children: React.ReactNode;
  // More buttons for the toolbar (e.g. «Свернуть всё»).
  tools?: React.ReactNode;
}) {
  const t = useT();
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(true);
  const [box, setBox] = useState<{ scale: number; left: number; height?: number }>({
    scale: 1,
    left: 0,
  });
  const [wide, setWide] = useState(false);

  const measure = useCallback(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    // offsetWidth/Height ignore the transform: the chart's own size.
    const natural = i.offsetWidth;
    const room = o.clientWidth;
    const scale = fit ? Math.min(1, room / Math.max(1, natural)) : 1;
    setWide(natural > room + 1);
    setBox({
      scale,
      left: Math.max(0, (room - natural * scale) / 2),
      height: i.offsetHeight * scale,
    });
  }, [fit]);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (outer.current) observer.observe(outer.current);
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    // Full size: start at the middle, where the top of the chart is.
    const o = outer.current;
    if (!fit && o) o.scrollLeft = (o.scrollWidth - o.clientWidth) / 2;
  }, [fit]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {wide && (
          <Button
            type="button"
            size="sm"
            variant={fit ? "default" : "outline"}
            onClick={() => setFit(true)}
            aria-pressed={fit}
          >
            <Minimize2 />
            {t("team.org.fit")}
          </Button>
        )}
        {wide && (
          <Button
            type="button"
            size="sm"
            variant={fit ? "outline" : "default"}
            onClick={() => setFit(false)}
            aria-pressed={!fit}
          >
            <Maximize2 />
            {t("team.org.actualSize")}
          </Button>
        )}
        {tools}
      </div>
      <div
        ref={outer}
        className={fit ? "overflow-hidden" : "overflow-x-auto pb-2"}
        style={{ height: box.height }}
      >
        <div
          ref={inner}
          className="w-max"
          style={{
            transform: box.scale < 1 ? `scale(${box.scale})` : undefined,
            transformOrigin: "top left",
            marginLeft: box.left,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
