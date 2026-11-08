"use client";

import { useActionState } from "react";

import type { MeetingFormState, MeetingFormValues } from "@/app/(app)/meetings/actions";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TranslationKey } from "@/lib/i18n";

type Props = {
  action: (state: MeetingFormState, formData: FormData) => Promise<MeetingFormState>;
  people: { id: string; name: string }[];
  meetingId?: string;
  initial: MeetingFormValues;
  isNew: boolean;
  // An occurrence of a weekly series: offer «this one» or «this and following».
  inSeries?: boolean;
  submitLabel: string;
};

// Participants are checkboxes. A refused save comes back with what was typed, so nothing is lost.
export function MeetingForm({
  action,
  people,
  meetingId,
  initial,
  isNew,
  inSeries,
  submitLabel,
}: Props) {
  const t = useT();
  const [state, dispatch, pending] = useActionState(action, { error: null, values: initial });
  const values = state.values;

  return (
    <form action={dispatch} className="flex flex-col gap-4">
      {meetingId && <input type="hidden" name="meetingId" value={meetingId} />}
      {state.error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`meetings.errors.${state.error}` as TranslationKey)}
        </p>
      )}
      <Card className="gap-3">
        <Label className="flex-col items-start">
          {t("meetings.fields.title")}
          <Input name="title" required maxLength={200} defaultValue={values.title} />
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <Label className="flex-col items-start">
            {t("meetings.fields.startsAt")}
            <Input
              type="datetime-local"
              name="startsLocal"
              required
              defaultValue={values.startsLocal}
            />
          </Label>
          <Label className="flex-col items-start">
            {t("meetings.fields.duration")}
            <Input
              type="number"
              name="durationMinutes"
              required
              min={5}
              max={1440}
              step={5}
              defaultValue={values.durationMinutes}
            />
          </Label>
        </div>
        {isNew && (
          <Label className="flex-col items-start">
            {t("meetings.fields.repeatUntil")}
            <Input type="date" name="repeatUntil" defaultValue={values.repeatUntil} />
          </Label>
        )}
        {inSeries && (
          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="mb-1 font-medium">{t("meetings.applyTo")}</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="following"
                value=""
                defaultChecked={values.following !== "1"}
                className="size-4"
              />
              {t("meetings.applyThis")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="following"
                value="1"
                defaultChecked={values.following === "1"}
                className="size-4"
              />
              {t("meetings.applyFollowing")}
            </label>
          </fieldset>
        )}
        <Label className="flex-col items-start">
          {t("meetings.fields.link")}
          <Input type="url" name="link" placeholder="https://" defaultValue={values.link} />
        </Label>
        <Label className="flex-col items-start">
          {t("meetings.fields.agenda")}
          <Textarea name="agenda" maxLength={5000} defaultValue={values.agenda} />
        </Label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t("meetings.fields.participants")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {people.map((p) => (
              <Label key={p.id} className="font-normal">
                <input
                  type="checkbox"
                  name="participantIds"
                  value={p.id}
                  defaultChecked={values.participantIds.includes(p.id)}
                  className="size-4"
                />
                {p.name}
              </Label>
            ))}
          </div>
        </fieldset>
      </Card>
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "…" : submitLabel}
      </Button>
    </form>
  );
}
