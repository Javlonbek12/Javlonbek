import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PlanExecution } from "@/modules/content/execution";

import { BOT_COLOR } from "./bot-chip";

function Tile({
  label,
  value,
  note,
  alarm,
}: {
  label: string;
  value: number;
  note?: string;
  // Posts that missed their day: the one number in red.
  alarm?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border p-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span
        className={cn(
          "font-display text-2xl font-semibold tabular-nums",
          alarm && value > 0 && "text-destructive",
        )}
      >
        {value}
      </span>
      {note && <span className="text-muted-foreground text-xs">{note}</span>}
    </div>
  );
}

// «Выполнение плана»: the first thing content analytics answers — how the plan was carried out.
// Counts are written as «2 из 3», not as percentages: on a few posts a percentage only alarms.
export function ExecutionBlock({ data }: { data: PlanExecution }) {
  const of = (part: number, whole: number) => t("content.analytics.execution.of", { part, whole });
  return (
    <Card className="gap-3">
      <div className="flex flex-wrap items-center gap-x-1">
        <CardTitle>{t("content.analytics.execution.title")}</CardTitle>
        <InfoHint>{t("content.analytics.execution.hint")}</InfoHint>
      </div>
      {data.due === 0 && data.ahead === 0 ? (
        <CardDescription>{t("content.analytics.execution.empty")}</CardDescription>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            <Tile label={t("content.analytics.execution.due")} value={data.due} />
            <Tile
              label={t("content.analytics.execution.sent")}
              value={data.sent}
              note={`${t("content.analytics.execution.onTime")}: ${of(data.onTime, data.sent)}`}
            />
            <Tile label={t("content.analytics.execution.late")} value={data.late} />
            <Tile label={t("content.analytics.execution.notSent")} value={data.notSent} alarm />
            <Tile
              label={t("content.analytics.execution.returned")}
              value={data.returnedPosts}
              note={t("content.analytics.execution.returnedHint", {
                review: data.returnsReview,
                legal: data.returnsLegal,
              })}
            />
            <Tile label={t("content.analytics.execution.cancelled")} value={data.cancelled} />
            <Tile label={t("content.analytics.execution.ahead")} value={data.ahead} />
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {data.byBot
              .filter((b) => b.planned > 0)
              .map((b) => (
                <li key={b.channel} className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: BOT_COLOR[b.channel] }}
                  />
                  {t("content.analytics.execution.byBot", {
                    bot: t(`content.channels.${b.channel}`),
                    sent: of(b.sent, b.planned),
                  })}
                </li>
              ))}
          </ul>

          {data.byAuthor.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t("content.analytics.execution.byAuthor")}</h3>
              {/* Phones: one card per author. */}
              <ul className="flex flex-col gap-2 md:hidden">
                {data.byAuthor.map((a) => (
                  <li key={a.id ?? "none"} className="rounded-xl border p-3 text-sm">
                    <span className="font-medium">
                      {a.name ?? t("content.analytics.execution.noAuthor")}
                    </span>
                    <dl className="text-muted-foreground mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                      <dt>{t("content.analytics.execution.sent")}</dt>
                      <dd className="text-foreground tabular-nums">{of(a.sent, a.due)}</dd>
                      <dt>{t("content.analytics.execution.onTime")}</dt>
                      <dd className="text-foreground tabular-nums">{of(a.onTime, a.sent)}</dd>
                      <dt>{t("content.analytics.execution.lateOrNot")}</dt>
                      <dd
                        className={cn(
                          "tabular-nums",
                          a.notSent ? "text-destructive font-medium" : "text-foreground",
                        )}
                      >
                        {a.late} / {a.notSent}
                      </dd>
                      <dt>{t("content.analytics.execution.returns")}</dt>
                      <dd className="text-foreground tabular-nums">
                        {a.returnsReview} / {a.returnsLegal}
                      </dd>
                    </dl>
                  </li>
                ))}
              </ul>
              <table className="hidden w-full text-sm md:table">
                <thead className="text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">
                      {t("content.analytics.execution.author")}
                    </th>
                    <th className="px-2 py-1.5 text-right font-medium">
                      {t("content.analytics.execution.due")}
                    </th>
                    <th className="px-2 py-1.5 text-right font-medium">
                      {t("content.analytics.execution.sent")}
                    </th>
                    <th className="px-2 py-1.5 text-right font-medium">
                      {t("content.analytics.execution.onTime")}
                    </th>
                    <th className="px-2 py-1.5 text-right font-medium">
                      {t("content.analytics.execution.late")}
                    </th>
                    <th className="px-2 py-1.5 text-right font-medium">
                      {t("content.analytics.execution.notSent")}
                    </th>
                    <th className="px-2 py-1.5 text-right font-medium">
                      {t("content.analytics.execution.returnsColumn")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.byAuthor.map((a) => (
                    <tr key={a.id ?? "none"} className="border-t">
                      <td className="py-1.5 pr-2">
                        {a.name ?? t("content.analytics.execution.noAuthor")}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{a.due}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{a.sent}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {of(a.onTime, a.sent)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{a.late}</td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right tabular-nums",
                          a.notSent > 0 && "text-destructive font-medium",
                        )}
                      >
                        {a.notSent}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {a.returnsReview} / {a.returnsLegal}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
