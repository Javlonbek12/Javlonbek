import Link from "next/link";

import { t } from "@/lib/i18n";
import {
  ATTENTION_SHOWN,
  attentionRules,
  type AttentionReason,
  type AttentionRow,
} from "@/modules/connect/attention";
import type { ConnectRules } from "@/modules/connect/rules";

import { DataTable, RulesLink, Section } from "./parts";
import { TsmName } from "./sections";

// A reason as a short phrase with its number: «Connect на 54% визитов (из 120)».
export const reasonText = (reason: AttentionReason) =>
  t(`connect.attention.reason.${reason.kind}`, { value: reason.value, of: reason.of ?? "" });

// «Требует внимания» at the top of the leadership's and the managers' levels: who to talk to and
// about what, the most reasons first. The first ten; the whole list is in the Excel file.
export function AttentionSection({
  rows,
  personHref,
  attendance = false,
  rules,
  rulesHref,
}: {
  rows: (AttentionRow & { canOpen: boolean })[];
  personHref: (code: string) => string;
  // The route analysis gives the share of planned visits made: that rule is looked at too.
  attendance?: boolean;
  // The lines the list was made with (the standard ones without them), and where the owner
  // changes them.
  rules?: ConnectRules;
  rulesHref?: string;
}) {
  const R = attentionRules(rules);
  const hint = t("connect.attention.hint", {
    connect: R.connect.below,
    recovery: R.recovery.below,
    followUp: R.followUp.below,
    unsold: R.unsold.from,
  });
  return (
    <Section
      sources={["smartup", "bot"]}
      nav={t("connect.attention.title")}
      action={rulesHref && <RulesLink href={rulesHref} />}
      title={
        rows.length
          ? `${t("connect.attention.title")} · ${rows.length}`
          : t("connect.attention.title")
      }
      hint={
        attendance
          ? `${hint} ${t("connect.attention.hintAttendance", { attendance: R.attendance.below })}`
          : hint
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {t("connect.attention.none")}
        </p>
      ) : (
        <DataTable
          rows={rows}
          rowKey={(r) => r.code}
          limit={ATTENTION_SHOWN}
          columns={[
            {
              key: "tsm",
              header: t("connect.col.tsm"),
              cell: (r) =>
                r.canOpen ? (
                  <Link
                    href={personHref(r.code)}
                    className="text-primary underline underline-offset-2"
                  >
                    <TsmName code={r.code} name={r.name} />
                  </Link>
                ) : (
                  <TsmName code={r.code} name={r.name} />
                ),
              className: "min-w-44",
            },
            {
              key: "manager",
              header: t("connect.attention.manager"),
              cell: (r) =>
                r.manager ? (
                  <span className="flex flex-col">
                    <span>{r.manager.name ?? r.manager.title}</span>
                    {r.manager.name && (
                      <span className="text-muted-foreground text-xs">{r.manager.title}</span>
                    )}
                  </span>
                ) : (
                  "—"
                ),
              className: "min-w-36",
            },
            {
              key: "reasons",
              header: t("connect.attention.reasons"),
              cell: (r) => (
                <span className="flex flex-col gap-0.5">
                  {r.reasons.map((reason) => (
                    <span key={reason.kind} className="text-amber-700 dark:text-amber-400">
                      {reasonText(reason)}
                    </span>
                  ))}
                </span>
              ),
              className: "min-w-64",
            },
          ]}
        />
      )}
    </Section>
  );
}
