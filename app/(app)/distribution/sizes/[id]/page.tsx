import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Section } from "@/components/connect/parts";
import { Matrix } from "@/components/distribution/parts";
import {
  EquipmentSketch,
  rowsOf,
  SKETCH_COLORS,
  sketchKind,
} from "@/components/distribution/sketch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { equipmentSize, gapsOf } from "@/modules/distribution/builder";
import { loadCatalog } from "@/modules/distribution/catalog";
import { canManageDistribution } from "@/modules/distribution/service";
import { DIST_TYPES } from "@/modules/distribution/types";

import { deleteElementAction, saveElementSizesAction } from "../../actions";

// One element's print size, pieces per unit and price on each equipment type (owner, managers).
export default async function DistributionElementPage({
  params,
  searchParams,
}: PageProps<"/distribution/sizes/[id]">) {
  const user = await requireUser();
  if (!canManageDistribution(user)) redirect("/distribution/sizes");
  const { id } = await params;
  const query = await searchParams;
  const catalog = await loadCatalog();
  const element = catalog.elements.find((e) => e.id === id);
  if (!element) notFound();
  const error = typeof query.error === "string" ? query.error : null;

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <Link href="/distribution/sizes" className="text-muted-foreground text-sm hover:underline">
        {t("dist.sizes.back")}
      </Link>
      {query.saved !== undefined && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("dist.posm.saved")}</p>
      )}
      {error && (
        <p className="text-destructive text-sm">{t(`dist.errors.${error}` as TranslationKey)}</p>
      )}
      <Section title={t("dist.sizes.visualTitle")} hint={t("dist.sizes.visualHint")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {DIST_TYPES.map((type) => {
            const box = catalog.types.find((x) => x.type === type.code);
            const size = element.sizes.find((s) => s.type === type.code);
            if (!box?.heightMm || !box.widthMm || size?.perUnit === 0) return null;
            const wide = size?.widthMm != null && size.widthMm > box.widthMm;
            return (
              <div key={type.code} className="flex flex-col gap-1 rounded-xl border p-2">
                <span className="text-xs font-semibold">{type.label}</span>
                <EquipmentSketch
                  heightMm={box.heightMm}
                  widthMm={box.widthMm}
                  rows={rowsOf(type.label)}
                  height={140}
                  items={
                    size
                      ? [
                          {
                            key: element.id,
                            label: element.name,
                            kind: sketchKind(element.name),
                            heightMm: size.heightMm,
                            widthMm: size.widthMm,
                            count: Math.max(1, Math.round(size.perUnit ?? 1)),
                            color: SKETCH_COLORS[0]!,
                          },
                        ]
                      : []
                  }
                />
                <span
                  className={cn(
                    "text-center text-xs",
                    wide ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground",
                  )}
                >
                  {size && size.heightMm != null && size.widthMm != null
                    ? `${size.heightMm}×${size.widthMm} / ${box.widthMm} ${t("dist.builder.mm")}`
                    : t("dist.builder.gap.size")}
                  {wide && ` · ${t("dist.campaign.tooWide")}`}
                </span>
              </div>
            );
          })}
        </div>
      </Section>
      <Section title={element.name} hint={t("dist.sizes.editHint")}>
        <form action={saveElementSizesAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={element.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              {t("dist.sizes.elementName")}
              <Input name="name" required maxLength={80} defaultValue={element.name} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("dist.sizes.defaultMaterial")}
              <Input name="material" maxLength={120} defaultValue={element.material ?? ""} />
            </label>
          </div>
          <Matrix
            dense
            text={[6, 7]}
            head={[
              t("dist.builder.equipment"),
              t("dist.sizes.printHeight"),
              t("dist.sizes.printWidth"),
              t("dist.builder.perUnit"),
              t("dist.builder.price"),
              t("dist.sizes.state"),
              t("dist.builder.material"),
              t("dist.orders.note"),
            ]}
            rows={DIST_TYPES.map((type) => {
              const size = element.sizes.find((s) => s.type === type.code);
              const todo = gapsOf(size);
              const field = (key: string, value: number | null | undefined) => (
                <Input
                  key={key}
                  name={`${key}:${type.code}`}
                  type="number"
                  min={0}
                  step="any"
                  defaultValue={value ?? ""}
                  className="ml-auto h-8 w-24"
                />
              );
              return {
                key: type.code,
                cells: [
                  <span key="l" className="flex flex-col">
                    <input type="hidden" name="type" value={type.code} />
                    <span>{type.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {equipmentSize(catalog.types.find((x) => x.type === type.code)) ?? "—"}
                    </span>
                  </span>,
                  field("h", size?.heightMm),
                  field("w", size?.widthMm),
                  field("per", size?.perUnit),
                  field("price", size?.price),
                  todo.length === 0 ? (
                    <span key="s" className="text-xs text-emerald-700 dark:text-emerald-400">
                      {size?.perUnit === 0 ? t("dist.sizes.notUsed") : t("dist.sizes.ok")}
                    </span>
                  ) : (
                    <span key="s" className="text-xs text-amber-700 dark:text-amber-400">
                      {todo.map((g) => t(`dist.builder.gap.${g}`)).join(", ")}
                    </span>
                  ),
                  <Input
                    key="m"
                    name={`material:${type.code}`}
                    defaultValue={size?.material ?? ""}
                    maxLength={120}
                    className="h-8 min-w-36"
                  />,
                  <Input
                    key="n"
                    name={`note:${type.code}`}
                    defaultValue={size?.note ?? ""}
                    maxLength={200}
                    className="h-8 min-w-36"
                  />,
                ],
              };
            })}
          />
          <p className="text-muted-foreground text-xs">{t("dist.sizes.notUsedHint")}</p>
          <div>
            <Button type="submit">{t("dist.posm.save")}</Button>
          </div>
        </form>
        <form action={deleteElementAction} className="border-t pt-4">
          <input type="hidden" name="id" value={element.id} />
          <Button type="submit" variant="outline" size="sm">
            {t("dist.sizes.delete")}
          </Button>
        </form>
      </Section>
    </div>
  );
}
