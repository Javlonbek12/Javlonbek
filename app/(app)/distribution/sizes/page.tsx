import { FileSpreadsheet } from "lucide-react";
import Link from "next/link";

import { Section } from "@/components/connect/parts";
import { fmt, Matrix } from "@/components/distribution/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { equipmentSize, gapsOf, missing, mm } from "@/modules/distribution/builder";
import { loadCatalog } from "@/modules/distribution/catalog";
import { canManageDistribution } from "@/modules/distribution/service";
import { DIST_TYPES } from "@/modules/distribution/types";

import { addElementAction, importCatalogAction, saveTypeSizesAction } from "../actions";

const XLSX = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// The builder's catalog: the equipment's own dimensions, and each element's print size, pieces
// per unit and price on every equipment type (they differ by equipment). What is missing can be
// downloaded as Excel, filled in and uploaded back.
export default async function DistributionSizesPage({
  searchParams,
}: PageProps<"/distribution/sizes">) {
  const user = await requireUser();
  const manage = canManageDistribution(user);
  const query = await searchParams;
  const catalog = await loadCatalog();
  const gaps = missing(catalog);
  const error = typeof query.error === "string" ? query.error : null;
  const done =
    typeof query.sizes === "string"
      ? t("dist.sizes.imported", { sizes: query.sizes, types: String(query.types ?? 0) })
      : query.saved !== undefined
        ? t("dist.posm.saved")
        : query.deleted !== undefined
          ? t("dist.sizes.deleted")
          : null;

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      {done && <p className="text-sm text-emerald-700 dark:text-emerald-400">{done}</p>}
      {error && (
        <p className="text-destructive text-sm">{t(`dist.errors.${error}` as TranslationKey)}</p>
      )}

      <Section title={t("dist.sizes.fillTitle")} hint={t("dist.sizes.fillHint")}>
        <p className="text-sm">
          {gaps.pairs.length + gaps.types.length > 0
            ? t("dist.sizes.missing", {
                pairs: gaps.pairs.length,
                types: gaps.types.length,
              })
            : t("dist.sizes.complete")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href="/api/distribution/sizes?missing=1">
              <FileSpreadsheet />
              {t("dist.sizes.downloadMissing")}
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href="/api/distribution/sizes">
              <FileSpreadsheet />
              {t("dist.sizes.downloadAll")}
            </a>
          </Button>
        </div>
        {manage && (
          <form action={importCatalogAction} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t("dist.sizes.upload")}
              <Input type="file" name="file" required accept={XLSX} />
            </label>
            <Button type="submit" variant="outline">
              {t("dist.import.submit")}
            </Button>
          </form>
        )}
      </Section>

      <Section title={t("dist.sizes.printTitle")} hint={t("dist.sizes.printHint")}>
        <Matrix
          dense
          text={catalog.elements.map((_, i) => i + 2)}
          head={[
            t("dist.builder.equipment"),
            t("dist.builder.equipmentSize"),
            ...catalog.elements.map((element) =>
              manage ? (
                <Link
                  key={element.id}
                  href={`/distribution/sizes/${element.id}`}
                  className="text-primary hover:underline"
                >
                  {element.name}
                </Link>
              ) : (
                element.name
              ),
            ),
          ]}
          rows={DIST_TYPES.map((type) => ({
            key: type.code,
            cells: [
              type.label,
              <span key="s" className="text-muted-foreground text-xs">
                {equipmentSize(catalog.types.find((x) => x.type === type.code)) ?? "—"}
              </span>,
              ...catalog.elements.map((element) => {
                const size = element.sizes.find((s) => s.type === type.code);
                const todo = gapsOf(size);
                if (size?.perUnit === 0)
                  return (
                    <span key={element.id} className="text-muted-foreground text-xs">
                      {t("dist.sizes.notUsed")}
                    </span>
                  );
                return (
                  <span key={element.id} className="flex flex-col text-xs">
                    <span className={size && mm(size.heightMm, size.widthMm) ? "text-sm" : ""}>
                      {mm(size?.heightMm ?? null, size?.widthMm ?? null) ?? (
                        <span className="text-red-600 dark:text-red-400">
                          {t("dist.builder.gap.size")}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      {size?.perUnit != null
                        ? t("dist.sizes.perUnit", { count: fmt(size.perUnit) })
                        : "? " + t("dist.builder.perUnit").toLowerCase()}
                      {" · "}
                      {size?.price != null ? fmt(size.price) : t("dist.sizes.noPrice")}
                    </span>
                    {todo.includes("check") && (
                      <span className="text-amber-700 dark:text-amber-400">
                        {t("dist.builder.gap.check")}
                      </span>
                    )}
                  </span>
                );
              }),
            ],
          }))}
        />
        {manage && (
          <form action={addElementAction} className="flex flex-wrap items-end gap-3 border-t pt-4">
            <label className="flex flex-col gap-1 text-sm">
              {t("dist.sizes.newElement")}
              <Input name="name" required maxLength={80} placeholder="Wobbler" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("dist.builder.material")}
              <Input name="material" maxLength={120} />
            </label>
            <Button type="submit" variant="outline">
              {t("dist.sizes.add")}
            </Button>
          </form>
        )}
      </Section>

      <Section title={t("dist.sizes.equipmentTitle")} hint={t("dist.sizes.equipmentHint")}>
        <form action={saveTypeSizesAction} className="flex flex-col gap-3">
          <Matrix
            dense
            text={[4]}
            head={[
              t("dist.builder.equipment"),
              t("dist.sizes.height"),
              t("dist.sizes.width"),
              t("dist.sizes.depth"),
              t("dist.orders.note"),
            ]}
            rows={DIST_TYPES.map((type) => {
              const size = catalog.types.find((x) => x.type === type.code);
              const field = (key: string, value: number | null | undefined) =>
                manage ? (
                  <Input
                    key={key}
                    name={`${key}:${type.code}`}
                    type="number"
                    min={0}
                    step="any"
                    defaultValue={value ?? ""}
                    className="ml-auto h-8 w-24"
                  />
                ) : (
                  (value ?? "—")
                );
              return {
                key: type.code,
                cells: [
                  <span key="l">
                    <input type="hidden" name="type" value={type.code} />
                    {type.label}
                  </span>,
                  field("h", size?.heightMm),
                  field("w", size?.widthMm),
                  field("d", size?.depthMm),
                  manage ? (
                    <Input
                      key="n"
                      name={`note:${type.code}`}
                      defaultValue={size?.note ?? ""}
                      maxLength={200}
                      className="h-8 min-w-48"
                    />
                  ) : (
                    (size?.note ?? "")
                  ),
                ],
              };
            })}
          />
          {manage && (
            <div>
              <Button type="submit" variant="outline">
                {t("dist.posm.save")}
              </Button>
            </div>
          )}
        </form>
      </Section>
    </div>
  );
}
