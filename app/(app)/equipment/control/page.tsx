import { Trash2 } from "lucide-react";
import Link from "next/link";

import { Section } from "@/components/connect/parts";
import { fmt, Matrix } from "@/components/distribution/parts";
import { ControlTable } from "@/components/equipment/control-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { dateFormat, t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { equipmentControl } from "@/modules/distribution/control";
import { listPurchases } from "@/modules/distribution/purchases";
import { canManageDistribution } from "@/modules/distribution/service";
import { DIST_TYPES, typeInfo } from "@/modules/distribution/types";

import { addPurchaseAction, deletePurchaseAction } from "../../distribution/actions";

// The control equation per type (bought = installed + in stock + unaccounted) and the purchase
// journal it is checked against.
export default async function EquipmentControlPage({
  searchParams,
}: PageProps<"/equipment/control">) {
  const user = await requireUser();
  const manage = canManageDistribution(user);
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : null;
  const [control, purchases, today] = await Promise.all([
    equipmentControl(),
    listPurchases(),
    getUserToday(user.id),
  ]);
  const day = dateFormat({ dateStyle: "medium", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      {error && (
        <p className="text-destructive text-sm">{t(`dist.errors.${error}` as TranslationKey)}</p>
      )}
      <Section title={t("equip.control.title")} hint={t("equip.control.hint")}>
        {control.rows.length ? (
          <ControlTable rows={control.rows} />
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("equip.empty")}{" "}
            <Link href="/distribution/import" className="text-primary hover:underline">
              {t("equip.upload")}
            </Link>
          </p>
        )}
      </Section>

      <Section title={t("equip.purchases.title")} hint={t("equip.purchases.hint")}>
        {manage && (
          <form action={addPurchaseAction} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t("equip.control.type")}
              <NativeSelect name="type" required defaultValue="">
                <option value="" disabled>
                  —
                </option>
                {DIST_TYPES.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex w-28 flex-col gap-1 text-sm">
              {t("equip.purchases.quantity")}
              <Input name="quantity" required inputMode="decimal" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("equip.purchases.date")}
              <Input type="date" name="date" required defaultValue={today} />
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
              {t("equip.purchases.document")}
              <Input name="document" required maxLength={200} />
            </label>
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
              {t("equip.purchases.note")}
              <Input name="note" maxLength={300} />
            </label>
            <Button type="submit">{t("equip.purchases.add")}</Button>
          </form>
        )}
        {purchases.length ? (
          <Matrix
            text={[3, 4, 5]}
            head={[
              t("equip.purchases.date"),
              t("equip.control.type"),
              t("equip.purchases.quantity"),
              t("equip.purchases.document"),
              t("equip.purchases.note"),
              t("equip.purchases.author"),
              ...(manage ? [""] : []),
            ]}
            rows={purchases.map((p) => ({
              key: p.id,
              cells: [
                day.format(p.date),
                typeInfo(p.type)?.label ?? p.type,
                fmt(p.quantity),
                p.document,
                p.note ?? "",
                [p.createdBy.firstName, p.createdBy.lastName].filter(Boolean).join(" "),
                ...(manage
                  ? [
                      <form key="d" action={deletePurchaseAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <Button
                          type="submit"
                          size="icon"
                          variant="ghost"
                          aria-label={t("equip.purchases.delete")}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </form>,
                    ]
                  : []),
              ],
            }))}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("equip.purchases.none")}</p>
        )}
      </Section>
    </div>
  );
}
