import { savePosmAction } from "@/app/(app)/planograms/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { Posm } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";

export function PosmForm({ posm }: { posm: Posm | null }) {
  return (
    <form action={savePosmAction} className="grid gap-3 md:grid-cols-2">
      {posm && <input type="hidden" name="posmId" value={posm.id} />}
      <Label className="flex-col items-start">
        {t("planograms.library.posm.name")}
        <Input name="name" required defaultValue={posm?.name ?? ""} />
      </Label>
      <Label className="flex-col items-start">
        {t("planograms.library.posm.type")}
        <NativeSelect name="type" defaultValue={posm?.type ?? "STICKER"} className="w-full">
          {(["HEADER", "BANNER", "STICKER"] as const).map((type) => (
            <option key={type} value={type}>
              {t(`planograms.library.posm.types.${type}`)}
            </option>
          ))}
        </NativeSelect>
      </Label>
      <Label className="flex-col items-start">
        {t("planograms.library.posm.span")}
        <Input
          type="number"
          name="slotSpan"
          min={1}
          max={40}
          defaultValue={posm?.slotSpan ?? 1}
          className="w-24"
        />
      </Label>
      <Label className="flex-col items-start">
        {t("planograms.library.posm.color")}
        <Input
          type="color"
          name="color"
          defaultValue={posm?.color ?? "#16a34a"}
          className="w-20 p-1"
        />
      </Label>
      {posm && (
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            name="archived"
            defaultChecked={posm.archived}
            className="size-4"
          />{" "}
          {t("planograms.library.skus.archived")}
        </label>
      )}
      <Button type="submit" className="self-start md:col-span-2">
        {t("planograms.library.posm.save")}
      </Button>
    </form>
  );
}
