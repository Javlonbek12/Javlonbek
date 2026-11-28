import { SopEmpty } from "@/components/sop/empty";
import { FindingsView } from "@/components/sop/findings";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { filterFindings, parseFindingsFilter } from "@/modules/sop/filter";
import { loadSopData } from "@/modules/sop/load";
import { monthLabel } from "@/modules/sop/texts";

import { markSopFindingAction } from "../actions";

// «Ошибки и риски»: everything found in the file, filtered by the page's address.
export default async function SopFindingsPage({ searchParams }: PageProps<"/sop/findings">) {
  const user = await requireUser();
  const [data, { timezone }, params] = await Promise.all([
    loadSopData(),
    getSettings(user.id),
    searchParams,
  ]);
  const { report, upload, baseline, marks } = data;
  if (!report || !upload) return <SopEmpty broken={data.broken} />;
  const filter = parseFindingsFilter(params);
  return (
    <FindingsView
      findings={filterFindings(report.findings, filter, new Set(marks.keys()))}
      all={report.findings}
      marks={marks}
      cycle={upload.cycle}
      filter={filter}
      factories={[...new Set(report.stats.map((s) => s.factory))].filter(Boolean).sort()}
      skuName={report.stats.find((s) => s.key === filter.sku)?.name ?? null}
      baseline={
        baseline
          ? t("sop.findings.baseline", {
              file: baseline.fileName,
              cycle: monthLabel(baseline.cycle),
              kind: t(`sop.kindsShort.${baseline.kind}`),
            })
          : null
      }
      markAction={markSopFindingAction}
      timeZone={timezone}
    />
  );
}
