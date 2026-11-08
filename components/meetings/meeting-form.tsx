"use client";

import { Search, Users } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";

import type { MeetingFormState, MeetingFormValues } from "@/app/(app)/meetings/actions";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { TranslationKey } from "@/lib/i18n";

type Props = {
  action: (state: MeetingFormState, formData: FormData) => Promise<MeetingFormState>;
  // Names already told apart (a position after a repeated name).
  people: { id: string; name: string }[];
  // «Моя команда»: the people the button ticks.
  teamIds: string[];
  // The organizer is always in the meeting: ticked and locked.
  creatorId: string;
  meetingId?: string;
  initial: MeetingFormValues;
  isNew: boolean;
  // An occurrence of a weekly series: offer «this one» or «this and following».
  inSeries?: boolean;
  submitLabel: string;
  // «Отмена»: back to where the form was opened from.
  cancelHref: string;
};

const DURATIONS = [15, 30, 45, 60, 90] as const;

// The meeting form: duration by buttons, how often it repeats, participants with a search and
// «Моя команда». A refused save comes back with what was typed, so nothing is lost.
export function MeetingForm({
  action,
  people,
  teamIds,
  creatorId,
  meetingId,
  initial,
  isNew,
  inSeries,
  submitLabel,
  cancelHref,
}: Props) {
  const t = useT();
  const [state, dispatch, pending] = useActionState(action, { error: null, values: initial });
  const values = state.values;
  const [duration, setDuration] = useState(values.durationMinutes);
  const [repeat, setRepeat] = useState(values.repeatEvery);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(() => new Set([creatorId, ...values.participantIds]));
  const toggle = (id: string, on: boolean) =>
    setChosen((set) => {
      const next = new Set(set);
      if (on) next.add(id);
      else if (id !== creatorId) next.delete(id);
      return next;
    });
  const needle = query.trim().toLowerCase();

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
        <Label className="flex-col items-start">
          {t("meetings.fields.startsAt")}
          <Input
            type="datetime-local"
            name="startsLocal"
            required
            defaultValue={values.startsLocal}
          />
        </Label>
        <div className="flex flex-col gap-1.5">
          <Label className="flex-col items-start">
            {t("meetings.fields.duration")}
            <Input
              type="number"
              name="durationMinutes"
              required
              min={5}
              max={1440}
              step={5}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-28"
            />
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {DURATIONS.map((minutes) => (
              <Button
                key={minutes}
                type="button"
                size="sm"
                variant={duration === String(minutes) ? "secondary" : "outline"}
                onClick={() => setDuration(String(minutes))}
              >
                {t("meetings.duration", { n: minutes })}
              </Button>
            ))}
          </div>
        </div>
        {isNew && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Label className="flex-col items-start">
              {t("meetings.fields.repeat")}
              <NativeSelect
                name="repeatEvery"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                className="w-full"
              >
                <option value="">{t("meetings.repeatEvery.none")}</option>
                <option value="week">{t("meetings.repeatEvery.week")}</option>
                <option value="twoWeeks">{t("meetings.repeatEvery.twoWeeks")}</option>
                <option value="month">{t("meetings.repeatEvery.month")}</option>
              </NativeSelect>
            </Label>
            {repeat && (
              <Label className="flex-col items-start">
                {t("meetings.fields.repeatUntil")}
                <Input type="date" name="repeatUntil" required defaultValue={values.repeatUntil} />
              </Label>
            )}
          </div>
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
          <legend className="mb-1 text-sm font-medium">
            {t("meetings.fields.participants")} · {chosen.size}
          </legend>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3">
              <Search className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("meetings.findPeople")}
                aria-label={t("meetings.findPeople")}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            {teamIds.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setChosen((set) => new Set([...set, ...teamIds]))}
              >
                <Users />
                {t("meetings.myTeam")}
              </Button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {people.map((p) => {
              const organizer = p.id === creatorId;
              // Filtered out rows stay in the form (hidden), so their tick is still sent.
              const shown = !needle || p.name.toLowerCase().includes(needle);
              return (
                <Label key={p.id} className={shown ? "font-normal" : "hidden"}>
                  <input
                    type="checkbox"
                    name="participantIds"
                    value={p.id}
                    checked={chosen.has(p.id)}
                    disabled={organizer}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                    className="size-4"
                  />
                  {p.name}
                  {organizer && (
                    <span className="text-muted-foreground text-xs">
                      ({t("meetings.organizer")})
                    </span>
                  )}
                </Label>
              );
            })}
          </div>
          {/* A disabled box sends nothing: the organizer goes along anyway. */}
          <input type="hidden" name="participantIds" value={creatorId} />
        </fieldset>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
        <Button asChild variant="outline">
          <Link href={cancelHref}>{t("meetings.cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}
