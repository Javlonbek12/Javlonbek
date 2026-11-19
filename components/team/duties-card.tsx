import { Plus } from "lucide-react";
import Link from "next/link";

import { DutyItem } from "@/components/team/duty-item";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { canOpenPath } from "@/modules/core/access/paths";
import type { Actor } from "@/modules/core/permissions";
import { ownerText, type dutiesOfPerson } from "@/modules/team/responsibilities";

// The employee card's «Обязанности»: what the person is responsible for, and whom they stand in
// for. The search opens the card here (#responsibilities).
export function DutiesCard({
  personId,
  duties,
  viewer,
  canAdd,
}: {
  personId: string;
  duties: Awaited<ReturnType<typeof dutiesOfPerson>>;
  viewer: Actor;
  // An editor, and the person still works here.
  canAdd: boolean;
}) {
  const back = `/team/${personId}?tab=profile#responsibilities`;
  return (
    <Card id="responsibilities" className="scroll-mt-20 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("team.duties.title")}</CardTitle>
        {canAdd && (
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/team/responsibilities/new?${new URLSearchParams({ person: personId, back })}`}
            >
              <Plus />
              {t("team.duties.add")}
            </Link>
          </Button>
        )}
      </div>
      {duties.own.length > 0 ? (
        <ul className="divide-y rounded-xl border">
          {duties.own.map((duty) => (
            <DutyItem key={duty.id} duty={duty} viewer={viewer} back={back} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t("team.duties.empty")}</p>
      )}
      {duties.deputyFor.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t("team.duties.replaces")}</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {duties.deputyFor.map((duty) => {
              const { owner } = duty;
              const name = ownerText(owner);
              const href = owner.kind === "person" ? `/team/${owner.person.id}` : null;
              return (
                <li key={duty.id}>
                  {duty.title}{" "}
                  <span className="text-muted-foreground">
                    —{" "}
                    {href && canOpenPath(viewer, href) ? (
                      <Link href={`${href}?tab=profile#responsibilities`} className="underline">
                        {t("team.duties.replacesFor", { name })}
                      </Link>
                    ) : (
                      t("team.duties.replacesFor", { name })
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
