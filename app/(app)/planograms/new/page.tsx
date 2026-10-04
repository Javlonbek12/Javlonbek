import { notFound } from "next/navigation";

import { PlanogramErrorNote } from "@/components/planograms/error-note";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManagePlanograms } from "@/modules/planograms/access";
import { describeGeometry, parseGeometry } from "@/modules/planograms/geometry";

import { createPlanogramAction } from "../actions";

export default async function NewPlanogramPage({ searchParams }: PageProps<"/planograms/new">) {
  const user = await requireUser();
  if (!canManagePlanograms(user.role)) notFound();
  const { error } = await searchParams;
  const [equipment, templates, priceLists] = await Promise.all([
    db.equipment.findMany({ orderBy: { name: "asc" } }),
    db.planogram.findMany({
      where: { isTemplate: true },
      select: { id: true, title: true, equipmentId: true },
      orderBy: { title: "asc" },
    }),
    db.priceList.findMany({ orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] }),
  ]);

  return (
    <form action={createPlanogramAction} className="flex max-w-2xl flex-col gap-4">
      <PlanogramErrorNote error={error} />
      <Card className="gap-3">
        <Label className="flex-col items-start">
          {t("planograms.fields.equipment")}
          <NativeSelect name="equipmentId" required className="w-full">
            {equipment.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.channel}, {describeGeometry(parseGeometry(e.geometry))})
              </option>
            ))}
          </NativeSelect>
        </Label>
        <div className="grid gap-3 md:grid-cols-2">
          <Label className="flex-col items-start">
            {t("planograms.fields.title")}
            <Input name="title" required maxLength={200} placeholder="Display L POSI" />
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.fields.channel")}
            <Input name="channel" required maxLength={40} defaultValue="POSI" />
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.fields.project")}
            <Input name="project" maxLength={100} placeholder="ESSE Change 1" />
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.fields.priceList")}
            <NativeSelect name="priceListId" className="w-full">
              {priceLists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.fields.validFrom")}
            <Input type="date" name="validFrom" />
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.fields.validTo")}
            <Input type="date" name="validTo" />
          </Label>
        </div>
        <Label className="flex-col items-start">
          {t("planograms.fields.template")}
          <NativeSelect name="templateId" className="w-full">
            <option value="">{t("planograms.fields.none")}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.title}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1 text-sm font-medium">{t("planograms.fields.fill")}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="fill" value="auto" defaultChecked />{" "}
            {t("planograms.fields.fillAuto")}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="fill" value="empty" /> {t("planograms.fields.fillEmpty")}
          </label>
        </fieldset>
      </Card>
      <Button type="submit" className="self-start">
        {t("planograms.create")}
      </Button>
    </form>
  );
}
