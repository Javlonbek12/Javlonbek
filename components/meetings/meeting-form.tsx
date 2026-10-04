import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";

type Props = {
  action: (formData: FormData) => Promise<void>;
  people: { id: string; name: string }[];
  initial: {
    meetingId?: string;
    title: string;
    startsLocal: string;
    durationMinutes: number;
    agenda: string;
    link: string;
    participantIds: string[];
  };
  isNew: boolean;
  submitLabel: string;
};

// Plain HTML form: works without JavaScript; participants are checkboxes.
export function MeetingForm({ action, people, initial, isNew, submitLabel }: Props) {
  return (
    <form action={action} className="flex flex-col gap-4">
      {initial.meetingId && <input type="hidden" name="meetingId" value={initial.meetingId} />}
      <Card className="gap-3">
        <Label className="flex-col items-start">
          {t("meetings.fields.title")}
          <Input name="title" required maxLength={200} defaultValue={initial.title} />
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <Label className="flex-col items-start">
            {t("meetings.fields.startsAt")}
            <Input
              type="datetime-local"
              name="startsLocal"
              required
              defaultValue={initial.startsLocal}
            />
          </Label>
          <Label className="flex-col items-start">
            {t("meetings.fields.duration")}
            <Input
              type="number"
              name="durationMinutes"
              min={5}
              max={1440}
              step={5}
              defaultValue={initial.durationMinutes}
            />
          </Label>
        </div>
        {isNew && (
          <Label className="flex-col items-start">
            {t("meetings.fields.repeatUntil")}
            <Input type="date" name="repeatUntil" />
          </Label>
        )}
        <Label className="flex-col items-start">
          {t("meetings.fields.link")}
          <Input type="url" name="link" placeholder="https://" defaultValue={initial.link} />
        </Label>
        <Label className="flex-col items-start">
          {t("meetings.fields.agenda")}
          <Textarea name="agenda" maxLength={5000} defaultValue={initial.agenda} />
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
                  defaultChecked={initial.participantIds.includes(p.id)}
                  className="size-4"
                />
                {p.name}
              </Label>
            ))}
          </div>
        </fieldset>
      </Card>
      <Button type="submit" className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
