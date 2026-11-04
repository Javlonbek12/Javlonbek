import {
  Activity,
  AlarmClock,
  ArrowUpDown,
  Bell,
  CalendarDays,
  CircleSlash,
  Flag,
  Folder,
  ListChecks,
  RotateCcw,
  Search,
  Star,
  Trash2,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { TaskTableRow } from "@/components/tasks/task-table-row";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { parseTaskFilters, TASK_SORTS, type TaskFilters } from "@/modules/tasks/filters";
import {
  countQuickFilters,
  listProjects,
  listTaskPeople,
  listTasks,
} from "@/modules/tasks/service";
import { displayName } from "@/modules/core/users/display-name";
import { bucketOf, BUCKETS } from "@/modules/tasks/sort";

// Quick filters: each one sets the due date and importance filters. Each has its colour and icon.
const CHIPS = [
  { key: "all", due: "any", priority: "any", icon: ListChecks, tone: "blue" },
  { key: "overdue", due: "overdue", priority: "any", icon: Bell, tone: "red" },
  { key: "today", due: "today", priority: "any", icon: AlarmClock, tone: "orange" },
  { key: "week", due: "week", priority: "any", icon: CalendarDays, tone: "blue" },
  { key: "important", due: "any", priority: "important", icon: Star, tone: "amber" },
  { key: "noDue", due: "none", priority: "any", icon: CircleSlash, tone: "grey" },
] as const;

const TONE: Record<(typeof CHIPS)[number]["tone"], { chip: string; tile: string; icon: string }> = {
  blue: {
    chip: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    tile: "bg-blue-50/70 dark:bg-blue-950/30",
    icon: "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300",
  },
  red: {
    chip: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300",
    tile: "bg-red-50/70 dark:bg-red-950/30",
    icon: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300",
  },
  orange: {
    chip: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
    tile: "bg-emerald-50/70 dark:bg-emerald-950/30",
    icon: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300",
  },
  amber: {
    chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    tile: "bg-amber-50/70 dark:bg-amber-950/30",
    icon: "bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-300",
  },
  grey: {
    chip: "bg-muted text-muted-foreground",
    tile: "bg-muted/60",
    icon: "bg-muted text-muted-foreground",
  },
};

// A dropdown with an icon on the left (the filters row).
function IconSelect({
  icon: Icon,
  children,
  ...props
}: React.ComponentProps<typeof NativeSelect> & { icon: LucideIcon }) {
  return (
    <span className="relative min-w-0">
      <Icon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <NativeSelect
        {...props}
        className="bg-card shadow-card h-11 w-full rounded-xl pl-9 md:w-auto md:min-w-44"
      >
        {children}
      </NativeSelect>
    </span>
  );
}

const DEFAULTS: Partial<TaskFilters> = {
  scope: "mine",
  status: "active",
  due: "any",
  priority: "any",
  project: "",
  q: "",
  sort: "smart",
  person: "",
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
  const params = await searchParams;
  const filters = parseTaskFilters(params);
  const today = await getUserToday(user.id);
  const [tasks, projects, counts, people] = await Promise.all([
    listTasks(user, filters, today),
    listProjects(user),
    countQuickFilters(user, filters, today),
    listTaskPeople(user),
  ]);
  const activeChip = CHIPS.find((c) => c.due === filters.due && c.priority === filters.priority);
  const groups =
    filters.sort === "smart" && tasks.length > 0
      ? BUCKETS.map((bucket) => ({
          bucket,
          tasks: tasks.filter((task) => bucketOf(task, today) === bucket),
        })).filter((g) => g.tasks.length)
      : null;

  return (
    <div className="flex flex-col gap-4">
      {params.deleted === "1" && (
        <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
          {t("tasks.remove.done")}
          {user.role === "OWNER" && (
            <>
              {" "}
              <Link href="/tasks/trash" className="underline">
                {t("tasks.trash.title")}
              </Link>
            </>
          )}
        </p>
      )}
      {/* A plain GET form: filters live in the URL and work without JavaScript. */}
      <form className="flex flex-col gap-3">
        <input type="hidden" name="due" value={filters.due} />
        <div className="bg-card shadow-card flex items-center gap-2 rounded-2xl border p-1.5 pl-4">
          <Search className="text-muted-foreground size-[18px] shrink-0" />
          <input
            name="q"
            defaultValue={filters.q}
            placeholder={t("tasks.filters.search")}
            aria-label={t("tasks.filters.search")}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <Button type="submit" className="h-10 rounded-xl px-5">
            {t("tasks.filters.apply")}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
          {/* "Whose" or a chosen employee: the employee replaces "whose". */}
          {!filters.person && (
            <IconSelect
              icon={User}
              name="scope"
              defaultValue={filters.scope}
              aria-label={t("tasks.filters.scope")}
            >
              <option value="mine">{t("tasks.filters.scopeMine")}</option>
              <option value="created">{t("tasks.filters.scopeCreated")}</option>
              <option value="team">{t("tasks.filters.scopeTeam")}</option>
            </IconSelect>
          )}
          {people.length > 1 && (
            <IconSelect
              icon={Users}
              name="person"
              defaultValue={filters.person}
              aria-label={t("tasks.filters.person")}
            >
              <option value="">{t("tasks.filters.personAny")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === user.id ? `${displayName(p)} (${t("common.you")})` : displayName(p)}
                </option>
              ))}
            </IconSelect>
          )}
          <IconSelect
            icon={Activity}
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
          </IconSelect>
          <IconSelect
            icon={Flag}
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
          </IconSelect>
          <IconSelect
            icon={Folder}
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
          </IconSelect>
          <IconSelect
            icon={ArrowUpDown}
            name="sort"
            defaultValue={filters.sort}
            aria-label={t("tasks.filters.sort")}
          >
            {TASK_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {t(`tasks.filters.sorts.${sort}`)}
              </option>
            ))}
          </IconSelect>
          <Link
            href="/tasks"
            className="text-primary flex items-center gap-1.5 px-2 text-sm font-medium hover:underline md:ml-auto"
          >
            <RotateCcw className="size-4" />
            {t("tasks.filters.reset")}
          </Link>
        </div>
      </form>

      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {CHIPS.map((chip) => {
          const active = chip === activeChip;
          const count = counts[chip.key];
          const Icon = chip.icon;
          return (
            <Link
              key={chip.key}
              href={hrefWith(filters, { due: chip.due, priority: chip.priority })}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-[0_8px_18px_-8px_var(--primary)]"
                  : cn(TONE[chip.tone].chip, "hover:brightness-95"),
              )}
            >
              {chip.key !== "all" && <Icon className="size-4" />}
              {t(`tasks.filters.chips.${chip.key}`)}
              <span
                className={cn(
                  "rounded-md px-1.5 text-xs font-semibold tabular-nums",
                  active ? "bg-white/20" : "bg-card/70",
                )}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* The same numbers as tiles. */}
      <div className="bg-card shadow-card grid grid-cols-2 gap-2 rounded-2xl border p-2 sm:grid-cols-3 lg:grid-cols-5">
        {(
          [
            ["all", "total"],
            ["overdue", "overdue"],
            ["today", "today"],
            ["week", "week"],
            ["important", "important"],
          ] as const
        ).map(([key, label]) => {
          const chip = CHIPS.find((c) => c.key === key)!;
          const Icon = chip.icon;
          return (
            <div
              key={key}
              className={cn("flex items-center gap-3 rounded-xl p-3", TONE[chip.tone].tile)}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full",
                  TONE[chip.tone].icon,
                )}
              >
                <Icon className="size-[18px]" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-lg leading-tight font-bold tabular-nums">{counts[key]}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {t(`tasks.look.${label}`)}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      {(groups ?? [{ bucket: null, tasks }]).map((group) => (
        <section key={group.bucket ?? "all"} className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {group.bucket && (
              <h2
                className={cn(
                  "flex items-center gap-2 text-sm font-semibold",
                  group.bucket === "overdue" ? "text-destructive" : "text-foreground",
                )}
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    group.bucket === "overdue" ? "bg-destructive" : "bg-primary/40",
                  )}
                />
                {t(`tasks.buckets.${group.bucket}`)}
                <span className="text-muted-foreground font-normal">· {group.tasks.length}</span>
              </h2>
            )}
            {group === (groups ?? [])[0] && (
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <ArrowUpDown className="size-3.5" />
                {t("tasks.look.sortLabel", { sort: t(`tasks.filters.sorts.${filters.sort}`) })}
              </span>
            )}
          </div>
          {group.tasks.length === 0 ? (
            <p className="text-muted-foreground bg-card rounded-2xl border p-6 text-center text-sm">
              {t("tasks.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {group.tasks.map((task) => (
                <TaskTableRow key={task.id} task={task} today={today} />
              ))}
            </ul>
          )}
        </section>
      ))}
      {user.role === "OWNER" && (
        <Link
          href="/tasks/trash"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 self-start text-sm"
        >
          <Trash2 className="size-4" />
          {t("tasks.trash.title")}
        </Link>
      )}
    </div>
  );
}
