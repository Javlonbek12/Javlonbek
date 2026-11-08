"use client";

import { Download, Loader2 } from "lucide-react";
import { useActionState } from "react";

import {
  applyOrgImportAction,
  previewOrgImportAction,
  type OrgImportState,
} from "@/app/(app)/team/structure/import/actions";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EMPTY: OrgImportState = { errors: [], preview: null };

// «Загрузить из Excel»: the file is checked and shown as the chart it will become; only then
// «Загрузить» saves it (replacing the current chart).
export function OrgImportForm({ replaces }: { replaces: boolean }) {
  const t = useT();
  const [checked, check, checking] = useActionState(previewOrgImportAction, EMPTY);
  const [applied, apply, applying] = useActionState(applyOrgImportAction, EMPTY);
  const errors = [...checked.errors, ...applied.errors];
  const preview = checked.preview;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <a href="/team/structure/template" download>
            <Download />
            {t("team.org.import.template")}
          </a>
        </Button>
      </div>
      <form action={check} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("team.org.import.file")}
          <Input
            type="file"
            name="file"
            required
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          />
        </label>
        <Button type="submit" variant="outline" disabled={checking}>
          {checking && <Loader2 className="animate-spin" />}
          {t("team.org.import.check")}
        </Button>
      </form>

      {errors.length > 0 && (
        <div role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          <p className="font-medium">{t("team.org.import.fix")}</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <div className="flex flex-col gap-3">
          <h2 className="font-medium">{t("team.org.import.preview")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("team.org.import.stats", {
              units: preview.stats.units,
              places: preview.stats.places,
              vacancies: preview.stats.vacancies,
              linked: preview.stats.linked,
            })}
          </p>
          <ul className="bg-muted/40 flex max-h-96 flex-col gap-0.5 overflow-y-auto rounded-lg border p-3 text-sm">
            {preview.lines.map((line, i) => (
              <li key={i} style={{ paddingLeft: `${line.depth * 1.25}rem` }}>
                {line.text}
                {line.note && <span className="text-muted-foreground"> · {line.note}</span>}
              </li>
            ))}
          </ul>
          <form action={apply} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="chart" value={preview.chart} />
            <Button type="submit" disabled={applying}>
              {applying && <Loader2 className="animate-spin" />}
              {t("team.org.import.apply")}
            </Button>
            {replaces && (
              <span className="text-muted-foreground text-sm">{t("team.org.import.replaces")}</span>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
