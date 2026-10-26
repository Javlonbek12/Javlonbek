import Link from "next/link";
import { notFound } from "next/navigation";

import { Section } from "@/components/connect/parts";
import { fmt, N } from "@/components/distribution/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManageDistribution, loadDistribution } from "@/modules/distribution/service";
import { DIST_TYPES, tagPrice } from "@/modules/distribution/types";

import { updatePosmAction } from "../../actions";

// One item: its plan by region and, for the owner and managers, its settings (stock, order,
// reserve, base, norm, the equipment types it goes to).
export default async function DistributionPosmPage({
  params,
  searchParams,
}: PageProps<"/distribution/posm/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const d = await loadDistribution();
  const plan = d.plans.find((p) => p.item.id === id);
  if (!plan) notFound();
  const item = plan.item;
  const manage = canManageDistribution(user);
  const error = typeof query.error === "string" ? query.error : null;
  const isTag = tagPrice(item.name) !== null;

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <Link href="/distribution/plan" className="text-muted-foreground text-sm hover:underline">
        {t("dist.posm.back")}
      </Link>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{item.name}</h2>
        <p className="text-muted-foreground text-sm">
          {item.category} · {t(`dist.base.${item.base}`)}
        </p>
      </div>
      {query.saved && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("dist.posm.saved")}</p>
      )}
      {error && (
        <p className="text-destructive text-sm">{t(`dist.errors.${error}` as TranslationKey)}</p>
      )}

      <Section title={t("dist.plan.title")}>
        <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[...plan.byRegion].map(([region, n]) => (
            <li key={region} className="flex justify-between gap-3 border-b py-1">
              <span>{region}</span>
              <span className="tabular-nums">
                <N value={n} />
              </span>
            </li>
          ))}
          <li className="flex justify-between gap-3 border-b py-1 font-semibold">
            <span>{t("dist.plan.central")}</span>
            <span className="tabular-nums">{fmt(plan.central)}</span>
          </li>
        </ul>
      </Section>

      {manage && (
        <Section title={t("dist.posm.title")}>
          <form action={updatePosmAction} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={item.id} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.posm.inStock")}
                <Input
                  type="number"
                  name="inStock"
                  min={0}
                  step={1}
                  defaultValue={item.inStock}
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.posm.ordered")}
                <Input
                  type="number"
                  name="ordered"
                  min={0}
                  step={1}
                  defaultValue={item.ordered}
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.posm.reserve")}
                <Input
                  type="number"
                  name="reserve"
                  min={0}
                  max={100}
                  step="any"
                  defaultValue={Math.round(item.reservePct * 1000) / 10}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.posm.base")}
                <NativeSelect name="base" defaultValue={item.base}>
                  {(["UNITS", "SLOTS", ...(isTag ? (["PLANOGRAM"] as const) : [])] as const).map(
                    (b) => (
                      <option key={b} value={b}>
                        {t(`dist.base.${b}`)}
                      </option>
                    ),
                  )}
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.posm.norm")}
                <Input
                  type="number"
                  name="norm"
                  min={0}
                  step="any"
                  defaultValue={item.norm ?? ""}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.posm.normReserve")}
                <Input
                  type="number"
                  name="normReserve"
                  min={0}
                  step="any"
                  defaultValue={Math.round(item.normReserve * 1000) / 10}
                />
              </label>
            </div>
            {isTag && <p className="text-muted-foreground text-xs">{t("dist.posm.baseHint")}</p>}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm">{t("dist.posm.types")}</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {DIST_TYPES.map((type) => (
                  <label key={type.code} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="types"
                      value={type.code}
                      defaultChecked={item.types.includes(type.code)}
                      className="size-4"
                    />
                    {type.label}
                    <span className="text-muted-foreground text-xs">
                      ({fmt(d.total[type.code] ?? 0)})
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <Button type="submit">{t("dist.posm.save")}</Button>
            </div>
          </form>
        </Section>
      )}
    </div>
  );
}
