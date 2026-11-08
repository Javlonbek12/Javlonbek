import { Download, FileSpreadsheet } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { menuItem, MoreMenu } from "@/components/content/more-menu";
import { RememberPeriod } from "@/components/reports/remember-period";
import { WeeklyChart } from "@/components/reports/weekly-chart";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PeriodPicker } from "@/components/ui/period-picker";
import { formatDay, todayInTimezone } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { deniedHref } from "@/modules/core/access/guard";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { canSeeReports } from "@/modules/reports/access";
import { buildReport } from "@/modules/reports/data";
import { reportExtras } from "@/modules/reports/extras";
import { formatRange } from "@/modules/reports/format";
import {
  parsePeriod,
  PERIOD_COOKIE,
  periodCookieValue,
  presetPeriod,
  PRESETS,
  rememberedPeriod,
} from "@/modules/reports/period";
import {
  changeNote as vs,
  formatDays,
  formatReportDate,
  highlights,
} from "@/modules/reports/summary";

function Tile({
  label,
  value,
  note,
  bad,
  href,
}: {
  label: string;
  value: string;
  note?: React.ReactNode;
  // The change is for the worse (e.g. tasks take longer): the note says so in amber.
  bad?: boolean;
  // A number «right now» opens the task list with that filter.
  href?: string;
}) {
  const body = (
    <>
      <CardDescription className="text-xs">{label}</CardDescription>
      <p className="font-display text-2xl font-semibold tabular-nums">{value}</p>
      {note && (
        <p
          className={cn(
            "text-xs",
            bad ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground",
          )}
          title={bad ? t("reports.kpi.worse") : undefined}
        >
          {note}
        </p>
      )}
    </>
  );
  return (
    <Card className={cn("gap-1 p-4", href && "hover:border-primary/40 transition-colors")}>
      {href ? (
        <Link href={href} className="flex flex-col gap-1">
          {body}
          <span className="text-primary text-xs">{t("reports.openList")}</span>
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

// The task list of the whole team, with a ready filter.
const tasksHref = (params: Record<string, string>) =>
  `/tasks?${new URLSearchParams({ scope: "team", ...params })}`;

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const user = await requireUser();
  if (!canSeeReports(user)) redirect(deniedHref("reports"));
  const { timezone } = await getSettings(user.id);
  const today = todayInTimezone(timezone);
  const params = await searchParams;
  // Without a period in the address: the one chosen last time.
  const asked = params.preset || params.from || params.to;
  const period = parsePeriod(
    asked ? params : rememberedPeriod((await cookies()).get(PERIOD_COOKIE)?.value, user.id),
    today,
  );
  const [report, extras] = await Promise.all([
    buildReport(period, timezone),
    reportExtras(user, period, today, timezone),
  ]);
  const query = period.preset ? `preset=${period.preset}` : `from=${period.from}&to=${period.to}`;
  const { kpis: k, previousKpis: p, now } = report;
  const pct = (value: number | null) => (value === null ? "—" : `${value}%`);

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <RememberPeriod name={PERIOD_COOKIE} value={periodCookieValue(user.id, period)} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-medium md:text-2xl">{t("reports.title")}</h1>
          {/* On screen the period picker below shows the dates; the printed page needs them here. */}
          <p className="text-muted-foreground hidden text-sm print:block">
            {t("reports.subtitle", {
              from: formatReportDate(period.from),
              to: formatReportDate(period.to),
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild>
            <a href={`/api/reports/pdf?${query}`}>
              <Download className="size-4" /> {t("reports.pdf")}
            </a>
          </Button>
          <MoreMenu label={t("reports.more")}>
            <a href={`/api/reports/xlsx?${query}`} className={menuItem}>
              <FileSpreadsheet />
              {t("reports.excel")}
            </a>
          </MoreMenu>
        </div>
      </div>

      <PeriodPicker
        chips={PRESETS.map((preset) => {
          const range = presetPeriod(preset, today);
          return {
            key: preset,
            label: t(`reports.presets.${preset}`),
            href: `/reports?preset=${preset}`,
            dates: formatRange(range.from, range.to, today),
          };
        })}
        active={period.preset}
        dates={formatRange(period.from, period.to, today)}
        custom={{
          label: t("reports.customDates"),
          apply: t("reports.show"),
          fromLabel: t("reports.from"),
          toLabel: t("reports.to"),
          type: "date",
          from: period.from,
          to: period.to,
          action: "/reports",
        }}
      />

      {/* «Главное» for the whole group: tasks, the content plan and Connect side by side. */}
      <div
        className={cn(
          "grid gap-4 [&>*]:min-w-0",
          extras.length === 2 ? "lg:grid-cols-3" : extras.length === 1 && "lg:grid-cols-2",
        )}
      >
        <Card className="gap-2">
          <CardTitle>{t("reports.summaryTasks")}</CardTitle>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {highlights(report).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Link href={tasksHref({})} className="text-primary mt-auto text-sm">
            {t("reports.openTasks")} →
          </Link>
        </Card>
        {extras.map((part) => (
          <Card key={part.href} className="gap-2">
            <CardTitle>{part.title}</CardTitle>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {part.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <Link href={part.href} className="text-primary mt-auto text-sm">
              {part.open} →
            </Link>
          </Card>
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-muted-foreground text-sm font-medium">{t("reports.forPeriod")}</h2>
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
            value={pct(k.onTimePercent)}
            note={vs(k.onTimePercent, p.onTimePercent, "points")}
          />
          <Tile
            label={t("reports.kpi.averageDays")}
            value={k.averageDays === null ? "—" : formatDays(k.averageDays)}
            note={vs(k.averageDays, p.averageDays, "days")}
            // Longer than before is worse.
            bad={k.averageDays !== null && p.averageDays !== null && k.averageDays > p.averageDays}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {t("reports.compared", {
            from: formatReportDate(report.previous.from),
            to: formatReportDate(report.previous.to),
          })}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-muted-foreground text-sm font-medium">{t("reports.rightNow")}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label={t("reports.kpi.active")}
            value={String(now.active)}
            href={tasksHref({ status: "active" })}
          />
          <Tile
            label={t("reports.kpi.overdue")}
            value={String(now.overdue)}
            note={t("reports.kpi.overdueHint", { count: now.overdueHigh })}
            href={tasksHref({ due: "overdue" })}
          />
          <Tile
            label={t("reports.kpi.waiting")}
            value={String(now.waitingApproval + now.inReview)}
            note={t("reports.kpi.waitingHint", {
              approval: now.waitingApproval,
              review: now.inReview,
            })}
            href={tasksHref({ status: now.inReview ? "IN_REVIEW" : "PENDING_APPROVAL" })}
          />
          <Tile
            label={t("reports.kpi.meetings")}
            value={String(report.meetings.held)}
            note={t("reports.other.meetingTasks", { count: report.meetings.tasksFromMeetings })}
          />
        </div>
      </section>

      <Card>
        <WeeklyChart weeks={report.weeks} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card className="gap-2">
          <CardTitle>{t("reports.people.title")}</CardTitle>
          {report.people.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("reports.people.empty")}</p>
          ) : (
            <>
              {/* Phones: a card per person, «now» and «for the period» apart. */}
              <ul className="flex flex-col gap-2 md:hidden">
                {report.people.map((x) => (
                  <li key={x.id} className="rounded-xl border p-3 text-sm">
                    <Link
                      className="text-primary font-medium underline underline-offset-2"
                      href={tasksHref({ person: x.id })}
                    >
                      {x.name}
                    </Link>
                    {x.position && (
                      <span className="text-muted-foreground block text-xs">{x.position}</span>
                    )}
                    <dl className="mt-1.5 grid grid-cols-2 gap-x-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">{t("reports.rightNow")}</dt>
                        <dd>
                          {t("reports.people.active")}: {x.active} ·{" "}
                          <span className={cn(x.overdue > 0 && "text-destructive font-medium")}>
                            {t("reports.people.overdue")}: {x.overdue}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t("reports.forPeriod")}</dt>
                        <dd>
                          {t("reports.people.completed")}: {x.completed} ·{" "}
                          {t("reports.people.onTime")}: {pct(x.onTimePercent)}
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
              <div className="-mx-2 hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-xs">
                    <tr>
                      <th />
                      <th colSpan={2} className="border-b px-2 pt-1 text-center font-medium">
                        {t("reports.rightNow")}
                      </th>
                      <th colSpan={2} className="border-b px-2 pt-1 text-center font-medium">
                        {t("reports.forPeriod")}
                      </th>
                    </tr>
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">
                        {t("reports.people.name")}
                      </th>
                      <th className="px-2 py-1 text-right font-medium">
                        {t("reports.people.active")}
                      </th>
                      <th className="px-2 py-1 text-right font-medium">
                        {t("reports.people.overdue")}
                      </th>
                      <th className="px-2 py-1 text-right font-medium">
                        {t("reports.people.completed")}
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
                          <Link className="hover:underline" href={tasksHref({ person: x.id })}>
                            {x.name}
                          </Link>
                          {x.position && (
                            <span className="text-muted-foreground block text-xs">
                              {x.position}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{x.active}</td>
                        <td
                          className={cn(
                            "px-2 py-1.5 text-right tabular-nums",
                            x.overdue > 0 && "text-destructive font-semibold",
                          )}
                        >
                          {x.overdue}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{x.completed}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {pct(x.onTimePercent)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
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
                  <span className="text-destructive shrink-0 text-xs font-semibold tabular-nums">
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
            <ul className="flex flex-col gap-2 md:hidden">
              {report.projects.map((x) => (
                <li key={x.name ?? ""} className="rounded-xl border p-3 text-sm">
                  <span className="font-medium">{x.name ?? t("reports.projects.none")}</span>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("reports.rightNow")}: {t("reports.people.active")} {x.active} ·{" "}
                    {t("reports.people.overdue")} {x.overdue}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t("reports.forPeriod")}: {t("reports.people.completed")} {x.completed}
                  </p>
                </li>
              ))}
            </ul>
            <div className="-mx-2 hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr>
                    <th />
                    <th colSpan={2} className="border-b px-2 pt-1 text-center font-medium">
                      {t("reports.rightNow")}
                    </th>
                    <th className="border-b px-2 pt-1 text-center font-medium">
                      {t("reports.forPeriod")}
                    </th>
                  </tr>
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">
                      {t("reports.projects.name")}
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      {t("reports.people.active")}
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      {t("reports.people.overdue")}
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      {t("reports.people.completed")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.projects.map((x) => (
                    <tr key={x.name ?? ""} className="border-t">
                      <td className="px-2 py-1.5">{x.name ?? t("reports.projects.none")}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{x.active}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{x.overdue}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{x.completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card className="gap-2">
          <CardTitle>{t("reports.upcoming.title")}</CardTitle>
          <p className="text-muted-foreground text-xs">
            {t("reports.other.planogramsApproved", { count: report.planograms.approved })} ·{" "}
            {t("reports.other.planogramsPending", { count: report.planograms.pending })}
          </p>
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
        </Card>
      </div>
    </div>
  );
}
