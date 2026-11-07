import { redirect } from "next/navigation";

import { PlanogramErrorNote, SavedNote } from "@/components/planograms/error-note";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { canApprovePlanograms, canManagePlanograms } from "@/modules/planograms/access";

import { approveAllPendingAction, massInsertAction, massReplaceAction } from "../actions";

export default async function MassPage({ searchParams }: PageProps<"/planograms/mass">) {
  const user = await requireUser();
  if (!canManagePlanograms(user.role)) redirect("/planograms");
  const query = await searchParams;
  const [skus, equipment, pending] = await Promise.all([
    db.sku.findMany({ where: { archived: false }, orderBy: [{ brand: "asc" }, { name: "asc" }] }),
    db.equipment.findMany({ orderBy: { name: "asc" } }),
    db.planogram.count({ where: { status: "PENDING_APPROVAL", isTemplate: false } }),
  ]);
  const skuOptions = skus.map((s) => (
    <option key={s.id} value={s.id}>
      {s.brand} {s.name} ({s.code})
    </option>
  ));

  return (
    <div className="flex flex-col gap-4">
      <PlanogramErrorNote error={query.error} />
      <SavedNote
        show={query.done}
        text={t("planograms.library.mass.done", { count: String(query.done) })}
      />
      {Number(query.skipped) > 0 && (
        <p className="text-sm text-amber-700">
          {t("planograms.library.mass.skipped", { count: String(query.skipped) })}
        </p>
      )}
      <SavedNote
        show={query.approved}
        text={t("planograms.library.mass.approved", { count: String(query.approved) })}
      />
      {Number(query.left) > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {t("planograms.library.mass.left", { count: String(query.left) })}
        </p>
      )}

      <Card className="gap-2">
        <CardTitle>{t("planograms.library.mass.replace")}</CardTitle>
        <form action={massReplaceAction} className="flex flex-col gap-2 md:flex-row md:items-end">
          <Label className="flex-col items-start">
            {t("planograms.library.mass.from")}
            <NativeSelect name="fromSkuId" className="w-full md:w-64">
              {skuOptions}
            </NativeSelect>
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.library.mass.to")}
            <NativeSelect name="toSkuId" className="w-full md:w-64">
              {skuOptions}
            </NativeSelect>
          </Label>
          <Button type="submit" size="sm">
            {t("planograms.library.mass.run")}
          </Button>
        </form>
      </Card>

      <Card className="gap-2">
        <CardTitle>{t("planograms.library.mass.insert")}</CardTitle>
        <form
          action={massInsertAction}
          className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-end"
        >
          <Label className="flex-col items-start">
            {t("planograms.library.mass.equipment")}
            <NativeSelect name="equipmentId" className="w-full md:w-48">
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.library.mass.sku")}
            <NativeSelect name="skuId" className="w-full md:w-64">
              {skuOptions}
            </NativeSelect>
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.library.mass.shelf")}
            <Input type="number" name="shelf" min={1} defaultValue={1} required className="w-24" />
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.library.mass.position")}
            <Input
              type="number"
              name="position"
              min={1}
              defaultValue={1}
              required
              className="w-24"
            />
          </Label>
          <Button type="submit" size="sm">
            {t("planograms.library.mass.run")}
          </Button>
        </form>
      </Card>

      {canApprovePlanograms(user.role) && (
        <Card className="gap-2">
          <CardTitle>{t("planograms.library.mass.approveAll")}</CardTitle>
          <p className="text-sm">
            {t("planograms.library.mass.pending", { count: String(pending) })}
          </p>
          <form action={approveAllPendingAction}>
            <Button type="submit" size="sm" disabled={pending === 0}>
              {t("planograms.library.mass.approveAll")}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
