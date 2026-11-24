import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConnectUploadForm } from "@/components/connect/upload-form";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { PageHeader } from "@/components/ui/page-header";
import type { ConnectKind } from "@/lib/generated/prisma/enums";
import { dateFormat, t } from "@/lib/i18n";
import { SAMPLE_EFFECT as EFFECT } from "@/modules/connect/sample-guide";
import { canLeadConnect, connectLoaded, lastImports } from "@/modules/connect/service";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { formatRange, plural } from "@/modules/reports/format";
import { todayInTimezone } from "@/lib/dates";

import { clearConnectAction, importConnectFileAction } from "../actions";

const ERRORS = ["forbidden", "empty", "unknown", "tooBig", "sample"] as const;
const KINDS = [
  "SU_VISIT",
  "SU_PERSON",
  "VISIT",
  "OOS",
  "ORDER",
  "PAYMENT",
  "AUDIT",
  "ISM_CHECK",
  "ROUTE",
  "CLIENT",
  "SU_POSITION",
  "SALE",
] as const satisfies ConnectKind[];

// Upload the Connect bot's and Smart Up's Excel exports (and the CRM's employee info and sales);
// what is loaded now, recent uploads and (for the owner) a full reset.
export default async function ConnectImportPage({ searchParams }: PageProps<"/connect/import">) {
  const user = await requireUser();
  if (!canLeadConnect(user)) redirect("/connect");
  const params = await searchParams;
  const error = ERRORS.find((e) => e === params.error);
  const done = typeof params.done === "string" ? params.done.split("\n").filter(Boolean) : [];
  const [imports, loaded, { timezone }] = await Promise.all([
    lastImports(),
    connectLoaded(),
    getSettings(user.id),
  ]);
  // The rows as the files have them: sales are stored a store's day per row but counted in the
  // report's lines, so the total is the sum of what is listed, not the rows of the table.
  const total = loaded.reduce((sum, l) => sum + l.count, 0);
  // Times in the viewer's time zone, not the server's.
  const when = dateFormat({ dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const today = todayInTimezone(timezone);
  // The bot's own times are Tashkent time (UTC+5, no summer time).
  const stamp = (value: string) => when.format(new Date(`${value}:00+05:00`));
  const kindName = (kind: string) =>
    KINDS.includes(kind as ConnectKind) ? t(`connect.kinds.${kind as ConnectKind}`) : kind;

  return (
    <div className="flex max-w-3xl flex-col gap-5 [&>*]:min-w-0">
      <Link
        href="/connect"
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        {t("connect.import.back")}
      </Link>
      <PageHeader title={t("connect.import.title")} />

      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`connect.import.errors.${error}`)}
        </p>
      )}
      {done.length > 0 && (
        <div role="status" className="rounded-md bg-emerald-500/10 p-3 text-sm">
          <p className="font-medium">{t("connect.import.done")}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {done.map((line) => {
              const [
                file = "",
                kind = "",
                created = "0",
                updated = "0",
                skipped = "0",
                kept = "0",
                newer = "",
                from = "",
                to = "",
                test = "0",
                replaced = "",
                samples = "0",
              ] = line.split("|");
              const range = from && to ? formatRange(from, to, today) : null;
              // Under the line: the days (sales have them in the line), the rows replaced, test
              // stores left out.
              const notes = [
                range &&
                  kind !== "SALE" &&
                  (replaced
                    ? t("connect.import.replaced", { range })
                    : t("connect.import.range", { range })),
                replaced &&
                  replaced !== "0" &&
                  t("connect.import.replacedRows", { count: replaced }),
                test !== "0" && t("connect.import.testRows", { count: test }),
                samples !== "0" && t("connect.samples.rowsLeft", { count: samples }),
              ].filter(Boolean);
              return (
                <li key={line}>
                  {kind === "SU_POSITION"
                    ? t("connect.import.resultPositions", {
                        file,
                        count: plural("connect.words.positions", Number(created)),
                      })
                    : kind === "SALE"
                      ? t("connect.import.resultSales", {
                          file,
                          count: plural("connect.words.rows", Number(created)),
                          range: range ?? "—",
                        })
                      : kind === "SU_VISIT" || kind === "ROUTE" || kind === "CLIENT"
                        ? t("connect.import.resultSmartUp", { file, kind: kindName(kind), created })
                        : t("connect.import.result", {
                            file,
                            kind: kindName(kind),
                            created,
                            updated,
                          })}
                  {skipped !== "0" && `; ${t("connect.import.skipped", { count: skipped })}`}
                  {notes.length > 0 && (
                    <span className="text-muted-foreground block text-xs">{notes.join(" · ")}</span>
                  )}
                  {newer && (
                    <span className="mt-0.5 block font-medium text-amber-700 dark:text-amber-300">
                      {t("connect.import.older", { date: stamp(newer), count: kept })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <Button asChild size="sm" className="mt-3">
            <Link href="/connect">{t("connect.import.open")}</Link>
          </Button>
        </div>
      )}
      {params.cleared && (
        <p role="status" className="rounded-md bg-emerald-500/10 p-3 text-sm">
          {t("connect.import.cleared")}
        </p>
      )}

      <Card className="gap-3">
        <CardDescription>{t("connect.import.hint")}</CardDescription>
        <ConnectUploadForm action={importConnectFileAction} />
      </Card>

      <Card id="samples" className="scroll-mt-20 gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle>{t("connect.samples.title")}</CardTitle>
            <CardDescription>{t("connect.samples.hint")}</CardDescription>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <a href="/api/connect/samples" download>
              <Download />
              {t("connect.samples.all")}
            </a>
          </Button>
        </div>
        <ul className="flex flex-col divide-y text-sm">
          {KINDS.map((kind) => (
            <li key={kind} className="flex flex-col gap-1 py-2.5">
              <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-medium">{t(`connect.kinds.${kind}`)}</span>
                <a
                  href={`/api/connect/samples?kind=${kind}`}
                  download
                  className="text-primary shrink-0 text-xs underline underline-offset-2"
                  aria-label={`${t("connect.samples.one")}: ${t(`connect.kinds.${kind}`)}`}
                >
                  {t("connect.samples.one")}
                </a>
              </span>
              <span className="text-muted-foreground text-xs">
                {t(`connect.samples.what.${kind}`)}
              </span>
              <span className="text-muted-foreground text-xs">
                <span className="text-foreground">{t("connect.samples.sourceLabel")}</span>{" "}
                {t(`connect.samples.source.${kind}`)}{" "}
                <span className="text-foreground">{t("connect.samples.effectLabel")}</span>{" "}
                {t(`connect.samples.effect.${EFFECT[kind]}`)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="gap-3">
        <CardTitle>{t("connect.import.loaded")}</CardTitle>
        {loaded.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("connect.import.loadedNone")}</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {KINDS.flatMap((kind) => loaded.filter((l) => l.kind === kind)).map((l) => (
              <li key={l.kind} className="flex flex-col gap-0.5 py-2">
                <span>{kindName(l.kind)}</span>
                <span className="text-muted-foreground text-xs">
                  {[
                    l.kind === "SU_POSITION"
                      ? t("connect.import.loadedPositions", { count: l.count })
                      : t("connect.import.loadedRows", { count: l.count }),
                    l.from &&
                      l.to &&
                      t("connect.import.loadedRange", { range: formatRange(l.from, l.to, today) }),
                    l.at && t("connect.import.loadedAt", { date: when.format(l.at) }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="gap-3">
        <CardTitle>{t("connect.import.history")}</CardTitle>
        <CardDescription>{t("connect.import.total", { count: total })}</CardDescription>
        {imports.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("connect.import.none")}</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {imports.map((i) => (
              <li key={i.id} className="flex flex-col gap-0.5 py-2">
                <span className="break-all">{i.fileName}</span>
                <span className="text-muted-foreground text-xs">
                  {when.format(i.createdAt)} · {i.kinds.split(",").map(kindName).join(", ")} ·{" "}
                  {t("connect.import.historyRow", { created: i.created, updated: i.updated })}
                  {i.kept > 0 && ` · ${t("connect.import.historyKept", { count: i.kept })}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {user.role === "OWNER" && total > 0 && (
        <Card className="gap-3">
          <CardTitle>{t("connect.import.clear")}</CardTitle>
          <CardDescription>{t("connect.import.clearHint")}</CardDescription>
          <ConfirmAction
            label={t("connect.import.clearConfirm")}
            title={t("connect.import.clearQuestion", { count: total })}
            hint={t("connect.import.clearHint")}
            confirm={t("connect.import.clearYes")}
            action={clearConnectAction}
          />
        </Card>
      )}
    </div>
  );
}
