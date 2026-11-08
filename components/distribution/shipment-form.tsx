"use client";

import { useState } from "react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export type ShipmentValues = {
  posmId: string;
  destination: string;
  quantity: string;
  shippedOn: string;
  note: string;
  overPlan: boolean;
};

// One shipment line. Shows how much the plan still leaves for the chosen place, keeps what was
// typed when the server sends it back with an error, and puts «Сверх плана» before the button.
// TSMs come first: shipping «to the region» by mistake sends to the region's warehouse.
export function ShipmentForm({
  action,
  items,
  tsms,
  regions,
  left,
  values,
  error,
}: {
  action: (form: FormData) => Promise<void>;
  items: { id: string; name: string }[];
  tsms: string[];
  regions: string[];
  // `${posmId}\n${destination}` → pieces the plan still leaves there.
  left: Record<string, number>;
  values: ShipmentValues;
  error?: string;
}) {
  const t = useT();
  const [posmId, setPosmId] = useState(values.posmId || items[0]?.id || "");
  const [destination, setDestination] = useState(values.destination);
  const [quantity, setQuantity] = useState(values.quantity);
  const remaining = destination ? (left[`${posmId}\n${destination}`] ?? 0) : null;
  const tooMany = remaining !== null && Number(quantity) > remaining;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <label className="flex min-w-0 flex-col gap-1 text-sm xl:col-span-2">
        {t("dist.stock.posm")}
        <NativeSelect
          name="posmId"
          required
          value={posmId}
          onChange={(e) => setPosmId(e.target.value)}
        >
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-sm">
        {t("dist.stock.destination")}
        <NativeSelect
          name="destination"
          required
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        >
          <option value="" disabled>
            —
          </option>
          {tsms.length > 0 && (
            <optgroup label={t("dist.shipping.groupTsm")}>
              {tsms.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={t("dist.shipping.groupRegions")}>
            {regions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </optgroup>
        </NativeSelect>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-sm">
        {t("dist.stock.quantity")}
        <Input
          type="number"
          name="quantity"
          min={1}
          step={1}
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          aria-invalid={Boolean(error) || undefined}
          className={cn((error || tooMany) && "border-amber-500")}
        />
        {remaining !== null && (
          <span
            className={cn(
              "text-xs",
              tooMany ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
            )}
          >
            {t("dist.shipping.leftHere", { count: remaining })}
          </span>
        )}
        {error && <span className="text-destructive text-xs">{error}</span>}
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-sm">
        {t("dist.stock.date")}
        <Input type="date" name="shippedOn" defaultValue={values.shippedOn} required />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-sm">
        {t("dist.stock.note")}
        <Input name="note" maxLength={200} defaultValue={values.note} />
      </label>
      <div className="flex flex-col items-start gap-3 xl:col-span-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="overPlan"
            defaultChecked={values.overPlan}
            className="size-4"
          />
          {t("dist.stock.overPlan")}
        </label>
        <Button type="submit">{t("dist.stock.save")}</Button>
      </div>
    </form>
  );
}
