import { Search } from "lucide-react";
import Link from "next/link";

import { ScopeSelect } from "@/components/tasks/scope-filter";
import { TaskList } from "@/components/tasks/task-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { parseTaskFilters, TASK_SORTS, type TaskFilters } from "@/modules/tasks/filters";
import { countQuickFilters, listProjects, listTasks } from "@/modules/tasks/service";
import { bucketOf, BUCKETS } from "@/modules/tasks/sort";

// Quick filters: each one sets the due date and importance filters.
const CHIPS = [
  { key: "all", due: "any", priority: "any" },
  { key: "overdue", due: "overdue", priority: "any" },
  { key: "today", due: "today", priority: "any" },
  { key: "week", due: "week", priority: "any" },
  { key: "important", due: "any", priority: "important" },
  { key: "noDue", due: "none", priority: "any" },
] as const;

const DEFAULTS: Partial<TaskFilters> = {
  scope: "mine",
  status: "active",
  due: "any",
  priority: "any",
  project: "",
  q: "",
  sort: "smart",
};

function hrefWith(filters: TaskFilters, change: Partial<TaskFilters>) {
  const next = { ...filters, ...change };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(next))
    if (value && value !== DEFAULTS[key as keyof TaskFilters]) query.set(key, String(value));
  const text = query.toString();
  return text ? `/tasks?${text}` : "/tasks";
}

export default async function TaskListPage({ searchParams }: PageProps<"/tasks">) {
  const user = await requireUser();
  const filters = parseTaskFilters(await searchParams);
  const today = await getUserToday(user.id);
  const [tasks, projects, counts] = await Promise.all([
    listTasks(user, filters, today),
    listProjects(user),
    countQuickFilters(user, filters, today),
  ]);
  const activeChip = CHIPS.find((c) => c.due === filters.due && c.priority === filters.priority);
  const groups =
    filters.sort === "smart"
      ? BUCKETS.map((bucket) => ({
          bucket,
          tasks: tasks.filter((task) => bucketOf(task, today) === bucket),
        })).filter((g) => g.tasks.length)
      : null;

  return (
    <div className="flex flex-col gap-4">
      {/* A plain GET form: filters live in the URL and work without JavaScript. */}
      <form className="flex flex-col gap-2">
        <input type="hidden" name="due" value={filters.due} />
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              name="q"
              defaultValue={filters.q}
              placeholder={t("tasks.filters.search")}
              aria-label={t("tasks.filters.search")}
              className="pl-9"
            />
          </div>
          <Button type="submit">{t("tasks.filters.apply")}</Button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
          <ScopeSelect value={filters.scope} />
          <NativeSelect
            name="status"
            defaultValue={filters.status}
            aria-label={t("tasks.filters.status")}
          >
            <option value="active">{t("tasks.filters.statusActive")}</option>
            <option value="all">{t("tasks.filters.statusAll")}</option>
            {Object.values(TaskStatus).map((status) => (
              <option key={status} value={status}>
                {t(`tasks.status.${status}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            name="priority"
            defaultValue={filters.priority}
            aria-label={t("tasks.filters.priority")}
          >
            <option value="any">{t("tasks.filters.priorityAny")}</option>
            <option value="important">{t("tasks.filters.priorityImportant")}</option>
            {(["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`tasks.priority.${p}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            name="project"
            defaultValue={filters.project}
            aria-label={t("tasks.filters.project")}
          >
            <option value="">{t("tasks.filters.projectAny")}</option>
            {projects.map((project) => (
              <option key={project} value={project}>
                {project}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            name="sort"
            defaultValue={filters.sort}
            aria-label={t("tasks.filters.sort")}
          >
            {TASK_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {t(`tasks.filters.sorts.${sort}`)}
              </option>
            ))}
          </NativeSelect>
          <Link
            href="/tasks"
            className="text-muted-foreground px-2 text-sm hover:underline md:ml-auto"
          >
            {t("tasks.filters.reset")}
          </Link>
        </div>
      </form>

      <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {CHIPS.map((chip) => {
          const active = chip === activeChip;
          const count = counts[chip.key];
          return (
            <Link
              key={chip.key}
              href={hrefWith(filters, { due: chip.due, priority: chip.priority })}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card hover:bg-accent",
              )}
            >
              {t(`tasks.filters.chips.${chip.key}`)}
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs font-semibold tabular-nums",
                  active
                    ? "bg-white/20"
                    : chip.key === "overdue" && count > 0
                      ? "bg-destructive text-white"
                      : chip.key === "important" && count > 0
                        ? "bg-amber-500/20 text-amber-800"
                        : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      {groups ? (
        groups.length === 0 ? (
          <TaskList tasks={[]} today={today} />
        ) : (
          groups.map((group) => (
            <section key={group.bucket} className="flex flex-col gap-2">
              <h2
                className={cn(
                  "text-sm font-semibold",
                  group.bucket === "overdue" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {t(`tasks.buckets.${group.bucket}`)} · {group.tasks.length}
              </h2>
              <TaskList tasks={group.tasks} today={today} />
            </section>
          ))
        )
      ) : (
        <TaskList tasks={tasks} today={today} />
      )}
    </div>
  );
}
