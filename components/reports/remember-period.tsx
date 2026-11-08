"use client";

import { useEffect } from "react";

// Remembers the period on screen in the browser (see PERIOD_COOKIE): the next visit opens it.
export function RememberPeriod({ name, value }: { name: string; value: string }) {
  useEffect(() => {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
  }, [name, value]);
  return null;
}
