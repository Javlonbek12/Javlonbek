import { Box, Printer, Send } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CopyLinkButton } from "@/components/planograms/copy-link";
import { PlanogramErrorNote, SavedNote } from "@/components/planograms/error-note";
import { PlanogramStatusBadge } from "@/components/planograms/status-badge";
import { PlanogramPicture } from "@/components/planograms/planogram-picture";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/db";
import { formatDay, toDateString } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { displayName } from "@/modules/core/users/display-name";
import { canApprovePlanograms, canManagePlanograms } from "@/modules/planograms/access";
import { describeChange, describeViolation } from "@/modules/planograms/describe";
import { planogramSvg } from "@/modules/planograms/export";
import { describeGeometry } from "@/modules/planograms/geometry";
import { priceListDate } from "@/modules/planograms/price-status";
import { listPriceLists } from "@/modules/planograms/pricing";
import { loadPlanogram } from "@/modules/planograms/repository";
import {
  changesVsPrevious,
  staleBase,
  submissions,
  validateStored,
  versionHistory,
} from "@/modules/planograms/service";
import { hasCritical } from "@/modules/planograms/validate";

import {
  sendToTelegramAction,
  updateMetaAction,
  updateRulesAction,
  workflowAction,
} from "../actions";

export default async function PlanogramPage({
  params,
  searchParams,
}: PageProps<"/planograms/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const loaded = await loadPlanogram(id);
  if (!loaded) notFound();
  const r = loaded.record;
  const manage = canManagePlanograms(user.role);
  const approve = canApprovePlanograms(user.role);
  // Sending to Telegram is for the owner and managers (the action checks the same).
  const canSend = user.role === "OWNER" || user.role === "MANAGER";
  const draft = r.status === "DRAFT" || r.status === "PENDING_APPROVAL";

  const [svg, violations, changes, history, equipment, people, priceLists, names, stale, sent] =
    await Promise.all([
      planogramSvg(loaded, { imageBase: "/api/planogram-images" }),
      validateStored(loaded),
      changesVsPrevious(loaded),
      versionHistory(r.rootId ?? r.id),
      db.equipment.findMany({ where: { id: { not: r.equipmentId } }, orderBy: { name: "asc" } }),
      db.user.findMany({
        where: { botChatId: { not: null }, deactivatedAt: null },
        orderBy: { firstName: "asc" },
      }),
      listPriceLists(),
      Promise.all([
        db.sku.findMany({ select: { id: true, name: true } }),
        db.posm.findMany({ select: { id: true, name: true } }),
      ]).then(([a, b]) => new Map([...a, ...b].map((x) => [x.id, x.name]))),
      staleBase(loaded),
      r.status === "PENDING_APPROVAL"
        ? submissions([r]).then((m) => m.get(r.id) ?? null)
        : Promise.resolve(null),
    ]);
  const critical = hasCritical(violations);
  // The approve button is there for an approver on a version sent to them or on their own draft.
  const approvable =
    approve &&
    !r.isTemplate &&
    (r.status === "PENDING_APPROVAL" || (r.status === "DRAFT" && r.createdById === user.id));
  const pending = r.status === "PENDING_APPROVAL" && !r.isTemplate;
  const own = r.createdById === user.id;
  const priceList = priceLists.find((p) => p.id === r.priceListId) ?? null;
  const warnings = violations.filter((v) => v.severity !== "CRITICAL").length;
  const criticals = violations.length - warnings;
  const shareUrl = r.shareToken ? `${getEnv().APP_URL}/p/${r.shareToken}` : null;
  const step = (
    name: string,
    label: string,
    variant: "default" | "outline" | "ghost" = "outline",
    disabled = false,
  ) => (
    <form action={workflowAction}>
      <input type="hidden" name="planogramId" value={r.id} />
      <input type="hidden" name="title" value={r.title} />
      <input type="hidden" name="step" value={name} />
      <Button type="submit" size="sm" variant={variant} disabled={disabled}>
        {label}
      </Button>
    </form>
  );
  const rule = (kind: string) => loaded.rules.find((x) => x.kind === kind);
  const shelvesText = (kind: string) => {
    const value = rule(kind)?.params.shelves;
    return Array.isArray(value) ? value.map((n: number) => n + 1).join(", ") : "";
  };

  return (
    <div className="flex flex-col gap-4">
      <PlanogramErrorNote error={query.error} />
      <SavedNote
        show={query.sent}
        text={t("planograms.actions.sent", { count: String(query.sent) })}
      />
      <SavedNote
        show={query.submitted}
        text={
          query.submitted === "-"
            ? t("planograms.actions.submittedNobody")
            : t("planograms.actions.submittedTo", { names: String(query.submitted) })
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">{r.title}</h2>
        <PlanogramStatusBadge status={r.status} />
        <span className="text-muted-foreground text-sm">
          {r.equipment.name} ({describeGeometry(loaded.geometry)}) · {r.channel} ·{" "}
          {t("planograms.version", { version: r.version })}
          {r.project && ` · ${r.project}`}
          {r.priceList && ` · ${r.priceList.name}`}
        </span>
      </div>

      {manage && (
        <div className="flex flex-wrap gap-2">
          {draft && (
            <Button asChild size="sm" className="hidden md:inline-flex">
              <Link href={`/planograms/${r.id}/edit`}>{t("planograms.actions.edit")}</Link>
            </Button>
          )}
          {r.status === "DRAFT" &&
            !r.isTemplate &&
            step("submit", t("planograms.actions.submit"), "outline", critical)}
          {approvable &&
            !pending &&
            !stale &&
            step("approve", t("planograms.actions.approve"), "default", critical)}
          {!draft && step("version", t("planograms.actions.newVersion"))}
          {!r.isTemplate && step("template", t("planograms.actions.saveTemplate"), "ghost")}
          {approve && r.status !== "ARCHIVED" && (
            <ConfirmAction
              label={t("planograms.actions.archive")}
              title={t("planograms.actions.archiveTitle")}
              hint={
                r.status === "APPROVED"
                  ? t("planograms.actions.archiveInForce")
                  : t("planograms.actions.archiveHint")
              }
              confirm={t("planograms.actions.archiveConfirm")}
              action={workflowAction}
              hidden={{ planogramId: r.id, step: "archive" }}
            />
          )}
        </div>
      )}
      {critical && r.status === "DRAFT" && !r.isTemplate && manage && (
        <p className="text-destructive text-sm">
          {approvable ? t("planograms.validation.blocked") : t("planograms.actions.submitBlocked")}
        </p>
      )}

      {/* A version sent for approval: everything to decide on one screen, the picture below. */}
      {pending && (
        <Card className="gap-3 border-amber-500/60 bg-amber-500/5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <CardTitle>{t("planograms.decision.title")}</CardTitle>
            {sent && (
              <span className="text-muted-foreground text-sm">
                {t("planograms.decision.sent", {
                  name: sent.name,
                  date: formatDateTime(sent.at, getEnv().DEFAULT_TIMEZONE),
                })}
              </span>
            )}
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            <li className={cn(criticals > 0 && "text-destructive font-medium")}>
              {violations.length === 0
                ? `✅ ${t("planograms.decision.rulesOk")}`
                : [
                    criticals > 0
                      ? `⛔ ${t("planograms.decision.rulesCritical", { count: criticals })}`
                      : "",
                    warnings > 0
                      ? `⚠️ ${t("planograms.decision.rulesWarnings", { count: warnings })}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </li>
            <li>
              {changes.length > 0
                ? t("planograms.decision.changes", { count: changes.length })
                : t("planograms.decision.changesNone")}
              {r.previousVersionId && (
                <>
                  {" · "}
                  <Link className="underline" href={`/planograms/${r.id}/compare`}>
                    {t("planograms.decision.compare")}
                  </Link>
                </>
              )}
            </li>
            <li>
              {priceList
                ? t("planograms.decision.prices", {
                    name: priceList.name,
                    status: t(`planograms.library.prices.status.${priceList.status}`).toLowerCase(),
                  })
                : t("planograms.decision.noPrices")}
            </li>
            <li>
              <a className="text-muted-foreground underline" href="#checks">
                {t("planograms.decision.details")}
              </a>
            </li>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            {approve &&
              !stale &&
              step("approve", t("planograms.actions.approve"), "default", critical)}
            {approve && !own && (
              <ConfirmAction
                label={t("planograms.actions.returnBack")}
                title={t("planograms.actions.returnTitle")}
                confirm={t("planograms.actions.returnBack")}
                action={workflowAction}
                hidden={{ planogramId: r.id, step: "draft" }}
                tone="default"
              >
                <Label className="flex-col items-start">
                  {t("planograms.actions.returnReason")}
                  <Textarea name="reason" required maxLength={1000} rows={3} />
                </Label>
              </ConfirmAction>
            )}
            {own && manage && step("draft", t("planograms.actions.withdraw"), "ghost")}
          </div>
        </Card>
      )}

      {stale && (
        <Card className="gap-2 border-amber-500/60 bg-amber-500/5">
          <CardTitle>{t("planograms.stale.title")}</CardTitle>
          <p className="text-sm">
            {t("planograms.stale.fromBase", {
              base: String(stale.base.version),
              current: String(stale.current.version),
            })}
          </p>
          {(stale.changes.length > 0 || stale.header || stale.shelftalkers) && (
            <div className="text-sm">
              <p className="font-medium">
                {t("planograms.stale.changes", {
                  base: String(stale.base.version),
                  current: String(stale.current.version),
                })}
              </p>
              <ul className="list-disc pl-5">
                {stale.changes.slice(0, 12).map((c, i) => (
                  <li key={i}>{describeChange(c, names)}</li>
                ))}
                {stale.changes.length > 12 && (
                  <li className="text-muted-foreground">
                    {t("planograms.stale.more", { count: String(stale.changes.length - 12) })}
                  </li>
                )}
                {stale.header && <li>{t("planograms.stale.header")}</li>}
                {stale.shelftalkers && <li>{t("planograms.stale.shelftalkers")}</li>}
              </ul>
            </div>
          )}
          {stale.priceList && (
            <p className="text-sm">
              {t("planograms.stale.priceList", {
                current: String(stale.current.version),
                name: stale.priceList,
              })}
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            {t("planograms.stale.advice", { current: String(stale.current.version) })}{" "}
            <Link className="underline" href={`/planograms/${stale.current.id}`}>
              {t("planograms.stale.open", { current: String(stale.current.version) })}
            </Link>
          </p>
          {approvable && manage && (
            <form action={workflowAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="planogramId" value={r.id} />
              <input type="hidden" name="step" value="approve" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="force" value="1" required className="size-4" />
                {t("planograms.stale.confirm", { current: String(stale.current.version) })}
              </label>
              <Button type="submit" size="sm" disabled={critical}>
                {t("planograms.stale.approve")}
              </Button>
            </form>
          )}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button asChild size="sm" variant="outline">
          <Link href={`/planograms/${r.id}/3d`}>
            <Box />
            {t("planograms.view3d.open")}
          </Link>
        </Button>
        <span className="text-muted-foreground">{t("planograms.export.label")}:</span>
        {(["pptx", "pdf", "png"] as const).map((format) => (
          <Button key={format} asChild size="sm" variant="outline">
            <a href={`/api/planograms/${r.id}/export?format=${format}`}>{format.toUpperCase()}</a>
          </Button>
        ))}
        {r.previousVersionId && (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/planograms/${r.id}/compare`}>{t("planograms.actions.compare")}</Link>
          </Button>
        )}
      </div>

      {/* The planogram picture; scrolls sideways on phones or fits the screen. */}
      <PlanogramPicture svg={svg} />

      <div id="checks" className="grid scroll-mt-24 gap-4 md:grid-cols-2">
        <Card className="gap-2">
          <CardTitle>{t("planograms.validation.title")}</CardTitle>
          {violations.length === 0 ? (
            <p className="text-sm">{t("planograms.validation.ok")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {violations.map((v, i) => (
                <li
                  key={i}
                  className={cn(v.severity === "CRITICAL" ? "text-destructive" : "text-amber-700")}
                >
                  {v.severity === "CRITICAL" ? "⛔" : "⚠️"} {describeViolation(v)}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="gap-2">
          <CardTitle>{t("planograms.changes.title")}</CardTitle>
          {changes.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("planograms.changes.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {changes.map((c, i) => (
                <li key={i}>{describeChange(c, names)}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {shareUrl && (
        <Card className="gap-2">
          <CardTitle>{t("planograms.actions.share")}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <CopyLinkButton url={shareUrl} />
            <Button asChild size="sm" variant="outline">
              <a
                href={`https://t.me/share/url?${new URLSearchParams({ url: shareUrl, text: r.title })}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Send />
                {t("planograms.actions.shareTelegram")}
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={`${shareUrl}?print=1`} target="_blank" rel="noopener noreferrer">
                <Printer />
                {t("planograms.actions.print")}
              </a>
            </Button>
          </div>
          <p className="text-muted-foreground text-xs break-all">
            <a className="underline" href={shareUrl} target="_blank" rel="noopener noreferrer">
              {shareUrl}
            </a>
          </p>
          {canSend && r.status !== "APPROVED" && (
            <p className="text-muted-foreground text-xs">{t("planograms.actions.sendsInForce")}</p>
          )}
          {canSend && people.length > 0 && (
            <form action={sendToTelegramAction} className="flex flex-col gap-2">
              <p className="text-sm">{t("planograms.actions.sendPeople")}</p>
              <input type="hidden" name="planogramId" value={r.id} />
              <div className="flex flex-wrap gap-3">
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-1 text-sm">
                    <input type="checkbox" name="userIds" value={p.id} className="size-4" />{" "}
                    {displayName(p)}
                  </label>
                ))}
              </div>
              <Button type="submit" size="sm" variant="outline" className="self-start">
                {t("planograms.actions.sendTelegram")}
              </Button>
            </form>
          )}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="gap-2">
          <CardTitle>{t("planograms.history")}</CardTitle>
          <ul className="flex flex-col gap-1 text-sm">
            {history.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <Link
                  className={cn("underline", v.id === r.id && "font-semibold")}
                  href={`/planograms/${v.id}`}
                >
                  {t("planograms.version", { version: v.version })}
                </Link>
                <PlanogramStatusBadge status={v.status} />
                <span className="text-muted-foreground text-xs">
                  {formatDay(toDateString(v.approvedAt ?? v.createdAt))}
                  {v.priceList && ` · ${v.priceList.name}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        {manage && (
          <Card className="gap-2">
            <CardTitle>{t("planograms.actions.adapt")}</CardTitle>
            <form action={workflowAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="planogramId" value={r.id} />
              <input type="hidden" name="step" value="adapt" />
              <NativeSelect name="equipmentId" aria-label={t("planograms.fields.equipment")}>
                {equipment.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.channel})
                  </option>
                ))}
              </NativeSelect>
              <Button type="submit" size="sm" variant="outline">
                {t("planograms.actions.adapt")}
              </Button>
            </form>
          </Card>
        )}
      </div>

      {manage && draft && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer font-medium">
            {t("planograms.fields.title")}, {t("planograms.fields.priceList").toLowerCase()}…
          </summary>
          <form action={updateMetaAction} className="mt-3 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="planogramId" value={r.id} />
            {r.status === "PENDING_APPROVAL" && (
              <p className="text-sm text-amber-700 md:col-span-2 dark:text-amber-300">
                {t("planograms.editor.pendingWarning")}
              </p>
            )}
            <Label className="flex-col items-start">
              {t("planograms.fields.title")}
              <Input name="title" required defaultValue={r.title} />
            </Label>
            <Label className="flex-col items-start">
              {t("planograms.fields.channel")}
              <Input name="channel" required defaultValue={r.channel} />
            </Label>
            <Label className="flex-col items-start">
              {t("planograms.fields.project")}
              <Input name="project" defaultValue={r.project ?? ""} />
            </Label>
            <Label className="flex-col items-start">
              {t("planograms.fields.priceList")}
              <NativeSelect
                name="priceListId"
                defaultValue={r.priceListId ?? ""}
                className="w-full"
              >
                {priceLists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {priceListDate(p.effectiveFrom)} ·{" "}
                    {t(`planograms.library.prices.status.${p.status}`).toLowerCase()}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label className="flex-col items-start">
              {t("planograms.fields.validFrom")}
              <Input
                type="date"
                name="validFrom"
                defaultValue={r.validFrom ? toDateString(r.validFrom) : ""}
              />
            </Label>
            <Label className="flex-col items-start">
              {t("planograms.fields.validTo")}
              <Input
                type="date"
                name="validTo"
                defaultValue={r.validTo ? toDateString(r.validTo) : ""}
              />
            </Label>
            <Label className="flex-col items-start md:col-span-2">
              {t("planograms.fields.notes")}
              <Textarea name="notes" defaultValue={r.notes ?? ""} />
            </Label>
            <Button type="submit" size="sm" className="self-start">
              {t("planograms.actions.save")}
            </Button>
          </form>
        </details>
      )}
      {!draft && r.notes && (
        <Card>
          <CardDescription className="whitespace-pre-wrap">{r.notes}</CardDescription>
        </Card>
      )}

      {manage && draft && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer font-medium">{t("planograms.actions.rules")}</summary>
          <form action={updateRulesAction} className="mt-3 flex flex-col gap-3 text-sm">
            <input type="hidden" name="planogramId" value={r.id} />
            {(
              [
                "MANDATORY_SKUS",
                "ALL_SLOTS_DECIDED",
                "FACINGS",
                "BRAND_BLOCKS",
                "NEW_ITEMS",
                "BRAND_ORDER",
              ] as const
            ).map((kind) => (
              <fieldset key={kind} className="flex flex-col gap-2 rounded-md border p-3">
                <legend className="px-1 font-medium">{t(`planograms.ruleKinds.${kind}`)}</legend>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      name={`${kind}_enabled`}
                      defaultChecked={rule(kind)?.enabled ?? false}
                      className="size-4"
                    />
                    {t("planograms.ruleParams.enabled")}
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      name={`${kind}_critical`}
                      defaultChecked={rule(kind)?.severity === "CRITICAL"}
                      className="size-4"
                    />
                    {t("planograms.ruleParams.critical")}
                  </label>
                </div>
                {(kind === "MANDATORY_SKUS" || kind === "NEW_ITEMS") && (
                  <Label className="flex-col items-start font-normal">
                    {t("planograms.ruleParams.shelves")}
                    <Input name={`${kind}_shelves`} defaultValue={shelvesText(kind)} />
                  </Label>
                )}
                {kind === "FACINGS" && (
                  <div className="flex gap-2">
                    <Label className="flex-col items-start font-normal">
                      {t("planograms.ruleParams.min")}
                      <Input
                        type="number"
                        min={1}
                        name="FACINGS_min"
                        defaultValue={Number(rule(kind)?.params.min ?? 1)}
                        className="w-24"
                      />
                    </Label>
                    <Label className="flex-col items-start font-normal">
                      {t("planograms.ruleParams.max")}
                      <Input
                        type="number"
                        min={1}
                        name="FACINGS_max"
                        defaultValue={Number(rule(kind)?.params.max ?? 4)}
                        className="w-24"
                      />
                    </Label>
                  </div>
                )}
                {kind === "BRAND_ORDER" && (
                  <Label className="flex-col items-start font-normal">
                    {t("planograms.ruleParams.order")}
                    <Input
                      name="BRAND_ORDER_order"
                      defaultValue={((rule(kind)?.params.order as string[] | undefined) ?? []).join(
                        ", ",
                      )}
                    />
                  </Label>
                )}
              </fieldset>
            ))}
            <Button type="submit" size="sm" className="self-start">
              {t("planograms.actions.saveRules")}
            </Button>
          </form>
        </details>
      )}
    </div>
  );
}
