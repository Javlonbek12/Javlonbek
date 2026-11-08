"use client";

import { useActionState } from "react";

import type { NotesState } from "@/app/(app)/meetings/actions";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { TranslationKey } from "@/lib/i18n";

// The minutes editor. It sends the version it started from: if someone saved in between, the
// server refuses, the typed text stays here and their current minutes are shown above it.
export function NotesForm({
  meetingId,
  text,
  version,
  action,
}: {
  meetingId: string;
  text: string;
  // updatedAt of the minutes as loaded ("" = none yet).
  version: string;
  action: (state: NotesState, formData: FormData) => Promise<NotesState>;
}) {
  const t = useT();
  const [state, dispatch, pending] = useActionState(action, { error: null, saved: false });
  const clash = state.error === "conflict" ? state.current : undefined;

  return (
    <form action={dispatch} className="flex flex-col gap-2">
      <input type="hidden" name="meetingId" value={meetingId} />
      {/* After a clash the next save goes over the minutes the user has now seen. */}
      <input type="hidden" name="version" value={clash ? clash.version : version} />
      {state.error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {state.error === "conflict" && clash
            ? t("meetings.errors.conflictBy", { name: clash.by, when: clash.at })
            : t(`meetings.errors.${state.error}` as TranslationKey)}
        </p>
      )}
      {clash && (
        <div className="bg-secondary flex flex-col gap-1 rounded-md p-3 text-sm">
          <span className="text-muted-foreground text-xs">{t("meetings.notes.current")}</span>
          <p className="whitespace-pre-wrap">{clash.text}</p>
        </div>
      )}
      {state.saved && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {t("meetings.notes.saved")}
        </p>
      )}
      <Textarea
        name="text"
        required
        rows={8}
        maxLength={20000}
        defaultValue={state.text ?? text}
        placeholder={t("meetings.notes.placeholder")}
      />
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        {pending ? "…" : t("meetings.notes.save")}
      </Button>
    </form>
  );
}
