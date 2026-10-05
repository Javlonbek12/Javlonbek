import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { savePlanSectionsAction } from "@/app/(app)/projects/actions";

// The written plan (e.g. the Launching Plan): one text per section, with what it must state.
export function LaunchPlan({
  projectId,
  sections,
  values,
  canEdit,
  saved,
}: {
  projectId: string;
  sections: { key: string; title: string; hint: string }[];
  values: Record<string, string>;
  canEdit: boolean;
  saved: boolean;
}) {
  const done = sections.filter((s) => values[s.key]?.trim()).length;
  return (
    <form action={savePlanSectionsAction} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-col gap-1.5">
        <p className="text-muted-foreground text-sm">{t("projects.planDoc.intro")}</p>
        <span className="text-sm font-medium">
          {t("projects.planDoc.filled", { done, total: sections.length })}
        </span>
        <div className="bg-muted h-2 rounded-full">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${(done / sections.length) * 100}%` }}
          />
        </div>
        {saved && (
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            {t("projects.planDoc.saved")}
          </p>
        )}
        {!canEdit && (
          <p className="text-muted-foreground text-xs">{t("projects.planDoc.readOnly")}</p>
        )}
      </div>
      {sections.map((section) => {
        const value = values[section.key] ?? "";
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
                name={`section.${section.key}`}
                defaultValue={value}
                rows={value ? 6 : 3}
                maxLength={10_000}
              />
            ) : (
              value && <p className="text-sm whitespace-pre-wrap">{value}</p>
            )}
          </Card>
        );
      })}
      {canEdit && (
        <div className="bg-background/95 sticky bottom-16 py-2 md:bottom-0">
          <Button type="submit">{t("projects.planDoc.save")}</Button>
        </div>
      )}
    </form>
  );
}
