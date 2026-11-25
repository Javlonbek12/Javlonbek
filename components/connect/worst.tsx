import Link from "next/link";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SHOWN } from "@/modules/connect/shown";
import type { WorstList } from "@/modules/connect/worst";

import { Section, ToneBar, ToneValue } from "./parts";
import { TONE_COLOR, toneRank } from "./tone";

// «Худшие результаты»: the five lowest numbers of each kind next to each other, so the worst is
// seen before anything is read (asked by the owner on 23.11.2026, after the Kazakhstan team's
// dashboard). Each list is a card outlined by its worst row; the colours are the norms'.

// The lowest first; `rows` come already sorted.
export function WorstSection({ lists }: { lists: WorstList[] }) {
  const shown = lists.filter((list) => list.rows.length > 0);
  if (!shown.length) return null;
  return (
    <Section
      sources={["smartup", "bot"]}
      title={t("connect.worst.title")}
      hint={t("connect.worst.hint")}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
        {shown.map((list) => {
          const rows = list.rows.slice(0, SHOWN.worst);
          // The card is as bad as its worst row.
          const worst = rows.map((r) => r.tone).sort((a, b) => toneRank(a) - toneRank(b))[0];
          return (
            <div
              key={list.key}
              className={cn(
                "flex min-w-0 flex-col gap-2.5 rounded-xl border-2 p-3 print:break-inside-avoid",
                worst === "bad" && "border-red-400 bg-red-500/[0.04] dark:border-red-500/70",
                worst === "warn" && "border-amber-400 bg-amber-400/[0.05]",
                worst !== "bad" && worst !== "warn" && "border-emerald-500/50",
              )}
            >
              <div className="flex flex-col gap-0.5">
                <h3 className="flex items-center gap-1.5 text-sm leading-tight font-semibold">
                  {worst && (
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: TONE_COLOR[worst] }}
                    />
                  )}
                  {list.title}
                </h3>
                <span className="text-muted-foreground text-xs">{list.norm}</span>
              </div>
              <ol className="flex flex-col gap-2">
                {rows.map((row, i) => {
                  const name = (
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate text-sm font-medium">{row.title}</span>
                      {row.note && (
                        <span className="text-muted-foreground truncate text-xs">{row.note}</span>
                      )}
                    </span>
                  );
                  return (
                    <li key={row.key} className="flex flex-col gap-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="flex min-w-0 items-start gap-1.5">
                          <span className="text-muted-foreground w-3.5 shrink-0 text-xs tabular-nums">
                            {i + 1}
                          </span>
                          {row.href ? (
                            <Link href={row.href} className="hover:text-primary min-w-0">
                              {name}
                            </Link>
                          ) : (
                            name
                          )}
                        </span>
                        <span className="flex shrink-0 flex-col items-end">
                          <ToneValue tone={row.tone}>{row.value}%</ToneValue>
                          {row.of && (
                            <span className="text-muted-foreground text-[11px] tabular-nums">
                              {row.of}
                            </span>
                          )}
                        </span>
                      </span>
                      <ToneBar value={row.value} tone={row.tone} />
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
