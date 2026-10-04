import { ScopeSelect } from "@/components/tasks/scope-filter";
import { TaskList } from "@/components/tasks/task-row";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { parseTaskFilters } from "@/modules/tasks/filters";
import { listProjects, listTasks } from "@/modules/tasks/service";

export default async function TaskListPage({ searchParams }: PageProps<"/tasks">) {
  const user = await requireUser();
  const filters = parseTaskFilters(await searchParams);
  const today = await getUserToday(user.id);
  const [tasks, projects] = await Promise.all([
    listTasks(user, filters, today),
    listProjects(user),
  ]);

  return (
    <div className="flex flex-col gap-4">
      {/* A plain GET form: filters live in the URL and work without JavaScript. */}
      <form className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
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
        <NativeSelect name="due" defaultValue={filters.due} aria-label={t("tasks.filters.due")}>
          <option value="any">{t("tasks.filters.dueAny")}</option>
          <option value="overdue">{t("tasks.filters.dueOverdue")}</option>
          <option value="today">{t("tasks.filters.dueToday")}</option>
          <option value="week">{t("tasks.filters.dueWeek")}</option>
          <option value="none">{t("tasks.filters.dueNone")}</option>
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
        <Button type="submit" variant="secondary" className="col-span-2">
          {t("tasks.filters.apply")}
        </Button>
      </form>
      <TaskList tasks={tasks} today={today} />
    </div>
  );
}
