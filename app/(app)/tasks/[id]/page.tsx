import { ExternalLink, FileText, Lock, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PriorityBadge, StatusBadge } from "@/components/tasks/task-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { isClosed } from "@/modules/tasks/access";
import { listAttachments, MAX_FILE_MB } from "@/modules/tasks/attachment-service";
import { listComments } from "@/modules/tasks/comment-service";
import { getDependencies, listBlockerCandidates } from "@/modules/tasks/dependency-service";
import { getTaskDetail, getTaskHistory } from "@/modules/tasks/service";
import { isOverdue } from "@/modules/tasks/today";
import { todayInTimezone } from "@/lib/dates";

import {
  addCommentAction,
  addDependencyAction,
  addLinkAction,
  changeStatusAction,
  removeAttachmentAction,
  removeDependencyAction,
} from "../actions";

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
  if (action === "task.updated" && details && typeof details === "object") {
    const fields = Object.keys(details).map((f) => (FIELD_LABELS[f] ? t(FIELD_LABELS[f]) : f));
    return `${label}: ${fields.join(", ")}`;
  }
  return label;
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default async function TaskPage({ params, searchParams }: PageProps<"/tasks/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { error } = await searchParams;
  const detail = await getTaskDetail(user, id);
  if (!detail) notFound();
  const { task, transitions, canEdit } = detail;

  const [settings, deps, candidates, comments, attachments, history] = await Promise.all([
    getSettings(user.id),
    getDependencies(user, id),
    canEdit ? listBlockerCandidates(user, id) : Promise.resolve([]),
    listComments(id),
    listAttachments(id),
    getTaskHistory(id),
  ]);
  const tz = settings.timezone;
  const today = todayInTimezone(tz);
  const overdue = isOverdue(task, today);
  const hidden = <input type="hidden" name="taskId" value={task.id} />;
  // Open blockers the user can't see (e.g. someone else's task): count only, no details.
  const hiddenBlockers = Math.max(
    0,
    task.openBlockers - deps.blockedBy.filter((b) => !isClosed(b.status)).length,
  );

  return (
    <div className="flex flex-col gap-4">
      {typeof error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`tasks.errors.${error}` as TranslationKey, { mb: MAX_FILE_MB })}
        </p>
      )}

      <Card className="gap-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-xl font-semibold break-words">{task.title}</h2>
          {canEdit && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/tasks/${task.id}/edit`} aria-label={t("tasks.edit")}>
                <Pencil />
                <span className="hidden sm:inline">{t("tasks.edit")}</span>
              </Link>
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {task.isPersonal && <Badge variant="outline">{t("tasks.fields.personalShort")}</Badge>}
          {task.project && <Badge variant="secondary">{task.project}</Badge>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {!task.isPersonal && (
            <>
              <dt className="text-muted-foreground">{t("tasks.fields.assignee")}</dt>
              <dd>{displayName(task.assignee)}</dd>
              <dt className="text-muted-foreground">{t("tasks.fields.creator")}</dt>
              <dd>{displayName(task.creator)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">{t("tasks.fields.dueDate")}</dt>
          <dd className={cn(overdue && "text-destructive font-medium")}>
            {task.dueDate ? formatDay(task.dueDate) : t("tasks.fields.none")}
            {overdue && ` · ${t("tasks.overdue")}`}
          </dd>
          {task.startDate && (
            <>
              <dt className="text-muted-foreground">{t("tasks.fields.startDate")}</dt>
              <dd>{formatDay(task.startDate)}</dd>
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
        {task.description && <p className="text-sm whitespace-pre-wrap">{task.description}</p>}
        {transitions.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {transitions.map((to) => (
              <form key={to} action={changeStatusAction}>
                {hidden}
                <input type="hidden" name="to" value={to} />
                <Button
                  type="submit"
                  size="sm"
                  variant={to === "CANCELLED" || to === "DRAFT" ? "ghost" : "default"}
                  disabled={to === "DONE" && task.openBlockers > 0}
                >
                  {t(`tasks.action.${to}`)}
                </Button>
              </form>
            ))}
          </div>
        )}
        {task.openBlockers > 0 && !isClosed(task.status) && (
          <p className="text-destructive flex items-center gap-1 text-sm">
            <Lock className="size-4" />
            {t("tasks.dependencies.openBlockers", { count: task.openBlockers })}
          </p>
        )}
      </Card>

      <Card className="gap-3">
        <CardTitle>{t("tasks.dependencies.title")}</CardTitle>
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
                    {hidden}
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
            {hidden}
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
      </Card>

      <Card className="gap-3">
        <CardTitle>{t("tasks.attachments.title")}</CardTitle>
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
                {hidden}
                <input type="hidden" name="attachmentId" value={a.id} />
                <Button type="submit" variant="ghost" size="sm">
                  {t("tasks.attachments.remove")}
                </Button>
              </form>
            )}
          </div>
        ))}
        <form action={addLinkAction} className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
          {hidden}
          <Input name="title" placeholder={t("tasks.attachments.linkTitle")} maxLength={200} />
          <Input name="url" type="url" required placeholder={t("tasks.attachments.linkUrl")} />
          <Button type="submit" variant="outline" size="sm">
            {t("tasks.attachments.addLink")}
          </Button>
        </form>
        <form
          action={`/api/tasks/${task.id}/attachments`}
          method="post"
          encType="multipart/form-data"
          className="flex flex-wrap items-center gap-2"
        >
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
      </Card>

      <Card className="gap-3">
        <CardTitle>{t("tasks.comments.title")}</CardTitle>
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
          {hidden}
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
      </Card>

      <Card className="gap-2">
        <CardTitle>{t("tasks.history.title")}</CardTitle>
        {history.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("tasks.history.none")}</p>
        )}
        <ul className="flex flex-col gap-1 text-sm">
          {history.map((h) => (
            <li key={h.id}>
              <span className="text-muted-foreground text-xs">
                {formatDateTime(h.createdAt, tz)}
              </span>{" "}
              {h.actor ? displayName(h.actor) : ""} {historyText(h.action, h.details)}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
