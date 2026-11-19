import { t } from "@/lib/i18n";
import type { Actor } from "@/modules/core/permissions";
import { MODULES } from "@/modules/core/registry";
import { DUTY_SECTIONS, dutyFormPeople } from "@/modules/team/responsibilities";

// Where the form returns: a page of «Команда» (from the list or a card), else the list.
export function formBack(value: unknown) {
  return typeof value === "string" &&
    /^\/team(?:[/?#]|$)/.test(value) &&
    !value.includes("//") &&
    !value.includes("\\")
    ? value
    : "/team?view=duties";
}

// The form's choices: people (a job title tells two of the same name apart), the sections.
export async function formChoices(viewer: Actor, keep: (string | null)[]) {
  const { responsible, deputies } = await dutyFormPeople(viewer, keep);
  const label = (person: (typeof deputies)[number]) =>
    [
      person.name,
      person.position && `· ${person.position}`,
      person.deactivated && `(${t("team.deactivation.mark")})`,
    ]
      .filter(Boolean)
      .join(" ");
  const options = (list: typeof deputies) => list.map((p) => ({ id: p.id, label: label(p) }));
  return {
    people: options(responsible),
    deputies: options(deputies),
    sections: DUTY_SECTIONS.map((id) => ({
      id,
      label: t(MODULES.find((m) => m.id === id)!.titleKey),
    })),
  };
}
