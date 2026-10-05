import { MeetingForm } from "@/components/meetings/meeting-form";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";

import { createMeetingAction } from "../actions";

export default async function NewMeetingPage({ searchParams }: PageProps<"/meetings/new">) {
  const user = await requireUser();
  const { error } = await searchParams;
  const [people, today] = await Promise.all([
    db.user.findMany({ orderBy: { firstName: "asc" } }),
    getUserToday(user.id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-medium md:text-2xl">{t("meetings.newMeeting")}</h1>
      {typeof error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`meetings.errors.${error}` as TranslationKey)}
        </p>
      )}
      <MeetingForm
        action={createMeetingAction}
        people={people.map((p) => ({ id: p.id, name: displayName(p) }))}
        isNew
        submitLabel={t("meetings.create")}
        initial={{
          title: "",
          startsLocal: `${addDays(today, 1)}T10:00`,
          durationMinutes: 60,
          agenda: "",
          link: "",
          participantIds: [user.id],
        }}
      />
    </div>
  );
}
