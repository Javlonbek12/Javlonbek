import Link from "next/link";

import { Avatar } from "@/components/team/avatar";
import { DutyItem } from "@/components/team/duty-item";
import { t } from "@/lib/i18n";
import type { Actor } from "@/modules/core/permissions";
import { plural } from "@/modules/reports/format";
import { ownerText, type DutyGroup } from "@/modules/team/responsibilities";

// Who a group is: the person (name, job title, team) or the place nobody in the app holds.
function GroupHead({ group }: { group: DutyGroup }) {
  const { owner } = group;
  const count = plural("team.duties.count", group.duties.length);
  if (owner.kind === "person") {
    const { person } = owner;
    return (
      <div className="flex items-center gap-3 px-1">
        <Avatar name={person.name} muted={person.deactivated} />
        <div className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <Link href={`/team/${person.id}`} className="font-medium hover:underline">
              {person.name}
            </Link>
            {person.deactivated && (
              <span className="text-muted-foreground text-xs">({t("team.deactivation.mark")})</span>
            )}
            <span className="text-muted-foreground text-xs">{count}</span>
          </span>
          <span className="text-muted-foreground text-xs">
            {[person.position ?? t("team.noPosition"), group.team].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 px-1">
      <Avatar name={owner.kind === "place" ? t("team.duties.vacancy") : "—"} muted />
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{ownerText(owner)}</span>
        <span className="text-muted-foreground text-xs">{count}</span>
      </span>
    </div>
  );
}

// «Команда» → «Обязанности»: everyone's items, grouped by the responsible.
export function DutiesList({
  groups,
  viewer,
  back,
  filtered,
}: {
  groups: DutyGroup[];
  viewer: Actor;
  back: string;
  // A search or a section is chosen: «nothing found» instead of «nothing written yet».
  filtered: boolean;
}) {
  if (groups.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {filtered ? t("team.duties.notFound") : t("team.duties.empty")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <GroupHead group={group} />
          <ul className="bg-card divide-y rounded-xl border">
            {group.duties.map((duty) => (
              <DutyItem key={duty.id} duty={duty} viewer={viewer} back={back} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
