import { notFound } from "next/navigation";

import { MeetingForm } from "@/components/meetings/meeting-form";
import { t } from "@/lib/i18n";
import { utcToZonedLocal } from "@/lib/time";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { meetingFormPeople } from "@/modules/meetings/form-people";
import { getMeetingDetail } from "@/modules/meetings/service";

import { updateMeetingAction } from "../../actions";

export default async function EditMeetingPage({ params }: PageProps<"/meetings/[id]/edit">) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getMeetingDetail(user, id);
  if (!detail?.canEdit) notFound();
  const { meeting } = detail;
  const [{ people, teamIds }, { timezone }] = await Promise.all([
    // Active people, and whoever is already in the meeting (so saving keeps them).
    meetingFormPeople(
      user,
      meeting.participants.map((p) => p.userId),
    ),
    getSettings(user.id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-medium md:text-2xl">
        {t("meetings.editTitle", { title: meeting.title })}
      </h1>
      <MeetingForm
        action={updateMeetingAction}
        people={people}
        teamIds={teamIds}
        creatorId={meeting.createdById}
        isNew={false}
        inSeries={meeting.seriesId !== null}
        meetingId={meeting.id}
        submitLabel={t("meetings.save")}
        cancelHref={`/meetings/${meeting.id}`}
        initial={{
          title: meeting.title,
          startsLocal: utcToZonedLocal(meeting.startsAt, timezone),
          durationMinutes: String(meeting.durationMinutes),
          agenda: meeting.agenda ?? "",
          link: meeting.link ?? "",
          repeatUntil: "",
          repeatEvery: "",
          participantIds: meeting.participants.map((p) => p.userId),
          following: "",
        }}
      />
    </div>
  );
}
