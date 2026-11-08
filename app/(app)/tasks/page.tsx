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
  Star,
  Tag,
  Trash2,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";

import { QuickCircle } from "@/components/tasks/quick-circle";
import { QuickUndo } from "@/components/tasks/quick-undo";
import { TaskFilterForm } from "@/components/tasks/task-filters";
import { TaskPanel } from "@/components/tasks/task-panel";
import { TaskTableRow } from "@/components/tasks/task-table-row";
import { NativeSelect } from "@/components/ui/native-select";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { isDoer } from "@/modules/tasks/access";
import { parseTaskFilters, TASK_SORTS, type TaskFilters } from "@/modules/tasks/filters";
import {
  countQuickFilters,
  LIST_LIMIT,
  listProjects,
  listTaskPeople,
  listTasks,
  type TaskView,
} from "@/modules/tasks/service";
import { displayName } from "@/modules/core/users/display-name";
import { knownLabels } from "@/modules/tasks/labels";
import { rememberedScope, SCOPE_COOKIE } from "@/modules/tasks/scope-cookie";
import { bucketOf, BUCKETS } from "@/modules/tasks/sort";
import { withParams } from "@/modules/tasks/back";
import { quickTarget } from "@/modules/tasks/quick";
import { getRunningTimer } from "@/modules/tasks/time";

// Quick filters: each one sets the due date and importance filters. Each has its colour and icon.
const CHIPS = [
  { key: "all", due: "any", priority: "any", icon: ListChecks, tone: "blue" },
  { key: "overdue", due: "overdue", priority: "any", icon: Bell, tone: "red" },
  { key: "today", due: "today", priority: "any", icon: AlarmClock, tone: "orange" },
  { key: "week", due: "week", priority: "any", icon: CalendarDays, tone: "blue" },
  { key: "important", due: "any", priority: "important", icon: Star, tone: "amber" },
  { key: "noDue", due: "none", priority: "any", icon: CircleSlash, tone: "grey" },
] as const;

const TONE: Record<(typeof CHIPS)[number]["tone"], string> = {
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  red: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300",
  orange: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  grey: "bg-muted text-muted-foreground",
};

// A dropdown with an icon on the left (the filters panel). Full width on a phone, so the option
// text is never cut.
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

// A link to the list with these filters. `scope` is left out only when it is the remembered one
// (the page falls back to it), so a link never switches «Чьи» behind the user's back.
function hrefWith(filters: TaskFilters, change: Partial<TaskFilters>, defaults: TaskFilters) {
  const next = { ...filters, ...change };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(next))
    if (value && value !== defaults[key as keyof TaskFilters]) query.set(key, String(value));
  const text = query.toString();
  return text ? `/tasks?${text}` : "/tasks";
}

// Filters set in the panel behind «Фильтры» (the number on the button).
function activeFilters(filters: TaskFilters) {
  return [
    filters.scope !== "mine" && !filters.person,
    filters.person,
    filters.status !== "active",
    filters.priority !== "any",
    filters.project,
    filters.label,
    filters.sort !== "smart",
  ].filter(Boolean).length;
}

export default async function TaskListPage({ searchParams }: PageProps<"/tasks">) {
  const user = await requireUser();
  const params = await searchParams;
  // «Чьи» chosen last time, when the address doesn't say.
  const remembered = rememberedScope((await cookies()).get(SCOPE_COOKIE)?.value, user.id);
  const defaults = parseTaskFilters({ scope: remembered });
  const filters = parseTaskFilters({ ...params, scope: params.scope ?? remembered });
  const today = await getUserToday(user.id);
  const [tasks, projects, counts, people, labels, timer] = await Promise.all([
    listTasks(user, filters, today),
    listProjects(user),
    countQuickFilters(user, filters, today),
    listTaskPeople(user),
    knownLabels(user),
    getRunningTimer(user.id),
  ]);
  const activeChip = CHIPS.find((c) => c.due === filters.due && c.priority === filters.priority);
  const groups =
    filters.sort === "smart" && tasks.length > 0
      ? BUCKETS.map((bucket) => ({
          bucket,
          tasks: tasks.filter((task) => bucketOf(task, today) === bucket),
        })).filter((g) => g.tasks.length)
      : null;

  // The task opened next to the list (?task=…): the list stays, the panel shows the card.
  const link = (change: Partial<TaskFilters>) => hrefWith(filters, change, defaults);
  const listHref = link({});
  const openId = typeof params.task === "string" ? params.task : null;
  const doneId = typeof params.done === "string" ? params.done : null;
  const here = openId ? withParams(listHref, { task: openId }) : listHref;
  const rowProps = (task: TaskView) => {
    const target = quickTarget(user, task);
    return {
      href: withParams(listHref, { task: task.id }),
      selected: task.id === openId,
      timerRunning: timer?.taskId === task.id,
      circle: (
        <QuickCircle
          taskId={task.id}
          status={task.status}
          target={target}
          accepts={target === "DONE" && !task.isPersonal && !isDoer(user, task)}
          blocked={target === "DONE" && task.openBlockers > 0}
          back={here}
        />
      ),
    };
  };

  const list = (
    <div className="flex min-w-0 flex-col gap-4">
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
      <QuickUndo user={user} taskId={doneId} back={here} />
      {/* Filters live in the address: the form navigates, the list is drawn on the server. */}
      <TaskFilterForm
        q={filters.q}
        activeCount={activeFilters(filters)}
        userId={user.id}
        hidden={{ due: filters.due }}
      >
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
        {(labels.length > 0 || filters.label) && (
          <IconSelect
            icon={Tag}
            name="label"
            defaultValue={filters.label}
            aria-label={t("tasks.filters.label")}
          >
            <option value="">{t("tasks.filters.labelAny")}</option>
            {[...new Set([...labels, ...(filters.label ? [filters.label] : [])])].map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </IconSelect>
        )}
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
          className="text-primary flex items-center gap-1.5 px-2 py-2 text-sm font-medium hover:underline md:ml-auto"
        >
          <RotateCcw className="size-4" />
          {t("tasks.filters.reset")}
        </Link>
      </TaskFilterForm>

      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {CHIPS.map((chip) => {
          const active = chip === activeChip;
          const count = counts[chip.key];
          const Icon = chip.icon;
          return (
            <Link
              key={chip.key}
              href={link({ due: chip.due, priority: chip.priority })}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-[0_8px_18px_-8px_var(--primary)]"
                  : cn(TONE[chip.tone], "hover:brightness-95"),
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

      {tasks.length >= LIST_LIMIT && (
        <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          {t("tasks.look.cut", { count: LIST_LIMIT })}
        </p>
      )}

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
              <span className="text-muted-foreground hidden items-center gap-1.5 text-xs md:flex">
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
                <TaskTableRow key={task.id} task={task} today={today} {...rowProps(task)} />
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
  if (!openId) return list;
  return (
    <>
      {list}
      <TaskPanel user={user} taskId={openId} base={here} closeHref={listHref} params={params} />
    </>
  );
}
