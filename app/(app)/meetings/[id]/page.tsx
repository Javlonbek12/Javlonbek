import { ExternalLink, MoreHorizontal, Pencil, Plus, Repeat } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionItems } from "@/components/meetings/action-items";
import { MeetingStatus, timeRange } from "@/components/meetings/meeting-line";
import { NotesForm } from "@/components/meetings/notes-form";
import { StatusBadge } from "@/components/tasks/task-badges";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { PageHeader } from "@/components/ui/page-header";
import { formatDay, toDateString } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { formatDateTime, utcToZonedLocal } from "@/lib/time";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings, getUserToday } from "@/modules/core/settings/service";
import { displayName, personName } from "@/modules/core/users/display-name";
import { dayHeading } from "@/modules/meetings/days";
import { getMeetingDetail } from "@/modules/meetings/service";
import { meetingPhase } from "@/modules/meetings/status";
import { distinctNames } from "@/modules/tasks/names";
import { isLateWork } from "@/modules/tasks/today";

import { actionItemsAction, deleteMeetingAction, saveNotesAction } from "../actions";

export default async function MeetingPage({ params, searchParams }: PageProps<"/meetings/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const detail = await getMeetingDetail(user, id);
  if (!detail) notFound();
  const { meeting, tasks, canEdit, followingCount } = detail;
  const [{ timezone }, today] = await Promise.all([getSettings(user.id), getUserToday(user.id)]);
  const withNotes = meeting.notes !== null;
  const now = new Date();
  const past = meetingPhase(meeting, now) === "past";
  const day = utcToZonedLocal(meeting.startsAt, timezone).slice(0, 10);
  const when = `${dayHeading(day, today)}, ${timeRange(meeting, timezone)}`;
  const names = distinctNames(meeting.participants.map((p) => p.user));

  return (
    <div className="flex flex-col gap-4">
      <Link href="/meetings" className="text-muted-foreground text-sm hover:underline">
        ← {t("meetings.back")}
      </Link>
      {typeof query.error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`meetings.errors.${query.error}` as TranslationKey)}
        </p>
      )}

      <Card className="gap-3">
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              {meeting.title}
              {meeting.seriesId && (
                <Repeat
                  className="text-muted-foreground size-4"
                  aria-label={t("meetings.weekly")}
                />
              )}
            </span>
          }
          // The «⋯» menu opens leftwards: the buttons stay on the right, also on a phone.
          className="flex-nowrap"
          actions={
            canEdit && (
              <div className="flex items-center gap-1">
                <Button asChild variant="outline" size="icon" className="size-8">
                  <Link
                    href={`/meetings/${meeting.id}/edit`}
                    aria-label={t("meetings.edit")}
                    title={t("meetings.edit")}
                  >
                    <Pencil />
                  </Link>
                </Button>
                {/* Deleting is one step away, in «⋯», not under the agenda. */}
                <details className="relative">
                  <summary
                    className="hover:bg-accent flex size-8 cursor-pointer list-none items-center justify-center rounded-full border [&::-webkit-details-marker]:hidden"
                    aria-label={t("meetings.more")}
                    title={t("meetings.more")}
                  >
                    <MoreHorizontal className="size-4" />
                  </summary>
                  <div className="bg-card absolute right-0 z-20 mt-1 flex w-64 flex-col items-start gap-1 rounded-xl border p-2 shadow-lg">
                    <ConfirmAction
                      label={t("meetings.delete")}
                      title={t("meetings.confirmDelete")}
                      hint={t(withNotes ? "meetings.deleteHintNotes" : "meetings.deleteHint")}
                      confirm={t("meetings.confirmYes")}
                      action={deleteMeetingAction}
                      hidden={{ meetingId: meeting.id }}
                      align="right"
                    />
                    {meeting.seriesId && (
                      <ConfirmAction
                        label={t("meetings.deleteSeries")}
                        title={t("meetings.confirmDeleteSeries", { n: followingCount })}
                        hint={t("meetings.deleteSeriesHint")}
                        confirm={t("meetings.confirmYes")}
                        action={deleteMeetingAction}
                        hidden={{ meetingId: meeting.id, following: "1" }}
                        align="right"
                      />
                    )}
                  </div>
                </details>
              </div>
            )
          }
        >
          <p className="first-letter:uppercase">
            {past ? t("meetings.pastOn", { when }) : when}
            {!past && (
              <>
                {" · "}
                <MeetingStatus meeting={meeting} now={now} />
              </>
            )}
          </p>
        </PageHeader>
        {/* A call that was days ago is no button to press. */}
        {meeting.link && !past && (
          <Button asChild size="sm" className="self-start">
            <a href={meeting.link} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              {t("meetings.join")}
            </a>
          </Button>
        )}
        <p className="text-sm">
          <span className="text-muted-foreground">{t("meetings.fields.participants")}: </span>
          {meeting.participants
            .map((p) =>
              p.user.deactivatedAt
                ? personName(p.user)
                : (names.get(p.user.id) ?? personName(p.user)),
            )
            .join(", ")}
        </p>
        {meeting.agenda && <p className="text-sm whitespace-pre-wrap">{meeting.agenda}</p>}
      </Card>

      <Card id="notes" className="scroll-mt-20 gap-3">
        <CardTitle>{t("meetings.notes.title")}</CardTitle>
        {meeting.notes ? (
          <p className="text-muted-foreground text-xs">
            {displayName(meeting.notes.author)} ·{" "}
            {formatDateTime(meeting.notes.updatedAt, timezone)}
          </p>
        ) : (
          past && (
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              {t("meetings.status.noNotes")}
            </p>
          )
        )}
        <NotesForm
          meetingId={meeting.id}
          text={meeting.notes?.text ?? ""}
          version={meeting.notes?.updatedAt.toISOString() ?? ""}
          action={saveNotesAction}
        />
        <p className="text-muted-foreground text-xs">{t("meetings.notes.byBot")}</p>
      </Card>

      {/* One block for the meeting's tasks: added by hand, or found in the outcome by the AI. */}
      <Card className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("meetings.tasks")}</CardTitle>
          <Button asChild size="sm">
            <Link href={`/tasks/new?meeting=${encodeURIComponent(meeting.id)}`}>
              <Plus />
              {t("meetings.addTask")}
            </Link>
          </Button>
        </div>
        {tasks.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("meetings.tasksEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {tasks.map((task) => {
              const due = task.dueDate ? toDateString(task.dueDate) : null;
              const late = isLateWork({ status: task.status, dueDate: due }, today);
              return (
                <li key={task.id}>
                  <Link
                    href={`/tasks/${task.id}`}
                    className="flex flex-wrap items-center gap-2 text-sm hover:underline"
                  >
                    <span className="font-medium">{task.title}</span>
                    <StatusBadge status={task.status} />
                    <span className="text-muted-foreground text-xs">
                      {displayName(task.assignee)}
                      {due && (
                        <span className={cn(late && "text-destructive font-medium")}>
                          {" · "}
                          {formatDay(due)}
                          {late && ` · ${t("tasks.look.colorOverdue").toLowerCase()}`}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {meeting.notes && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-muted-foreground text-xs">{t("meetings.actions.ai")}</p>
            <ActionItems meetingId={meeting.id} action={actionItemsAction} />
          </div>
        )}
      </Card>
    </div>
  );
}
