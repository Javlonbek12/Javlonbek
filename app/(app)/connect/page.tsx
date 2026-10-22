import { FileSpreadsheet, Presentation, Upload } from "lucide-react";
import Link from "next/link";

import { ExecView } from "@/components/connect/exec-view";
import { ExecutorView } from "@/components/connect/executor-view";
import { ManagerView } from "@/components/connect/manager-view";
import { Button } from "@/components/ui/button";
import { Card, CardDescription } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { dateFormat, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  buildConnectReport,
  connectHref,
  monthLabel,
  parseConnectQuery,
  periodLabel,
  VIEWS,
} from "@/modules/connect/report";
import { canLeadConnect, lastImports } from "@/modules/connect/service";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";

// Connect bot analytics on three levels: leadership, managers, executors.
export default async function ConnectPage({ searchParams }: PageProps<"/connect">) {
  const user = await requireUser();
  const canLead = canLeadConnect(user);
  const query = parseConnectQuery(await searchParams, canLead);
  const [report, imports] = await Promise.all([
    buildConnectReport(query, await getUserToday(user.id)),
    lastImports(1),
  ]);
  const q = report.query;
  const views = canLead ? VIEWS : (["executor"] as const);
  const lastImport = imports[0];

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-medium md:text-2xl">{t("connect.title")}</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">{t("connect.intro")}</p>
          {lastImport && (
            <p className="text-muted-foreground text-xs">
              {t("connect.updated", {
                date: dateFormat({ dateStyle: "medium", timeStyle: "short" }).format(
                  lastImport.createdAt,
                ),
              })}
            </p>
          )}
        </div>
        {canLead && (
          <Button asChild variant="outline" size="sm">
            <Link href="/connect/import">
              <Upload />
              {t("connect.import.link")}
            </Link>
          </Button>
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
                  href={connectHref("/connect", q, { view })}
                  className={cn(
                    "-mb-px flex flex-col border-b-2 px-3 py-2",
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

          <form
            action="/connect"
            className="flex flex-wrap items-end gap-x-3 gap-y-2 text-sm [&_label]:flex [&_label]:flex-col [&_label]:gap-1"
          >
            <input type="hidden" name="view" value={q.view} />
            {q.view === "executor" && (
              <label className="w-full sm:w-auto">
                <span className="text-muted-foreground text-xs">{t("connect.filters.person")}</span>
                <NativeSelect name="person" defaultValue={q.person ?? ""} className="sm:max-w-80">
                  <option value="">{t("connect.executor.pick")}</option>
                  {report.people.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            <label>
              <span className="text-muted-foreground text-xs">{t("connect.filters.from")}</span>
              <NativeSelect name="from" defaultValue={q.filter.from ?? ""}>
                <option value="">{t("connect.filters.all")}</option>
                {report.facets.months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              <span className="text-muted-foreground text-xs">{t("connect.filters.to")}</span>
              <NativeSelect name="to" defaultValue={q.filter.to ?? ""}>
                <option value="">{t("connect.filters.all")}</option>
                {report.facets.months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              <span className="text-muted-foreground text-xs">{t("connect.filters.city")}</span>
              <NativeSelect name="city" defaultValue={q.filter.city ?? ""} className="max-w-44">
                <option value="">{t("connect.filters.all")}</option>
                {report.facets.cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              <span className="text-muted-foreground text-xs">{t("connect.filters.channel")}</span>
              <NativeSelect
                name="channel"
                defaultValue={q.filter.channel ?? ""}
                className="max-w-40"
              >
                <option value="">{t("connect.filters.all")}</option>
                {report.facets.channels.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Button type="submit" size="sm">
              {t("connect.filters.apply")}
            </Button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">
              {periodLabel(report)} · {t("connect.testNote")}
            </span>
            {!report.empty && (q.view !== "executor" || q.person) && (
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={connectHref("/api/connect/xlsx", q)} download>
                    <FileSpreadsheet />
                    {t("connect.download.xlsx")}
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={connectHref("/api/connect/pptx", q)} download>
                    <Presentation />
                    {t("connect.download.pptx")}
                  </a>
                </Button>
              </div>
            )}
          </div>

          {report.empty ? (
            <Card>
              <CardDescription>{t("connect.emptyFilter")}</CardDescription>
            </Card>
          ) : report.exec ? (
            <ExecView data={report.exec} />
          ) : report.manager ? (
            <ManagerView
              data={report.manager}
              personHref={(person) => connectHref("/connect", q, { view: "executor", person })}
            />
          ) : report.executor && q.person ? (
            <ExecutorView person={q.person} data={report.executor} />
          ) : (
            <Card>
              <CardDescription>
                {report.people.length ? t("connect.executor.pick") : t("connect.executor.none")}
              </CardDescription>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
