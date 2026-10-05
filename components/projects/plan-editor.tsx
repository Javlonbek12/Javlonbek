import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ProjectTask } from "@/modules/projects/progress";

import {
  deletePhaseAction,
  savePhaseAction,
  saveProjectTaskAction,
  shiftProjectAction,
} from "@/app/(app)/projects/actions";

type Phase = { id: string; title: string; dueDate: string | null; sortOrder: number };

function TaskFields({
  task,
  phases,
  phaseId,
}: {
  task?: ProjectTask;
  phases: Phase[];
  phaseId: string | null;
}) {
  return (
    <div className="grid gap-2 text-sm sm:grid-cols-2">
      <label className="flex flex-col gap-1 sm:col-span-2">
        {t("projects.setup.taskTitle")}
        <Input name="title" required maxLength={200} defaultValue={task?.title} />
      </label>
      <label className="flex flex-col gap-1">
        {t("projects.setup.phase")}
        <NativeSelect name="phaseId" defaultValue={phaseId ?? ""}>
          <option value="">{t("projects.setup.noPhase")}</option>
          {phases.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1">
        {t("projects.setup.responsible")}
        <Input name="responsible" maxLength={120} defaultValue={task?.responsible ?? ""} />
      </label>
      <label className="flex flex-col gap-1">
        {t("projects.setup.start")}
        <Input type="date" name="startDate" defaultValue={task?.startDate ?? ""} />
      </label>
      <label className="flex flex-col gap-1">
        {t("projects.setup.due")}
        <Input type="date" name="dueDate" defaultValue={task?.dueDate ?? ""} />
      </label>
      <label className="flex flex-col gap-1">
        {t("projects.setup.code")}
        <Input name="code" maxLength={20} defaultValue={task?.code ?? ""} className="w-28" />
      </label>
      <label className="flex items-center gap-2 self-end pb-2">
        <input type="checkbox" name="isMilestone" defaultChecked={task?.isMilestone} />
        {t("projects.setup.milestone")}
      </label>
    </div>
  );
}

// "Phases and tasks": adjusting the plan to the project.
export function PlanEditor({
  projectId,
  anchor,
  phases,
  tasks,
}: {
  projectId: string;
  // The anchor day and what it means, if the project has one.
  anchor: { label: string; date: string } | null;
  phases: Phase[];
  tasks: ProjectTask[];
}) {
  const hidden = <input type="hidden" name="projectId" value={projectId} />;
  const groups = [
    ...phases.map((p) => ({
      phase: p as Phase | null,
      tasks: tasks.filter((x) => x.phaseId === p.id),
    })),
    { phase: null, tasks: tasks.filter((x) => x.phaseId === null) },
  ].filter((g) => g.phase || g.tasks.length);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t("projects.setup.intro")}</p>

      {anchor && (
        <Card className="gap-2">
          <CardTitle>
            {t("projects.setup.anchor", { label: anchor.label, date: formatDay(anchor.date) })}
          </CardTitle>
          <CardDescription>{t("projects.setup.shiftHint")}</CardDescription>
          <form action={shiftProjectAction} className="flex flex-wrap items-center gap-2">
            {hidden}
            <Input
              type="date"
              name="anchorDate"
              required
              defaultValue={anchor.date}
              className="w-auto"
            />
            <Button type="submit" variant="outline">
              {t("projects.setup.shift")}
            </Button>
          </form>
        </Card>
      )}

      <Card className="gap-3">
        <CardTitle>{t("projects.setup.phases")}</CardTitle>
        {phases.map((phase) => (
          <details key={phase.id} className="rounded-lg border p-2.5">
            <summary className="cursor-pointer text-sm">
              <span className="font-medium">{phase.title}</span>
              {phase.dueDate && (
                <span className="text-muted-foreground"> · {formatDay(phase.dueDate)}</span>
              )}
            </summary>
            <form
              action={savePhaseAction}
              className="mt-2 grid gap-2 text-sm sm:grid-cols-[1fr_auto_auto]"
            >
              {hidden}
              <input type="hidden" name="phaseId" value={phase.id} />
              <Input
                name="title"
                required
                maxLength={200}
                defaultValue={phase.title}
                aria-label={t("projects.setup.phaseTitle")}
              />
              <Input
                type="date"
                name="dueDate"
                defaultValue={phase.dueDate ?? ""}
                aria-label={t("projects.setup.phaseDue")}
                className="w-auto"
              />
              <Input
                type="number"
                name="sortOrder"
                min={0}
                max={999}
                defaultValue={phase.sortOrder}
                aria-label={t("projects.setup.order")}
                className="w-20"
              />
              <div className="flex flex-wrap gap-2 sm:col-span-3">
                <Button type="submit" size="sm">
                  {t("projects.setup.save")}
                </Button>
              </div>
            </form>
            <form action={deletePhaseAction} className="mt-2 flex items-center gap-2">
              {hidden}
              <input type="hidden" name="phaseId" value={phase.id} />
              <Button type="submit" size="sm" variant="ghost" className="text-destructive">
                {t("projects.setup.deletePhase")}
              </Button>
              <span className="text-muted-foreground text-xs">
                {t("projects.setup.deletePhaseHint")}
              </span>
            </form>
          </details>
        ))}
        <details className="rounded-lg border border-dashed p-2.5">
          <summary className="cursor-pointer text-sm font-medium">
            + {t("projects.setup.addPhase")}
          </summary>
          <form
            action={savePhaseAction}
            className="mt-2 grid gap-2 text-sm sm:grid-cols-[1fr_auto_auto]"
          >
            {hidden}
            <Input
              name="title"
              required
              maxLength={200}
              placeholder={t("projects.setup.phaseTitle")}
            />
            <Input
              type="date"
              name="dueDate"
              aria-label={t("projects.setup.phaseDue")}
              className="w-auto"
            />
            <Input
              type="number"
              name="sortOrder"
              min={0}
              max={999}
              defaultValue={phases.length}
              aria-label={t("projects.setup.order")}
              className="w-20"
            />
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">
                {t("projects.setup.addPhase")}
              </Button>
            </div>
          </form>
        </details>
      </Card>

      <Card className="gap-3">
        <CardTitle>{t("projects.setup.tasks")}</CardTitle>
        <details className="rounded-lg border border-dashed p-2.5">
          <summary className="cursor-pointer text-sm font-medium">
            + {t("projects.setup.addTask")}
          </summary>
          <form action={saveProjectTaskAction} className="mt-2 flex flex-col gap-2">
            {hidden}
            <TaskFields phases={phases} phaseId={phases[0]?.id ?? null} />
            <div>
              <Button type="submit" size="sm">
                {t("projects.setup.addTask")}
              </Button>
            </div>
          </form>
        </details>
        {groups.map(({ phase, tasks: own }) => (
          <div key={phase?.id ?? "none"} className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              {phase?.title ?? t("projects.phases.noPhase")}
            </span>
            {own.map((task) => {
              const closed = task.status === "DONE" || task.status === "CANCELLED";
              return (
                <details key={task.id} className="rounded-lg border p-2.5">
                  <summary className="cursor-pointer text-sm">
                    {task.code && <span className="text-muted-foreground">{task.code} · </span>}
                    <span className={cn(closed && "text-muted-foreground line-through")}>
                      {task.title}
                    </span>
                    {task.isMilestone && " ◆"}
                    <span className="text-muted-foreground text-xs">
                      {" · "}
                      {task.dueDate
                        ? `${formatDay(task.startDate ?? task.dueDate)} – ${formatDay(task.dueDate)}`
                        : "—"}
                      {task.responsible && ` · ${task.responsible}`}
                    </span>
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    {closed ? (
                      <span className="text-muted-foreground text-xs">
                        {t("projects.setup.closed")}
                      </span>
                    ) : (
                      <form action={saveProjectTaskAction} className="flex flex-col gap-2">
                        {hidden}
                        <input type="hidden" name="taskId" value={task.id} />
                        <TaskFields task={task} phases={phases} phaseId={task.phaseId} />
                        <div>
                          <Button type="submit" size="sm">
                            {t("projects.setup.save")}
                          </Button>
                        </div>
                      </form>
                    )}
                    <Link href={`/tasks/${task.id}`} className="text-sm underline">
                      {t("projects.setup.openTask")}
                    </Link>
                  </div>
                </details>
              );
            })}
          </div>
        ))}
      </Card>
    </div>
  );
}
