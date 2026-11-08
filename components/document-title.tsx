"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useT } from "@/components/locale-provider";
import { moduleForPath } from "@/modules/core/registry";

// The browser tab is named after the section: «Команда — Assistant», so five open tabs can be
// told apart. Only the bare app name is replaced: a page with its own title keeps it.
export function DocumentTitle() {
  const t = useT();
  const pathname = usePathname();
  const section = moduleForPath(pathname);
  const app = t("app.name");
  const title = section ? `${t(section.titleKey)} — ${app}` : app;

  // The name set for the previous section, replaced as well.
  const ours = useRef(app);

  useEffect(() => {
    const apply = () => {
      // Already ours: writing it again would wake the observer below, and so on forever.
      if (document.title === title) return;
      if (document.title !== app && document.title !== ours.current) return;
      document.title = title;
      ours.current = title;
    };
    apply();
    // Next.js writes the page's <title> as the page streams in; name the tab again after it.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [app, title]);

  return null;
}
