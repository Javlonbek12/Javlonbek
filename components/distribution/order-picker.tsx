"use client";

import { usePathname } from "next/navigation";

import { useT } from "@/components/locale-provider";
import { NativeSelect } from "@/components/ui/native-select";

// Which order the pages show: picking one reloads them for it.
export function OrderPicker({
  orders,
  current,
  action,
}: {
  orders: { id: string; label: string }[];
  current: string;
  action: (form: FormData) => Promise<void>;
}) {
  const t = useT();
  const pathname = usePathname();
  return (
    <form action={action} className="flex items-center gap-2 text-sm print:hidden">
      <input type="hidden" name="back" value={pathname} />
      <span className="text-muted-foreground">{t("dist.orders.current")}</span>
      <NativeSelect
        name="orderId"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label={t("dist.orders.current")}
      >
        {orders.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
      <button type="submit" className="sr-only">
        {t("dist.orders.open")}
      </button>
    </form>
  );
}
