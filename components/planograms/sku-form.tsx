import { saveSkuAction } from "@/app/(app)/planograms/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toDateString } from "@/lib/dates";
import type { Sku } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";

const k = (key: string) => t(`planograms.library.skus.${key}` as Parameters<typeof t>[0]);

export function SkuForm({ sku }: { sku: Sku | null }) {
  return (
    <form action={saveSkuAction} className="grid gap-3 md:grid-cols-2">
      {sku && <input type="hidden" name="skuId" value={sku.id} />}
      <Label className="flex-col items-start">
        {k("code")}
        <Input name="code" required defaultValue={sku?.code ?? ""} />
      </Label>
      <Label className="flex-col items-start">
        {k("brand")}
        <Input name="brand" required defaultValue={sku?.brand ?? ""} />
      </Label>
      <Label className="flex-col items-start">
        {k("name")}
        <Input name="name" required defaultValue={sku?.name ?? ""} />
      </Label>
      <Label className="flex-col items-start">
        {k("format")}
        <Input name="format" defaultValue={sku?.format ?? ""} />
      </Label>
      <Label className="flex-col items-start">
        {k("badges")}
        <Input name="defaultBadges" defaultValue={sku?.defaultBadges.join(", ") ?? ""} />
      </Label>
      <Label className="flex-col items-start">
        {k("priceStyle")}
        <NativeSelect
          name="priceStyle"
          defaultValue={sku?.priceStyle ?? "NUMBER"}
          className="w-full"
        >
          <option value="NUMBER">{k("priceNumber")}</option>
          <option value="MING">{k("priceMing")}</option>
        </NativeSelect>
      </Label>
      <Label className="flex-col items-start">
        {k("newSince")}
        <Input
          type="date"
          name="newSince"
          defaultValue={sku?.newSince ? toDateString(sku.newSince) : ""}
        />
      </Label>
      <Label className="flex-col items-start">
        {k("color")}
        <Input
          type="color"
          name="color"
          defaultValue={sku?.color ?? "#64748b"}
          className="w-20 p-1"
        />
      </Label>
      <div className="flex flex-wrap gap-4 text-sm md:col-span-2">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            name="isNew"
            defaultChecked={sku?.isNew ?? false}
            className="size-4"
          />{" "}
          {k("isNew")}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            name="isMandatory"
            defaultChecked={sku?.isMandatory ?? false}
            className="size-4"
          />{" "}
          {k("mandatory")}
        </label>
        {sku && (
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              name="archived"
              defaultChecked={sku.archived}
              className="size-4"
            />{" "}
            {k("archived")}
          </label>
        )}
      </div>
      <Button type="submit" className="self-start">
        {k("save")}
      </Button>
    </form>
  );
}
