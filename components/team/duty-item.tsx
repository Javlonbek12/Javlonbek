import { Check, Pencil } from "lucide-react";
import Link from "next/link";

import { confirmDutyAction, deleteDutyAction } from "@/app/(app)/team/responsibilities/actions";
import { CollapsibleText } from "@/components/team/collapsible-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { t } from "@/lib/i18n";
import { canOpenPath } from "@/modules/core/access/paths";
import type { Actor } from "@/modules/core/permissions";
import { MODULES } from "@/modules/core/registry";
import type { Duty } from "@/modules/team/responsibilities";

// The page a section link opens, if the viewer has that section.
function sectionLink(viewer: Actor, id: string | null) {
  const entry = id ? MODULES.find((m) => m.id === id) : undefined;
  if (!entry) return null;
  return { label: t(entry.titleKey), href: canOpenPath(viewer, entry.href) ? entry.href : null };
}

// One responsibility: its title, the description cut after three lines, the stand-in and the
// section; a suggestion carries its badge and where it came from. Editors get the buttons.
// `back`: the page to return to after a button or the form.
export function DutyItem({ duty, viewer, back }: { duty: Duty; viewer: Actor; back: string }) {
  const section = sectionLink(viewer, duty.module);
  const suggested = duty.status === "SUGGESTED";
  const hidden = { dutyId: duty.id, back };
  const deputy = duty.deputy;
  return (
    <li className="flex flex-col gap-1.5 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="min-w-0 text-sm font-medium break-words">{duty.title}</h3>
          {suggested && (
            <Badge variant="secondary" title={t("team.duties.suggestedHint")}>
              {t("team.duties.suggested")}
            </Badge>
          )}
        </div>
        {duty.canEdit && (
          // On the right, also when they wrap: the delete card opens leftwards from the button.
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            {suggested && (
              <form action={confirmDutyAction}>
                {Object.entries(hidden).map(([name, value]) => (
                  <input key={name} type="hidden" name={name} value={value} />
                ))}
                <Button type="submit" size="sm">
                  <Check />
                  {t("team.duties.confirm")}
                </Button>
              </form>
            )}
            <Button asChild size="sm" variant="outline">
              <Link
                href={`/team/responsibilities/${duty.id}?${new URLSearchParams({ back })}`}
                aria-label={`${t("team.duties.edit")}: ${duty.title}`}
              >
                <Pencil />
                {t("team.duties.edit")}
              </Link>
            </Button>
            <ConfirmAction
              label={t("team.duties.delete")}
              title={t("team.duties.deleteTitle")}
              hint={t("team.duties.deleteHint", { title: duty.title })}
              confirm={t("team.duties.deleteConfirm")}
              action={deleteDutyAction}
              hidden={hidden}
              align="right"
            />
          </div>
        )}
      </div>
      {duty.description && <CollapsibleText text={duty.description} />}
      {(deputy || section) && (
        <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {deputy && (
            <span>
              {canOpenPath(viewer, `/team/${deputy.id}`) ? (
                <Link href={`/team/${deputy.id}`} className="hover:underline">
                  {t("team.duties.deputy", { name: deputy.name })}
                </Link>
              ) : (
                t("team.duties.deputy", { name: deputy.name })
              )}
              {deputy.deactivated && ` (${t("team.deactivation.mark")})`}
            </span>
          )}
          {section &&
            (section.href ? (
              <Link href={section.href} className="hover:underline">
                {t("team.duties.openSection", { name: section.label })} →
              </Link>
            ) : (
              <span>{t("team.duties.openSection", { name: section.label })}</span>
            ))}
        </p>
      )}
      {suggested && duty.source && <p className="text-muted-foreground text-xs">{duty.source}</p>}
    </li>
  );
}
