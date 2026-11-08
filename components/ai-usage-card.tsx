import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { addMonths, formatMonth, fromDateString, startOfMonth } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { intlLocale, t } from "@/lib/i18n";
import { isKnownFunction, monthlyAiCost } from "@/modules/ops/ai-cost";

export function usd(value: number) {
  const format = (n: number) =>
    new Intl.NumberFormat(intlLocale(), {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(n);
  return value > 0 && value < 0.01 ? `< ${format(0.01)}` : `≈ ${format(value)}`;
}

const count = (n: number) => new Intl.NumberFormat(intlLocale()).format(n);

// OWNER-only: what the AI cost this month, in plain names and approximate dollars, next to the
// last month and the daily limit.
export async function AiUsageCard({ today }: { today: string }) {
  const month = startOfMonth(today);
  const usage = await monthlyAiCost(
    fromDateString(month),
    fromDateString(addMonths(month, 1)),
    fromDateString(addMonths(month, -1)),
  );
  const fnName = (fn: string) => (isKnownFunction(fn) ? t(`settings.ai.fns.${fn}`) : fn);

  return (
    <Card className="gap-3">
      <CardTitle>{t("settings.ai.title", { month: formatMonth(month) })}</CardTitle>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums">{usd(usage.total.cost)}</span>
        <span className="text-muted-foreground text-sm">
          {t("settings.ai.calls", { count: count(usage.total.calls) })} ·{" "}
          {t("settings.ai.previous", { sum: usd(usage.previousCost) })}
        </span>
      </div>
      <CardDescription>
        {t("settings.ai.limit", { limit: getEnv().AI_DAILY_LIMIT })} {t("settings.ai.estimate")}
      </CardDescription>
      {usage.total.calls === 0 ? (
        <p className="text-muted-foreground text-sm">{t("settings.ai.empty")}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(
            [
              [
                "settings.ai.byFunction",
                usage.functions.map((r) => ({ ...r, name: fnName(r.fn) })),
              ],
              ["settings.ai.byPerson", usage.people],
            ] as const
          ).map(([title, rows]) => (
            <table key={title} className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="py-1 pr-2 font-normal">{t(title)}</th>
                  <th className="py-1 pr-2 text-right font-normal">
                    {t("settings.ai.callsShort")}
                  </th>
                  <th className="py-1 text-right font-normal">{t("settings.ai.sum")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.name}
                    className="border-t"
                    title={t("settings.ai.tokens", {
                      input: count(r.inputTokens),
                      output: count(r.outputTokens),
                    })}
                  >
                    <td className="py-1 pr-2">{r.name}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{count(r.calls)}</td>
                    <td className="py-1 text-right whitespace-nowrap tabular-nums">
                      {usd(r.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}
    </Card>
  );
}
