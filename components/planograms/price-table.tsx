"use client";

import { useMemo, useState, type ReactNode } from "react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PriceTableRow } from "@/modules/planograms/price-table";

const group = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// Every SKU with its price. Editable: each price is a field, changed ones are marked and counted;
// the form goes to `action` with the fields as price.<skuId>. `head` holds the form's own fields
// (the new list's name and date), `submit` the button's words.
export function PriceTable({
  rows,
  editable,
  action,
  hidden,
  head,
  submit,
}: {
  rows: PriceTableRow[];
  editable: boolean;
  action?: (formData: FormData) => Promise<void>;
  hidden?: Record<string, string>;
  head?: ReactNode;
  submit?: string;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.skuId, r.price === null ? "" : String(r.price)])),
  );
  const changed = useMemo(
    () =>
      rows.filter((r) => {
        const text = (values[r.skuId] ?? "").replace(/\s/g, "");
        return text !== (r.price === null ? "" : String(r.price));
      }).length,
    [rows, values],
  );
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) =>
        `${r.code} ${r.brand} ${r.name} ${r.format ?? ""}`.toLowerCase().includes(needle),
      )
    : rows;
  const showBefore = rows.some((r) => r.previous !== null);

  const table = (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm tabular-nums">
        <thead className="bg-muted/60 text-muted-foreground text-left text-xs">
          <tr>
            <th className="px-3 py-2 font-medium">{t("planograms.library.prices.code")}</th>
            <th className="px-3 py-2 font-medium">{t("planograms.library.prices.brand")}</th>
            <th className="px-3 py-2 font-medium">{t("planograms.library.prices.skuName")}</th>
            <th className="hidden px-3 py-2 font-medium sm:table-cell">
              {t("planograms.library.prices.format")}
            </th>
            {showBefore && (
              <th className="px-3 py-2 text-right font-medium">
                {t("planograms.library.prices.before")}
              </th>
            )}
            <th className="px-3 py-2 text-right font-medium">
              {t("planograms.library.prices.price")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const value = values[row.skuId] ?? "";
            const edited =
              value.replace(/\s/g, "") !== (row.price === null ? "" : String(row.price));
            const moved = row.previous !== null && row.price !== null && row.previous !== row.price;
            return (
              <tr
                key={row.skuId}
                hidden={!shown.includes(row)}
                className={cn("border-t", edited && "bg-amber-500/10")}
              >
                <td className="px-3 py-1.5 font-mono text-xs">{row.code}</td>
                <td className="px-3 py-1.5">{row.brand}</td>
                <td className="px-3 py-1.5">{row.name}</td>
                <td className="text-muted-foreground hidden px-3 py-1.5 sm:table-cell">
                  {row.format ?? "—"}
                </td>
                {showBefore && (
                  <td className="text-muted-foreground px-3 py-1.5 text-right">
                    {row.previous === null ? "—" : group(row.previous)}
                  </td>
                )}
                <td className="px-3 py-1 text-right">
                  {editable ? (
                    <Input
                      name={`price.${row.skuId}`}
                      inputMode="numeric"
                      value={value}
                      onChange={(e) => setValues({ ...values, [row.skuId]: e.target.value })}
                      placeholder={t("planograms.library.prices.noPrice")}
                      aria-label={`${t("planograms.library.prices.price")}: ${row.brand} ${row.name}`}
                      className={cn("ml-auto h-8 w-28 text-right", edited && "border-amber-500")}
                    />
                  ) : (
                    <span
                      className={cn(moved && "font-semibold text-amber-700 dark:text-amber-300")}
                    >
                      {row.price === null ? (
                        <span className="text-muted-foreground">
                          {t("planograms.library.prices.noPrice")}
                        </span>
                      ) : (
                        group(row.price)
                      )}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const search = (
    <Input
      type="search"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder={t("planograms.library.prices.filter")}
      aria-label={t("planograms.library.prices.filter")}
      className="max-w-sm"
    />
  );

  if (!editable || !action)
    return (
      <div className="flex flex-col gap-3">
        {search}
        {table}
      </div>
    );
  return (
    <form action={action} className="flex flex-col gap-3">
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {search}
      {table}
      <div className="bg-card/95 sticky bottom-0 flex flex-wrap items-end gap-3 border-t py-3 backdrop-blur">
        {head}
        <span className="text-muted-foreground text-sm">
          {t("planograms.library.prices.changed", { count: changed })}
        </span>
        <Button type="submit" size="sm" disabled={changed === 0}>
          {submit}
        </Button>
      </div>
    </form>
  );
}
