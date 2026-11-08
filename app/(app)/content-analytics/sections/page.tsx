import { sectionMeta } from "@/components/content/analytics-charts";
import { AnalyticsTabs } from "@/components/content/analytics-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { addMonths } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { analyticsPeriod } from "@/modules/content/analytics";
import { listSections } from "@/modules/content/sections";
import { formatRange } from "@/modules/reports/format";

import {
  archiveSectionAction,
  deleteSectionAction,
  retagAction,
  saveSectionAction,
} from "../actions";

const BACK = "/content-analytics/sections";

// The sections AI sorts posts into: a setting, kept apart from the results.
export default async function ContentSectionsPage({
  searchParams,
}: PageProps<"/content-analytics/sections">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = await getUserToday(user.id);
  const sections = await listSections();
  const meta = sectionMeta(sections);
  // Re-tagging covers the last three months and the year planned ahead.
  const retagFrom = analyticsPeriod(today, 3).from;
  const DONE = ["saved", "created", "archived", "restored", "deleted", "retagged"] as const;
  const ERRORS = ["invalid", "state", "forbidden", "notFound"] as const;
  const sectionDone = DONE.find((d) => d === params.section);
  const sectionError = ERRORS.find((e) => e === params.sectionError);

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <PageHeader title={t("content.analytics.title")} />
      <AnalyticsTabs active="sections" />
      <Card id="sections" className="scroll-mt-20 gap-3">
        <div className="flex flex-wrap items-center gap-x-1">
          <CardTitle>{t("content.analytics.sections.title")}</CardTitle>
          <InfoHint>{t("content.analytics.sections.hint")}</InfoHint>
        </div>
        {sectionDone && (
          <p className="text-sm text-emerald-700">
            {t(`content.analytics.sections.done.${sectionDone}`, {
              count: String(params.count ?? 0),
            })}
          </p>
        )}
        {sectionError && (
          <p className="text-destructive text-sm">
            {t(`content.analytics.sections.errors.${sectionError}`)}
          </p>
        )}
        <ul className="flex flex-col divide-y">
          {sections.map((section) => (
            <li key={section.id} className="flex flex-col gap-2 py-3">
              <details>
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: meta[section.id]?.color }}
                  />
                  <span className={cn("font-medium", section.archived && "text-muted-foreground")}>
                    {meta[section.id]?.name ?? section.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("content.analytics.sections.posts", { count: section.posts })}
                    {section.archived && ` · ${t("content.analytics.sections.archived")}`}
                  </span>
                </summary>
                <div className="mt-3 flex flex-col gap-2">
                  <SectionForm section={section} />
                  <div className="flex flex-wrap gap-2">
                    <form action={archiveSectionAction}>
                      <input type="hidden" name="back" value={BACK} />
                      <input type="hidden" name="id" value={section.id} />
                      <input type="hidden" name="archived" value={section.archived ? "0" : "1"} />
                      <Button type="submit" size="sm" variant="outline">
                        {section.archived
                          ? t("content.analytics.sections.restore")
                          : t("content.analytics.sections.archive")}
                      </Button>
                    </form>
                    {section.posts === 0 && (
                      <form action={deleteSectionAction}>
                        <input type="hidden" name="back" value={BACK} />
                        <input type="hidden" name="id" value={section.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                        >
                          {t("content.analytics.sections.delete")}
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              </details>
              {section.description && (
                <p className="text-muted-foreground pl-[18px] text-xs">{section.description}</p>
              )}
            </li>
          ))}
        </ul>
        <details className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t("content.analytics.sections.add")}
          </summary>
          <div className="mt-3">
            <SectionForm
              section={{
                id: "",
                name: "",
                nameEn: null,
                description: null,
                sortOrder: sections.length,
              }}
            />
          </div>
        </details>
        <form action={retagAction} className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
          <input type="hidden" name="back" value={BACK} />
          <input type="hidden" name="from" value={retagFrom} />
          <input type="hidden" name="to" value={addMonths(today, 12)} />
          <span className="text-muted-foreground text-xs">
            {t("content.analytics.sections.retagHint")} (
            {t("content.analytics.sections.retagFrom", {
              date: formatRange(retagFrom, retagFrom, today),
            })}
            )
          </span>
          <div>
            <Button type="submit" size="sm" variant="outline">
              {t("content.analytics.sections.retag")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function SectionForm({
  section,
}: {
  section: {
    id: string;
    name: string;
    nameEn: string | null;
    description: string | null;
    sortOrder: number;
  };
}) {
  return (
    <form action={saveSectionAction} className="flex flex-col gap-2 text-sm">
      <input type="hidden" name="back" value={BACK} />
      <input type="hidden" name="id" value={section.id} />
      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <label className="flex flex-col gap-1">
          {t("content.analytics.sections.name")}
          <Input name="name" defaultValue={section.name} required maxLength={60} />
        </label>
        <label className="flex flex-col gap-1">
          {t("content.analytics.sections.order")}
          <Input
            type="number"
            name="sortOrder"
            min={0}
            max={999}
            defaultValue={section.sortOrder}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        {t("content.analytics.sections.nameEn")}
        <Input name="nameEn" defaultValue={section.nameEn ?? ""} maxLength={60} />
      </label>
      <label className="flex flex-col gap-1">
        {t("content.analytics.sections.description")}
        <Textarea
          name="description"
          defaultValue={section.description ?? ""}
          maxLength={300}
          rows={2}
        />
      </label>
      <div>
        <Button type="submit" size="sm">
          {section.id ? t("content.analytics.sections.save") : t("content.analytics.sections.add")}
        </Button>
      </div>
    </form>
  );
}
