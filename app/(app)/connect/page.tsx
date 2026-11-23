import { Upload } from "lucide-react";
import Link from "next/link";

import { ConnectDownloads } from "@/components/connect/download-menu";
import { ExecView } from "@/components/connect/exec-view";
import { ExecutorsOverview, ExecutorView } from "@/components/connect/executor-view";
import { ManagerView } from "@/components/connect/manager-view";
import { menuItem, MoreMenu } from "@/components/content/more-menu";
import { AutoSubmitForm } from "@/components/ui/auto-submit-form";
import { Card, CardDescription } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { PeriodPicker } from "@/components/ui/period-picker";
import { Segmented } from "@/components/ui/segmented";
import { todayInTimezone } from "@/lib/dates";
import { dateFormat, t } from "@/lib/i18n";
import {
  buildConnectReport,
  connectHref,
  leadScope,
  loadConnectAccess,
  monthsLabel,
  parseConnectQuery,
  PERIOD_PRESETS,
  periodLabel,
  scopeConnectQuery,
  VIEWS,
} from "@/modules/connect/report";
import {
  canLeadConnect,
  connectAppUsers,
  connectTotal,
  lastImports,
} from "@/modules/connect/service";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { presetPeriod } from "@/modules/reports/period";

import { linkConnectPersonAction, linkConnectPositionAction } from "./actions";

// Smart Up visits × Connect Bot on three levels: leadership, managers, executors.
export default async function ConnectPage({ searchParams }: PageProps<"/connect">) {
  const user = await requireUser();
  const canLead = canLeadConnect(user);
  const { timezone } = await getSettings(user.id);
  const today = todayInTimezone(timezone);
  const access = await loadConnectAccess();
  const links = access.people;
  const { query, own } = scopeConnectQuery(
    parseConnectQuery(await searchParams, canLead),
    canLead,
    links,
    user.id,
    access.positions,
  );
  // The owner and managers see the TSMs of their team and under their positions; an employee
  // their own codes and those under their positions.
  const scope = canLead ? leadScope(user, links, access.positions) : own ? new Set(own) : null;
  const [report, imports, appUsers, total] = await Promise.all([
    buildConnectReport(query, today, scope, {
      hierarchy: access.positions.hierarchy,
      own: own !== null,
    }),
    lastImports(1),
    canLead ? connectAppUsers() : Promise.resolve([]),
    connectTotal(),
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
  const months = monthsLabel(report.months);
  const downloadable = !report.empty && (q.view !== "executor" || q.person);
  // The period chosen: chips and own dates keep the level and the TSM.
  const keep = Object.fromEntries(
    Object.entries({ view: q.view, person: q.person, staff: q.staff }).filter(
      (e): e is [string, string] => Boolean(e[1]),
    ),
  );
  const people = report.people;
  const choosePerson =
    q.view === "executor" && (own === null || people.length > 1) && people.length;
  const users = appUsers.map((u) => ({ id: u.id, name: displayName(u) }));
  // The same page with something changed, for the blocks added to the sections.
  const href = (change: Record<string, string | null>) => connectHref("/connect", q, change);

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <PageHeader
        title={t("connect.title")}
        hint={
          <>
            {t("connect.intro")} {t("connect.testNote")}
          </>
        }
        hintClassName="max-w-2xl"
        actions={
          (canLead || downloadable) && (
            <MoreMenu label={t("connect.moreMenu")}>
              {canLead && (
                <Link href="/connect/import" className={menuItem}>
                  <Upload />
                  {t("connect.import.link")}
                </Link>
              )}
              {downloadable && (
                // The file language is chosen before downloading (the interface's by default).
                <ConnectDownloads
                  xlsx={connectHref("/api/connect/xlsx", q)}
                  pptx={connectHref("/api/connect/pptx", q)}
                />
              )}
            </MoreMenu>
          )
        }
      >
        {report.dataDate && (
          <p className="text-xs">
            <span className="text-foreground font-medium">
              {t("connect.dataDate", {
                date: periodLabel({ from: report.dataDate, to: report.dataDate }, today),
              })}
            </span>
            {uploaded && ` · ${t("connect.uploadedAt", { date: uploaded })}`}
          </p>
        )}
      </PageHeader>

      {total === 0 ? (
        <Card>
          <CardDescription>{t("connect.empty")}</CardDescription>
        </Card>
      ) : (
        <>
          {views.length > 1 && (
            <Segmented
              label={t("connect.viewsLabel")}
              className="self-start"
              items={views.map((view) => ({
                key: view,
                label: t(`connect.views.${view}`),
                href: connectHref("/connect", q, { view, person: null }),
                active: view === q.view,
              }))}
            />
          )}

          <div className="flex flex-col gap-2">
            <PeriodPicker
              chips={PERIOD_PRESETS.map((preset) => {
                const range = presetPeriod(preset, today);
                return {
                  key: preset,
                  label: t(`connect.period.${preset}`),
                  href: connectHref("/connect", q, { preset, from: null, to: null }),
                  dates: periodLabel(range, today),
                };
              })}
              active={report.period.preset}
              dates={periodLabel(report.period, today)}
              custom={{
                label: t("connect.period.custom"),
                apply: t("connect.period.apply"),
                fromLabel: t("connect.period.from"),
                toLabel: t("connect.period.to"),
                type: "date",
                from: report.period.from,
                to: report.period.to,
                action: "/connect",
                params: keep,
              }}
            />
            {choosePerson ? (
              <AutoSubmitForm action="/connect" className="flex flex-wrap items-end gap-2 text-sm">
                <input type="hidden" name="view" value="executor" />
                {q.preset && <input type="hidden" name="preset" value={q.preset} />}
                {q.from && <input type="hidden" name="from" value={q.from} />}
                {q.to && <input type="hidden" name="to" value={q.to} />}
                <label className="flex w-full flex-col gap-1 sm:w-auto">
                  <span className="text-muted-foreground text-xs">
                    {t("connect.executor.choose")}
                  </span>
                  <NativeSelect name="person" defaultValue={q.person ?? ""} className="sm:max-w-80">
                    {own === null && <option value="">{t("connect.executor.everyone")}</option>}
                    {people.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name ? `${p.code} · ${p.name}` : p.code}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              </AutoSubmitForm>
            ) : null}
          </div>

          {own !== null && own.length === 0 ? (
            <Card>
              <CardDescription>{t("connect.executor.notLinkedYou")}</CardDescription>
            </Card>
          ) : canLead && scope && scope.size === 0 && q.view !== "exec" ? (
            <Card>
              <CardDescription>{t("connect.manager.noScope")}</CardDescription>
            </Card>
          ) : report.empty ? (
            <Card>
              <CardDescription>{t("connect.emptyPeriod")}</CardDescription>
            </Card>
          ) : report.exec ? (
            <ExecView data={report.exec} months={months} insights={report.insights} href={href} />
          ) : report.manager ? (
            <ManagerView
              data={report.manager}
              months={months}
              sales={report.salesDate !== null}
              insights={report.insights}
              href={href}
              personHref={(person) => connectHref("/connect", q, { view: "executor", person })}
              link={
                canLead
                  ? {
                      action: linkConnectPositionAction,
                      users,
                      links: access.positions.links,
                      back: connectHref("/connect", q),
                    }
                  : undefined
              }
            />
          ) : report.executor ? (
            <ExecutorView
              data={report.executor}
              months={months}
              insights={report.insights}
              href={href}
            />
          ) : report.executors ? (
            <ExecutorsOverview
              rows={report.executors}
              personHref={(person) => connectHref("/connect", q, { person })}
              link={
                canLead
                  ? {
                      action: linkConnectPersonAction,
                      users,
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
