import { Download } from "lucide-react";

import { SopTabs } from "@/components/sop/tabs";
import { UploadPicker } from "@/components/sop/upload-picker";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { dateFormat, t } from "@/lib/i18n";
import { requireModule } from "@/modules/core/access/guard";
import { getSettings } from "@/modules/core/settings/service";
import { loadSopData } from "@/modules/sop/load";
import { monthLabel } from "@/modules/sop/texts";

import { pickSopUploadAction } from "./actions";

// «S&OP»: the section's title, its tabs and the upload the pages show. Only for those who have
// the section (the owner switches it on per role).
export default async function SopLayout({ children }: LayoutProps<"/sop">) {
  const user = await requireModule("sop");
  const [data, { timezone }] = await Promise.all([loadSopData(), getSettings(user.id)]);
  const { upload, report, uploads, marks } = data;
  const day = dateFormat({ day: "numeric", month: "short", timeZone: timezone });
  const errors = report
    ? report.findings.filter((f) => f.severity === "error" && !marks.has(f.key)).length
    : 0;
  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <PageHeader
        title={t("sop.title")}
        hint={t("sop.intro")}
        hintClassName="max-w-3xl"
        className="print:hidden"
        actions={
          report && (
            <Button asChild variant="outline">
              <a href="/api/sop/xlsx" download>
                <Download />
                {t("sop.download")}
              </a>
            </Button>
          )
        }
      />
      <SopTabs errors={errors} />
      {upload && (
        <UploadPicker
          action={pickSopUploadAction}
          current={upload.id}
          stale={upload.id !== uploads[0]?.id}
          note={
            report
              ? t("sop.picker.cycle", {
                  cycle: monthLabel(report.months.cycle),
                  closed: report.months.closed ? monthLabel(report.months.closed) : "—",
                  from: monthLabel(report.months.horizon[0]!),
                  to: monthLabel(report.months.horizon.at(-1)!),
                })
              : undefined
          }
          uploads={uploads.map((u, index) => ({
            id: u.id,
            label: [
              monthLabel(u.cycle),
              t(`sop.kindsShort.${u.kind}`),
              day.format(u.createdAt),
              u.fileName,
              index === 0 ? t("sop.picker.current") : null,
            ]
              .filter(Boolean)
              .join(" · "),
          }))}
        />
      )}
      {children}
    </div>
  );
}
