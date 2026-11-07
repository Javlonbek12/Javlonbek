"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type DetailTab = {
  key: string;
  label: string;
  count?: number;
  // Shown like the count, as it is («2/5»).
  badge?: string;
  content: ReactNode;
};

// Tabs of the task card (Описание, Файлы, Комментарии, История). The content is drawn on the
// server; this only switches what is shown, and remembers the tab in the address so that a form
// sent from a tab comes back to it.
export function DetailTabs({ tabs, initial }: { tabs: DetailTab[]; initial: string }) {
  const [active, setActive] = useState(
    tabs.some((tab) => tab.key === initial) ? initial : tabs[0]!.key,
  );
  const choose = (key: string) => {
    setActive(key);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", key);
      url.searchParams.delete("error");
      url.searchParams.delete("notice");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // Only a convenience: the tab works without it.
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        className="bg-muted/60 -mx-1 flex gap-1 overflow-x-auto rounded-xl p-1 text-sm"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`tab-${tab.key}`}
            aria-selected={active === tab.key}
            aria-controls={`tabpanel-${tab.key}`}
            onClick={() => choose(tab.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors",
              active === tab.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs",
                  active === tab.key ? "bg-primary-foreground/20" : "bg-background",
                )}
              >
                {tab.count}
              </span>
            )}
            {tab.badge && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  active === tab.key ? "bg-primary-foreground/20" : "bg-background",
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`tabpanel-${tab.key}`}
          aria-labelledby={`tab-${tab.key}`}
          hidden={active !== tab.key}
          className="flex flex-col gap-3"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
