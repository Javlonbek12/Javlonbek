import { ExternalLink, Pencil, Repeat } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionItems } from "@/components/meetings/action-items";
import { NotesForm } from "@/components/meetings/notes-form";
import { StatusBadge } from "@/components/tasks/task-badges";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { formatDay, toDateString } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { displayName, personName } from "@/modules/core/users/display-name";
import { getMeetingDetail } from "@/modules/meetings/service";

import { actionItemsAction, deleteMeetingAction, saveNotesAction } from "../actions";

export default async function MeetingPage({ params, searchParams }: PageProps<"/meetings/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const detail = await getMeetingDetail(user, id);
  if (!detail) notFound();
  const { meeting, tasks, canEdit, followingCount } = detail;
  const { timezone } = await getSettings(user.id);
  const withNotes = meeting.notes !== null;

  return (
    <div className="flex flex-col gap-4">
      {typeof query.error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`meetings.errors.${query.error}` as TranslationKey)}
        </p>
      )}

      <Card className="gap-3">
        <div className="flex items-start justify-between gap-2">
          <h1 className="flex items-center gap-2 text-xl font-medium">
            {meeting.title}
            {meeting.seriesId && (
              <Repeat className="text-muted-foreground size-4" aria-label={t("meetings.weekly")} />
            )}
          </h1>
          {canEdit && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/meetings/${meeting.id}/edit`} aria-label={t("meetings.edit")}>
                <Pencil />
              </Link>
            </Button>
          )}
        </div>
        <CardDescription>
          {formatDateTime(meeting.startsAt, timezone)} ·{" "}
          {t("meetings.duration", { n: meeting.durationMinutes })}
        </CardDescription>
        {meeting.link && (
          <Button asChild size="sm" className="self-start">
            <a href={meeting.link} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              {t("meetings.join")}
            </a>
          </Button>
        )}
        <p className="text-sm">
          <span className="text-muted-foreground">{t("meetings.fields.participants")}: </span>
          {meeting.participants.map((p) => personName(p.user)).join(", ")}
        </p>
        {meeting.agenda && <p className="text-sm whitespace-pre-wrap">{meeting.agenda}</p>}
        {canEdit && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <ConfirmAction
              label={t("meetings.delete")}
              title={t("meetings.confirmDelete")}
              hint={t(withNotes ? "meetings.deleteHintNotes" : "meetings.deleteHint")}
              confirm={t("meetings.confirmYes")}
              action={deleteMeetingAction}
              hidden={{ meetingId: meeting.id }}
            />
            {meeting.seriesId && (
              <ConfirmAction
                label={t("meetings.deleteSeries")}
                title={t("meetings.confirmDeleteSeries", { n: followingCount })}
                hint={t("meetings.deleteSeriesHint")}
                confirm={t("meetings.confirmYes")}
                action={deleteMeetingAction}
                hidden={{ meetingId: meeting.id, following: "1" }}
              />
            )}
          </div>
        )}
      </Card>

      <Card className="gap-3">
        <CardTitle>{t("meetings.notes.title")}</CardTitle>
        {meeting.notes && (
          <p className="text-muted-foreground text-xs">
            {displayName(meeting.notes.author)} ·{" "}
            {formatDateTime(meeting.notes.updatedAt, timezone)}
          </p>
        )}
        <NotesForm
          meetingId={meeting.id}
          text={meeting.notes?.text ?? ""}
          version={meeting.notes?.updatedAt.toISOString() ?? ""}
          action={saveNotesAction}
        />
        <p className="text-muted-foreground text-xs">{t("meetings.notes.byBot")}</p>
      </Card>

      {meeting.notes && (
        <Card className="gap-3">
          <CardTitle>{t("meetings.actions.title")}</CardTitle>
          <ActionItems meetingId={meeting.id} action={actionItemsAction} />
        </Card>
      )}

      {tasks.length > 0 && (
        <Card className="gap-2">
          <CardTitle>{t("meetings.tasks")}</CardTitle>
          {tasks.map((task) => (
            <Link
              key={task.id}
              href={`/tasks/${task.id}`}
              className="flex flex-wrap items-center gap-2 text-sm hover:underline"
            >
              <span className="font-medium">{task.title}</span>
              <StatusBadge status={task.status} />
              <span className="text-muted-foreground text-xs">
                {displayName(task.assignee)}
                {task.dueDate && ` · ${formatDay(toDateString(task.dueDate))}`}
              </span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
