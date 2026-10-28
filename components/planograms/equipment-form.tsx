"use client";

import { useState } from "react";

import { saveEquipmentAction } from "@/app/(app)/planograms/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useT } from "@/components/locale-provider";
import type { Geometry, Shelf } from "@/modules/planograms/geometry";

type Props = {
  id: string | null;
  code: string;
  name: string;
  channel: string;
  geometry: Geometry;
  locked: boolean;
  // Types of the equipment file (BW) this model is, and every type with the model it is now.
  distTypes: string[];
  typeOptions: { code: string; label: string; owner: string | null }[];
};

// Equipment constructor: shelves with slot counts, offsets and grouping, plus a live preview.
export function EquipmentForm(props: Props) {
  const t = useT();
  const [header, setHeader] = useState<Geometry["header"]>(props.geometry.header);
  const [shelves, setShelves] = useState<Shelf[]>(props.geometry.shelves);
  const update = (index: number, patch: Partial<Shelf>) =>
    setShelves((list) => list.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const number = (value: string, min: number) => Math.min(40, Math.max(min, Number(value) || min));
  const width = Math.max(...shelves.map((s) => s.offset + s.slots));

  return (
    <form action={saveEquipmentAction} className="flex flex-col gap-4">
      {props.id && <input type="hidden" name="equipmentId" value={props.id} />}
      <input type="hidden" name="geometry" value={JSON.stringify({ header, shelves })} />
      <div className="grid gap-3 md:grid-cols-3">
        <Label className="flex-col items-start">
          {t("planograms.library.equipment.code")}
          <Input name="code" required defaultValue={props.code} />
        </Label>
        <Label className="flex-col items-start">
          {t("planograms.library.equipment.name")}
          <Input name="name" required defaultValue={props.name} />
        </Label>
        <Label className="flex-col items-start">
          {t("planograms.library.equipment.channel")}
          <Input name="channel" required defaultValue={props.channel} />
        </Label>
      </div>
      {props.locked && (
        <p className="text-muted-foreground text-sm">{t("planograms.library.equipment.inUse")}</p>
      )}
      <fieldset disabled={props.locked} className="flex flex-col gap-3">
        <Label className="flex-col items-start">
          {t("planograms.library.equipment.header")}
          <NativeSelect
            value={header ?? ""}
            onChange={(e) => setHeader((e.target.value || null) as Geometry["header"])}
          >
            <option value="">{t("planograms.library.equipment.headerNone")}</option>
            <option value="horizontal">{t("planograms.library.equipment.headerHorizontal")}</option>
            <option value="vertical">{t("planograms.library.equipment.headerVertical")}</option>
          </NativeSelect>
        </Label>
        <p className="font-medium">{t("planograms.library.equipment.shelves")}</p>
        <ol className="flex flex-col gap-2">
          {shelves.map((shelf, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2 text-sm">
              <span className="w-6 pb-2">{i + 1}.</span>
              <Label className="flex-col items-start font-normal">
                {t("planograms.library.equipment.slots")}
                <Input
                  type="number"
                  min={1}
                  max={40}
                  value={shelf.slots}
                  className="w-20"
                  onChange={(e) => update(i, { slots: number(e.target.value, 1) })}
                />
              </Label>
              <Label className="flex-col items-start font-normal">
                {t("planograms.library.equipment.offset")}
                <Input
                  type="number"
                  min={0}
                  max={40}
                  value={shelf.offset}
                  className="w-20"
                  onChange={(e) => update(i, { offset: number(e.target.value, 0) })}
                />
              </Label>
              <Label className="flex-col items-start font-normal">
                {t("planograms.library.equipment.group")}
                <Input
                  type="number"
                  min={0}
                  max={40}
                  value={shelf.group}
                  className="w-20"
                  onChange={(e) => update(i, { group: number(e.target.value, 0) })}
                />
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={shelves.length === 1}
                onClick={() => setShelves((list) => list.filter((_, j) => j !== i))}
              >
                {t("planograms.library.equipment.removeShelf")}
              </Button>
            </li>
          ))}
        </ol>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={shelves.length >= 20}
          onClick={() => setShelves((list) => [...list, { ...list[list.length - 1] }])}
        >
          {t("planograms.library.equipment.addShelf")}
        </Button>
      </fieldset>

      {/* Shelftalkers don't move any slot: they can be set on equipment that has planograms. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{t("planograms.library.equipment.talkers")}</legend>
        <p className="text-muted-foreground text-xs">
          {t("planograms.library.equipment.talkersHint")}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {shelves.map((shelf, i) => (
            <label key={i} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={shelf.talker ?? false}
                onChange={(e) => update(i, { talker: e.target.checked })}
                className="size-4"
              />
              {t("planograms.editor.shelf", { n: i + 1 })}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Preview: one square per slot. */}
      <div className="overflow-x-auto rounded-lg border p-2" aria-hidden>
        {header === "horizontal" && (
          <div className="mb-1 h-4 rounded-sm bg-emerald-600/70" style={{ width: width * 20 }} />
        )}
        <div className="flex gap-1">
          {header === "vertical" && <div className="w-4 rounded-sm bg-emerald-600/70" />}
          <div className="flex flex-col gap-1">
            {shelves.map((shelf, i) => (
              <div key={i} className="flex gap-0.5" style={{ paddingLeft: shelf.offset * 20 }}>
                {Array.from({ length: shelf.slots }, (_, j) => (
                  <div
                    key={j}
                    className={`bg-muted size-[18px] rounded-sm border ${shelf.group && j > 0 && j % shelf.group === 0 ? "ml-1" : ""}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">
          {t("planograms.library.equipment.distTypes")}
        </legend>
        <p className="text-muted-foreground text-xs">
          {t("planograms.library.equipment.distTypesHint")}
        </p>
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {props.typeOptions.map((o) => (
            <label key={o.code} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="distTypes"
                value={o.code}
                defaultChecked={props.distTypes.includes(o.code)}
                className="size-4"
              />
              {o.label}
              {o.owner && !props.distTypes.includes(o.code) && (
                <span className="text-muted-foreground text-xs">({o.owner})</span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <Button type="submit" className="self-start">
        {t("planograms.library.equipment.save")}
      </Button>
    </form>
  );
}
