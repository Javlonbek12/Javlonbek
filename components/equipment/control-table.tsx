import { fmt, Matrix } from "@/components/distribution/parts";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { controlTotal, type ControlRow, type ControlTone } from "@/modules/distribution/control";
import { typeInfo } from "@/modules/distribution/types";

const TONE: Record<ControlTone, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  none: "text-muted-foreground",
};

// A group bought as one: its types joined.
export const typesLabel = (types: string[]) =>
  types.map((type) => typeInfo(type)?.label ?? type).join(" + ");

const signed = (n: number) => (n > 0.005 ? `+${fmt(n)}` : fmt(n));

function Unaccounted({ row }: { row: Pick<ControlRow, "unaccounted" | "tone"> }) {
  if (row.unaccounted === null)
    return <span className="text-muted-foreground text-xs">{t("equip.control.noPurchase")}</span>;
  return (
    <span
      className={cn("inline-block rounded-md px-2 py-0.5 font-semibold", TONE[row.tone])}
      title={t(`equip.control.tone.${row.tone}`)}
    >
      {signed(row.unaccounted)}
    </span>
  );
}

// Per type: bought = installed + in stock + unaccounted; the last column coloured. On a phone each
// type is a card with the unaccounted number first, as that is what the table is for.
export function ControlTable({ rows }: { rows: ControlRow[] }) {
  const total = controlTotal(rows);
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((r) => (
          <li key={r.types.join("+")} className="flex flex-col gap-1 rounded-xl border p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 font-medium break-words">{typesLabel(r.types)}</span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                <span className="text-muted-foreground text-[11px]">
                  {t("equip.control.unaccounted")}
                </span>
                <Unaccounted row={r} />
              </span>
            </div>
            <span className="text-muted-foreground text-xs tabular-nums">
              {t("equip.control.card", {
                purchased: r.purchased === null ? "—" : fmt(r.purchased),
                installed: fmt(r.installed),
                stock: fmt(r.stock),
              })}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-2 px-3 text-sm font-semibold">
          <span>{t("dist.total")}</span>
          <span className="tabular-nums">
            {total.unaccounted === null ? "—" : signed(total.unaccounted)}
          </span>
        </li>
      </ul>
      <div className="hidden md:block">
        <Matrix
          head={[
            t("equip.control.type"),
            t("equip.control.purchased"),
            t("equip.control.installed"),
            t("equip.control.stock"),
            t("equip.control.unaccounted"),
          ]}
          rows={rows.map((r) => ({
            key: r.types.join("+"),
            cells: [
              typesLabel(r.types),
              r.purchased === null ? "—" : fmt(r.purchased),
              fmt(r.installed),
              fmt(r.stock),
              <Unaccounted key="u" row={r} />,
            ],
          }))}
          foot={[
            t("dist.total"),
            total.purchased === null ? "—" : fmt(total.purchased),
            fmt(total.installed),
            fmt(total.stock),
            total.unaccounted === null ? "—" : signed(total.unaccounted),
          ]}
        />
      </div>
      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {(["ok", "warn", "bad"] as const).map((tone) => (
          <li key={tone} className="flex items-center gap-1.5">
            <span className={cn("inline-block size-3 rounded-sm", TONE[tone])} />
            {t(`equip.control.tone.${tone}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
