import { SopEmpty } from "@/components/sop/empty";
import { OverviewView } from "@/components/sop/overview";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { loadSopData } from "@/modules/sop/load";
import { sopUserNames } from "@/modules/sop/service";

import { tickSopChecklistAction } from "./actions";

// «Обзор»: the file on screen in a few numbers, what to do now, the calendar and the checklist.
export default async function SopOverviewPage() {
  const user = await requireUser();
  const [data, { timezone }] = await Promise.all([loadSopData(), getSettings(user.id)]);
  if (!data.report || !data.upload) return <SopEmpty broken={data.broken} />;
  const names = await sopUserNames(Object.values(data.checklist).map((tick) => tick.by));
  return (
    <OverviewView
      data={data}
      report={data.report}
      tickAction={tickSopChecklistAction}
      timeZone={timezone}
      names={names}
    />
  );
}
