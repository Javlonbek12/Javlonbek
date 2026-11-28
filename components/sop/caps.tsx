import { Download } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { KA_MIN_MONTHS, type CapRow } from "@/modules/sop/caps";
import { skuHref } from "@/modules/sop/links";
import type { SopSettings } from "@/modules/sop/settings";
import { cases, coverText, monthLabel } from "@/modules/sop/texts";

import { Chip, NUM, ScrollTable, STICKY, TD, TH, TONE_TEXT } from "./parts";

// Where the key accounts' part of the table comes from, in a sentence.
export function capsSource(rows: CapRow[], settings: SopSettings): string {
  const names = { ka: settings.kaLabel, share: formatNumber(settings.kaShare ?? 0, 1) };
  const fromFile = rows.some((r) => r.source === "file");
  const fromShare = rows.some((r) => r.source === "share");
  if (fromFile && fromShare) return t("sop.caps.source.mixed", names);
  if (fromFile) return t("sop.caps.source.file", names);
  if (fromShare) return t("sop.caps.source.share", names);
  return t("sop.caps.source.none", names);
}

// «Лимиты отгрузки»: for M and M+1, how much of each SKU may go to the main distributor.
export function CapsView({
  rows,
  settings,
  download,
}: {
  rows: CapRow[];
  settings: SopSettings;
  // The link of the Excel file (none in a test).
  download?: string;
}) {
  const labels = { ka: settings.kaLabel, distributor: settings.distributorLabel };
  const months = rows[0]?.months.map((m) => m.month) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground max-w-3xl text-sm">{t("sop.caps.intro", labels)}</p>
        {download && rows.length > 0 && (
          <Button asChild variant="outline">
            <a href={download} download>
              <Download />
              {t("sop.caps.download")}
            </a>
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <Card>
          <CardDescription>{t("sop.caps.none")}</CardDescription>
        </Card>
      ) : (
        <Card className="gap-3">
          {rows.some((r) => r.source !== "none") ? (
            <CardDescription>{capsSource(rows, settings)}</CardDescription>
          ) : (
            <p role="note" className="rounded-md bg-amber-400/15 p-3 text-sm">
              {capsSource(rows, settings)}{" "}
              <Link href="/sop/settings" className="text-primary underline underline-offset-2">
                {t("sop.tabs.settings")}
              </Link>
            </p>
          )}
          <ScrollTable label={t("sop.tabs.caps")}>
            <thead>
              <tr>
                <th rowSpan={2} className={cn(TH, STICKY, "text-left align-bottom")}>
                  {t("sop.caps.columns.sku")}
                </th>
                {months.map((month) => (
                  <th key={month} colSpan={5} className={cn(TH, "border-l text-center")}>
                    <span className="text-foreground text-sm font-medium">{monthLabel(month)}</span>
                  </th>
                ))}
              </tr>
              <tr>
                {months.map((month) =>
                  (["sellIn", "ka", "cap", "stock", "kaMonths"] as const).map((column) => (
                    <th
                      key={`${month}-${column}`}
                      className={cn(
                        TH,
                        "max-w-[7rem] text-right whitespace-normal",
                        column === "sellIn" && "border-l",
                        column === "cap" && "text-foreground font-medium",
                      )}
                    >
                      {t(`sop.caps.columns.${column}`, labels)}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td
                    className={cn(
                      TD,
                      STICKY,
                      "max-w-[8.5rem] min-w-[7.5rem] sm:max-w-xs sm:min-w-[9rem]",
                    )}
                  >
                    <Link
                      href={skuHref(row.key)}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <span className="text-muted-foreground block text-xs">
                      {[row.factory, row.status].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  {row.months.map((m) => (
                    <CapCells key={m.month} month={m} />
                  ))}
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </Card>
      )}
    </div>
  );
}

function CapCells({ month: m }: { month: CapRow["months"][number] }) {
  const unset = <span className="text-muted-foreground text-xs">{t("sop.caps.notSet")}</span>;
  return (
    <>
      <td className={cn(TD, NUM, "border-l")}>{cases(m.sellIn)}</td>
      <td className={cn(TD, NUM)}>{m.ka === null ? unset : cases(m.ka)}</td>
      <td className={cn(TD, NUM, "font-semibold")}>{m.cap === null ? unset : cases(m.cap)}</td>
      <td className={cn(TD, NUM, m.entityStock < -0.5 && TONE_TEXT.bad)}>{cases(m.entityStock)}</td>
      <td className={cn(TD, NUM)}>
        {m.kaMonths === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="inline-flex flex-col items-end gap-0.5">
            {coverText(m.kaMonths)}
            {m.warn && <Chip tone="bad">{t("sop.caps.warn", { min: KA_MIN_MONTHS })}</Chip>}
          </span>
        )}
      </td>
    </>
  );
}
