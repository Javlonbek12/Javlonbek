import { CalendarClock, FolderKanban, ListTodo } from "lucide-react";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n";

// Login and invite pages: the brand panel (what the app is for) next to the sign-in card.
export function AuthShell({ children }: { children: ReactNode }) {
  const points = [
    { icon: ListTodo, text: t("authShell.tasks") },
    { icon: CalendarClock, text: t("authShell.meetings") },
    { icon: FolderKanban, text: t("authShell.projects") },
  ];
  return (
    <div className="grid flex-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="bg-sidebar text-sidebar-foreground relative flex flex-col justify-between gap-8 overflow-hidden px-6 py-8 md:px-14 md:py-14">
        {/* A quiet grid: the "operations room" feel without decoration for its own sake. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:44px_44px] opacity-[0.07]"
        />
        <div className="relative flex items-center gap-2.5">
          <span className="font-display flex size-9 items-center justify-center rounded-xl bg-[oklch(0.62_0.15_268)] font-semibold text-white">
            A
          </span>
          <span className="font-display text-lg font-semibold text-white">{t("app.name")}</span>
        </div>
        <div className="relative flex max-w-md flex-col gap-5">
          <h1 className="text-[26px] leading-tight text-white md:text-[34px]">
            {t("authShell.headline")}
          </h1>
          <ul className="hidden flex-col gap-3 md:flex">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[15px]">
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/10 text-white">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative hidden text-xs opacity-70 md:block">{t("authShell.footer")}</p>
      </section>
      <main className="flex flex-col justify-center gap-4 px-4 py-8 md:px-14">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">{children}</div>
      </main>
    </div>
  );
}
