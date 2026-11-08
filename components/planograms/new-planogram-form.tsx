"use client";

import { useState } from "react";

import { createPlanogramAction } from "@/app/(app)/planograms/actions";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

type Option = { id: string; label: string };

// «Новая планограмма»: the templates offered are those of the chosen equipment (a template is
// made for one shape). `values` are what was typed before an error sent the form back.
export function NewPlanogramForm({
  equipment,
  templates,
  priceLists,
  projects,
  values,
}: {
  equipment: Option[];
  templates: (Option & { equipmentId: string })[];
  priceLists: Option[];
  // Projects planograms already have: offered as you type, so a typo makes no new «project».
  projects: string[];
  values: Record<string, string>;
}) {
  const t = useT();
  const [equipmentId, setEquipmentId] = useState(values.equipmentId || equipment[0]?.id || "");
  const own = templates.filter((tpl) => tpl.equipmentId === equipmentId);
  const [templateId, setTemplateId] = useState(values.templateId ?? "");
  const template = own.some((tpl) => tpl.id === templateId) ? templateId : "";

  return (
    <form action={createPlanogramAction} className="flex max-w-2xl flex-col gap-4">
      <Card className="gap-3">
        <Label className="flex-col items-start">
          {t("planograms.fields.equipment")}
          <NativeSelect
            name="equipmentId"
            required
            className="w-full"
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
          >
            {equipment.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <div className="grid gap-3 md:grid-cols-2">
          <Label className="flex-col items-start">
            {t("planograms.fields.title")}
            <Input
              name="title"
              required
              maxLength={200}
              placeholder="Display L POSI"
              defaultValue={values.title}
            />
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.fields.channel")}
            <Input name="channel" required maxLength={40} defaultValue={values.channel ?? "POSI"} />
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.fields.project")}
            <Input
              name="project"
              maxLength={100}
              placeholder="ESSE Change 1"
              defaultValue={values.project}
              list="planogram-projects"
              autoComplete="off"
            />
            <datalist id="planogram-projects">
              {projects.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.fields.priceList")}
            <NativeSelect
              name="priceListId"
              className="w-full"
              defaultValue={values.priceListId ?? ""}
            >
              <option value="">{t("planograms.fields.noPriceList")}</option>
              {priceLists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.fields.validFrom")}
            <Input type="date" name="validFrom" defaultValue={values.validFrom} />
          </Label>
          <Label className="flex-col items-start">
            {t("planograms.fields.validTo")}
            <Input type="date" name="validTo" defaultValue={values.validTo} />
          </Label>
        </div>
        <Label className="flex-col items-start">
          {t("planograms.fields.template")}
          <NativeSelect
            name="templateId"
            className="w-full"
            value={template}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">{t("planograms.fields.none")}</option>
            {own.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.label}
              </option>
            ))}
          </NativeSelect>
          {own.length === 0 && templates.length > 0 && (
            <span className="text-muted-foreground text-xs font-normal">
              {t("planograms.fields.noTemplates")}
            </span>
          )}
        </Label>
        <fieldset className="flex flex-wrap gap-4 text-sm" disabled={template !== ""}>
          <legend className="mb-1 text-sm font-medium">{t("planograms.fields.fill")}</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="fill"
              value="auto"
              defaultChecked={(values.fill || "auto") === "auto"}
            />{" "}
            {t("planograms.fields.fillAuto")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="fill"
              value="empty"
              defaultChecked={values.fill === "empty"}
            />{" "}
            {t("planograms.fields.fillEmpty")}
          </label>
        </fieldset>
      </Card>
      <Button type="submit" className="self-start">
        {t("planograms.create")}
      </Button>
    </form>
  );
}
