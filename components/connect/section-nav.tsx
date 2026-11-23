"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

import { SECTION_ATTRIBUTE } from "./section-anchor";

// The page is long (every block of three sources): the sections as chips under the period, and a
// button to come back to them from anywhere below. The sections are read from the page itself, so
// the list is always the blocks actually shown for this level, period and person.
export function SectionNav() {
  const t = useT();
  const nav = useRef<HTMLElement>(null);
  const [items, setItems] = useState<{ id: string; label: string }[]>([]);
  const [below, setBelow] = useState(false);

  useEffect(() => {
    const found = [...document.querySelectorAll<HTMLElement>(`[${SECTION_ATTRIBUTE}]`)].map(
      (element, i) => {
        if (!element.id) element.id = `connect-section-${i + 1}`;
        return { id: element.id, label: element.getAttribute(SECTION_ATTRIBUTE) ?? "" };
      },
    );
    // The page's blocks are known only once it is in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(found.filter((item) => item.label));
    const onScroll = () => {
      const top = nav.current?.getBoundingClientRect().bottom ?? 0;
      setBelow(top < 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Two blocks are in sight anyway.
  if (items.length < 3) return <nav ref={nav} hidden />;
  return (
    <>
      <nav
        ref={nav}
        aria-label={t("connect.sectionNav.label")}
        className="-mx-1 flex scroll-mt-24 gap-1.5 overflow-x-auto px-1 pb-1 text-xs sm:flex-wrap"
      >
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="bg-card text-muted-foreground hover:text-foreground rounded-full border px-3 py-1 whitespace-nowrap"
          >
            {item.label}
          </a>
        ))}
      </nav>
      <button
        type="button"
        onClick={() => nav.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        aria-label={t("connect.sectionNav.top")}
        title={t("connect.sectionNav.top")}
        className={cn(
          "bg-card text-foreground fixed right-4 bottom-24 z-30 flex size-10 items-center justify-center rounded-full border shadow-md transition-opacity md:right-6 md:bottom-6",
          below ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <ArrowUp className="size-4" />
      </button>
    </>
  );
}
