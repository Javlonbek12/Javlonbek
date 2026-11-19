"use client";

import { Sparkles } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ComposeTaskResult } from "@/app/(app)/tasks/actions";
import type { TranslationKey } from "@/lib/i18n";

const MAX_TEXT = 2000;

// «Оформить с ИИ» above the new task form: the task in one's own words → the form's fields, and
// what the task still lacks. The person then checks the form and creates the task as usual.
export function ComposeWithAi({
  compose,
  onComposed,
}: {
  compose: (text: string) => Promise<ComposeTaskResult>;
  onComposed: (values: Record<string, string>) => void;
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<TranslationKey | null>(null);
  const [result, setResult] = useState<{ missing: string[]; notes: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const response = await compose(text);
      if (!response.ok) {
        setResult(null);
        setError(response.error);
        return;
      }
      setResult({ missing: response.missing, notes: response.notes });
      onComposed(response.values);
    });
  }

  return (
    <div className="bg-muted/40 flex flex-col gap-3 rounded-2xl border p-3 text-sm md:p-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-primary flex items-center gap-2 text-left font-medium"
      >
        <Sparkles className="size-4 shrink-0" aria-hidden />
        {t("tasks.compose.open")}
      </button>
      {open && (
        <>
          <label htmlFor={id} className="sr-only">
            {t("tasks.compose.label")}
          </label>
          <Textarea
            id={id}
            value={text}
            maxLength={MAX_TEXT}
            rows={3}
            placeholder={t("tasks.compose.placeholder")}
            onChange={(e) => setText(e.target.value)}
            className="bg-background"
          />
          <p className="text-muted-foreground text-xs">{t("tasks.compose.hint")}</p>
          <div>
            <Button type="button" size="sm" onClick={run} disabled={pending || !text.trim()}>
              <Sparkles />
              {pending ? t("tasks.compose.pending") : t("tasks.compose.submit")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-destructive">
              {t(error)}
            </p>
          )}
          {result && (
            <div role="status" className="flex flex-col gap-2">
              <p className="text-muted-foreground">{t("tasks.compose.done")}</p>
              {(result.notes.length > 0 || result.missing.length > 0) && (
                <div className="rounded-md bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200">
                  <p className="font-medium">{t("tasks.compose.missing")}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {[...result.notes, ...result.missing].map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
