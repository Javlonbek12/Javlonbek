import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { displayName } from "@/modules/core/users/display-name";

import { loadRouting, resolveRoute, type Route } from "./routing";

// What will happen to a task before it is created, said in words: under the «Создать» button, in
// the bot's confirmation card and on the meeting page.

export type RouteHint = { status: Route["status"]; text: string; short: string };

function describe(route: Route, assigneeId: string, names: Map<string, string>): RouteHint {
  const list = route.deciderIds.map((id) => names.get(id) ?? "?").join(", ");
  if (route.status === "APPROVED")
    return {
      status: route.status,
      text: t("tasks.route.started"),
      short: t("tasks.route.shortStarted"),
    };
  if (route.kind === "up" && route.deciderIds.includes(assigneeId))
    return {
      status: route.status,
      text: t("tasks.route.request", { name: names.get(assigneeId) ?? "?" }),
      short: t("tasks.route.shortRequest", { name: names.get(assigneeId) ?? "?" }),
    };
  return {
    status: route.status,
    text: t("tasks.route.pending", { names: list }),
    short: t("tasks.route.shortPending", { names: list }),
  };
}

// For every possible assignee: the hint as it is, and with «Требует утверждения» ticked.
export async function routeHints(
  authorId: string,
): Promise<Record<string, { plain: RouteHint; flagged: RouteHint }>> {
  const [{ people, settings }, users] = await Promise.all([
    loadRouting(),
    db.user.findMany({ select: { id: true, firstName: true, lastName: true } }),
  ]);
  const names = new Map(users.map((u) => [u.id, displayName(u)]));
  const result: Record<string, { plain: RouteHint; flagged: RouteHint }> = {};
  for (const person of people) {
    result[person.id] = {
      plain: describe(resolveRoute(people, settings, authorId, person.id), person.id, names),
      flagged: describe(
        resolveRoute(people, settings, authorId, person.id, true),
        person.id,
        names,
      ),
    };
  }
  return result;
}

// The short hint for each proposed task (null assignee: a personal task).
export async function shortRouteHints(authorId: string, assigneeIds: (string | null)[]) {
  const hints = await routeHints(authorId);
  return assigneeIds.map((id) =>
    id === null || id === authorId
      ? t("tasks.route.shortPersonal")
      : (hints[id]?.plain.short ?? ""),
  );
}
