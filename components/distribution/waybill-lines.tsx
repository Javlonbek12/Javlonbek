"use client";

import { useState } from "react";

import { useLocale, useT } from "@/components/locale-provider";
import { Input } from "@/components/ui/input";
import { intlLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type WaybillLine = {
  id: string;
  name: string;
  category: string;
  planned: number;
  shipped: number;
  viaTsm: number;
  toSend: number;
};

// The lines of a waybill being prepared: the quantity to send starts at what is left and can be
// lowered for a partial shipment. On paper only the lines that go and their quantities are printed,
// with a column for the receiver's mark.
export function WaybillLines({ lines, viaTsm }: { lines: WaybillLine[]; viaTsm: boolean }) {
  const t = useT();
  const locale = useLocale();
  const fmt = (n: number) => new Intl.NumberFormat(intlLocale(locale)).format(n);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, String(l.toSend)])),
  );
  const quantity = (l: WaybillLine) =>
    Math.max(0, Math.min(l.toSend, Math.floor(Number(values[l.id]) || 0)));
  const total = (pick: (l: WaybillLine) => number) => lines.reduce((s, l) => s + pick(l), 0);
  const cell = "px-2 py-2";
  const num = cn(cell, "text-right tabular-nums");
  // Lines are numbered as they go on paper: those with nothing to send get no number.
  const numbers = lines.reduce<number[]>(
    (acc, l) => [...acc, (acc.at(-1) ?? 0) + (quantity(l) > 0 ? 1 : 0)],
    [],
  );
  return (
    <div className="-mx-1 overflow-x-auto px-1 print:mx-0 print:overflow-visible print:px-0">
      <table className="w-full text-sm print:text-[11pt]">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs print:text-black">
            <th className={cn(cell, "font-medium")}>#</th>
            <th className={cn(cell, "font-medium")}>{t("dist.waybill.posm")}</th>
            <th className={cn(cell, "font-medium")}>{t("dist.waybill.category")}</th>
            <th className={cn(num, "font-medium print:hidden")}>{t("dist.waybill.planned")}</th>
            <th className={cn(num, "font-medium print:hidden")}>{t("dist.waybill.shipped")}</th>
            {viaTsm && (
              <th className={cn(num, "font-medium print:hidden")}>{t("dist.waybill.viaTsm")}</th>
            )}
            <th className={cn(num, "font-medium print:hidden")}>{t("dist.waybill.left")}</th>
            <th className={cn(num, "font-medium")}>{t("dist.waybill.quantity")}</th>
            <th className={cn(cell, "hidden w-48 font-medium print:table-cell")}>
              {t("dist.waybill.received")}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const q = quantity(l);
            return (
              <tr key={l.id} className={cn("border-b last:border-b-0", q === 0 && "print:hidden")}>
                <td className={cn(cell, "text-muted-foreground")}>{q > 0 ? numbers[i] : ""}</td>
                <td className={cn(cell, "min-w-40")}>{l.name}</td>
                <td className={cn(cell, "text-muted-foreground")}>{l.category}</td>
                <td className={cn(num, "print:hidden")}>{fmt(l.planned)}</td>
                <td className={cn(num, "print:hidden")}>{fmt(l.shipped)}</td>
                {viaTsm && <td className={cn(num, "print:hidden")}>{fmt(l.viaTsm)}</td>}
                <td className={cn(num, "print:hidden")}>{fmt(l.toSend)}</td>
                <td className={num}>
                  {l.toSend > 0 ? (
                    <>
                      <input type="hidden" name="posmId" value={l.id} />
                      <Input
                        type="number"
                        name="quantity"
                        min={0}
                        max={l.toSend}
                        step={1}
                        value={values[l.id] ?? ""}
                        onChange={(e) => setValues({ ...values, [l.id]: e.target.value })}
                        aria-label={`${t("dist.waybill.quantity")}: ${l.name}`}
                        className="ml-auto h-8 w-24 text-right font-semibold print:hidden"
                      />
                      <span className="hidden font-semibold print:inline">{fmt(q)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
                <td className={cn(cell, "hidden border-l print:table-cell")} />
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <td className={cell} colSpan={3}>
              {t("dist.total")}
            </td>
            <td className={cn(num, "print:hidden")}>{fmt(total((l) => l.planned))}</td>
            <td className={cn(num, "print:hidden")}>{fmt(total((l) => l.shipped))}</td>
            {viaTsm && <td className={cn(num, "print:hidden")}>{fmt(total((l) => l.viaTsm))}</td>}
            <td className={cn(num, "print:hidden")}>{fmt(total((l) => l.toSend))}</td>
            <td className={num}>{fmt(total(quantity))}</td>
            <td className="hidden print:table-cell" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
