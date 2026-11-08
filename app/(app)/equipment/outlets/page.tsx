import { Download } from "lucide-react";

import { Section } from "@/components/connect/parts";
import { fmt, Matrix } from "@/components/distribution/parts";
import { DataFreshness } from "@/components/equipment/data-freshness";
import { Button } from "@/components/ui/button";
import { dateFormat, t, type TranslationKey } from "@/lib/i18n";
import { outletReview, type OutletRow } from "@/modules/distribution/control";
import { regionLabel, typeInfo } from "@/modules/distribution/types";

const types = (row: OutletRow) => row.types.map((x) => typeInfo(x)?.label ?? x).join(", ");

// Outlets that need attention: with an ID the outlet base does not have (installed, no TSM until
// the base gets them), without an ID (counted, never split by TSM), rows not counted at all, and
// outlets the base puts in another region than the file.
export default async function EquipmentOutletsPage() {
  const r = await outletReview();
  const day = dateFormat({ dateStyle: "medium" });
  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DataFreshness />
        <Button asChild size="sm" variant="outline">
          <a href="/api/distribution/outlet-review">
            <Download />
            {t("equip.attention.excel")}
          </a>
        </Button>
      </div>
      <Section
        title={`${t("equip.outlets.missingTitle")} · ${fmt(r.missing.length)}`}
        hint={t("equip.outlets.missingHint")}
      >
        {r.missing.length ? (
          <Matrix
            dense
            text={[1, 2, 3, 4]}
            head={[
              "ID",
              t("equip.outlets.name"),
              t("equip.outlets.tin"),
              t("dist.equipment.region"),
              t("equip.outlets.types"),
              t("equip.outlets.units"),
              t("equip.outlets.firstSeen"),
            ]}
            rows={r.missing.map((o) => ({
              key: o.key,
              cells: [
                o.outletId,
                o.posName || "—",
                o.tin || "—",
                regionLabel(o.region),
                types(o),
                fmt(o.units),
                o.firstSeen ? day.format(o.firstSeen) : "—",
              ],
            }))}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("equip.outlets.none")}</p>
        )}
      </Section>

      <Section
        title={`${t("equip.outlets.noIdTitle")} · ${fmt(r.noId.length)}`}
        hint={t("equip.outlets.noIdHint")}
      >
        {r.noId.length ? (
          <Matrix
            dense
            text={[0, 1, 2, 3]}
            head={[
              t("equip.outlets.name"),
              t("equip.outlets.tin"),
              t("dist.equipment.region"),
              t("equip.outlets.types"),
              t("equip.outlets.units"),
            ]}
            rows={r.noId.map((o) => ({
              key: o.key,
              cells: [
                o.posName || "—",
                o.tin || "—",
                regionLabel(o.region),
                types(o),
                fmt(o.units),
              ],
            }))}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("equip.outlets.none")}</p>
        )}
      </Section>

      <Section
        title={`${t("equip.outlets.skippedTitle")} · ${fmt(r.skipped.length)}`}
        hint={t("equip.outlets.skippedHint")}
      >
        {r.skipped.length ? (
          <Matrix
            dense
            text={[1, 2, 3]}
            head={[
              t("equip.outlets.row"),
              t("equip.outlets.reason"),
              t("dist.equipment.region"),
              t("equip.outlets.description"),
            ]}
            rows={r.skipped.map((s) => ({
              key: s.id,
              cells: [
                s.row,
                t(`equip.outlets.reasons.${s.reason}` as TranslationKey),
                s.region ? regionLabel(s.region) : "—",
                s.description || "—",
              ],
            }))}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("equip.outlets.none")}</p>
        )}
      </Section>

      <Section
        title={`${t("equip.outlets.mismatchTitle")} · ${fmt(r.mismatches.length)}`}
        hint={t("equip.outlets.mismatchHint")}
      >
        {r.mismatches.length ? (
          <Matrix
            dense
            text={[1, 2, 3]}
            head={[
              "ID",
              t("equip.outlets.name"),
              t("equip.outlets.fileRegion"),
              t("equip.outlets.baseRegion"),
            ]}
            rows={r.mismatches.map((m) => ({
              key: m.outletId,
              cells: [
                m.outletId,
                m.posName || "—",
                regionLabel(m.fileRegion),
                m.baseRegion
                  .split(", ")
                  .map((x) => regionLabel(x))
                  .join(", "),
              ],
            }))}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("equip.outlets.none")}</p>
        )}
      </Section>
    </div>
  );
}
