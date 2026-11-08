import { CircleAlert, Clock } from "lucide-react";

import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { displayName } from "@/modules/core/users/display-name";
import { dataSources, STALE_DAYS } from "@/modules/distribution/service";

// How fresh the numbers are: when the equipment file and the outlet base were loaded and by whom.
// An equipment file older than a week is shown in amber, so nobody trusts old numbers by mistake.
export async function DataFreshness({ now = new Date() }: { now?: Date }) {
  const sources = await dataSources();
  const zone = getEnv().DEFAULT_TIMEZONE;
  const equipment = sources.equipment;
  const stale = !equipment || now.getTime() - equipment.at.getTime() > STALE_DAYS * 86_400_000;
  const Icon = stale ? CircleAlert : Clock;
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs",
        stale ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <span>
        {equipment
          ? t("equip.fresh.equipment", {
              date: formatDateTime(equipment.at, zone),
              name: equipment.by ? displayName(equipment.by) : "—",
            })
          : t("equip.fresh.noEquipment")}
        {" · "}
        {sources.outlets
          ? t("equip.fresh.outlets", { date: formatDateTime(sources.outlets.at, zone) })
          : t("equip.fresh.noOutlets")}
        {equipment && stale && ` · ${t("equip.fresh.stale", { days: STALE_DAYS })}`}
      </span>
    </p>
  );
}
