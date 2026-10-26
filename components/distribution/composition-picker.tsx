"use client";

import { LayoutGrid, List } from "lucide-react";
import { useState } from "react";

import { useT } from "@/components/locale-provider";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { EquipmentSketch, type SketchKind } from "./sketch";

export type PickerElement = {
  id: string;
  name: string;
  kind: SketchKind;
  color: string;
  // By type: print size, pieces per unit (0 = not used there), price.
  sizes: Record<
    string,
    {
      heightMm: number | null;
      widthMm: number | null;
      perUnit: number | null;
      price: number | null;
    }
  >;
};

export type PickerType = {
  code: string;
  label: string;
  heightMm: number | null;
  widthMm: number | null;
  depthMm: number | null;
  units: number;
  rows: number;
};

const fmt = (n: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n);
const mm = (h: number | null, w: number | null) => (h === null || w === null ? "?" : `${h}×${w}`);

// What the campaign orders, picked on the drawings of the displays (or as a list): every element
// on its own equipment, pieces per unit for this campaign, and the reserve. The form gets the
// choice as hidden fields (el, t:<element>, pu:<element>:<type>).
export function CompositionPicker({
  elements,
  types,
  initial,
  disabled,
}: {
  elements: PickerElement[];
  types: PickerType[];
  initial: {
    selected: Record<string, string[]>;
    perUnit: Record<string, Record<string, number>>;
    reservePct: number;
    withStock: boolean;
  };
  disabled: boolean;
}) {
  const t = useT();
  const [view, setView] = useState<"visual" | "list">("visual");
  const [selected, setSelected] = useState(initial.selected);
  const [perUnit, setPerUnit] = useState(initial.perUnit);
  const [reserve, setReserve] = useState(String(Math.round(initial.reservePct * 1000) / 10));

  const usedOn = (el: PickerElement, type: string) => el.sizes[type]?.perUnit !== 0;
  const isOn = (el: string, type: string) => selected[el]?.includes(type) ?? false;
  const toggle = (el: string, type: string) =>
    setSelected((s) => {
      const list = s[el] ?? [];
      return { ...s, [el]: list.includes(type) ? list.filter((x) => x !== type) : [...list, type] };
    });
  const setAll = (el: PickerElement, on: boolean) =>
    setSelected((s) => ({
      ...s,
      [el.id]: on ? types.filter((x) => x.units > 0 && usedOn(el, x.code)).map((x) => x.code) : [],
    }));
  const pieces = (el: PickerElement, type: string) => {
    const own = perUnit[el.id]?.[type];
    return own ?? el.sizes[type]?.perUnit ?? null;
  };
  const reservePct = Math.max(0, Number(reserve.replace(",", ".")) || 0) / 100;
  const quantity = (el: PickerElement, type: PickerType) => {
    const p = pieces(el, type.code);
    return p === null ? null : Math.ceil(type.units * p * (1 + reservePct) - 1e-9);
  };
  const setPieces = (el: string, type: string, value: string) =>
    setPerUnit((s) => {
      const next = { ...(s[el] ?? {}) };
      if (value === "") delete next[type];
      else next[type] = Number(value.replace(",", "."));
      return { ...s, [el]: next };
    });
  const totals = elements.map((el) => {
    const qty = (selected[el.id] ?? []).map((code) => {
      const type = types.find((x) => x.code === code);
      return type ? quantity(el, type) : null;
    });
    return {
      el,
      qty: qty.reduce<number>((s, q) => s + (q ?? 0), 0),
      unknown: qty.some((q) => q === null),
    };
  });

  const piecesInput = (el: PickerElement, type: string, className?: string) => (
    <Input
      type="number"
      min={0}
      step="any"
      value={perUnit[el.id]?.[type] ?? ""}
      placeholder={el.sizes[type]?.perUnit != null ? String(el.sizes[type]!.perUnit) : "?"}
      onChange={(e) => setPieces(el.id, type, e.target.value)}
      title={t("dist.builder.perUnit")}
      aria-label={`${el.name} · ${type} · ${t("dist.builder.perUnit")}`}
      disabled={disabled}
      className={cn("h-7 w-14 px-1.5 text-xs", className)}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {/* The choice for the form. */}
      {elements.map((el) =>
        (selected[el.id] ?? []).length === 0 ? null : (
          <span key={el.id} hidden>
            <input type="hidden" name="el" value={el.id} />
            {selected[el.id]!.map((type) => (
              <input key={type} type="hidden" name={`t:${el.id}`} value={type} />
            ))}
            {Object.entries(perUnit[el.id] ?? {}).map(([type, n]) => (
              <input key={type} type="hidden" name={`pu:${el.id}:${type}`} value={n} />
            ))}
          </span>
        ),
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="bg-muted inline-flex rounded-lg p-0.5 text-sm">
          {(
            [
              ["visual", LayoutGrid, t("dist.campaign.visual")],
              ["list", List, t("dist.campaign.asList")],
            ] as const
          ).map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5",
                view === key ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {totals.map(({ el, qty, unknown }) => (
            <span
              key={el.id}
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-1"
              style={{ borderColor: el.color }}
            >
              <span className="size-2.5 rounded-full" style={{ background: el.color }} />
              {el.name}: <strong>{fmt(qty)}</strong>
              {unknown && <span className="text-amber-700 dark:text-amber-400">+?</span>}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {elements.map((el) => (
          <span key={el.id} className="flex items-center gap-1 text-xs">
            <span className="size-2.5 rounded-full" style={{ background: el.color }} />
            {el.name}:
            <button
              type="button"
              disabled={disabled}
              onClick={() => setAll(el, true)}
              className="text-primary hover:underline disabled:opacity-50"
            >
              {t("dist.campaign.allEquipment")}
            </button>
            /
            <button
              type="button"
              disabled={disabled}
              onClick={() => setAll(el, false)}
              className="text-primary hover:underline disabled:opacity-50"
            >
              {t("dist.campaign.none")}
            </button>
          </span>
        ))}
      </div>

      {view === "visual" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {types.map((type) => {
            const items = elements
              .filter((el) => isOn(el.id, type.code))
              .map((el) => {
                const s = el.sizes[type.code];
                return {
                  key: el.id,
                  label: `${el.name} ${mm(s?.heightMm ?? null, s?.widthMm ?? null)}`,
                  kind: el.kind,
                  heightMm: s?.heightMm ?? null,
                  widthMm: s?.widthMm ?? null,
                  count: Math.max(1, Math.round(pieces(el, type.code) ?? 1)),
                  color: el.color,
                };
              });
            return (
              <div
                key={type.code}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border p-3",
                  items.length > 0 && "border-primary/40 bg-primary/[0.03]",
                  type.units === 0 && "opacity-60",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{type.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {fmt(type.units)} {t("dist.builder.unitsShort")}
                  </span>
                </div>
                <span className="text-muted-foreground -mt-1.5 text-xs">
                  {type.heightMm && type.widthMm
                    ? `${type.heightMm}×${type.widthMm}${type.depthMm ? `×${type.depthMm}` : ""} ${t("dist.builder.mm")}`
                    : t("dist.builder.noSize")}
                </span>
                <EquipmentSketch
                  heightMm={type.heightMm}
                  widthMm={type.widthMm}
                  rows={type.rows}
                  items={items}
                  height={170}
                />
                <div className="flex flex-col gap-1">
                  {elements
                    .filter((el) => usedOn(el, type.code))
                    .map((el) => {
                      const on = isOn(el.id, type.code);
                      const s = el.sizes[type.code];
                      const qty = quantity(el, type);
                      const wide =
                        s?.widthMm != null && type.widthMm != null && s.widthMm > type.widthMm;
                      return (
                        <div key={el.id} className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => toggle(el.id, type.code)}
                            aria-pressed={on}
                            className={cn(
                              "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-xs transition-colors",
                              on ? "text-white" : "hover:bg-accent/50",
                            )}
                            style={on ? { background: el.color, borderColor: el.color } : undefined}
                          >
                            <span
                              className="size-2.5 shrink-0 rounded-full border border-white/70"
                              style={{ background: el.color }}
                            />
                            <span className="truncate font-medium">{el.name}</span>
                            <span
                              className={cn(
                                "ml-auto shrink-0",
                                on ? "text-white/85" : "text-muted-foreground",
                              )}
                            >
                              {mm(s?.heightMm ?? null, s?.widthMm ?? null)}
                            </span>
                          </button>
                          {on && (
                            <>
                              {piecesInput(el, type.code)}
                              <span
                                className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums"
                                title={t("dist.builder.quantity")}
                              >
                                {qty === null ? "?" : fmt(qty)}
                              </span>
                            </>
                          )}
                          {wide && (
                            <span
                              className="text-xs text-red-600 dark:text-red-400"
                              title={t("dist.campaign.tooWide")}
                            >
                              !
                            </span>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {elements.map((el) => (
            <div key={el.id} className="rounded-xl border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="size-2.5 rounded-full" style={{ background: el.color }} />
                {el.name}
              </div>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                {types
                  .filter((type) => usedOn(el, type.code))
                  .map((type) => {
                    const s = el.sizes[type.code];
                    return (
                      <label
                        key={type.code}
                        className="hover:bg-accent/40 flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={isOn(el.id, type.code)}
                          onChange={() => toggle(el.id, type.code)}
                          disabled={disabled}
                          className="size-4 shrink-0"
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="font-medium">{type.label}</span>
                          <span className="text-muted-foreground">
                            {fmt(type.units)} {t("dist.builder.unitsShort")} ·{" "}
                            {mm(s?.heightMm ?? null, s?.widthMm ?? null)}
                          </span>
                        </span>
                        {piecesInput(el, type.code)}
                      </label>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div id="reserve" className="flex scroll-mt-24 flex-wrap items-end gap-4 border-t pt-3">
        <label className="flex flex-col gap-1 text-sm">
          {t("dist.campaign.reserveStep")}
          <Input
            type="number"
            name="reserve"
            min={0}
            max={100}
            step="any"
            value={reserve}
            onChange={(e) => setReserve(e.target.value)}
            disabled={disabled}
            className="w-28"
          />
        </label>
        <div className="flex gap-1.5 pb-1">
          {[10, 15, 20].map((n) => (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => setReserve(String(n))}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                Number(reserve) === n
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-accent/50",
              )}
            >
              +{n}%
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            name="stock"
            value="1"
            defaultChecked={initial.withStock}
            disabled={disabled}
            className="size-4"
          />
          {t("dist.builder.withStock")}
        </label>
      </div>
    </div>
  );
}
