import { Section } from "@/components/connect/parts";
import { fmt, Matrix } from "@/components/distribution/parts";
import { dateFormat, t, type TranslationKey } from "@/lib/i18n";
import { outletReview, type OutletRow } from "@/modules/distribution/control";
import { typeInfo } from "@/modules/distribution/types";

const types = (row: OutletRow) => row.types.map((x) => typeInfo(x)?.label ?? x).join(", ");

// Outlets that need attention: with an ID the outlet base does not have (installed, no TSM until
// the base gets them), without an ID (counted, never split by TSM), rows not counted at all, and
// outlets the base puts in another region than the file.
export default async function EquipmentOutletsPage() {
  const r = await outletReview();
  const day = dateFormat({ dateStyle: "medium" });
  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
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
                o.region,
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
              cells: [o.posName || "—", o.tin || "—", o.region, types(o), fmt(o.units)],
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
                s.region || "—",
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
              cells: [m.outletId, m.posName || "—", m.fileRegion, m.baseRegion],
            }))}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("equip.outlets.none")}</p>
        )}
      </Section>
    </div>
  );
}
