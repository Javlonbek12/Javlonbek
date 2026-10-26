import { FileSpreadsheet } from "lucide-react";
import Link from "next/link";

import { Section } from "@/components/connect/parts";
import { fmt, Matrix } from "@/components/distribution/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { equipmentSize, mm, typeLabel } from "@/modules/distribution/builder";
import { builderOptions, runBuilder } from "@/modules/distribution/catalog";
import { canManageDistribution, getIncludeStock } from "@/modules/distribution/service";
import { DIST_TYPES } from "@/modules/distribution/types";

import { createOrderFromBuilderAction } from "../actions";

const GAP_KEYS = ["size", "perUnit", "price", "check"] as const;

// The order builder: pick the equipment types and the POSM elements, see how many pieces of what
// size to order and what it costs; save it as a new order or download it as Excel.
export default async function DistributionBuilderPage({
  searchParams,
}: PageProps<"/distribution/builder">) {
  const user = await requireUser();
  const manage = canManageDistribution(user);
  const query = await searchParams;
  const get = (key: string) => {
    const v = query[key];
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
  };
  const picked = get("t").length > 0 || get("e").length > 0;
  if (!picked && query.stock === undefined && (await getIncludeStock())) query.stock = "1";
  const options = builderOptions(get, Object.keys(query));
  const { catalog, units, lines } = await runBuilder(options);
  const error = typeof query.error === "string" ? query.error : null;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (key !== "error")
      for (const v of Array.isArray(value) ? value : [value ?? ""]) params.append(key, v);
  const total = (key: "quantity" | "sum") => lines.reduce((s, l) => s + (l[key] ?? 0), 0);
  const withGaps = lines.filter((l) => l.gaps.some((g) => g !== "check")).length;
  const unchecked = lines.filter((l) => l.gaps.includes("check")).length;
  const ready = lines.length > 0;

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      {error && (
        <p className="text-destructive text-sm">{t(`dist.errors.${error}` as TranslationKey)}</p>
      )}
      <form id="builder" method="get" className="flex flex-col gap-5">
        <Section title={t("dist.builder.step1")} hint={t("dist.builder.step1Hint")}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {DIST_TYPES.map((type) => {
              const size = equipmentSize(catalog.types.find((x) => x.type === type.code));
              return (
                <label
                  key={type.code}
                  className="hover:bg-accent/40 flex items-start gap-2 rounded-lg border p-2.5 text-sm"
                >
                  <input
                    type="checkbox"
                    name="t"
                    value={type.code}
                    defaultChecked={options.types.includes(type.code)}
                    className="mt-0.5 size-4"
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{type.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {t("dist.builder.units", { count: fmt(units[type.code] ?? 0) })} ·{" "}
                      {size ? `${size} ${t("dist.builder.mm")}` : t("dist.builder.noSize")}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="stock"
              value="1"
              defaultChecked={options.withStock}
              className="size-4"
            />
            {t("dist.builder.withStock")}
          </label>
        </Section>

        <Section title={t("dist.builder.step2")} hint={t("dist.builder.step2Hint")}>
          <div className="flex flex-wrap gap-2">
            {catalog.elements.map((element) => (
              <label
                key={element.id}
                className="hover:bg-accent/40 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="e"
                  value={element.id}
                  defaultChecked={options.elements.includes(element.id)}
                  className="size-4"
                />
                {element.name}
              </label>
            ))}
            <Link
              href="/distribution/sizes"
              className="text-primary self-center px-2 text-sm hover:underline"
            >
              {t("dist.builder.catalog")}
            </Link>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-sm">
              {t("dist.builder.reserve")}
              <Input
                type="number"
                name="reserve"
                min={0}
                max={100}
                step="any"
                defaultValue={Math.round(options.reservePct * 1000) / 10}
                className="w-28"
              />
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="hidden" name="merge" value="0" />
              <input
                type="checkbox"
                name="merge"
                value="1"
                defaultChecked={options.merge}
                className="size-4"
              />
              {t("dist.builder.merge")}
            </label>
            <Button type="submit">{t("dist.builder.count")}</Button>
          </div>
        </Section>
      </form>

      {picked && (
        <Section title={t("dist.builder.result")} hint={t("dist.builder.resultHint")}>
          {!ready ? (
            <p className="text-muted-foreground text-sm">{t("dist.builder.pickBoth")}</p>
          ) : (
            <>
              {(withGaps > 0 || unchecked > 0) && (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  {withGaps > 0 && t("dist.builder.gaps", { count: withGaps })}{" "}
                  {unchecked > 0 && t("dist.builder.unchecked", { count: unchecked })}{" "}
                  <Link href="/distribution/sizes" className="underline">
                    {t("dist.builder.fill")}
                  </Link>
                </p>
              )}
              <Matrix
                dense
                text={[1, 2, 3, 4]}
                head={[
                  t("dist.builder.posm"),
                  t("dist.builder.equipment"),
                  t("dist.builder.equipmentSize"),
                  t("dist.builder.printSize"),
                  t("dist.builder.material"),
                  t("dist.builder.unitsCol"),
                  t("dist.builder.perUnit"),
                  t("dist.builder.quantity"),
                  t("dist.builder.price"),
                  t("dist.builder.sum"),
                ]}
                rows={lines.map((l) => ({
                  key: l.key,
                  cells: [
                    <span key="n" className="flex flex-col">
                      <span>{l.element}</span>
                      {l.gaps.length > 0 && (
                        <span className="text-xs text-amber-700 dark:text-amber-400">
                          {GAP_KEYS.filter((g) => l.gaps.includes(g))
                            .map((g) => t(`dist.builder.gap.${g}`))
                            .join(", ")}
                        </span>
                      )}
                    </span>,
                    <span key="e" className="text-xs whitespace-normal">
                      {l.types.map(typeLabel).join(", ")}
                    </span>,
                    <span key="s" className="text-muted-foreground text-xs whitespace-normal">
                      {l.types
                        .map(
                          (type) =>
                            equipmentSize(catalog.types.find((x) => x.type === type)) ?? "—",
                        )
                        .join(", ")}
                    </span>,
                    mm(l.heightMm, l.widthMm) ?? <Missing key="p" />,
                    <span key="m" className="text-muted-foreground text-xs whitespace-normal">
                      {l.material ?? "—"}
                    </span>,
                    fmt(l.units),
                    <Input
                      key="u"
                      form="builder"
                      name={`pu.${l.elementId}.${l.types.join("+")}`}
                      type="number"
                      min={0}
                      step="any"
                      defaultValue={l.perUnit ?? ""}
                      aria-label={t("dist.builder.perUnit")}
                      className={cn(
                        "ml-auto h-8 w-20",
                        l.perUnit === null && "border-red-400 dark:border-red-500",
                      )}
                    />,
                    l.quantity === null ? (
                      <Missing key="q" />
                    ) : (
                      <strong key="q">{fmt(l.quantity)}</strong>
                    ),
                    l.price === null ? <Missing key="c" /> : fmt(l.price),
                    l.sum === null ? "—" : fmt(l.sum),
                  ],
                }))}
                foot={[
                  t("dist.total"),
                  "",
                  "",
                  "",
                  "",
                  "",
                  "",
                  fmt(total("quantity")),
                  "",
                  fmt(total("sum")),
                ]}
              />
              <p className="text-muted-foreground text-xs">{t("dist.builder.perUnitHint")}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" form="builder" size="sm">
                  {t("dist.builder.count")}
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/distribution/builder?${params}`}>
                    <FileSpreadsheet />
                    {t("dist.excel")}
                  </a>
                </Button>
              </div>
            </>
          )}
        </Section>
      )}

      {picked && ready && manage && (
        <Section title={t("dist.builder.save")} hint={t("dist.builder.saveHint")}>
          <form action={createOrderFromBuilderAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="query" value={params.toString()} />
            {options.types.map((type) => (
              <input key={type} type="hidden" name="t" value={type} />
            ))}
            {options.elements.map((id) => (
              <input key={id} type="hidden" name="e" value={id} />
            ))}
            <input type="hidden" name="reserve" value={options.reservePct * 100} />
            <input type="hidden" name="merge" value={options.merge ? "1" : "0"} />
            <input type="hidden" name="stock" value={options.withStock ? "1" : "0"} />
            {[...params.entries()]
              .filter(([key]) => key.startsWith("pu."))
              .map(([key, value]) => (
                <input key={key} type="hidden" name={key} value={value} />
              ))}
            <label className="flex flex-col gap-1 text-sm">
              {t("dist.orders.name")}
              <Input name="name" required maxLength={120} className="w-64" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("dist.orders.date")}
              <Input
                type="date"
                name="orderedOn"
                required
                defaultValue={await getUserToday(user.id)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("dist.orders.note")}
              <Input name="note" maxLength={500} className="w-64" />
            </label>
            <Button type="submit">{t("dist.orders.create")}</Button>
          </form>
        </Section>
      )}
    </div>
  );
}

function Missing() {
  return <span className="text-xs font-medium text-red-600 dark:text-red-400">?</span>;
}
