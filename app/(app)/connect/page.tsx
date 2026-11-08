import { FileSpreadsheet, Presentation, SlidersHorizontal, Upload } from "lucide-react";
import Link from "next/link";

import { ExecView } from "@/components/connect/exec-view";
import { ExecutorsOverview, ExecutorView } from "@/components/connect/executor-view";
import { FilterSelect } from "@/components/connect/filter-select";
import { ManagerView } from "@/components/connect/manager-view";
import { menuItem, MoreMenu } from "@/components/content/more-menu";
import { Card, CardDescription } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { PeriodPicker } from "@/components/ui/period-picker";
import { dateFormat, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  activePreset,
  buildConnectReport,
  connectHref,
  parseConnectQuery,
  PERIOD_PRESETS,
  periodLabel,
  presetMonths,
  scopeConnectQuery,
  VIEWS,
} from "@/modules/connect/report";
import {
  canLeadConnect,
  connectAppUsers,
  connectPeopleLinks,
  lastImports,
} from "@/modules/connect/service";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { formatRange } from "@/modules/reports/format";
import { addDays, addMonths, todayInTimezone } from "@/lib/dates";

import { linkConnectPersonAction } from "./actions";

// Connect bot analytics on three levels: leadership, managers, executors.
export default async function ConnectPage({ searchParams }: PageProps<"/connect">) {
  const user = await requireUser();
  const canLead = canLeadConnect(user);
  const { timezone } = await getSettings(user.id);
  const today = todayInTimezone(timezone);
  const links = await connectPeopleLinks();
  const { query, own } = scopeConnectQuery(
    parseConnectQuery(await searchParams, canLead),
    canLead,
    links,
    user.id,
  );
  const [report, imports, appUsers] = await Promise.all([
    buildConnectReport(query, today),
    lastImports(1),
    canLead ? connectAppUsers() : Promise.resolve([]),
  ]);
  const q = report.query;
  const views = canLead ? VIEWS : (["executor"] as const);
  const lastImport = imports[0];
  const uploaded =
    lastImport &&
    // In the viewer's time zone, not the server's.
    dateFormat({ dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(
      lastImport.createdAt,
    );
  // The dates each chip covers, cut at the last day of data.
  const presetDates = (preset: (typeof PERIOD_PRESETS)[number]) => {
    const m = presetMonths(preset, today);
    if (!m.from || !m.to) return undefined;
    const from = `${m.from}-01`;
    const monthEnd = addDays(addMonths(`${m.to}-01`, 1), -1);
    const data = report.dataDate;
    return formatRange(from, data && data >= from && data < monthEnd ? data : monthEnd, today);
  };
  const filtersSet = Boolean(q.filter.city || q.filter.channel);
  // City, channel and (for the owner and managers) the person: each applies when chosen.
  const filters = (
    <form
      action="/connect"
      className="flex flex-wrap items-end gap-x-3 gap-y-2 text-sm [&_label]:flex [&_label]:flex-col [&_label]:gap-1"
    >
      <input type="hidden" name="view" value={q.view} />
      {q.filter.from && <input type="hidden" name="from" value={q.filter.from} />}
      {q.filter.to && <input type="hidden" name="to" value={q.filter.to} />}
      {q.view === "executor" && own === null && (
        <label className="w-full sm:w-auto">
          <span className="text-muted-foreground text-xs">{t("connect.filters.person")}</span>
          <FilterSelect name="person" defaultValue={q.person ?? ""} className="sm:max-w-80">
            <option value="">{t("connect.executor.everyone")}</option>
            {report.people.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </FilterSelect>
        </label>
      )}
      {own !== null && q.person && <input type="hidden" name="person" value={q.person} />}
      <label>
        <span className="text-muted-foreground text-xs">{t("connect.filters.city")}</span>
        <FilterSelect name="city" defaultValue={q.filter.city ?? ""} className="max-w-44">
          <option value="">{t("connect.filters.all")}</option>
          {report.facets.cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </FilterSelect>
      </label>
      <label>
        <span className="text-muted-foreground text-xs">{t("connect.filters.channel")}</span>
        <FilterSelect name="channel" defaultValue={q.filter.channel ?? ""} className="max-w-40">
          <option value="">{t("connect.filters.all")}</option>
          {report.facets.channels.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </FilterSelect>
      </label>
    </form>
  );
  const downloadable = !report.empty && (q.view !== "executor" || q.person);

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-1">
            <h1 className="text-[22px] font-medium md:text-2xl">{t("connect.title")}</h1>
            <InfoHint className="max-w-2xl">
              {t("connect.intro")} {t("connect.testNote")}
            </InfoHint>
          </div>
          {report.dataDate && (
            <p className="text-muted-foreground text-xs">
              <span className="text-foreground font-medium">
                {t("connect.dataDate", {
                  date: formatRange(report.dataDate, report.dataDate, today),
                })}
              </span>
              {uploaded && ` · ${t("connect.uploadedAt", { date: uploaded })}`}
            </p>
          )}
        </div>
        {(canLead || downloadable) && (
          <MoreMenu label={t("connect.moreMenu")}>
            {canLead && (
              <Link href="/connect/import" className={menuItem}>
                <Upload />
                {t("connect.import.link")}
              </Link>
            )}
            {downloadable && (
              <>
                <a href={connectHref("/api/connect/xlsx", q)} download className={menuItem}>
                  <FileSpreadsheet />
                  {t("connect.download.xlsx")}
                </a>
                <a href={connectHref("/api/connect/pptx", q)} download className={menuItem}>
                  <Presentation />
                  {t("connect.download.pptx")}
                </a>
              </>
            )}
          </MoreMenu>
        )}
      </div>

      {report.facets.total === 0 ? (
        <Card>
          <CardDescription>{t("connect.empty")}</CardDescription>
        </Card>
      ) : (
        <>
          {views.length > 1 && (
            <nav className="flex gap-1 overflow-x-auto border-b text-sm">
              {views.map((view) => (
                <Link
                  key={view}
                  href={connectHref("/connect", q, { view, person: null })}
                  className={cn(
                    "-mb-px flex shrink-0 flex-col border-b-2 px-3 py-2",
                    view === q.view
                      ? "border-primary text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground border-transparent",
                  )}
                >
                  <span className="whitespace-nowrap">{t(`connect.views.${view}`)}</span>
                  <span className="text-muted-foreground hidden text-xs font-normal sm:block">
                    {t(`connect.viewHints.${view}`)}
                  </span>
                </Link>
              ))}
            </nav>
          )}

          <div className="flex flex-col gap-2">
            <PeriodPicker
              chips={PERIOD_PRESETS.map((preset) => {
                const dates = presetDates(preset);
                const m = presetMonths(preset, today);
                return {
                  key: preset,
                  label:
                    preset === "month" && dates
                      ? `${t("connect.period.month")} (${dates})`
                      : t(`connect.period.${preset}`),
                  href: connectHref("/connect", q, { from: m.from ?? null, to: m.to ?? null }),
                  dates,
                };
              })}
              active={activePreset(q.filter, today)}
              dates={periodLabel(report)}
              custom={{
                label: t("connect.period.custom"),
                apply: t("connect.period.apply"),
                fromLabel: t("connect.filters.from"),
                toLabel: t("connect.filters.to"),
                type: "month",
                from: q.filter.from,
                to: q.filter.to,
                min: report.facets.months[0],
                max: report.facets.months.at(-1),
                action: "/connect",
                params: Object.fromEntries(
                  Object.entries({
                    view: q.view,
                    city: q.filter.city,
                    channel: q.filter.channel,
                    person: q.person,
                  }).filter((e): e is [string, string] => Boolean(e[1])),
                ),
              }}
            />
            {/* Phones: the other filters behind one button; wider screens: in a row. */}
            <details className="md:hidden" open={filtersSet}>
              <summary className="border-input bg-card inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium shadow-xs [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal className="size-4" />
                {t("connect.filters.title")}
              </summary>
              <div className="mt-2">{filters}</div>
            </details>
            <div className="hidden md:block">{filters}</div>
          </div>

          {own !== null && own.length === 0 ? (
            <Card>
              <CardDescription>{t("connect.executor.notLinkedYou")}</CardDescription>
            </Card>
          ) : report.empty ? (
            <Card>
              <CardDescription>{t("connect.emptyFilter")}</CardDescription>
            </Card>
          ) : report.exec ? (
            <ExecView data={report.exec} previous={report.previous} dataDate={report.dataDate} />
          ) : report.manager ? (
            <ManagerView
              data={report.manager}
              personHref={(person) => connectHref("/connect", q, { view: "executor", person })}
            />
          ) : report.executor && q.person ? (
            <ExecutorView person={q.person} data={report.executor} />
          ) : report.executors ? (
            <ExecutorsOverview
              rows={report.executors}
              personHref={(person) => connectHref("/connect", q, { person })}
              link={
                canLead
                  ? {
                      action: linkConnectPersonAction,
                      users: appUsers.map((u) => ({ id: u.id, name: displayName(u) })),
                      links,
                      back: connectHref("/connect", q),
                    }
                  : undefined
              }
            />
          ) : (
            <Card>
              <CardDescription>{t("connect.executor.none")}</CardDescription>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
