"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { DutyFormState, DutyFormValues } from "@/app/(app)/team/responsibilities/actions";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type Person = { id: string; label: string };

// Add or change a responsibility: title, description, the responsible, a stand-in and a section.
// A refused save comes back with what was typed.
export function ResponsibilityForm({
  action,
  dutyId,
  initial,
  people,
  deputies,
  sections,
  keepPlace,
  suggested = false,
  back,
  submitLabel,
}: {
  action: (state: DutyFormState, formData: FormData) => Promise<DutyFormState>;
  dutyId?: string;
  initial: DutyFormValues;
  // Whom the editor may make responsible, and who may stand in.
  people: Person[];
  deputies: Person[];
  sections: { id: string; label: string }[];
  // The item sits on a place no app user holds: the option that keeps it there.
  keepPlace?: { value: string; label: string };
  suggested?: boolean;
  back: string;
  submitLabel: string;
}) {
  const t = useT();
  const [state, dispatch] = useActionState(action, { error: null, values: initial });
  const values = state.values;

  return (
    <form action={dispatch} className="flex flex-col gap-4">
      {dutyId && <input type="hidden" name="dutyId" value={dutyId} />}
      <input type="hidden" name="back" value={back} />
      {state.error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`team.duties.errors.${state.error}`)}
        </p>
      )}
      {suggested && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {t("team.duties.suggestedSave")}
        </p>
      )}
      <Card className="gap-3">
        <Label className="flex-col items-start">
          {t("team.duties.fields.title")}
          <Input
            name="title"
            required
            maxLength={120}
            defaultValue={values.title}
            placeholder={t("team.duties.fields.titlePlaceholder")}
          />
        </Label>
        <Label className="flex-col items-start">
          {t("team.duties.fields.description")}
          <Textarea
            name="description"
            maxLength={2000}
            rows={4}
            defaultValue={values.description}
            placeholder={t("team.duties.fields.descriptionPlaceholder")}
          />
        </Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label className="flex-col items-start">
            {t("team.duties.fields.responsible")}
            <NativeSelect
              name="responsible"
              required
              defaultValue={values.responsible}
              className="w-full"
            >
              <option value="" disabled>
                —
              </option>
              {keepPlace && <option value={keepPlace.value}>{keepPlace.label}</option>}
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label className="flex-col items-start">
            {t("team.duties.fields.deputy")}
            <NativeSelect name="deputyId" defaultValue={values.deputyId} className="w-full">
              <option value="">{t("team.duties.fields.noDeputy")}</option>
              {deputies.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label className="flex-col items-start">
            {t("team.duties.fields.module")}
            <NativeSelect name="module" defaultValue={values.module} className="w-full">
              <option value="">{t("team.duties.fields.noModule")}</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.label}
                </option>
              ))}
            </NativeSelect>
          </Label>
        </div>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{submitLabel}</Button>
        <Button asChild variant="outline">
          <Link href={back}>{t("team.duties.cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}
