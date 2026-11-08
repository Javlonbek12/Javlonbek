import { MeetingForm } from "@/components/meetings/meeting-form";
import { addDays } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { meetingFormPeople } from "@/modules/meetings/form-people";

import { createMeetingAction } from "../actions";

export default async function NewMeetingPage() {
  const user = await requireUser();
  const [{ people, teamIds }, today] = await Promise.all([
    meetingFormPeople(user),
    getUserToday(user.id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-medium md:text-2xl">{t("meetings.newMeeting")}</h1>
      <MeetingForm
        action={createMeetingAction}
        people={people}
        teamIds={teamIds}
        creatorId={user.id}
        isNew
        submitLabel={t("meetings.create")}
        cancelHref="/meetings"
        initial={{
          title: "",
          startsLocal: `${addDays(today, 1)}T10:00`,
          durationMinutes: "60",
          agenda: "",
          link: "",
          repeatUntil: "",
          repeatEvery: "",
          participantIds: [user.id],
          following: "",
        }}
      />
    </div>
  );
}
