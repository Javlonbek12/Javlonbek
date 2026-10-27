import { Check, Download, FileText, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Section } from "@/components/connect/parts";
import { CompositionPicker } from "@/components/distribution/composition-picker";
import { fmt, Matrix, N, pct } from "@/components/distribution/parts";
import { rowsOf, SKETCH_COLORS, sketchKind } from "@/components/distribution/sketch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/db";
import { dateFormat, t, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { mm, typeLabel } from "@/modules/distribution/builder";
import { loadCampaign, MAX_CAMPAIGN_FILE_MB } from "@/modules/distribution/campaign";
import { equipmentUnits, loadCatalog } from "@/modules/distribution/catalog";
import { canManageDistribution } from "@/modules/distribution/service";
import { DIST_TYPES } from "@/modules/distribution/types";

import {
  addCampaignFileAction,
  importReplacementAction,
  openDistributionAction,
  removeCampaignFileAction,
  saveCompositionAction,
  savePricesAction,
  setKvFinalAction,
  setOrderedAction,
  updateConceptAction,
} from "../../actions";

const STEPS = [
  ["concept", "concept"],
  ["kv", "kv"],
  ["composition", "composition"],
  ["reserve", "reserve"],
  ["list", "list"],
  ["prices", "prices"],
  ["ordered", "order"],
  ["distribution", "distribution"],
  ["replacement", "replacement"],
] as const;

const XLSX = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// One campaign, step by step: concept, key visual, what to order on which equipment, the list
// with the printer's prices, the order (EAS), the split by region and TSM, replacement in shops.
export default async function DistributionCampaignPage({
  params,
  searchParams,
}: PageProps<"/distribution/campaigns/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const c = await loadCampaign(id);
  if (!c) notFound();
  const { order } = c;
  const manage = canManageDistribution(user) && !order.closed;
  const locked = order.orderedOn !== null;
  const [catalog, units, projects, today] = await Promise.all([
    loadCatalog(),
    equipmentUnits(order.withStock),
    manage
      ? db.project.findMany({
          where: { archived: false },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    getUserToday(user.id),
  ]);
  const day = dateFormat({ dateStyle: "medium", timeZone: "UTC" });
  const error = typeof query.error === "string" ? query.error : null;
  const files = (kind: string) => c.order.files.filter((f) => f.kind === kind);
  const q = (key: string) => (typeof query[key] === "string" ? String(query[key]) : null);

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-2">
        <Link
          href="/distribution/campaigns"
          className="text-muted-foreground text-sm hover:underline"
        >
          {t("dist.campaign.back")}
        </Link>
        <h2 className="text-xl font-semibold">{order.name}</h2>
        {order.closed && (
          <p className="text-muted-foreground text-sm">{t("dist.campaign.closedHint")}</p>
        )}
        <ol className="flex flex-wrap gap-1.5">
          {STEPS.map(([key, anchor], i) => (
            <li key={key}>
              <a
                href={`#${anchor}`}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
                  c.steps[key === "reserve" ? "composition" : key]
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                {c.steps[key === "reserve" ? "composition" : key] ? (
                  <Check className="size-3.5" />
                ) : (
                  <span>{i + 1}.</span>
                )}
                {t(`dist.campaign.steps.${key}`)}
              </a>
            </li>
          ))}
        </ol>
      </div>
      {error && (
        <p className="text-destructive text-sm">{t(`dist.errors.${error}` as TranslationKey)}</p>
      )}

      {/* 1. Concept */}
      <Anchor id="concept">
        <Section title={t("dist.campaign.conceptTitle")} hint={t("dist.campaign.conceptHint")}>
          {q("saved") === "concept" && <Saved />}
          {manage ? (
            <form action={updateConceptAction} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={order.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  {t("dist.orders.name")}
                  <Input name="name" required maxLength={120} defaultValue={order.name} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("dist.campaign.project")}
                  <NativeSelect name="projectId" defaultValue={order.projectId ?? ""}>
                    <option value="">—</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.campaign.description")}
                <Textarea
                  name="description"
                  rows={3}
                  maxLength={2000}
                  defaultValue={order.description ?? ""}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="approved"
                  value="1"
                  defaultChecked={order.conceptApprovedAt !== null}
                  className="size-4"
                />
                {t("dist.campaign.conceptApproved")}
              </label>
              <div>
                <Button type="submit" variant="outline">
                  {t("dist.posm.save")}
                </Button>
              </div>
            </form>
          ) : (
            order.description && <p className="text-sm whitespace-pre-line">{order.description}</p>
          )}
          {order.project && (
            <Link
              href={`/projects/${order.project.id}`}
              className="text-primary text-sm hover:underline"
            >
              {t("dist.campaign.openProject", { name: order.project.name })}
            </Link>
          )}
          <Files
            files={files("CONCEPT")}
            kind="CONCEPT"
            orderId={order.id}
            manage={manage}
            anchor="#concept"
          />
        </Section>
      </Anchor>

      {/* 2. Key visual */}
      <Anchor id="kv">
        <Section title={t("dist.campaign.kvTitle")} hint={t("dist.campaign.kvHint")}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {files("KEY_VISUAL").map((f) => (
              <div
                key={f.id}
                className={cn(
                  "flex flex-col overflow-hidden rounded-xl border",
                  f.final && "border-emerald-400 ring-2 ring-emerald-400/40",
                )}
              >
                {f.mime.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/distribution/files/${f.id}`}
                    alt={f.name}
                    className="bg-muted aspect-[4/3] w-full object-contain"
                  />
                ) : (
                  <div className="bg-muted text-muted-foreground flex aspect-[4/3] items-center justify-center">
                    <FileText className="size-8" />
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 p-2 text-xs">
                  <a
                    href={`/api/distribution/files/${f.id}?download=1`}
                    className="truncate hover:underline"
                  >
                    {f.name}
                  </a>
                  {manage && (
                    <span className="flex shrink-0 gap-1">
                      <form action={setKvFinalAction}>
                        <input type="hidden" name="id" value={order.id} />
                        <input type="hidden" name="fileId" value={f.id} />
                        <input type="hidden" name="final" value={f.final ? "0" : "1"} />
                        <Button
                          type="submit"
                          size="sm"
                          variant={f.final ? "default" : "outline"}
                          className="h-7 px-2 text-xs"
                        >
                          <Star className="size-3.5" />
                          {f.final ? t("dist.campaign.final") : t("dist.campaign.makeFinal")}
                        </Button>
                      </form>
                      <RemoveFile orderId={order.id} fileId={f.id} anchor="#kv" />
                    </span>
                  )}
                  {!manage && f.final && (
                    <span className="text-emerald-700 dark:text-emerald-400">
                      {t("dist.campaign.final")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {manage && <Upload orderId={order.id} kind="KEY_VISUAL" accept="image/*,.pdf" />}
        </Section>
      </Anchor>

      {/* 3–4. What to order and the reserve */}
      <Anchor id="composition">
        <Section
          title={t("dist.campaign.compositionTitle")}
          hint={t("dist.campaign.compositionHint")}
        >
          {locked && <p className="text-sm">{t("dist.campaign.lockedHint")}</p>}
          <form action={saveCompositionAction} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={order.id} />
            <fieldset disabled={!manage || locked} className="flex flex-col gap-4">
              <CompositionPicker
                disabled={!manage || locked}
                elements={catalog.elements.map((element, i) => ({
                  id: element.id,
                  name: element.name,
                  kind: sketchKind(element.name),
                  color: SKETCH_COLORS[i % SKETCH_COLORS.length]!,
                  sizes: Object.fromEntries(
                    element.sizes.map((s) => [
                      s.type,
                      {
                        heightMm: s.heightMm,
                        widthMm: s.widthMm,
                        perUnit: s.perUnit,
                        price: s.price,
                      },
                    ]),
                  ),
                }))}
                types={DIST_TYPES.map((type) => {
                  const size = catalog.types.find((x) => x.type === type.code);
                  return {
                    code: type.code,
                    label: type.label,
                    heightMm: size?.heightMm ?? null,
                    widthMm: size?.widthMm ?? null,
                    depthMm: size?.depthMm ?? null,
                    units: Math.round((units[type.code] ?? 0) * 10) / 10,
                    rows: rowsOf(type.label),
                  };
                })}
                initial={{
                  selected: Object.fromEntries(order.elements.map((e) => [e.elementId, e.types])),
                  perUnit: Object.fromEntries(
                    order.elements.map((e) => [
                      e.elementId,
                      (e.perUnit ?? {}) as Record<string, number>,
                    ]),
                  ),
                  reservePct: order.reservePct,
                  reserveByType: (order.reserveByType ?? {}) as Record<string, number>,
                  withStock: order.withStock,
                }}
              />
              <p className="text-muted-foreground text-xs">{t("dist.campaign.perUnitHint")}</p>
              {manage && !locked && (
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" name="next" value="list">
                    {t("dist.campaign.makeList")}
                  </Button>
                  <Button type="submit" variant="outline">
                    {t("dist.campaign.saveComposition")}
                  </Button>
                  <Link
                    href="/equipment/sizes"
                    className="text-primary self-center px-2 text-sm hover:underline"
                  >
                    {t("dist.builder.catalog")}
                  </Link>
                </div>
              )}
            </fieldset>
          </form>
          {!locked && c.preview.lines.length > 0 && (
            <div className="flex flex-col gap-2 border-t pt-3">
              <h3 className="text-sm font-semibold">{t("dist.campaign.preview")}</h3>
              <Matrix
                dense
                text={[1, 2]}
                head={[
                  t("dist.builder.posm"),
                  t("dist.builder.equipment"),
                  t("dist.builder.printSize"),
                  t("dist.builder.unitsCol"),
                  t("dist.builder.perUnit"),
                  t("dist.builder.quantity"),
                  t("dist.builder.price"),
                  t("dist.builder.sum"),
                ]}
                rows={c.preview.lines.map((l) => ({
                  key: l.key,
                  cells: [
                    <span key="n" className="flex flex-col">
                      {l.element}
                      {l.gaps.length > 0 && (
                        <span className="text-xs text-amber-700 dark:text-amber-400">
                          {l.gaps.map((g) => t(`dist.builder.gap.${g}`)).join(", ")}
                        </span>
                      )}
                    </span>,
                    <span key="e" className="text-xs whitespace-normal">
                      {l.types.map(typeLabel).join(", ")}
                    </span>,
                    mm(l.heightMm, l.widthMm) ?? "?",
                    fmt(l.units),
                    l.perUnit ?? "?",
                    l.quantity === null ? "?" : <strong key="q">{fmt(l.quantity)}</strong>,
                    l.price === null ? "?" : fmt(l.price),
                    l.sum === null ? "—" : fmt(l.sum),
                  ],
                }))}
              />
            </div>
          )}
        </Section>
      </Anchor>

      {/* 5. The list */}
      <Anchor id="list">
        <Section title={t("dist.campaign.listTitle")} hint={t("dist.campaign.listHint")}>
          {q("saved") === "list" && <Saved />}
          {c.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("dist.campaign.noList")}</p>
          ) : (
            <>
              <Matrix
                dense
                text={[1, 3]}
                head={[
                  t("dist.builder.posm"),
                  t("dist.builder.equipment"),
                  t("dist.builder.printSize"),
                  t("dist.builder.material"),
                  t("dist.builder.unitsCol"),
                  t("dist.builder.perUnit"),
                  t("dist.builder.quantity"),
                  t("dist.builder.price"),
                  t("dist.builder.sum"),
                ]}
                rows={c.items.map((item) => ({
                  key: item.id,
                  cells: [
                    <Link
                      key="n"
                      href={`/distribution/posm/${item.id}`}
                      className="hover:underline"
                    >
                      {item.category}
                    </Link>,
                    <span key="e" className="text-xs whitespace-normal">
                      {item.equipmentLabel}
                    </span>,
                    item.size ?? "—",
                    <span key="m" className="text-muted-foreground text-xs whitespace-normal">
                      {item.material ?? "—"}
                    </span>,
                    fmt(item.orderedFor),
                    item.norm ?? "—",
                    <strong key="q">{fmt(item.ordered)}</strong>,
                    item.price === null ? "—" : fmt(item.price),
                    item.price === null ? "—" : fmt(item.price * item.ordered),
                  ],
                }))}
                foot={[
                  t("dist.total"),
                  "",
                  "",
                  "",
                  "",
                  "",
                  fmt(c.items.reduce((s, i) => s + i.ordered, 0)),
                  "",
                  fmt(c.total),
                ]}
              />
              <div>
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/distribution/campaigns/${order.id}/xlsx`}>
                    <Download />
                    {t("dist.campaign.listExcel")}
                  </a>
                </Button>
              </div>
            </>
          )}
        </Section>
      </Anchor>

      {/* 6. The printer's prices */}
      <Anchor id="prices">
        <Section title={t("dist.campaign.pricesTitle")} hint={t("dist.campaign.pricesStepHint")}>
          {q("prices") !== null && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              {t("dist.campaign.pricesSaved", { count: q("prices")! })}
            </p>
          )}
          {c.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("dist.campaign.noList")}</p>
          ) : (
            <form action={savePricesAction} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={order.id} />
              <Matrix
                dense
                text={[1, 2]}
                head={[
                  t("dist.builder.posm"),
                  t("dist.builder.equipment"),
                  t("dist.builder.printSize"),
                  t("dist.builder.quantity"),
                  t("dist.builder.price"),
                  t("dist.builder.sum"),
                  t("dist.campaign.confirmed"),
                ]}
                rows={c.items.map((item) => ({
                  key: item.id,
                  cells: [
                    <span key="n" className="flex flex-col">
                      <Link href={`/distribution/posm/${item.id}`} className="hover:underline">
                        {item.category}
                      </Link>
                      {item.supplier && (
                        <span className="text-muted-foreground text-xs">
                          {item.supplier}
                          {item.quoteNo && ` · ${t("dist.campaign.quoteShort")} ${item.quoteNo}`}
                        </span>
                      )}
                    </span>,
                    <span key="e" className="text-xs whitespace-normal">
                      {item.equipmentLabel}
                    </span>,
                    item.size ?? "—",
                    <strong key="q">{fmt(item.ordered)}</strong>,
                    manage ? (
                      <span key="p">
                        <input type="hidden" name="posmId" value={item.id} />
                        <Input
                          name={`price:${item.id}`}
                          type="number"
                          min={0}
                          step="any"
                          defaultValue={item.price ?? ""}
                          className="ml-auto h-8 w-28"
                          aria-label={t("dist.builder.price")}
                        />
                      </span>
                    ) : item.price === null ? (
                      "—"
                    ) : (
                      fmt(item.price)
                    ),
                    item.price === null ? "—" : fmt(item.price * item.ordered),
                    item.priceConfirmedAt ? (
                      <span key="c" className="text-xs text-emerald-700 dark:text-emerald-400">
                        ✓ {day.format(item.priceConfirmedAt)}
                      </span>
                    ) : manage ? (
                      <label key="c" className="flex items-center justify-end gap-1.5 text-xs">
                        <input type="checkbox" name="confirm" value={item.id} className="size-4" />
                        {t("dist.campaign.confirm")}
                      </label>
                    ) : (
                      <span key="c" className="text-xs text-amber-700 dark:text-amber-400">
                        {t("dist.campaign.notConfirmed")}
                      </span>
                    ),
                  ],
                }))}
                foot={[
                  t("dist.total"),
                  "",
                  "",
                  fmt(c.items.reduce((s, i) => s + i.ordered, 0)),
                  "",
                  fmt(c.total),
                  `${c.priced} / ${c.items.length}`,
                ]}
              />
              {manage && (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    {t("dist.campaign.supplier")}
                    <Input name="supplier" maxLength={120} className="w-56" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    {t("dist.campaign.quoteNo")}
                    <Input name="quoteNo" maxLength={60} className="w-36" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    {t("dist.campaign.quotedOn")}
                    <Input type="date" name="quotedOn" required defaultValue={today} />
                  </label>
                  <Button type="submit">{t("dist.campaign.savePrices")}</Button>
                </div>
              )}
              <p className="text-muted-foreground text-xs">{t("dist.campaign.pricesHint")}</p>
            </form>
          )}
          <Files
            files={files("QUOTE")}
            kind="QUOTE"
            orderId={order.id}
            manage={manage}
            anchor="#prices"
            label={t("dist.campaign.quotes")}
          />
        </Section>
      </Anchor>

      {/* 7. EAS and the order */}
      <Anchor id="order">
        <Section title={t("dist.campaign.orderTitle")} hint={t("dist.campaign.orderHint")}>
          <div>
            <Button asChild>
              <Link href={`/distribution/campaigns/${order.id}/eas`}>
                <FileText />
                {t("dist.eas.open")}
              </Link>
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">{t("dist.campaign.easPending")}</p>
          <Files
            files={files("EAS")}
            kind="EAS"
            orderId={order.id}
            manage={manage}
            anchor="#order"
            label={t("dist.campaign.easFiles")}
          />
          {order.orderedOn ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                {t("dist.campaign.orderedOn", { date: day.format(order.orderedOn) })}
              </span>
              {manage && c.shipped === 0 && (
                <form action={setOrderedAction}>
                  <input type="hidden" name="id" value={order.id} />
                  <input type="hidden" name="undo" value="1" />
                  <Button type="submit" size="sm" variant="ghost">
                    {t("dist.campaign.unorder")}
                  </Button>
                </form>
              )}
            </div>
          ) : (
            manage && (
              <form action={setOrderedAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={order.id} />
                <label className="flex flex-col gap-1 text-sm">
                  {t("dist.orders.date")}
                  <Input type="date" name="orderedOn" required defaultValue={today} />
                </label>
                <Button type="submit" disabled={c.items.length === 0}>
                  {t("dist.campaign.markOrdered")}
                </Button>
                {!c.steps.prices && c.items.length > 0 && (
                  <span className="text-xs text-amber-700 dark:text-amber-400">
                    {t("dist.campaign.pricesNotAll")}
                  </span>
                )}
              </form>
            )
          )}
        </Section>
      </Anchor>

      {/* 8. Distribution */}
      <Anchor id="distribution">
        <Section
          title={t("dist.campaign.distributionTitle")}
          hint={t("dist.campaign.distributionHint")}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label={t("dist.campaign.ordered")}
              value={fmt(c.items.reduce((s, i) => s + i.ordered, 0))}
            />
            <Stat label={t("dist.kpi.toRegions")} value={fmt(c.toRegions)} />
            <Stat
              label={t("dist.kpi.shipped")}
              value={fmt(c.shipped)}
              note={c.toRegions ? pct(c.shipped / c.toRegions) : undefined}
            />
          </div>
          <form action={openDistributionAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={order.id} />
            <Button type="submit" name="to" value="plan" disabled={c.items.length === 0}>
              {t("dist.campaign.openPlan")}
            </Button>
            <Button
              type="submit"
              name="to"
              value="stock"
              variant="outline"
              disabled={c.items.length === 0}
            >
              {t("dist.campaign.openStock")}
            </Button>
          </form>
        </Section>
      </Anchor>

      {/* 9. Replacement in the shops */}
      <Anchor id="replacement">
        <Section
          title={t("dist.campaign.replacementTitle")}
          hint={t("dist.campaign.replacementHint")}
        >
          {q("rows") !== null && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              {t("dist.campaign.replacementDone", {
                rows: q("rows")!,
                replaced: q("replaced") ?? "0",
              })}
              {Number(q("unknown")) > 0 &&
                ` ${t("dist.campaign.replacementUnknown", { count: q("unknown")! })}`}
            </p>
          )}
          {c.outlets.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("dist.campaign.noOutlets")}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat label={t("dist.campaign.outlets")} value={fmt(c.replacement.total.planned)} />
                <Stat
                  label={t("dist.campaign.replaced")}
                  value={fmt(c.replacement.total.replaced)}
                  note={pct(c.replacement.total.replaced / c.replacement.total.planned)}
                />
                <Stat label={t("dist.campaign.notYet")} value={fmt(c.replacement.total.notYet)} />
              </div>
              <Matrix
                dense
                head={[
                  t("dist.regions.region"),
                  t("dist.campaign.outlets"),
                  t("dist.campaign.replaced"),
                  t("dist.campaign.notYet"),
                  "%",
                ]}
                rows={c.replacement.regions.map((r) => ({
                  key: r.key,
                  cells: [
                    r.key,
                    fmt(r.planned),
                    <N key="d" value={r.replaced} tone="good" />,
                    <N key="n" value={r.notYet} tone="bad" />,
                    pct(r.replaced / r.planned),
                  ],
                }))}
              />
              <details>
                <summary className="text-primary cursor-pointer text-sm">
                  {t("dist.campaign.byTsm")}
                </summary>
                <Matrix
                  dense
                  head={[
                    t("dist.equipment.tsm"),
                    t("dist.campaign.outlets"),
                    t("dist.campaign.replaced"),
                    t("dist.campaign.notYet"),
                    "%",
                  ]}
                  rows={c.replacement.regions.flatMap((r) =>
                    [...(c.replacement.tsms.get(r.key)?.values() ?? [])].map((row) => ({
                      key: `${r.key}:${row.key}`,
                      cells: [
                        `${r.key} · ${row.key}`,
                        fmt(row.planned),
                        <N key="d" value={row.replaced} tone="good" />,
                        <N key="n" value={row.notYet} tone="bad" />,
                        pct(row.replaced / row.planned),
                      ],
                    })),
                  )}
                />
              </details>
            </>
          )}
          <div className="flex flex-wrap items-end gap-3">
            {c.outlets.length > 0 && (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/distribution/campaigns/${order.id}/replacement`}>
                  <Download />
                  {t("dist.campaign.replacementTemplate")}
                </a>
              </Button>
            )}
            {!order.closed && c.outlets.length > 0 && (
              <form action={importReplacementAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={order.id} />
                <label className="flex flex-col gap-1 text-sm">
                  {t("dist.campaign.replacementFile")}
                  <Input type="file" name="file" required accept={XLSX} />
                </label>
                <Button type="submit" variant="outline">
                  {t("dist.import.submit")}
                </Button>
              </form>
            )}
          </div>
          <p className="text-muted-foreground text-xs">{t("dist.campaign.replacementFormat")}</p>
        </Section>
      </Anchor>
    </div>
  );
}

function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24">
      {children}
    </div>
  );
}

function Saved() {
  return <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("dist.posm.saved")}</p>;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {note && <div className="text-muted-foreground text-xs">{note}</div>}
    </div>
  );
}

function RemoveFile({
  orderId,
  fileId,
  anchor,
}: {
  orderId: string;
  fileId: string;
  anchor: string;
}) {
  return (
    <form action={removeCampaignFileAction}>
      <input type="hidden" name="id" value={orderId} />
      <input type="hidden" name="fileId" value={fileId} />
      <input type="hidden" name="anchor" value={anchor} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        className="h-7 px-2"
        aria-label={t("dist.campaign.removeFile")}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </form>
  );
}

function Upload({ orderId, kind, accept }: { orderId: string; kind: string; accept?: string }) {
  return (
    <form action={addCampaignFileAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={orderId} />
      <input type="hidden" name="kind" value={kind} />
      <label className="flex flex-col gap-1 text-sm">
        {t("dist.campaign.addFiles", { mb: MAX_CAMPAIGN_FILE_MB })}
        <Input type="file" name="file" multiple required accept={accept} />
      </label>
      <Button type="submit" variant="outline">
        {t("dist.import.submit")}
      </Button>
    </form>
  );
}

function Files({
  files,
  kind,
  orderId,
  manage,
  anchor,
  label,
}: {
  files: { id: string; name: string; size: number }[];
  kind: string;
  orderId: string;
  manage: boolean;
  anchor: string;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-sm font-semibold">{label ?? t("dist.campaign.files")}</h3>
      {files.length === 0 && (
        <p className="text-muted-foreground text-xs">{t("dist.campaign.noFiles")}</p>
      )}
      <ul className="flex flex-col gap-1">
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-2 text-sm">
            <FileText className="text-muted-foreground size-4 shrink-0" />
            <a
              href={`/api/distribution/files/${f.id}?download=1`}
              className="truncate hover:underline"
            >
              {f.name}
            </a>
            <span className="text-muted-foreground text-xs">
              {fmt(Math.round(f.size / 1024))} KB
            </span>
            {manage && <RemoveFile orderId={orderId} fileId={f.id} anchor={anchor} />}
          </li>
        ))}
      </ul>
      {manage && <Upload orderId={orderId} kind={kind} />}
    </div>
  );
}
