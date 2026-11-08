import { t } from "@/lib/i18n";
import { connectKpis } from "@/modules/connect/analytics";
import { formatMoney, monthLabel } from "@/modules/connect/report";
import { canSeeConnect, connectDataDate, loadDataset } from "@/modules/connect/service";
import { loadExecution, planExecution } from "@/modules/content/execution";
import { canUseModule } from "@/modules/core/access/actor";
import type { Actor } from "@/modules/core/permissions";

import { formatRange, plural } from "./format";
import type { Period } from "./period";

// The report's «Главное» beyond tasks: the content plan and Connect, for whoever has those
// sections. Plain lines, the same on the page and in the PDF.

export type ReportPart = { title: string; lines: string[]; href: string; open: string };

async function contentPart(
  viewer: Actor,
  period: Period,
  today: string,
  timezone: string,
): Promise<ReportPart> {
  const posts = (await loadExecution(viewer, period.from, today, timezone)).filter(
    (p) => p.publishDate <= period.to,
  );
  const e = planExecution(posts, today);
  const lines =
    e.due === 0
      ? [t("reports.content.none")]
      : [
          t("reports.content.sent", {
            sent: e.onTime,
            due: plural("content.analytics.postsCount", e.due),
          }),
          ...(e.late ? [t("reports.content.late", { count: e.late })] : []),
          e.notSent
            ? t("reports.content.notSent", { count: e.notSent })
            : t("reports.content.allSent"),
          ...(e.returnedPosts ? [t("reports.content.returned", { count: e.returnedPosts })] : []),
        ];
  return {
    title: t("reports.content.title"),
    lines,
    href: "/content-analytics",
    open: t("reports.content.open"),
  };
}

async function connectPart(period: Period, today: string): Promise<ReportPart> {
  const from = period.from.slice(0, 7);
  const to = period.to.slice(0, 7);
  const [data, dataDate] = await Promise.all([loadDataset({ from, to }), connectDataDate()]);
  const k = connectKpis(data);
  const months = from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`;
  const fresh = dataDate
    ? t("reports.connect.dataDate", { date: formatRange(dataDate, dataDate, today) })
    : null;
  const empty = !data.oos.length && !data.orders.length && !data.payments.length;
  const lines = empty
    ? [t("reports.connect.none", { months }), ...(fresh ? [fresh] : [])]
    : [
        t("reports.connect.months", { months }) + (fresh ? ` · ${fresh}` : ""),
        ...(data.oos.length ? [t("reports.connect.gaps", { rate: k.gapRate })] : []),
        ...(data.orders.length ? [t("reports.connect.noAnswer", { rate: k.noAnswerRate })] : []),
        ...(k.waiting
          ? [
              t("reports.connect.waiting", {
                count: plural("connect.words.requests", k.waiting),
                sum: formatMoney(k.waitingSum),
              }),
            ]
          : []),
      ];
  return {
    title: t("reports.connect.title"),
    lines,
    href: "/connect",
    open: t("reports.connect.open"),
  };
}

export async function reportExtras(
  viewer: Actor,
  period: Period,
  today: string,
  timezone: string,
): Promise<ReportPart[]> {
  const parts: ReportPart[] = [];
  if (canUseModule(viewer, "content"))
    parts.push(await contentPart(viewer, period, today, timezone));
  if (canSeeConnect(viewer)) parts.push(await connectPart(period, today));
  return parts;
}
