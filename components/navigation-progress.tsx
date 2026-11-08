"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

const START = "app:navigation-start";

// For code that navigates with router.push: show the bar as a link would.
export function startNavigationProgress() {
  window.dispatchEvent(new Event(START));
}

// A link to another page of the app, opened in this tab (not a new tab, a download or a mere
// #anchor on the same page).
function leadsAway(event: MouseEvent): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  const link = (event.target as Element | null)?.closest?.("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return false;
  if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return false;
  const url = new URL(link.href, location.href);
  return (
    url.origin === location.origin &&
    (url.pathname !== location.pathname || url.search !== location.search)
  );
}

// A search or filter form that opens a page (a server action form is not a page change).
function formLeadsAway(event: SubmitEvent): boolean {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return false;
  const action = form.getAttribute("action") ?? "";
  return form.method === "get" && !action.startsWith("javascript:");
}

// A thin bar along the top while the next page loads: the press was taken, no need to press again.
// It appears only if the page takes a moment, and finishes when the address changes.
export function NavigationProgress() {
  const t = useT();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const clear = () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };
    const start = () => {
      clear();
      // Fast pages (already loaded in the background) don't need a bar.
      timers.current.push(window.setTimeout(() => setState("loading"), 120));
      // Something stopped the page from changing (a link that opens a dialog): give up quietly.
      timers.current.push(window.setTimeout(() => setState("idle"), 15_000));
    };
    const onClick = (event: MouseEvent) => leadsAway(event) && start();
    const onSubmit = (event: SubmitEvent) => formLeadsAway(event) && start();
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener(START, start);
    return () => {
      clear();
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener(START, start);
    };
  }, []);

  // The address changed: the new page is here. The bar runs to the end and fades out.
  const address = `${pathname}?${searchParams}`;
  const [shown, setShown] = useState(address);
  if (address !== shown) {
    setShown(address);
    if (state === "loading") setState("done");
  }
  useEffect(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, [address]);
  useEffect(() => {
    if (state !== "done") return;
    const id = window.setTimeout(() => setState("idle"), 250);
    return () => window.clearTimeout(id);
  }, [state]);

  if (state === "idle") return null;
  return (
    <div
      role="progressbar"
      aria-label={t("shell.loading")}
      data-print="hide"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5"
    >
      <div
        className={cn(
          "bg-primary h-full shadow-[0_0_8px_var(--primary)]",
          state === "loading"
            ? "animate-[navigation-progress_8s_cubic-bezier(0.1,0.7,0.3,1)_forwards]"
            : "w-full opacity-0 transition-opacity duration-200",
        )}
      />
    </div>
  );
}
