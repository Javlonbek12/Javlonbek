"use client";

import { useEffect, useRef, useState } from "react";

import { savePlanDraftAction } from "@/app/(app)/projects/actions";
import { useT } from "@/components/locale-provider";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const SAVE_DELAY_MS = 1200;

type State = "idle" | "saving" | "saved" | "error";

// The written plan (e.g. the launch plan): one text per section, with what it must state. It saves
// by itself a moment after typing stops (as task notes do) and says «Сохранено».
export function LaunchPlan({
  projectId,
  sections,
  values,
  canEdit,
}: {
  projectId: string;
  sections: { key: string; title: string; hint: string }[];
  values: Record<string, string>;
  canEdit: boolean;
}) {
  const t = useT();
  const [texts, setTexts] = useState(values);
  const [state, setState] = useState<State>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(texts);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const save = async () => {
    setState("saving");
    const sent = latest.current;
    const result = await savePlanDraftAction(projectId, sent);
    // A newer change is waiting for its own save.
    if (latest.current !== sent) return;
    setState(result.ok ? "saved" : "error");
  };
  const change = (key: string, value: string) => {
    const next = { ...latest.current, [key]: value };
    latest.current = next;
    setTexts(next);
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY_MS);
  };

  const done = sections.filter((s) => texts[s.key]?.trim()).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p className="text-muted-foreground text-sm">{t("projects.planDoc.intro")}</p>
        <span className="flex flex-wrap items-center gap-x-3 text-sm font-medium">
          {t("projects.planDoc.filled", { done, total: sections.length })}
          {canEdit && state !== "idle" && (
            <span
              role="status"
              className={cn(
                "text-xs font-normal",
                state === "error"
                  ? "text-destructive"
                  : state === "saved"
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-muted-foreground",
              )}
            >
              {t(`projects.planDoc.${state}`)}
            </span>
          )}
        </span>
        <div className="bg-muted h-2 rounded-full">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${(done / sections.length) * 100}%` }}
          />
        </div>
        {!canEdit && (
          <p className="text-muted-foreground text-xs">{t("projects.planDoc.readOnly")}</p>
        )}
      </div>
      {sections.map((section) => {
        const value = texts[section.key] ?? "";
        return (
          <Card key={section.key} className="gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{section.title}</span>
              <span
                className={cn(
                  "text-xs",
                  value.trim() ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
                )}
              >
                {value.trim() ? "✓" : t("projects.planDoc.empty")}
              </span>
            </div>
            <span className="text-muted-foreground text-xs">{section.hint}</span>
            {canEdit ? (
              <Textarea
                value={value}
                onChange={(e) => change(section.key, e.target.value)}
                aria-label={section.title}
                rows={value ? 6 : 3}
                maxLength={10_000}
              />
            ) : (
              value && <p className="text-sm whitespace-pre-wrap">{value}</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
