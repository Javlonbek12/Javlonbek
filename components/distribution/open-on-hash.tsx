"use client";

import { useEffect } from "react";

// A link to a folded step (#prices, or an action coming back to it) opens that step and scrolls
// to it; browsers don't all unfold <details> for a fragment by themselves.
export function OpenOnHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const details = id ? document.getElementById(id)?.closest("details") : null;
      if (!details) return;
      details.open = true;
      details.scrollIntoView({ block: "start" });
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
