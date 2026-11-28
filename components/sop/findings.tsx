import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { dateFormat, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { FindingsFilter } from "@/modules/sop/filter";
import { RULE_IDS, type Finding, type Severity } from "@/modules/sop/findings";
import { findingsHref, skuHref } from "@/modules/sop/links";
import type { SopMarkRow } from "@/modules/sop/service";
import { describeFinding } from "@/modules/sop/texts";

import { Chip, Pills, SeverityMark } from "./parts";

type MarkAction = (form: FormData) => void | Promise<void>;

// How many month lines of a finding are shown before «…и ещё N».
const ROWS_SHOWN = 6;

// One finding: what it is about, its numbers, what to do, and the mark.
export function FindingItem({
  finding,
  mark,
  cycle,
  back,
  markAction,
  timeZone,
  showSku = true,
  showTodo = true,
}: {
  finding: Finding;
  mark: SopMarkRow | undefined;
  cycle: string;
  // Where the mark's form returns to.
  back: string;
  markAction: MarkAction;
  timeZone: string;
  showSku?: boolean;
  // False where the group above says what to do once for all its findings.
  showTodo?: boolean;
}) {
  const text = describeFinding(finding);
  const when = dateFormat({ dateStyle: "medium", timeZone });
  const hidden = (
    <>
      <input type="hidden" name="cycle" value={cycle} />
      <input type="hidden" name="key" value={finding.key} />
      <input type="hidden" name="back" value={back} />
    </>
  );
  return (
    <li
      className={cn("flex flex-col gap-1.5 border-t py-3 first:border-t-0", mark && "opacity-70")}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {showSku &&
          (finding.sku ? (
            <Link
              href={skuHref(finding.sku.key)}
              className="font-medium underline-offset-2 hover:underline"
            >
              {finding.sku.name}
            </Link>
          ) : (
            <span className="font-medium">{text.subject}</span>
          ))}
        {showSku && finding.sku?.factory && <Chip>{finding.sku.factory}</Chip>}
        {!showSku && <span className="font-medium">{text.name}</span>}
        {mark && (
          <Chip tone="good">
            {t(`sop.findings.mark.${mark.status}`)}
            {mark.userName &&
              ` · ${t("sop.findings.mark.by", { name: mark.userName, date: when.format(mark.updatedAt) })}`}
          </Chip>
        )}
      </div>
      {text.line && <p className="text-sm">{text.line}</p>}
      {text.rows.length > 0 && (
        <ul className="text-sm tabular-nums">
          {text.rows.slice(0, ROWS_SHOWN).map((row) => (
            <li key={row}>{row}</li>
          ))}
          {text.rows.length > ROWS_SHOWN && (
            <li className="text-muted-foreground">
              {t("sop.findings.more", { count: text.rows.length - ROWS_SHOWN })}
            </li>
          )}
        </ul>
      )}
      {Number(finding.params.count) > finding.rows.length && finding.rule === "subtotal" && (
        <p className="text-muted-foreground text-sm">
          {t("sop.findings.more", { count: Number(finding.params.count) - finding.rows.length })}
        </p>
      )}
      {finding.skus.length > 0 && (
        <p className="text-muted-foreground text-sm">
          {t("sop.findings.skus", {
            list: finding.skus
              .slice(0, 12)
              .map((s) => s.name)
              .join(", "),
          })}
          {finding.skus.length > 12 &&
            ` ${t("sop.findings.more", { count: finding.skus.length - 12 })}`}
        </p>
      )}
      {showTodo && (
        <p className="text-sm">
          <span className="font-medium">{t("sop.findings.todo")}</span> {text.todo}
        </p>
      )}
      {mark?.note && <p className="text-muted-foreground text-sm">«{mark.note}»</p>}
      {mark ? (
        <form action={markAction}>
          {hidden}
          <input type="hidden" name="status" value="" />
          <button
            type="submit"
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
          >
            {t("sop.findings.mark.clear")}
          </button>
        </form>
      ) : (
        <details className="group">
          <summary className="text-primary w-fit cursor-pointer list-none text-xs underline underline-offset-2 [&::-webkit-details-marker]:hidden">
            {t("sop.findings.mark.open")}
          </summary>
          <form action={markAction} className="mt-2 flex max-w-xl flex-wrap items-center gap-2">
            {hidden}
            <Input
              name="note"
              maxLength={500}
              placeholder={t("sop.findings.mark.note")}
              aria-label={t("sop.findings.mark.note")}
              className="min-w-48 flex-1"
            />
            <Button type="submit" name="status" value="CHECKED" size="sm" variant="outline">
              {t("sop.findings.mark.CHECKED")}
            </Button>
            <Button type="submit" name="status" value="ACCEPTED" size="sm" variant="outline">
              {t("sop.findings.mark.ACCEPTED")}
            </Button>
          </form>
        </details>
      )}
    </li>
  );
}

const SEVERITIES: Severity[] = ["error", "risk", "note"];
// A group of risks or notes with more findings than this is folded until it is opened.
const OPEN_UP_TO = 4;

// «Ошибки и риски»: the filters and the findings grouped by importance, then by rule.
export function FindingsView({
  findings,
  all,
  marks,
  cycle,
  filter,
  factories,
  skuName,
  baseline,
  markAction,
  timeZone,
}: {
  // The findings after the filter, and all of them (for the counts of the filter's pills).
  findings: Finding[];
  all: Finding[];
  marks: Map<string, SopMarkRow>;
  cycle: string;
  filter: FindingsFilter;
  factories: string[];
  // The name of the SKU the list is narrowed to.
  skuName: string | null;
  // What the frozen months are compared with (a ready sentence), or null.
  baseline: string | null;
  markAction: MarkAction;
  timeZone: string;
}) {
  const query = {
    severity: filter.severity ?? undefined,
    factory: filter.factory ?? undefined,
    q: filter.q || undefined,
    hide: filter.hideMarked ? "1" : undefined,
    item: filter.item ?? undefined,
    sku: filter.sku ?? undefined,
  };
  const back = findingsHref(query);
  const open = findings.filter((f) => !marks.has(f.key)).length;
  const narrowed = Boolean(
    filter.severity || filter.factory || filter.q || filter.hideMarked || filter.item || filter.sku,
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground max-w-3xl text-sm">{t("sop.findings.intro")}</p>
      <Card className="gap-3">
        <Pills
          label={t("sop.findings.filters.severity")}
          items={[
            {
              key: "all",
              label: t("sop.findings.filters.all"),
              href: findingsHref({ ...query, severity: undefined }),
              active: !filter.severity,
              count: all.length,
            },
            ...SEVERITIES.map((severity) => ({
              key: severity,
              label: t(`sop.severity.${severity}`),
              href: findingsHref({ ...query, severity }),
              active: filter.severity === severity,
              count: all.filter((f) => f.severity === severity).length,
            })),
          ]}
        />
        <form action="/sop/findings" className="flex flex-wrap items-end gap-2">
          {filter.severity && <input type="hidden" name="severity" value={filter.severity} />}
          {filter.item && <input type="hidden" name="item" value={filter.item} />}
          {filter.sku && <input type="hidden" name="sku" value={filter.sku} />}
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{t("sop.findings.filters.search")}</span>
            <Input
              name="q"
              defaultValue={filter.q}
              placeholder={t("sop.findings.filters.searchPlaceholder")}
              className="w-48"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{t("sop.findings.filters.factory")}</span>
            <NativeSelect name="factory" defaultValue={filter.factory ?? ""}>
              <option value="">{t("sop.findings.filters.allFactories")}</option>
              {factories.map((factory) => (
                <option key={factory} value={factory}>
                  {factory}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="hide"
              value="1"
              defaultChecked={filter.hideMarked}
              className="size-4"
            />
            {t("sop.findings.filters.hideMarked")}
          </label>
          <Button type="submit" variant="outline">
            {t("sop.findings.filters.apply")}
          </Button>
          {narrowed && (
            <Link
              href="/sop/findings"
              className="text-muted-foreground hover:text-foreground flex h-9 items-center text-sm underline underline-offset-2"
            >
              {t("sop.findings.filters.reset")}
            </Link>
          )}
        </form>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span>{t("sop.findings.count", { count: findings.length, open })}</span>
          {filter.item && <Chip>{t("sop.findings.filters.checklist", { item: filter.item })}</Chip>}
          {filter.sku && skuName && <Chip>{t("sop.findings.filters.sku", { name: skuName })}</Chip>}
        </div>
        <p className="text-muted-foreground text-xs">{baseline ?? t("sop.findings.noBaseline")}</p>
      </Card>

      {findings.length === 0 && (
        <Card>
          <CardDescription>
            {t(all.length === 0 ? "sop.findings.none" : "sop.findings.noneFiltered")}
          </CardDescription>
        </Card>
      )}

      {SEVERITIES.map((severity) => {
        const ofSeverity = findings.filter((f) => f.severity === severity);
        if (ofSeverity.length === 0) return null;
        return (
          <section key={severity} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <SeverityMark severity={severity} count={ofSeverity.length} />
            </h2>
            {RULE_IDS.map((rule) => {
              const group = ofSeverity.filter((f) => f.rule === rule);
              if (group.length === 0) return null;
              const text = describeFinding(group[0]!);
              // What to do is said once when it is the same for the whole group.
              const shared = group.every((f) => describeFinding(f).todo === text.todo);
              const left = group.filter((f) => !marks.has(f.key)).length;
              return (
                <Card key={rule} className="gap-0 py-0 md:py-0">
                  {/* A long group of risks is folded until asked for; errors and short groups
                      are open, and so is everything a filter has narrowed down. */}
                  <details
                    className="group py-4 md:py-5"
                    open={severity === "error" || group.length <= OPEN_UP_TO || narrowed}
                  >
                    <summary className="flex cursor-pointer list-none flex-col gap-1 [&::-webkit-details-marker]:hidden">
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90" />
                        {text.name}
                        <span className="text-muted-foreground text-sm font-normal tabular-nums">
                          {left === group.length ? group.length : `${left} / ${group.length}`}
                        </span>
                      </CardTitle>
                      <CardDescription>
                        <span className="text-foreground font-medium">{t("sop.findings.why")}</span>{" "}
                        {text.why}
                      </CardDescription>
                      {shared && (
                        <CardDescription>
                          <span className="text-foreground font-medium">
                            {t("sop.findings.todo")}
                          </span>{" "}
                          {text.todo}
                        </CardDescription>
                      )}
                    </summary>
                    <ul className="mt-2 flex flex-col">
                      {group.map((finding) => (
                        <FindingItem
                          key={finding.key}
                          finding={finding}
                          mark={marks.get(finding.key)}
                          cycle={cycle}
                          back={back}
                          markAction={markAction}
                          timeZone={timeZone}
                          showTodo={!shared}
                        />
                      ))}
                    </ul>
                  </details>
                </Card>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
