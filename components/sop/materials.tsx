import Link from "next/link";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { skuHref } from "@/modules/sop/links";
import type { MaterialRow } from "@/modules/sop/report";
import { cases, coverText } from "@/modules/sop/texts";

import { Chip, NUM, Pills, ScrollTable, STICKY, TD, TH, TONE_TEXT } from "./parts";

// «Материалы»: the packaging the factory holds for our SKUs against the six months of the plan.
export function MaterialsView({
  rows,
  sheet,
  onlyFlagged,
}: {
  // Null: the file has no materials sheet.
  rows: MaterialRow[] | null;
  sheet: string | null;
  onlyFlagged: boolean;
}) {
  if (!rows)
    return (
      <Card className="gap-2">
        <CardTitle>{t("sop.materials.none.title")}</CardTitle>
        <CardDescription>{t("sop.materials.none.text")}</CardDescription>
      </Card>
    );
  const flagged = rows.filter((r) => r.flag);
  const shown = onlyFlagged ? flagged : rows;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground max-w-3xl text-sm">{t("sop.materials.intro")}</p>
      <Card className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Pills
            label={t("sop.tabs.materials")}
            items={[
              {
                key: "all",
                label: t("sop.materials.all"),
                href: "/sop/materials",
                active: !onlyFlagged,
                count: rows.length,
              },
              {
                key: "flagged",
                label: t("sop.materials.onlyFlagged"),
                href: "/sop/materials?risk=1",
                active: onlyFlagged,
                count: flagged.length,
              },
            ]}
          />
          <span className="text-muted-foreground text-xs">
            {t("sop.materials.sheet", { sheet: sheet ?? "", count: rows.length })}
          </span>
        </div>
        <ScrollTable label={t("sop.tabs.materials")}>
          <thead>
            <tr>
              <th className={cn(TH, STICKY, "text-left")}>{t("sop.materials.columns.sku")}</th>
              {(["ksh", "box", "plan", "leftover", "forecast", "turnover"] as const).map((c) => (
                <th key={c} className={cn(TH, "max-w-[7rem] text-right whitespace-normal")}>
                  {t(`sop.materials.columns.${c}`)}
                </th>
              ))}
              <th className={cn(TH, "text-left")}>{t("sop.materials.columns.note")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.row}>
                <td
                  className={cn(
                    TD,
                    STICKY,
                    "max-w-[8.5rem] min-w-[7.5rem] sm:max-w-xs sm:min-w-[9rem]",
                  )}
                >
                  {row.skuKey ? (
                    <Link
                      href={skuHref(row.skuKey)}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {row.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{row.name}</span>
                  )}
                  <span className="text-muted-foreground block text-xs">
                    {[row.factory, row.status].filter(Boolean).join(" · ")}
                  </span>
                </td>
                <td className={cn(TD, NUM)}>{row.totalKsh === null ? "—" : cases(row.totalKsh)}</td>
                <td className={cn(TD, NUM)}>{row.totalBox === null ? "—" : cases(row.totalBox)}</td>
                <td className={cn(TD, NUM)}>
                  {row.planTotal === null ? "—" : cases(row.planTotal)}
                </td>
                <td className={cn(TD, NUM)}>
                  {row.leftover > 0.5 ? (
                    <span className={cn("font-semibold", row.flag && TONE_TEXT.warn)}>
                      {cases(row.leftover)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className={cn(TD, NUM)}>
                  {row.salesForecast === null ? "—" : cases(row.salesForecast)}
                </td>
                <td className={cn(TD, NUM)}>
                  {row.turnover === null || row.turnover === 0 ? "—" : coverText(row.turnover)}
                </td>
                <td className={cn(TD, "min-w-[10rem] text-xs")}>
                  {row.flag && <Chip tone="warn">{t(`sop.materials.flags.${row.flag}`)}</Chip>}
                  {row.leftover < -0.5 && (row.totalBox ?? 0) >= 1 && (
                    <span className="text-muted-foreground block">
                      {t("sop.materials.short", { count: cases(-row.leftover) })}
                    </span>
                  )}
                  {row.note && <span className="block">{row.note}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      </Card>
    </div>
  );
}
