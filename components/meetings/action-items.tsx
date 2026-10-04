"use client";

import { useActionState } from "react";

import type { ProposalState } from "@/app/(app)/meetings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { t, type TranslationKey } from "@/lib/i18n";

type Props = {
  meetingId: string;
  propose: (state: ProposalState, formData: FormData) => Promise<ProposalState>;
  create: (formData: FormData) => Promise<void>;
};

// "Find tasks in the minutes": AI proposes rows, the user edits and confirms them.
export function ActionItems({ meetingId, propose, create }: Props) {
  const [state, action, pending] = useActionState(propose, {
    error: null,
    tasks: null,
    people: [],
  });

  return (
    <div className="flex flex-col gap-3">
      <form action={action}>
        <input type="hidden" name="meetingId" value={meetingId} />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "…" : t("meetings.actions.find")}
        </Button>
      </form>
      {state.error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(state.error as TranslationKey)}
        </p>
      )}
      {state.tasks && state.tasks.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("meetings.actions.none")}</p>
      )}
      {state.tasks && state.tasks.length > 0 && (
        <form action={create} className="flex flex-col gap-3">
          <input type="hidden" name="meetingId" value={meetingId} />
          <input type="hidden" name="count" value={state.tasks.length} />
          {state.tasks.map((task, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`include_${i}`} defaultChecked className="size-4" />
                {t("meetings.actions.include")}
              </label>
              <Input
                name={`title_${i}`}
                defaultValue={task.title}
                required
                maxLength={200}
                aria-label={t("tasks.fields.title")}
              />
              <div className="grid grid-cols-2 gap-2">
                <NativeSelect
                  name={`assignee_${i}`}
                  defaultValue={task.assigneeId ?? "me"}
                  aria-label={t("tasks.fields.assignee")}
                >
                  <option value="me">{t("meetings.actions.me")}</option>
                  {state.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  type="date"
                  name={`due_${i}`}
                  defaultValue={task.dueDate ?? ""}
                  aria-label={t("tasks.fields.dueDate")}
                />
              </div>
              <input type="hidden" name={`priority_${i}`} value={task.priority ?? ""} />
              <input type="hidden" name={`project_${i}`} value={task.project ?? ""} />
            </div>
          ))}
          <Button type="submit" className="self-start">
            {t("meetings.actions.create")}
          </Button>
        </form>
      )}
    </div>
  );
}
