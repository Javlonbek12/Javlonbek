"use client";

import { usePathname } from "next/navigation";

import { useT } from "@/components/locale-provider";
import { NativeSelect } from "@/components/ui/native-select";
import type { OrderStage } from "@/modules/distribution/service";

// The pages that show one campaign's numbers (split, shipments, analysis). Elsewhere the picker
// would put a second «current» campaign on the screen, e.g. above another campaign's page.
const SHOWN_ON = ["/distribution", "/distribution/plan", "/distribution/stock"];

// Which campaign those pages show: picking one reloads them for it at once. Running campaigns come
// first, then the ones being prepared and the closed ones; `note` explains a draft opened because
// nothing was ordered yet.
export function OrderPicker({
  orders,
  current,
  note,
  action,
}: {
  orders: { id: string; label: string; stage: OrderStage }[];
  current: string;
  note?: string;
  action: (form: FormData) => Promise<void>;
}) {
  const t = useT();
  const pathname = usePathname();
  if (!SHOWN_ON.includes(pathname)) return null;
  const groups = (["running", "draft", "closed"] as const)
    .map((stage) => ({ stage, items: orders.filter((o) => o.stage === stage) }))
    .filter((g) => g.items.length > 0);
  const label = {
    running: t("dist.orders.groupRunning"),
    draft: t("dist.orders.groupDrafts"),
    closed: t("dist.orders.groupClosed"),
  };
  return (
    <div className="flex flex-col gap-2 print:hidden">
      <form action={action} className="flex min-w-0 items-center gap-2 text-sm">
        <input type="hidden" name="back" value={pathname} />
        <span className="text-muted-foreground shrink-0">{t("dist.orders.current")}</span>
        <NativeSelect
          name="orderId"
          defaultValue={current}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          aria-label={t("dist.orders.current")}
          className="w-full min-w-0 sm:w-auto sm:max-w-md"
        >
          {groups.map((g) => (
            <optgroup key={g.stage} label={label[g.stage]}>
              {g.items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
        <button type="submit" className="sr-only">
          {t("dist.orders.open")}
        </button>
      </form>
      {note && <p className="text-sm text-amber-700 dark:text-amber-300">{note}</p>}
    </div>
  );
}
