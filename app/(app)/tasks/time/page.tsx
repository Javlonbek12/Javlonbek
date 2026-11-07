import { Download } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/tasks/task-badges";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { todayInTimezone } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { parsePeriod, PRESETS } from "@/modules/reports/period";
import { formatReportDate } from "@/modules/reports/summary";
import { durationText } from "@/modules/tasks/time-format";
import { getTimeReport } from "@/modules/tasks/time-report";

const duration = (minutes: number) => {
  const { key, values } = durationText(minutes);
  return t(key, values);
};

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="gap-1 p-4">
      <CardDescription className="text-xs">{label}</CardDescription>
      <p className="font-display text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

export default async function TimeReportPage({ searchParams }: PageProps<"/tasks/time">) {
  const user = await requireUser();
  const { timezone } = await getSettings(user.id);
  const period = parsePeriod(await searchParams, todayInTimezone(timezone));
  const report = await getTimeReport(user, period, timezone);
  const query = period.preset ? `preset=${period.preset}` : `from=${period.from}&to=${period.to}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">{t("tasks.timeReport.title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("tasks.timeReport.subtitle", {
              from: formatReportDate(period.from),
              to: formatReportDate(period.to),
            })}
          </p>
        </div>
        {report.totalMinutes > 0 && (
          <Button asChild variant="outline">
            <a href={`/api/tasks/time-report?${query}`}>
              <Download className="size-4" /> {t("tasks.timeReport.excel")}
            </a>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            asChild
            size="sm"
            variant={period.preset === preset ? "default" : "outline"}
          >
            <Link href={`/tasks/time?preset=${preset}`}>{t(`reports.presets.${preset}`)}</Link>
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

      <div className="grid grid-cols-3 gap-3">
        <Tile label={t("tasks.timeReport.total")} value={duration(report.totalMinutes)} />
        <Tile label={t("tasks.timeReport.people")} value={String(report.people.length)} />
        <Tile label={t("tasks.timeReport.tasks")} value={String(report.taskCount)} />
      </div>

      {report.people.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("tasks.timeReport.empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {report.people.map((person) => {
            const percent = Math.round((person.minutes / report.totalMinutes) * 100);
            return (
              <Card key={person.id} className="gap-2 p-0">
                <details>
                  <summary className="flex cursor-pointer list-none flex-col gap-2 p-4 [&::-webkit-details-marker]:hidden">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <CardTitle className="text-base">{person.name}</CardTitle>
                      <span className="font-medium tabular-nums">{duration(person.minutes)}</span>
                    </span>
                    <Progress value={percent} />
                    <span className="text-muted-foreground text-xs">
                      {t("tasks.timeReport.share", { percent })} ·{" "}
                      {t("tasks.timeReport.taskCount", { count: person.tasks.length })}
                    </span>
                  </summary>
                  <ul className="flex flex-col border-t">
                    {person.tasks.map((task) => (
                      <li key={task.id} className="border-b last:border-b-0">
                        <Link
                          href={`/tasks/${task.id}`}
                          className="hover:bg-accent/50 flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm"
                        >
                          <span className="min-w-0 flex-1 truncate">{task.title}</span>
                          <StatusBadge status={task.status} />
                          <span className="tabular-nums">
                            {duration(task.minutes)}
                            {task.estimateMinutes ? (
                              <span className="text-muted-foreground">
                                {" "}
                                {t("tasks.time.ofEstimate", {
                                  estimate: duration(task.estimateMinutes),
                                })}
                              </span>
                            ) : null}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              </Card>
            );
          })}
        </div>
      )}
      <p className="text-muted-foreground text-xs">{t("tasks.timeReport.hint")}</p>
    </div>
  );
}
