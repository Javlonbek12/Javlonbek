"use client";

import { useEffect, useRef } from "react";

// A horizontally scrolling box that opens centred: on phones a wide org chart starts at the top person,
// not at its empty left edge.
export function CenteredScroll({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (box) box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
