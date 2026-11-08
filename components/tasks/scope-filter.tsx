"use client";

import Link from "next/link";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import type { Scope } from "@/modules/tasks/filters";
import { SCOPE_COOKIE } from "@/modules/tasks/scope-cookie";

// The same order as SCOPES in modules/tasks/filters.ts (that file is for the server).
const LABELS: Record<
  Scope,
  "tasks.filters.scopeMine" | "tasks.filters.scopeCreated" | "tasks.filters.scopeTeam"
> = {
  mine: "tasks.filters.scopeMine",
  created: "tasks.filters.scopeCreated",
  team: "tasks.filters.scopeTeam",
};
const SCOPES = Object.keys(LABELS) as Scope[];

// The choice is remembered per person in the browser (modules/tasks/scope-cookie.ts).
function remember(userId: string, scope: Scope) {
  document.cookie = `${SCOPE_COOKIE}=${encodeURIComponent(`${userId}:${scope}`)}; path=/; max-age=31536000; samesite=lax`;
}

// «Мои / Поставил я / Команда»: the same switch in the list, on the board, in the calendar and the
// timeline. It applies at once (no «Показать») and is remembered for the next visit to any view.
export function ScopeSwitch({
  value,
  userId,
  hrefs,
  className,
}: {
  value: Scope | null;
  userId: string;
  // The address with each choice.
  hrefs: Record<Scope, string>;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t("tasks.filters.scope")}
      className={cn(
        "bg-card shadow-card inline-flex shrink-0 rounded-xl border p-1 text-sm",
        className,
      )}
    >
      {SCOPES.map((scope) => (
        <Link
          key={scope}
          href={hrefs[scope]}
          scroll={false}
          onClick={() => remember(userId, scope)}
          aria-current={scope === value ? "true" : undefined}
          className={cn(
            "rounded-lg px-3 py-1.5 whitespace-nowrap",
            scope === value
              ? "bg-secondary text-primary font-semibold"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(LABELS[scope])}
        </Link>
      ))}
    </div>
  );
}
