import { Download } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { WeeklyChart } from "@/components/reports/weekly-chart";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDay, todayInTimezone } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { deniedHref } from "@/modules/core/access/guard";
import { canOpenPath } from "@/modules/core/access/paths";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { canSeeReports } from "@/modules/reports/access";
import { buildReport } from "@/modules/reports/data";
import { parsePeriod, PRESETS } from "@/modules/reports/period";
import { changeNote as vs, formatReportDate, highlights } from "@/modules/reports/summary";

function Tile({
  label,
  value,
  note,
  bad,
}: {
  label: string;
  value: string;
  note?: string;
  // The change is for the worse (e.g. tasks take longer): the note is red.
  bad?: boolean;
}) {
  return (
    <Card className="gap-1 p-4">
      <CardDescription className="text-xs">{label}</CardDescription>
      <p className="font-display text-2xl font-semibold tabular-nums">{value}</p>
      {note && (
        <p
          className={cn("text-xs", bad ? "text-destructive font-medium" : "text-muted-foreground")}
          title={bad ? t("reports.kpi.worse") : undefined}
        >
          {note}
        </p>
      )}
    </Card>
  );
}

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const user = await requireUser();
  if (!canSeeReports(user)) redirect(deniedHref("reports"));
  // Names lead to the employee card only for those who can open the team section.
  const seesTeam = canOpenPath(user, "/team/x");
  const { timezone } = await getSettings(user.id);
  const period = parsePeriod(await searchParams, todayInTimezone(timezone));
  const report = await buildReport(period, timezone);
  const query = period.preset ? `preset=${period.preset}` : `from=${period.from}&to=${period.to}`;
  const { kpis: k, previousKpis: p, now } = report;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-medium md:text-2xl">{t("reports.title")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("reports.subtitle", {
              from: formatReportDate(period.from),
              to: formatReportDate(period.to),
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href={`/api/reports/pdf?${query}`}>
              <Download className="size-4" /> {t("reports.pdf")}
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={`/api/reports/xlsx?${query}`}>
              <Download className="size-4" /> {t("reports.excel")}
            </a>
          </Button>
        </div>
      </div>

      {/* Period: presets in one row, custom dates next to them. */}
      <div className="flex flex-wrap items-end gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            asChild
            size="sm"
            variant={period.preset === preset ? "default" : "outline"}
          >
            <Link href={`/reports?preset=${preset}`}>{t(`reports.presets.${preset}`)}</Link>
          </Button>
        ))}
        <form className="flex flex-wrap items-end gap-2">
          <label className="text-muted-foreground flex flex-col text-xs">
            {t("reports.from")}
            <Input type="date" name="from" defaultValue={period.from} className="w-40" />
          </label>
          <label className="text-muted-foreground flex flex-col text-xs">
            {t("reports.to")}
            <Input type="date" name="to" defaultValue={period.to} className="w-40" />
          </label>
          <Button type="submit" size="sm" variant="outline">
            {t("reports.show")}
          </Button>
        </form>
      </div>

      <Card className="gap-2">
        <CardTitle>{t("reports.summary")}</CardTitle>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {highlights(report).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label={t("reports.kpi.completed")}
          value={String(k.completed)}
          note={vs(k.completed, p.completed)}
        />
        <Tile
          label={t("reports.kpi.created")}
          value={String(k.created)}
          note={vs(k.created, p.created)}
        />
        <Tile
          label={t("reports.kpi.onTime")}
          value={k.onTimePercent === null ? "—" : `${k.onTimePercent}%`}
          note={vs(k.onTimePercent, p.onTimePercent, true)}
        />
        <Tile
          label={t("reports.kpi.averageDays")}
          value={k.averageDays === null ? "—" : t("reports.kpi.days", { value: k.averageDays })}
          note={vs(k.averageDays, p.averageDays)}
          // Longer than before is worse.
          bad={k.averageDays !== null && p.averageDays !== null && k.averageDays > p.averageDays}
        />
        <Tile label={t("reports.kpi.active")} value={String(now.active)} />
        <Tile
          label={t("reports.kpi.overdue")}
          value={String(now.overdue)}
          note={t("reports.kpi.overdueHint", { count: now.overdueHigh })}
        />
        <Tile
          label={t("reports.kpi.waiting")}
          value={String(now.waitingApproval + now.inReview)}
          note={t("reports.kpi.waitingHint", {
            approval: now.waitingApproval,
            review: now.inReview,
          })}
        />
        <Tile
          label={t("reports.kpi.meetings")}
          value={String(report.meetings.held)}
          note={t("reports.other.meetingTasks", { count: report.meetings.tasksFromMeetings })}
        />
      </div>

      <p className="text-muted-foreground -mt-2 text-xs">
        {t("reports.compared", {
          from: formatReportDate(report.previous.from),
          to: formatReportDate(report.previous.to),
        })}
      </p>

      <Card>
        <WeeklyChart weeks={report.weeks} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card className="gap-2">
          <CardTitle>{t("reports.people.title")}</CardTitle>
          {report.people.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("reports.people.empty")}</p>
          ) : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">{t("reports.people.name")}</th>
                    <th className="px-2 py-1 text-right font-medium">
                      {t("reports.people.active")}
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      {t("reports.people.completed")}
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      {t("reports.people.overdue")}
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      {t("reports.people.onTime")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.people.map((x) => (
                    <tr key={x.id} className="border-t">
                      <td className="px-2 py-1.5">
                        {seesTeam ? (
                          <Link className="hover:underline" href={`/team/${x.id}`}>
                            {x.name}
                          </Link>
                        ) : (
                          x.name
                        )}
                        {x.position && (
                          <span className="text-muted-foreground block text-xs">{x.position}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{x.active}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{x.completed}</td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right tabular-nums",
                          x.overdue > 0 && "font-semibold",
                        )}
                      >
                        {x.overdue}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {x.onTimePercent === null ? "—" : `${x.onTimePercent}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="gap-2">
          <CardTitle>{t("reports.risks.title")}</CardTitle>
          {report.overdueTasks.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("reports.risks.empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {report.overdueTasks.slice(0, 10).map((task) => (
                <li key={task.id} className="flex items-start justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <Link className="hover:underline" href={`/tasks/${task.id}`}>
                      {task.title}
                    </Link>
                    <span className="text-muted-foreground block text-xs">
                      {task.assignee} · {t(`tasks.priority.${task.priority}`)} ·{" "}
                      {formatDay(task.due!)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">
                    {t("reports.risks.days", { days: task.daysOverdue })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {report.projects.length > 0 && (
          <Card className="gap-2">
            <CardTitle>{t("reports.projects.title")}</CardTitle>
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">
                      {t("reports.projects.name")}
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      {t("reports.people.active")}
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      {t("reports.people.completed")}
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      {t("reports.people.overdue")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.projects.map((x) => (
                    <tr key={x.name ?? ""} className="border-t">
                      <td className="px-2 py-1.5">{x.name ?? t("reports.projects.none")}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{x.active}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{x.completed}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{x.overdue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card className="gap-2">
          <CardTitle>{t("reports.upcoming.title")}</CardTitle>
          {report.upcoming.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("reports.upcoming.empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {report.upcoming.slice(0, 10).map((task) => (
                <li key={task.id} className="flex items-start justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <Link className="hover:underline" href={`/tasks/${task.id}`}>
                      {task.title}
                    </Link>
                    <span className="text-muted-foreground block text-xs">
                      {task.assignee} · {t(`tasks.priority.${task.priority}`)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums">{formatDay(task.due!)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground border-t pt-2 text-xs">
            {t("reports.other.planogramsApproved", { count: report.planograms.approved })} ·{" "}
            {t("reports.other.planogramsPending", { count: report.planograms.pending })}
          </p>
        </Card>
      </div>
    </div>
  );
}
