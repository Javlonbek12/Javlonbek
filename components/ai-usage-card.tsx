import { Card, CardTitle } from "@/components/ui/card";
import { addMonths, formatMonth, fromDateString, startOfMonth } from "@/lib/dates";
import { t, intlLocale } from "@/lib/i18n";
import { getMonthlyUsage } from "@/modules/ai/run";
import { displayName } from "@/modules/core/users/display-name";

const nf = { format: (n: number) => new Intl.NumberFormat(intlLocale()).format(n) };

// OWNER-only: AI usage for the current month, by person and prompt function.
export async function AiUsageCard({ today }: { today: string }) {
  const month = startOfMonth(today);
  const rows = await getMonthlyUsage(fromDateString(month), fromDateString(addMonths(month, 1)));
  const total = rows.reduce(
    (sum, r) => ({
      calls: sum.calls + r.calls,
      input: sum.input + r.inputTokens,
      output: sum.output + r.outputTokens,
    }),
    { calls: 0, input: 0, output: 0 },
  );

  return (
    <Card className="gap-3">
      <CardTitle>{t("ai.usage.title", { month: formatMonth(month) })}</CardTitle>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("ai.usage.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="py-1 pr-2 font-normal">{t("ai.usage.user")}</th>
                <th className="py-1 pr-2 font-normal">{t("ai.usage.fn")}</th>
                <th className="py-1 pr-2 text-right font-normal">{t("ai.usage.calls")}</th>
                <th className="py-1 text-right font-normal">{t("ai.usage.tokens")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.user.id}-${r.fn}`} className="border-t">
                  <td className="py-1 pr-2">{displayName(r.user)}</td>
                  <td className="py-1 pr-2">{r.fn}</td>
                  <td className="py-1 pr-2 text-right">{nf.format(r.calls)}</td>
                  <td className="py-1 text-right whitespace-nowrap">
                    {nf.format(r.inputTokens)} / {nf.format(r.outputTokens)}
                  </td>
                </tr>
              ))}
              <tr className="border-t font-medium">
                <td className="py-1 pr-2" colSpan={2}>
                  {t("ai.usage.total")}
                </td>
                <td className="py-1 pr-2 text-right">{nf.format(total.calls)}</td>
                <td className="py-1 text-right whitespace-nowrap">
                  {nf.format(total.input)} / {nf.format(total.output)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
