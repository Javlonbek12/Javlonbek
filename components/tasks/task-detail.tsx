import {
  CalendarDays,
  ExternalLink,
  FileText,
  Folder,
  Lock,
  Pencil,
  Repeat,
  X,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  addCommentAction,
  addDependencyAction,
  addCoAssigneeAction,
  addLinkAction,
  decideCoAssigneeAction,
  removeCoAssigneeAction,
  setTaskLabelsAction,
  withdrawCoAssigneeRequestAction,
  changeStatusAction,
  removeAttachmentAction,
  removeDependencyAction,
  resolveDeleteTaskAction,
  updateTaskFieldAction,
} from "@/app/(app)/tasks/actions";
import { setTaskRiskAction } from "@/app/(app)/projects/actions";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { CoAssigneePicker } from "@/components/tasks/co-assignee-picker";
import { DetailTabs } from "@/components/tasks/detail-tabs";
import { QuickCircle } from "@/components/tasks/quick-circle";
import { StepsTab } from "@/components/tasks/steps-tab";
import { TaskNotes } from "@/components/tasks/task-notes";
import { PriorityBadge, StatusBadge } from "@/components/tasks/task-badges";
import { TaskActions } from "@/components/tasks/task-actions";
import { TaskDeleteControl } from "@/components/tasks/task-delete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { daysBetween, formatDay, toDateString, todayInTimezone } from "@/lib/dates";
import type { TaskSeries } from "@/lib/generated/prisma/client";
import { TaskPriority } from "@/lib/generated/prisma/enums";
import { t, type TranslationKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Actor } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { projectOfTask } from "@/modules/projects/service";
import { canControl, isClosed, isDoer } from "@/modules/tasks/access";
import { listAttachments, MAX_FILE_MB } from "@/modules/tasks/attachment-service";
import { withParams } from "@/modules/tasks/back";
import { listComments } from "@/modules/tasks/comment-service";
import { getDeleteMode } from "@/modules/tasks/delete-service";
import { getDependencies, listBlockerCandidates } from "@/modules/tasks/dependency-service";
import { quickTarget } from "@/modules/tasks/quick";
import { routeHints } from "@/modules/tasks/route-hints";
import {
  getTaskDetail,
  getTaskHistory,
  listAssignableUsers,
  listProjects,
} from "@/modules/tasks/service";
import { getTaskSettings } from "@/modules/tasks/settings";
import {
  canPlanSteps,
  canTickSteps,
  stepPeopleIds,
  stepProgress,
} from "@/modules/tasks/step-rules";
import { canLabelTask, knownLabels } from "@/modules/tasks/labels";
import {
  canDecideCoAssignee,
  canJoin,
  canManageCoAssignees,
  coAssigneeHints,
  getCoAssignees,
} from "@/modules/tasks/co-assignees";
import { canEditNote, getNote } from "@/modules/tasks/notes";
import { listSteps } from "@/modules/tasks/steps";
import { isOverdue } from "@/modules/tasks/today";

// The task card. One view for both places a task opens: its own page (links from notifications
// and the bot) and the panel next to the list. Every form in it comes back to where it was sent
// from (`base`), on the tab it was sent from.

const FIELD_LABELS: Record<string, TranslationKey> = {
  title: "tasks.fields.title",
  description: "tasks.fields.description",
  assigneeId: "tasks.fields.assignee",
  startDate: "tasks.fields.startDate",
  dueDate: "tasks.fields.dueDate",
  priority: "tasks.fields.priority",
  project: "tasks.fields.project",
  planId: "tasks.fields.plan",
  estimateMinutes: "tasks.fields.estimate",
};

function historyText(action: string, details: unknown): string {
  const key = action.replace("task.", "");
  const label = t(`tasks.history.actions.${key}` as TranslationKey);
  if (action === "task.status_changed" && details && typeof details === "object") {
    const { from, to } = details as { from: string; to: string };
    return `${label}: ${t(`tasks.status.${from}` as TranslationKey)} → ${t(`tasks.status.${to}` as TranslationKey)}`;
  }
  if (action.startsWith("task.coassignee_") && details && typeof details === "object") {
    const { name } = details as { name?: string };
    return name ? `${label}: ${name}` : label;
  }
  if (action.startsWith("task.step_") && details && typeof details === "object") {
    const { title } = details as { title?: string };
    return title ? `${label} «${title}»` : label;
  }
  if (action === "task.updated" && details && typeof details === "object") {
    const fields = Object.keys(details).map((f) => (FIELD_LABELS[f] ? t(FIELD_LABELS[f]) : f));
    return `${label}: ${fields.join(", ")}`;
  }
  return label;
}

// "каждую неделю, по дням: пн, ср · до 31 дек. · следующая: 9 нояб."
// A date of the rule, with its year when it is not this year («до 5 дек. 2027»).
function ruleDay(value: Date, today: string): string {
  const day = toDateString(value);
  return day.slice(0, 4) === today.slice(0, 4)
    ? formatDay(day)
    : `${formatDay(day)} ${day.slice(0, 4)}`;
}

function repeatSummary(series: TaskSeries, today: string): string {
  const unit = t(`tasks.repeat.unit.${series.frequency}`);
  const parts = [
    series.interval > 1
      ? t("tasks.repeat.summary.everyN", { n: series.interval, unit })
      : t(`tasks.repeat.summary.${series.frequency}`),
  ];
  if (series.frequency === "WEEKLY" && series.weekdays.length)
    parts.push(
      t("tasks.repeat.summary.on", {
        days: [...series.weekdays]
          .sort()
          .map((d) => t(`tasks.repeat.days.${d}` as TranslationKey))
          .join(", "),
      }),
    );
  if (series.frequency === "MONTHLY" && series.monthDay)
    parts.push(t("tasks.repeat.summary.monthDay", { day: series.monthDay }));
  const text = [parts.join(", ")];
  if (series.until)
    text.push(t("tasks.repeat.summary.until", { date: ruleDay(series.until, today) }));
  text.push(
    series.nextDate
      ? t("tasks.repeat.summary.next", { date: ruleDay(series.nextDate, today) })
      : t("tasks.repeat.summary.stopped"),
  );
  return text.join(" · ");
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

// One property of the task with «Изменить»: the form opens in place.
function Field({
  label,
  children,
  edit,
}: {
  label: string;
  children: ReactNode;
  edit?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-2 text-sm">
      <span className="text-muted-foreground pt-0.5">{label}</span>
      {edit ? (
        <details className="group min-w-0">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">{children}</span>
            <span className="text-primary shrink-0 text-xs font-medium group-open:hidden">
              {t("tasks.panel.change")}
            </span>
            <span className="text-muted-foreground hidden shrink-0 text-xs group-open:inline">
              {t("tasks.panel.cancel")}
            </span>
          </summary>
          <div className="mt-2">{edit}</div>
        </details>
      ) : (
        <span className="min-w-0">{children}</span>
      )}
    </div>
  );
}

type Props = {
  user: Actor & { id: string };
  taskId: string;
  variant: "page" | "panel";
  // Where this view lives (without error, notice and tab): forms come back here.
  base: string;
  tab?: string;
  error?: string;
  notice?: string;
  // The panel's ✕: the list without the task.
  closeHref?: string;
};

export async function TaskDetail({
  user,
  taskId,
  variant,
  base,
  tab,
  error,
  notice,
  closeHref,
}: Props) {
  const detail = await getTaskDetail(user, taskId);
  if (!detail)
    return (
      <div className="flex flex-col gap-3 p-4 text-sm">
        <p className="text-muted-foreground">{t("tasks.panel.unavailable")}</p>
        {closeHref && (
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href={closeHref}>{t("tasks.panel.close")}</Link>
          </Button>
        )}
      </div>
    );
  const { task, buttons, route, cancelledBlockers, canEdit } = detail;
  const assigneeEditable =
    canEdit && !task.isPersonal && ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(task.status);
  const coManage = canManageCoAssignees(user, task);

  const [
    settings,
    deps,
    candidates,
    comments,
    attachments,
    history,
    project,
    deleteMode,
    taskSettings,
    projects,
    people,
    hints,
    steps,
    note,
    allLabels,
    co,
    coPeople,
    coHints,
  ] = await Promise.all([
    getSettings(user.id),
    getDependencies(user, task.id),
    canEdit ? listBlockerCandidates(user, task.id) : Promise.resolve([]),
    listComments(task.id),
    listAttachments(task.id),
    getTaskHistory(task.id),
    projectOfTask(task),
    getDeleteMode(user, task.id),
    getTaskSettings(),
    canEdit ? listProjects(user) : Promise.resolve([]),
    assigneeEditable ? listAssignableUsers() : Promise.resolve([]),
    assigneeEditable
      ? routeHints(task.creatorId)
      : Promise.resolve({} as Awaited<ReturnType<typeof routeHints>>),
    listSteps(task.id),
    getNote(task.id),
    canLabelTask(user, task) ? knownLabels(user) : Promise.resolve([] as string[]),
    task.isPersonal ? Promise.resolve(null) : getCoAssignees(task),
    coManage ? listAssignableUsers() : Promise.resolve([]),
    coManage ? coAssigneeHints(user.id) : Promise.resolve({} as Record<string, string>),
  ]);
  const labelable = canLabelTask(user, task);
  const tz = settings.timezone;
  const today = todayInTimezone(tz);
  const overdue = isOverdue(task, today);
  const days = task.dueDate ? daysBetween(today, task.dueDate) : null;
  const open = !isClosed(task.status);
  const back = (key: string) => withParams(base, { tab: key });
  const hidden = (key: string) => (
    <>
      <input type="hidden" name="taskId" value={task.id} />
      <input type="hidden" name="back" value={back(key)} />
    </>
  );
  const shownNotice = (["sent", "rejected", "withdrawn"] as const).find((n) => n === notice);
  const deleteRequest = task.deleteRequestedAt
    ? {
        at: task.deleteRequestedAt,
        name: task.deleteRequestedBy ? displayName(task.deleteRequestedBy) : "—",
        own: task.deleteRequestedById === user.id,
        canDecide: !task.isPersonal && canControl(user, task),
      }
    : null;
  // Open blockers the user can't see (e.g. someone else's task): count only, no details.
  const hiddenBlockers = Math.max(
    0,
    task.openBlockers - deps.blockedBy.filter((b) => !isClosed(b.status)).length,
  );
  const target = quickTarget(user, task);
  const main = buttons.find(
    (b) => b.variant === "default" && b.reason === null && b.to !== "PENDING_APPROVAL",
  );
  const panel = variant === "panel";
  const fieldForm = (field: string, control: ReactNode) => (
    <form action={updateTaskFieldAction} className="flex flex-col gap-2">
      {hidden("description")}
      <input type="hidden" name="field" value={field} />
      {control}
      <Button type="submit" size="sm" className="self-start">
        {t("tasks.panel.save")}
      </Button>
    </form>
  );

  const coEdit = co && (
    <div className="flex flex-col gap-3">
      {co.people.length > 0 && (
        <ul className="flex flex-col gap-1">
          {co.people.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{p.name}</span>
              {(coManage || (p.id === user.id && open)) && (
                <form action={removeCoAssigneeAction}>
                  {hidden("description")}
                  <input type="hidden" name="userId" value={p.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    {p.id === user.id
                      ? t("tasks.coAssignees.leave")
                      : t("tasks.coAssignees.remove")}
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {co.requests.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0">
            {r.name}{" "}
            <span className="text-muted-foreground text-xs">
              — {t("tasks.coAssignees.waiting", { names: r.deciders.join(", ") })}
            </span>
          </span>
          <span className="flex flex-wrap gap-1">
            {open && canDecideCoAssignee(user, r) && (
              <form action={decideCoAssigneeAction} className="flex gap-1">
                <input type="hidden" name="requestId" value={r.id} />
                <input type="hidden" name="back" value={back("description")} />
                <Button type="submit" size="sm" name="decision" value="approve">
                  {t("tasks.coAssignees.approve")}
                </Button>
                <Button type="submit" size="sm" variant="outline" name="decision" value="decline">
                  {t("tasks.coAssignees.decline")}
                </Button>
              </form>
            )}
            {(r.requestedById === user.id || coManage) && (
              <form action={withdrawCoAssigneeRequestAction}>
                {hidden("description")}
                <input type="hidden" name="requestId" value={r.id} />
                <Button type="submit" size="sm" variant="ghost">
                  {t("tasks.coAssignees.withdraw")}
                </Button>
              </form>
            )}
          </span>
        </div>
      ))}
      {coManage && (
        <form action={addCoAssigneeAction} className="flex flex-col gap-2">
          {hidden("description")}
          <CoAssigneePicker
            people={coPeople
              .filter((p) => canJoin(p.id, task) && !co.requests.some((r) => r.userId === p.id))
              .map((p) => ({ id: p.id, label: displayName(p) }))}
            hints={coHints}
          />
          <Button type="submit" size="sm" className="self-start">
            {t("tasks.coAssignees.add")}
          </Button>
        </form>
      )}
    </div>
  );

  const stepCount = stepProgress(steps);
  const tickSteps = canTickSteps(user, task);
  const stepsTab = (
    <StepsTab
      taskId={task.id}
      status={task.status}
      steps={steps}
      back={back("work")}
      today={today}
      plan={canPlanSteps(user, task)}
      tick={tickSteps}
      mine={isDoer(user, task)}
      people={stepPeopleIds(task).map((id) => ({
        id,
        name:
          id === task.assigneeId
            ? displayName(task.assignee)
            : id === task.creatorId
              ? displayName(task.creator)
              : (co?.people.find((p) => p.id === id)?.name ?? "?"),
      }))}
      finish={
        tickSteps && target
          ? {
              label:
                target === "IN_REVIEW"
                  ? t("tasks.panel.quick.IN_REVIEW")
                  : t("tasks.panel.quick.DONE"),
            }
          : null
      }
    />
  );

  const descriptionTab = (
    <>
      {task.description ? (
        <p className="text-sm whitespace-pre-wrap">{task.description}</p>
      ) : (
        <p className="text-muted-foreground text-sm">{t("tasks.panel.noDescription")}</p>
      )}
      {(route.deciders.length > 0 || route.reviewer || route.approvedBy || route.acceptedBy) && (
        <ul className="text-muted-foreground flex flex-col gap-0.5 text-sm">
          {route.deciders.length > 0 && (
            <li className="font-medium text-amber-700 dark:text-amber-300">
              {t("tasks.decision.waiting", { names: route.deciders.join(", ") })}
            </li>
          )}
          {route.approvedBy && (
            <li>{t("tasks.decision.approvedBy", { name: route.approvedBy })}</li>
          )}
          {route.reviewer && <li>{t("tasks.decision.reviewer", { name: route.reviewer })}</li>}
          {route.acceptedBy && (
            <li>{t("tasks.decision.acceptedBy", { name: route.acceptedBy })}</li>
          )}
        </ul>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {!task.isPersonal && (
          <>
            <dt className="text-muted-foreground">{t("tasks.fields.creator")}</dt>
            <dd>{displayName(task.creator)}</dd>
          </>
        )}
        {task.series && (
          <>
            <dt className="text-muted-foreground">{t("tasks.repeat.title")}</dt>
            <dd className="flex items-center gap-1.5">
              <Repeat className="size-3.5 shrink-0" aria-hidden />
              {repeatSummary(task.series, today)}
            </dd>
          </>
        )}
        {task.estimateMinutes !== null && (
          <>
            <dt className="text-muted-foreground">{t("tasks.fields.estimate")}</dt>
            <dd>{task.estimateMinutes / 60}</dd>
          </>
        )}
        {task.meeting && (
          <>
            <dt className="text-muted-foreground">{t("nav.meetings")}</dt>
            <dd>
              <Link className="underline" href={`/meetings/${task.meeting.id}`}>
                {task.meeting.title}
              </Link>
            </dd>
          </>
        )}
        {task.code && (
          <>
            <dt className="text-muted-foreground">{t("projects.task.code")}</dt>
            <dd>{task.code}</dd>
          </>
        )}
        {task.responsible && (
          <>
            <dt className="text-muted-foreground">{t("projects.task.responsible")}</dt>
            <dd>{task.responsible}</dd>
          </>
        )}
        {task.plan && (
          <>
            <dt className="text-muted-foreground">{t("tasks.fields.plan")}</dt>
            <dd>
              <Link className="underline" href={`/tasks/plans/${task.plan.id}`}>
                {task.plan.title}
              </Link>
            </dd>
          </>
        )}
      </dl>
      {project && canEdit && open && (
        <form action={setTaskRiskAction}>
          {hidden("description")}
          <input type="hidden" name="atRisk" value={task.atRisk ? "0" : "1"} />
          <Button type="submit" size="sm" variant="outline">
            {task.atRisk ? t("projects.risk.clear") : t("projects.risk.mark")}
          </Button>
        </form>
      )}

      <div className="flex flex-col gap-2 border-t pt-3">
        <span className="text-sm font-medium">{t("tasks.dependencies.title")}</span>
        {task.openBlockers > 0 && open && (
          <p className="text-destructive flex items-center gap-1 text-sm">
            <Lock className="size-4" />
            {t("tasks.dependencies.openBlockers", { count: task.openBlockers })}
          </p>
        )}
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("tasks.dependencies.blockedBy")}</span>
          {deps.blockedBy.length === 0 && hiddenBlockers === 0 && (
            <span>{t("tasks.fields.none")}</span>
          )}
          {deps.blockedBy.map((blocker) => (
            <div key={blocker.id} className="flex items-center justify-between gap-2">
              <Link
                href={`/tasks/${blocker.id}`}
                className={cn("underline", !isClosed(blocker.status) && "text-destructive")}
              >
                {blocker.title}
              </Link>
              <span className="flex items-center gap-1">
                <StatusBadge status={blocker.status} />
                {canEdit && (
                  <form action={removeDependencyAction}>
                    {hidden("description")}
                    <input type="hidden" name="blockerId" value={blocker.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t("tasks.dependencies.remove")}
                    </Button>
                  </form>
                )}
              </span>
            </div>
          ))}
        </div>
        {hiddenBlockers > 0 && (
          <p className="text-muted-foreground text-sm">
            {t("tasks.dependencies.hidden", { count: hiddenBlockers })}
          </p>
        )}
        {canEdit && candidates.length > 0 && (
          <form action={addDependencyAction} className="flex flex-wrap gap-2">
            {hidden("description")}
            <NativeSelect
              name="blockerId"
              className="min-w-0 flex-1"
              aria-label={t("tasks.dependencies.add")}
            >
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" variant="outline" size="sm">
              {t("tasks.dependencies.add")}
            </Button>
          </form>
        )}
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("tasks.dependencies.blocks")}</span>
          {deps.blocks.length === 0 && <span>{t("tasks.fields.none")}</span>}
          {deps.blocks.map((blocked) => (
            <div key={blocked.id} className="flex items-center justify-between gap-2">
              <Link href={`/tasks/${blocked.id}`} className="underline">
                {blocked.title}
              </Link>
              <StatusBadge status={blocked.status} />
            </div>
          ))}
        </div>
        {(deps.upstream.length > 1 || deps.downstream.length > 1) && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("tasks.dependencies.chain")}</span>
            <ol className="flex flex-wrap items-center gap-1">
              {[
                ...deps.upstream,
                { id: task.id, title: task.title, status: task.status },
                ...deps.downstream,
              ].map((item, index) => (
                <li key={item.id} className="flex items-center gap-1">
                  {index > 0 && <span className="text-muted-foreground">→</span>}
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-xs",
                      item.id === task.id && "border-primary font-medium",
                      !isClosed(item.status) && item.id !== task.id && "border-amber-500",
                      isClosed(item.status) && "text-muted-foreground line-through",
                    )}
                  >
                    {item.title}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </>
  );

  const filesTab = (
    <>
      {attachments.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("tasks.attachments.none")}</p>
      )}
      {attachments.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
          <a
            className="flex min-w-0 items-center gap-1.5 underline"
            href={a.kind === "LINK" ? a.url! : `/api/attachments/${a.id}`}
            target={a.kind === "LINK" ? "_blank" : undefined}
            rel="noopener noreferrer"
          >
            {a.kind === "LINK" ? (
              <ExternalLink className="size-4 shrink-0" />
            ) : (
              <FileText className="size-4 shrink-0" />
            )}
            <span className="truncate">{a.title}</span>
            {a.sizeBytes !== null && (
              <span className="text-muted-foreground shrink-0">({formatSize(a.sizeBytes)})</span>
            )}
          </a>
          {(a.uploadedById === user.id || canEdit) && (
            <form action={removeAttachmentAction}>
              {hidden("files")}
              <input type="hidden" name="attachmentId" value={a.id} />
              <Button type="submit" variant="ghost" size="sm">
                {t("tasks.attachments.remove")}
              </Button>
            </form>
          )}
        </div>
      ))}
      <form
        action={addLinkAction}
        className={cn("grid gap-2", !panel && "md:grid-cols-[1fr_2fr_auto]")}
      >
        {hidden("files")}
        <Input name="title" placeholder={t("tasks.attachments.linkTitle")} maxLength={200} />
        <Input name="url" type="url" required placeholder={t("tasks.attachments.linkUrl")} />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className={cn(panel && "justify-self-start")}
        >
          {t("tasks.attachments.addLink")}
        </Button>
      </form>
      <form
        action={`/api/tasks/${task.id}/attachments`}
        method="post"
        encType="multipart/form-data"
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="back" value={back("files")} />
        <Input
          type="file"
          name="file"
          required
          className="min-w-0 flex-1"
          aria-label={t("tasks.attachments.file")}
        />
        <Button type="submit" variant="outline" size="sm">
          {t("tasks.attachments.upload")}
        </Button>
      </form>
    </>
  );

  const commentsTab = (
    <>
      {comments.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("tasks.comments.none")}</p>
      )}
      {comments.map((c) => (
        <div key={c.id} className="flex flex-col gap-0.5 text-sm">
          <span className="text-muted-foreground text-xs">
            {displayName(c.author)} · {formatDateTime(c.createdAt, tz)}
          </span>
          <p className="whitespace-pre-wrap">{c.body}</p>
        </div>
      ))}
      <form action={addCommentAction} className="flex flex-col gap-2">
        {hidden("comments")}
        <Textarea
          name="body"
          required
          maxLength={2000}
          placeholder={t("tasks.comments.placeholder")}
        />
        <Button type="submit" size="sm" className="self-start">
          {t("tasks.comments.add")}
        </Button>
      </form>
    </>
  );

  const historyTab = (
    <>
      {history.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("tasks.history.none")}</p>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {history.map((h) => (
          <li key={h.id}>
            <span className="text-muted-foreground text-xs">{formatDateTime(h.createdAt, tz)}</span>{" "}
            {h.actor ? displayName(h.actor) : ""} {historyText(h.action, h.details)}
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <div className={cn("flex flex-col gap-4", panel ? "p-4 md:p-5" : "")}>
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <QuickCircle
            taskId={task.id}
            status={task.status}
            target={target}
            accepts={target === "DONE" && !task.isPersonal && !isDoer(user, task)}
            blocked={target === "DONE" && task.openBlockers > 0}
            back={withParams(base, {})}
            size="lg"
          />
        </div>
        <h2 className="min-w-0 flex-1 text-lg font-semibold break-words md:text-xl">
          {task.title}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {canEdit && (
            <Button asChild variant="ghost" size="icon" className="size-8">
              <Link
                href={`/tasks/${task.id}/edit`}
                aria-label={t("tasks.edit")}
                title={t("tasks.edit")}
              >
                <Pencil />
              </Link>
            </Button>
          )}
          {panel && (
            <Button asChild variant="ghost" size="icon" className="size-8">
              <Link
                href={`/tasks/${task.id}`}
                aria-label={t("tasks.panel.openPage")}
                title={t("tasks.panel.openPage")}
              >
                <ExternalLink />
              </Link>
            </Button>
          )}
          {closeHref && (
            <Button asChild variant="ghost" size="icon" className="size-8">
              <Link
                href={closeHref}
                aria-label={t("tasks.panel.close")}
                title={t("tasks.panel.close")}
              >
                <X />
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="-mt-2 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={task.status} />
        {task.isPersonal && <Badge variant="outline">{t("tasks.fields.personalShort")}</Badge>}
        <PriorityBadge priority={task.priority} />
        {task.dueDate && (
          <Badge
            variant="outline"
            className={cn(overdue && "border-destructive/40 text-destructive")}
          >
            <CalendarDays className="size-3" />
            {formatDay(task.dueDate)}
          </Badge>
        )}
        {overdue && days !== null && (
          <span className="text-destructive text-xs">
            {t("tasks.look.overdueBy", { count: -days })}
          </span>
        )}
        {task.isMilestone && <Badge variant="outline">◆ {t("projects.task.milestone")}</Badge>}
        {task.atRisk && open && (
          <Badge className="bg-amber-500 text-white">{t("projects.risk.badge")}</Badge>
        )}
        {task.needsApproval && <Badge variant="outline">{t("tasks.decision.needsApproval")}</Badge>}
        {task.historical && <Badge variant="outline">{t("tasks.decision.historical")}</Badge>}
      </div>

      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`tasks.errors.${error}` as TranslationKey, { mb: MAX_FILE_MB })}
        </p>
      )}
      {shownNotice && (
        <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
          {t(`tasks.remove.${shownNotice}`)}
        </p>
      )}
      {deleteRequest && (
        <div className="border-destructive/30 bg-destructive/5 flex flex-col gap-2 rounded-xl border p-3 text-sm">
          <span className="font-medium">
            {t("tasks.remove.pending", {
              name: deleteRequest.name,
              date: formatDateTime(deleteRequest.at, tz),
            })}
          </span>
          {task.deleteReason && (
            <span className="text-muted-foreground">
              {t("tasks.remove.pendingReason", { reason: task.deleteReason })}
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            {deleteRequest.canDecide && (
              <>
                <form action={resolveDeleteTaskAction}>
                  {hidden("description")}
                  <input type="hidden" name="decision" value="approve" />
                  <Button type="submit" size="sm" variant="destructive">
                    {t("tasks.remove.approve")}
                  </Button>
                </form>
                {!deleteRequest.own && (
                  <form action={resolveDeleteTaskAction}>
                    {hidden("description")}
                    <input type="hidden" name="decision" value="reject" />
                    <Button type="submit" size="sm" variant="outline">
                      {t("tasks.remove.reject")}
                    </Button>
                  </form>
                )}
              </>
            )}
            {deleteRequest.own && (
              <form action={resolveDeleteTaskAction}>
                {hidden("description")}
                <input type="hidden" name="decision" value="withdraw" />
                <Button type="submit" size="sm" variant="outline">
                  {t("tasks.remove.withdraw")}
                </Button>
              </form>
            )}
          </div>
        </div>
      )}

      <DetailTabs
        initial={tab ?? "description"}
        tabs={[
          { key: "description", label: t("tasks.panel.tabs.description"), content: descriptionTab },
          {
            key: "work",
            label: t("tasks.panel.tabs.work"),
            badge: stepCount.total ? `${stepCount.done}/${stepCount.total}` : undefined,
            content: stepsTab,
          },
          {
            key: "notes",
            label: t("tasks.panel.tabs.notes"),
            badge: note.text.trim() ? "•" : undefined,
            content: (
              <TaskNotes
                key={`${task.id}-${note.version}`}
                taskId={task.id}
                initial={note}
                canEdit={canEditNote(user, task)}
              />
            ),
          },
          {
            key: "files",
            label: t("tasks.panel.tabs.files"),
            count: attachments.length,
            content: filesTab,
          },
          {
            key: "comments",
            label: t("tasks.panel.tabs.comments"),
            count: comments.length,
            content: commentsTab,
          },
          { key: "history", label: t("tasks.panel.tabs.history"), content: historyTab },
        ]}
      />

      <div className="divide-y border-t">
        <Field
          label={t("tasks.panel.project")}
          edit={
            canEdit && open
              ? fieldForm(
                  "project",
                  <>
                    <Input
                      name="value"
                      list={`projects-${task.id}`}
                      maxLength={60}
                      defaultValue={task.project ?? ""}
                    />
                    <datalist id={`projects-${task.id}`}>
                      {projects.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </>,
                )
              : undefined
          }
        >
          {project ? (
            <span className="flex items-center gap-1.5">
              <Folder className="text-primary size-4 shrink-0" />
              <Link className="truncate underline" href={`/projects/${project.id}`}>
                {project.name}
              </Link>
              {project.phase && <span className="text-muted-foreground">· {project.phase}</span>}
            </span>
          ) : task.project ? (
            <span className="flex items-center gap-1.5">
              <Folder className="text-primary size-4 shrink-0" />
              {task.project}
            </span>
          ) : (
            t("tasks.fields.none")
          )}
        </Field>
        {!task.isPersonal && (
          <Field
            label={t("tasks.fields.assignee")}
            edit={
              assigneeEditable
                ? fieldForm(
                    "assigneeId",
                    <AssigneePicker
                      initial={task.assigneeId}
                      people={people.map((p) => ({ id: p.id, label: displayName(p) }))}
                      hints={Object.fromEntries(
                        Object.entries(hints).map(([id, hint]) => [id, hint.plain.text]),
                      )}
                    />,
                  )
                : undefined
            }
          >
            {displayName(task.assignee)}
          </Field>
        )}
        {co && (co.people.length > 0 || co.requests.length > 0 || coManage) && (
          <Field
            label={t("tasks.coAssignees.title")}
            edit={
              coManage ||
              co.people.some((p) => p.id === user.id) ||
              co.requests.some((r) => r.requestedById === user.id || canDecideCoAssignee(user, r))
                ? coEdit
                : undefined
            }
          >
            {co.people.length === 0 && co.requests.length === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span className="flex flex-col gap-0.5">
                {co.people.length > 0 && <span>{co.people.map((p) => p.name).join(", ")}</span>}
                {co.requests.map((r) => (
                  <span key={r.id} className="text-muted-foreground text-xs">
                    {r.name} — {t("tasks.coAssignees.waiting", { names: r.deciders.join(", ") })}
                  </span>
                ))}
              </span>
            )}
          </Field>
        )}
        <Field
          label={t("tasks.fields.dueDate")}
          edit={
            canEdit && open
              ? fieldForm(
                  "dueDate",
                  <Input type="date" name="value" defaultValue={task.dueDate ?? ""} />,
                )
              : undefined
          }
        >
          <span className={cn(overdue && "text-destructive font-medium")}>
            {task.dueDate ? formatDay(task.dueDate) : t("tasks.fields.none")}
            {overdue && days !== null && ` · ${t("tasks.look.overdueBy", { count: -days })}`}
          </span>
        </Field>
        {task.startDate && (
          <Field label={t("tasks.fields.startDate")}>{formatDay(task.startDate)}</Field>
        )}
        <Field
          label={t("tasks.fields.priority")}
          edit={
            canEdit && open
              ? fieldForm(
                  "priority",
                  <NativeSelect name="value" defaultValue={task.priority} className="w-full">
                    {Object.values(TaskPriority).map((p) => (
                      <option key={p} value={p}>
                        {t(`tasks.priority.${p}`)}
                      </option>
                    ))}
                  </NativeSelect>,
                )
              : undefined
          }
        >
          {t(`tasks.priority.${task.priority}`)}
        </Field>
        <Field
          label={t("tasks.fields.status")}
          edit={
            buttons.length > 0 ? (
              <div className="flex flex-col items-start gap-2">
                <TaskActions
                  taskId={task.id}
                  buttons={buttons}
                  action={changeStatusAction}
                  openBlockers={task.openBlockers}
                  cancelledBlockers={cancelledBlockers}
                  back={back("description")}
                />
              </div>
            ) : undefined
          }
        >
          <StatusBadge status={task.status} />
        </Field>
        {(task.labels.length > 0 || labelable) && (
          <Field
            label={t("tasks.panel.labels")}
            edit={
              labelable ? (
                <form action={setTaskLabelsAction} className="flex flex-col gap-2">
                  {hidden("description")}
                  <Input
                    name="value"
                    list={`labels-${task.id}`}
                    defaultValue={task.labels.join(", ")}
                    placeholder={t("tasks.labels.placeholder")}
                    aria-label={t("tasks.panel.labels")}
                    maxLength={400}
                  />
                  <datalist id={`labels-${task.id}`}>
                    {allLabels
                      .filter((l) => !task.labels.includes(l))
                      .map((l) => (
                        <option key={l} value={[...task.labels, l].join(", ")} />
                      ))}
                  </datalist>
                  <span className="text-muted-foreground text-xs">{t("tasks.labels.hint")}</span>
                  <Button type="submit" size="sm" className="self-start">
                    {t("tasks.panel.save")}
                  </Button>
                </form>
              ) : undefined
            }
          >
            {task.labels.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {task.labels.map((label) => (
                  <Link key={label} href={`/tasks?label=${encodeURIComponent(label)}`}>
                    <Badge variant="secondary" className="hover:bg-secondary/70">
                      {label}
                    </Badge>
                  </Link>
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
        )}
      </div>

      <TaskDeleteControl
        taskId={task.id}
        mode={deleteMode}
        requested={task.deleteRequestedAt !== null}
        trashDays={task.isPersonal ? null : taskSettings.trashDays}
        back={withParams(base, {})}
      />

      {(main || buttons.some((b) => b.reason === "required")) && (
        <div
          className={cn(
            "flex flex-wrap items-start justify-end gap-2",
            panel &&
              "bg-card/95 sticky bottom-0 -mx-4 -mb-4 border-t px-4 py-3 backdrop-blur md:-mx-5 md:-mb-5 md:px-5",
          )}
        >
          <TaskActions
            taskId={task.id}
            buttons={buttons}
            // The main step, and next to it the way back that needs a reason («Отклонить»,
            // «На доработку»): deciding happens in one place.
            only={(b) => b === main || b.reason === "required"}
            action={changeStatusAction}
            openBlockers={task.openBlockers}
            cancelledBlockers={cancelledBlockers}
            back={withParams(base, {})}
          />
        </div>
      )}
    </div>
  );
}
